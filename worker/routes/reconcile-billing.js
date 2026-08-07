/**
 * Ask Stripe, nightly, what it thinks each subscription is doing.
 *
 * ── Why pull and not a webhook ──────────────────────────────────────────────
 *
 * This app has no Stripe webhook, and `plan` could therefore only ever move
 * forward. verify-checkout set it to 'active' when a browser came back from
 * Checkout, and nothing on earth set it to anything else. A restaurant that
 * cancelled in Stripe, or whose card stopped working, stayed 'active' in this
 * database permanently — so the enforcement in shared/entitlement.js would have
 * had nothing true to enforce against.
 *
 * A webhook is the textbook answer and it is the wrong one at this size. It
 * means a public unauthenticated endpoint, signature verification, replay
 * handling, and an outage window during which events are missed and must be
 * backfilled by hand. This is a handful of restaurants on a monthly plan.
 *
 * Polling once a day is a dozen API calls, needs no new endpoint and no new
 * secret, and is self-healing: a night that fails changes nothing, because the
 * next night asks the same question again. There is no state to miss, because
 * nothing is being delivered — the truth is in Stripe and we go and read it.
 *
 * If this ever runs to hundreds of restaurants, swap it for a webhook and keep
 * this as the reconciliation pass behind it. Do not delete it: a webhook with
 * no reconciliation is a system that is confidently wrong the first time an
 * event is dropped.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It never touches a restaurant with no `stripe_subscription_id`. Those are on
 * trial, their clock is `trial_ends_at`, and Stripe has never heard of them.
 *
 * It never writes 'active' onto a row Stripe does not say is active. The only
 * direction this job is allowed to invent is the one that stops service, and
 * even that comes from Stripe's own status string rather than from arithmetic
 * here.
 */
import { serviceRole } from '../lib/data.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';
import { audit as recordAudit, ACTIONS } from '../lib/audit.js';

/**
 * Stripe subscription status to the plan column.
 *
 * `trialing` maps to active because a Stripe-side trial is a subscription that
 * has been set up and is being honoured — the operator handed over a card.
 * `incomplete` maps to nothing: the checkout has not finished and the row
 * should keep whatever it had rather than be knocked off a trial it is still
 * legitimately on.
 */
const PLAN_FOR = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'cancelled',
  incomplete_expired: 'cancelled',
};

/** How many restaurants one nightly invocation will reconcile. */
const MAX_PER_RUN = 200;

/**
 * @returns {Promise<object>} a summary for the log line — never throws, because
 *   an exception out of a scheduled handler marks the invocation failed and
 *   loses the summary that says which restaurant it died on.
 */
export async function scheduled(env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    // Not an error. A deployment with no Stripe key is one where nobody has
    // subscribed, and there is nothing to reconcile.
    return { job: 'reconcile-billing', skipped: 'no_stripe_key' };
  }

  let svc;
  try {
    svc = serviceRole(env);
  } catch (error) {
    return { job: 'reconcile-billing', failed: error.message };
  }

  const restaurants = await svc.entity('Restaurant').list('created_date', MAX_PER_RUN);
  const subscribed = restaurants.filter((r) => r.stripe_subscription_id);

  let checked = 0;
  let changed = 0;
  const failures = [];

  for (const r of subscribed) {
    checked += 1;
    try {
      const res = await fetchWithTimeout(
        `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(r.stripe_subscription_id)}`,
        { headers: { Authorization: `Bearer ${key}` } },
        TIMEOUTS.payment,
      );
      const sub = await res.json();

      if (!res.ok) {
        // A 404 means the subscription id on this row does not exist in Stripe
        // at all. That is worth surfacing rather than acting on: deleting
        // someone's service because of a bad id in our own column is precisely
        // the failure entitlement.js is written to avoid.
        failures.push({ restaurant_id: r.id, status: res.status });
        continue;
      }

      const plan = PLAN_FOR[sub.status];
      if (!plan) continue;

      const periodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null;
      const planChanged = plan !== r.plan;
      const periodChanged = periodEnd && periodEnd !== Number(r.current_period_end);
      if (!planChanged && !periodChanged) continue;

      await svc.entity('Restaurant').update(r.id, {
        plan,
        ...(periodEnd ? { current_period_end: periodEnd } : {}),
      });
      changed += 1;

      // Only when the plan itself moved. A period end sliding forward on a
      // healthy subscription every month is not a dispute anybody will ever
      // ask about; service stopping is.
      if (planChanged) {
        await recordAudit(env, null, {
          action: ACTIONS.BILLING_RECONCILED,
          restaurantId: r.id,
          detail: { plan, previous_plan: r.plan || 'trial', reason: sub.status },
        });
      }
    } catch (error) {
      failures.push({ restaurant_id: r.id, error: error.message });
    }
  }

  return {
    job: 'reconcile-billing',
    checked,
    changed,
    ...(failures.length ? { failures } : {}),
    ...(subscribed.length === MAX_PER_RUN ? { truncated: MAX_PER_RUN } : {}),
  };
}
