/**
 * POST /api/delete-account — erase a person, and be honest about the edges.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * src/pages/Privacy.jsx tells every visitor they may "delete their account and
 * all associated data at any time from the app's profile settings", and
 * src/pages/Profile.jsx has the button, the type-DELETE confirmation and the
 * warning to go with it. It called invoke('deleteAccount'), which posts to
 * /api/fn/deleteAccount, and no such handler has ever existed — so the request
 * 404'd, the error surfaced, and the promise in the policy was one the software
 * could not keep. Nevada's NRS 603A and California's CCPA both make that a
 * claim worth being able to honour rather than merely publish.
 *
 * ── What is deleted, and what is deliberately not ───────────────────────────
 *
 * Deleted outright: the auth user, the profile row, and any demo restaurants
 * this person stood up along with their ratings and contacts — those are
 * ephemeral by design and already expire in twenty-four hours.
 *
 * Detached rather than destroyed: splits they hosted. A split belongs to
 * everybody who ate at that table, not only to the person who photographed the
 * receipt, and deleting one would take other diners' records of what they paid
 * with it. `created_by_id` is nulled instead, which is what ties the row to a
 * person; retention.js already redacts names and claim lists at thirty days.
 *
 * Pseudonymised: the audit log. It is append-only and it is what a payment
 * dispute is settled from — worker/lib/audit.js argues that at length — so the
 * rows stay and `actor_user_id` is nulled. Everything else in them is already a
 * one-way fingerprint rather than an identity.
 *
 * ── The one case this refuses ───────────────────────────────────────────────
 *
 * Somebody who owns a real restaurant is turned away, with the names, rather
 * than half-served. Deleting the row would take a paying business off the air
 * mid-service and strand every table tent already printed. Nulling `owner_id`
 * is worse: findOrAdoptRestaurant documents that a row with a null owner is
 * *adoptable*, so orphaning one hands a stranger the keys to a business's
 * ratings and its alert address.
 *
 * Neither is a defensible reading of "delete my account", so the account stays
 * and the person is told exactly what to wind down first. That is an ordinary
 * contractual-obligation carve-out and it is honest, which the alternative —
 * reporting success while a business quietly breaks — is not.
 *
 * Bindings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optionally
 * STRIPE_SECRET_KEY to cancel a live Pro subscription on the way out.
 */
import { json } from '../lib/email.js';
import { currentUser, serviceRole } from '../lib/data.js';
import { supabaseUrl } from '../lib/db.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';
import { audit, ACTIONS, fingerprint } from '../lib/audit.js';

/** The word the UI already makes them type. Checked again here. */
const CONFIRMATION = 'DELETE';

