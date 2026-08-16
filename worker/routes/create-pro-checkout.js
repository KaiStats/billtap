/**
 * POST /api/create-pro-checkout — start a 99c consumer Pro subscription.
 *
 * ── Why this is not create-checkout ─────────────────────────────────────────
 *
 * That route sells the $149 restaurant plan and takes a restaurant_id out of
 * the request body with no authentication at all. For a restaurant that is
 * merely loose: the worst a stranger can do is pay for somebody else's
 * subscription.
 *
 * Here it would be the whole bug. Consumer Pro attaches to a person, so the
 * question "who is this for" has to be answered by a verified session and never
 * by the body — otherwise anyone could start a checkout in anyone's name, and
 * more to the point the webhook would then grant Pro to whichever user id the
 * caller typed.
 *
 * So: currentUser or nothing, and the id goes into Stripe's metadata from the
 * session rather than from the request.
 *
 * Bindings:
 *   STRIPE_SECRET_KEY     required
 *   STRIPE_PRO_PRICE_ID   required — the recurring $0.99/mo price
 *   PUBLIC_BASE_URL       optional, defaults to the request's own origin
 */
import { json } from '../lib/email.js';
import { currentUser, serviceRole } from '../lib/data.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

/** Matches the "14-day free trial" the pricing card has always promised. */
const TRIAL_DAYS = 14;

export async function onRequestPost({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: 'Sign in first.', code: 'unauthorized' }, 401);

  const key = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRO_PRICE_ID;
  if (!key || !price) {
    // Named individually, for the reason create-checkout.js gives: a secret
    // can exist with an empty value, so "or" sends somebody to check two
    // bindings that both look present.
    const missing = [!key && 'STRIPE_SECRET_KEY', !price && 'STRIPE_PRO_PRICE_ID'].filter(Boolean);
    console.error(`create-pro-checkout: not configured — ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty or unset`);
    return json({ error: 'Billing is not configured yet.', code: 'not_configured' }, 503);
  }

  /**
   * What this person already has, before selling them another one.
   *
   * ── The two holes this closes ───────────────────────────────────────────
   *
   * The route checked only that somebody was signed in and then created a
   * Checkout Session unconditionally, and the Pro button on the pricing card is
   * live for every signed-in visitor including current subscribers. So: subscribe
   * in January; in February land on the home page, not remember, and tap Get
   * Pro. The idempotency key is bucketed by the hour, so a different hour is a
   * different key and Stripe made a second session quite happily. Worse, the
   * request passed customer_email and never `customer`, so Stripe minted a
   * *second* Customer — and the webhook then overwrote stripe_subscription_id
   * with the new one. The first subscription was left referenced by nothing in
   * the database: billed monthly, forever, and unreachable from any screen,
   * route or reconcile job in this codebase.
   *
   * The same gap re-granted the trial. Fourteen free days are attached per
   * session, and because each checkout created a fresh Customer, Stripe's own
   * customer-level trial tracking could not deduplicate them either. Cancel on
   * day thirteen, resubscribe on day fifteen, and the unlimited party size is
   * permanent and free.
   *
   * A read failure is deliberately not fatal: the answer only ever narrows what
   * this route will do, and refusing to sell Pro because one SELECT timed out
   * is worse than the duplicate it prevents. It fails toward the old behaviour,
   * which the idempotency key still guards against a double-tap.
   */
  let profile = null;
  try {
    const rows = await serviceRole(env).entity('Profile').filter(
      { id: user.id },
      { select: 'id,plan,plan_expires_at,stripe_customer_id,stripe_subscription_id' },
    );
    profile = rows[0] || null;
  } catch (err) {
    console.error('create-pro-checkout: could not read the profile', err?.message);
  }

  const expires = Number(profile?.plan_expires_at) || null;
  if (profile?.plan === 'pro' && (!expires || Date.now() < expires)) {
    // Named so the browser can say "you already have Pro" rather than showing a
    // generic failure to somebody whose card is already being charged.
    return json({ error: 'You are already on Pro.', code: 'already_pro' }, 409);
  }

  /**
   * Reusing the Customer is what stops the orphan.
   *
   * With `customer` set, a second subscription lands on the same Stripe customer
   * — visible in one place, cancellable, and counted by Stripe's own trial
   * rules. customer_email is only for somebody who has genuinely never paid.
   */
  const returning = typeof profile?.stripe_customer_id === 'string' && profile.stripe_customer_id;

  const origin = env.PUBLIC_BASE_URL || new URL(request.url).origin;

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',

    /**
     * The user id, twice, and both on purpose.
     *
     * `client_reference_id` is on the Checkout Session and is what
     * `checkout.session.completed` carries. The subscription metadata is what
     * every later event carries — a renewal, a cancellation, a failed card —
     * none of which mention the session that started it. Setting only the
     * first would mean the webhook could provision Pro and then never hear
     * about it ending.
     */
    client_reference_id: user.id,
    'subscription_data[metadata][user_id]': user.id,
    'subscription_data[metadata][kind]': 'pro',

    success_url: `${origin}/profile?pro=1`,
    cancel_url: `${origin}/#pricing`,
    allow_promotion_codes: 'true',
  });

  /**
   * The trial is once per person, not once per checkout.
   *
   * A stripe_customer_id on the row is the record that this person has been
   * through checkout before, whatever became of that subscription — so the
   * fourteen days are offered to first-timers only. Somebody coming back after
   * cancelling is welcome; they just pay the 99c like everyone else, rather
   * than looping cancel-and-resubscribe for permanent free Pro.
   */
  if (!returning) params.set('subscription_data[trial_period_days]', String(TRIAL_DAYS));

  if (returning) {
    params.set('customer', String(profile.stripe_customer_id));
  } else if (user.email) {
    // Stripe knows this address already; passing it stops Checkout asking a
    // signed-in person to retype something the app is holding.
    params.set('customer_email', String(user.email));
  }

  try {
    const res = await fetchWithTimeout('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        /**
         * So a double-tap does not become two subscriptions.
         *
         * CLAUDE.md requires this on every Stripe transaction and nothing in
         * this codebase had one. Keyed on the user and the hour rather than on
         * a random value, because a random key is a new key every time and
         * therefore no protection at all: the thing being guarded against is
         * the same person pressing the button twice while the first request is
         * still in flight.
         *
         * The hour bucket is what lets them legitimately try again later —
         * after abandoning a checkout, or after a card was declined.
         */
        'Idempotency-Key': `pro-${user.id}-${Math.floor(Date.now() / 3600000)}`,
      },
      body: params,
    }, TIMEOUTS.payment);

    const data = await res.json();
    if (!res.ok) {
      console.error('create-pro-checkout: Stripe rejected', res.status, JSON.stringify(data).slice(0, 300));
      return json({ error: 'Could not start checkout.', code: 'stripe_error' }, 502);
    }
    return json({ ok: true, url: data.url });
  } catch (err) {
    console.error('create-pro-checkout: Stripe request threw', err?.message);
    return json({ error: 'Could not start checkout.', code: 'network' }, 502);
  }
}
