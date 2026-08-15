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
import { currentUser } from '../lib/data.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

/** Matches the "14-day free trial" the pricing card has always promised. */
const TRIAL_DAYS = 14;

export async function onRequestPost({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: 'Sign in first.', code: 'unauthorized' }, 401);

  const key = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRO_PRICE_ID;
  if (!key || !price) {
    console.error('create-pro-checkout: STRIPE_SECRET_KEY or STRIPE_PRO_PRICE_ID not configured');
    return json({ error: 'Billing is not configured yet.', code: 'not_configured' }, 503);
  }

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
    'subscription_data[trial_period_days]': String(TRIAL_DAYS),

    success_url: `${origin}/profile?pro=1`,
    cancel_url: `${origin}/#pricing`,
    allow_promotion_codes: 'true',
  });

  // Stripe knows this address already; passing it stops Checkout asking a
  // signed-in person to retype something the app is holding.
  if (user.email) params.set('customer_email', String(user.email));

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