/** PostgREST, as service role. Returns the rows it touched. */
async function write(env, table, params, { method = 'PATCH', body } = {}) {
  const res = await fetchWithTimeout(
    `${supabaseUrl(env)}/rest/v1/${table}?${params}`,
    {
      method,
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    TIMEOUTS.database,
  );
  if (!res.ok) {
    throw new Error(`${table} ${method} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

const eq = (column, value) => {
  const p = new URLSearchParams();
  p.append(column, `eq.${value}`);
  return p;
};

/**
 * Stops the money before the account that could cancel it is gone.
 *
 * Deleting the row first would leave a subscription nobody in this app can
 * reach — the exact orphan a Payment Link once created here, except this time
 * self-inflicted and still billing. A failure is logged and not fatal: refusing
 * to delete somebody's account because Stripe timed out would be the worse of
 * the two outcomes, and the subscription is recoverable from Stripe's own
 * dashboard whereas their patience is not.
 */
async function stripeGet(env, path) {
  const res = await fetchWithTimeout(
    `https://api.stripe.com/v1/${path}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
    TIMEOUTS.payment,
  );
  if (!res.ok) throw new Error(`stripe GET ${path} → ${res.status}`);
  return res.json();
}

async function stripeCancel(env, subscriptionId) {
  const res = await fetchWithTimeout(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
    TIMEOUTS.payment,
  );
  if (!res.ok && res.status !== 404) throw new Error(`stripe cancel ${subscriptionId} → ${res.status}`);
}

/**
 * Cancel every subscription this person has, asking Stripe rather than the row.
 *
 * ── The orphan this closes ──────────────────────────────────────────────────
 *
 * The first version cancelled only profile.stripe_subscription_id, and that
 * column is written by the webhook — so a subscription paid on Stripe seconds
 * ago, whose checkout.session.completed has not landed yet, is invisible to a
 * database read. Delete the account in that window and the live subscription is
 * never cancelled: the row is gone, nothing in the app can reach it, and
 * reconcile-billing walks only Restaurant rows, so it bills the deleted person's
 * card forever. The window is not merely the usual few seconds either — a
 * transient Stripe error puts the webhook into backoff for minutes.
 *
 * So the source of truth is Stripe. Look the customer up by the id we have and
 * by email — create-pro-checkout hands Stripe customer_email for a first-timer,
 * so the customer exists there under the email before our row ever names it —
 * and cancel every active or trialing subscription found on any matching
 * customer. Belt and suspenders: the DB-recorded id is cancelled too, in case
 * the customer lookup misses it.
 *
 * Every Stripe call is wrapped: a failure is logged and returns what was
 * cancelled so far rather than aborting the deletion. Refusing to erase
 * somebody because Stripe timed out is the worse outcome, and a leftover
 * subscription is visible and cancellable from Stripe's own dashboard, which a
 * person's patience is not.
 *
 * @returns {Promise<{cancelled: number, checked: boolean}>}
 */
async function cancelAllSubscriptions(env, { subscriptionId, customerId, email }) {
  if (!env?.STRIPE_SECRET_KEY) return { cancelled: 0, checked: false };
  const toCancel = new Set();
  try {
    // Customers matching this person: the recorded id, plus any under the email.
    const customerIds = new Set();
    if (customerId) customerIds.add(customerId);
    if (email) {
      const found = await stripeGet(env, `customers?email=${encodeURIComponent(email)}&limit=100`);
      for (const c of found?.data || []) if (c?.id) customerIds.add(c.id);
    }
    for (const cid of customerIds) {
      const subs = await stripeGet(env, `subscriptions?customer=${encodeURIComponent(cid)}&status=all&limit=100`);
      for (const s of subs?.data || []) {
        // Only the ones still costing money. canceled/incomplete_expired are done.
        if (s?.id && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status)) toCancel.add(s.id);
      }
    }
    // The row's own id, even if the lookups above never surfaced it.
    if (subscriptionId) toCancel.add(subscriptionId);

    let cancelled = 0;
    for (const id of toCancel) {
      await stripeCancel(env, id);
      cancelled += 1;
    }
    return { cancelled, checked: true };
  } catch (err) {
    console.error('delete-account: subscription cancellation incomplete', err?.message);
    // Cancel whatever we already resolved before the failure, best-effort.
    let cancelled = 0;
    for (const id of toCancel) {
      try { await stripeCancel(env, id); cancelled += 1; } catch { /* logged above */ }
    }
    return { cancelled, checked: false };
  }
}

export async function onRequestPost({ request, env, ctx, requestId = null }) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: 'Sign in first.', code: 'unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  if (String(body?.confirm || '').trim().toUpperCase() !== CONFIRMATION) {
    // The screen already asks for this. Checked again because an endpoint that
    // erases a person on an empty POST is one stray fetch away from doing it.
    return json({ error: `Send confirm: "${CONFIRMATION}" to delete an account.`, code: 'not_confirmed' }, 400);
  }

  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('delete-account: not configured — SUPABASE_SERVICE_ROLE_KEY is empty or unset');
    return json({ error: 'Account deletion is unavailable right now.', code: 'not_configured' }, 503);
  }

  const svc = serviceRole(env);
  const removed = { demo_restaurants: 0, demo_ratings: 0, demo_contacts: 0, splits_detached: 0, audit_pseudonymised: 0 };

  try {
    const owned = await svc.entity('Restaurant')
      .filter({ owner_id: user.id }, { select: 'id,name,slug,demo,plan' });

    const real = owned.filter((r) => !r.demo);
    if (real.length) {
      // Named, because "you own a restaurant" is not actionable and the person
      // may well have forgotten a row they made once in a trial.
      return json({
        error: 'Wind down your restaurant first, then delete your account.',
        code: 'owns_restaurant',
        restaurants: real.map((r) => ({ name: r.name, slug: r.slug, plan: r.plan })),
      }, 409);
    }

    // Demo pages carry a real business's name and were never theirs to keep.
    for (const demo of owned) {
      removed.demo_ratings += await write(env, 'guest_ratings', eq('restaurant_id', demo.id), { method: 'DELETE' });
      removed.demo_contacts += await write(env, 'guest_contacts', eq('restaurant_id', demo.id), { method: 'DELETE' });
      const guard = eq('id', demo.id);
      guard.append('demo', 'eq.true');
      removed.demo_restaurants += await write(env, 'restaurants', guard, { method: 'DELETE' });
    }

    const profile = (await svc.entity('Profile')
      .filter({ id: user.id }, { select: 'id,stripe_customer_id,stripe_subscription_id' }))[0] || null;
    // Asked of Stripe, by customer and by email, not just the row — see the
    // header on cancelAllSubscriptions for the orphan this closes.
    const billing = await cancelAllSubscriptions(env, {
      subscriptionId: profile?.stripe_subscription_id || null,
      customerId: profile?.stripe_customer_id || null,
      email: user.email || null,
    });

    removed.splits_detached = await write(env, 'sessions', eq('created_by_id', user.id), { body: { created_by_id: null } });
    removed.audit_pseudonymised = await write(env, 'audit_log', eq('actor_user_id', user.id), { body: { actor_user_id: null } });

    if (profile) await write(env, 'profiles', eq('id', user.id), { method: 'DELETE' });

    /**
     * The ownership check, re-run against the moment of deletion.
     *
     * The guard at the top of this function is a check; the auth-user delete
     * below is the act, and between them is a window. It matters because
     * restaurants.owner_id is `on delete set null` (migration 0001), and
     * findOrAdoptRestaurant treats a null-owner row as adoptable — so deleting a
     * user who acquired a real restaurant in that window would hand a live
     * business's ratings and alert address to whoever claims the slug next.
     *
     * Re-reading here shrinks the window to almost nothing and, more to the
     * point, refuses rather than orphans: if a real restaurant now exists, the
     * account is left intact (the profile is already deleted, which is
     * recoverable on the next sign-in; an orphaned business is not).
     */
    const stillOwned = await svc.entity('Restaurant')
      .filter({ owner_id: user.id }, { select: 'id,demo' });
    if (stillOwned.some((r) => !r.demo)) {
      console.error(`delete-account: ${user.id} acquired a real restaurant mid-deletion — refusing to orphan it`);
      return json({
        error: 'A restaurant was linked to your account during deletion. Nothing was removed from Stripe billing. Wind the restaurant down and try again.',
        code: 'owns_restaurant',
      }, 409);
    }

    /**
     * The auth user last, and this one must not fail quietly.
     *
     * Everything above is reversible-ish or merely detached; this is the row
     * that decides whether the person can still sign in. Leaving it behind
     * after the rest is gone is the worst of both: an account that still works,
     * attached to nothing, whose owner was told it was deleted.
     */
    const res = await fetchWithTimeout(
      `${supabaseUrl(env)}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
      TIMEOUTS.database,
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`auth user delete failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }

    /**
     * Recorded by fingerprint, not by id.
     *
     * A deletion has to leave evidence it happened — it is the one action here
     * whose absence from the log is indistinguishable from it never being
     * asked for. Writing the raw user id would put back the identifier every
     * other row in this table just had removed, so it goes in one-way, which is
     * enough to tie a support conversation to a record and not enough to
     * reconstitute the person.
     */
    await audit(env, ctx, {
      action: ACTIONS.ACCOUNT_DELETED,
      request,
      requestId,
      detail: { subject_fp: await fingerprint(user.id), subscriptions_cancelled: billing.cancelled, billing_checked: billing.checked, ...removed },
    });

    return json({ ok: true, deleted: true, ...removed });
  } catch (error) {
    // Loud, and a 5xx. A half-finished deletion reported as success is how
    // somebody ends up believing their data is gone when it is not.
    console.error('delete-account: failed part-way', error?.message);
    await audit(env, ctx, {
      action: ACTIONS.ACCOUNT_DELETED,
      request,
      requestId,
      outcome: 'error',
      detail: { subject_fp: await fingerprint(user.id), message: String(error?.message || '').slice(0, 200), ...removed },
    }).catch(() => {});
    return json({ error: 'Could not finish deleting the account. Nothing further was removed.', code: 'incomplete' }, 500);
  }
}
