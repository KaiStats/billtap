/**
 * POST /api/create-checkout
 *
 * Opens a Stripe Checkout session for the $149/mo subscription and returns its
 * URL. The browser redirects there; Stripe handles the card, so no payment
 * details ever touch this app.
 *
 * Bindings:
 *   STRIPE_SECRET_KEY   required
 *   STRIPE_PRICE_ID     required — the recurring $149/mo price
 *   PUBLIC_BASE_URL     optional, defaults to the request's own origin
 */
import { json, clean, EMAIL_RE } from '../lib/email.js';
import { currentUser, serviceRole } from '../lib/data.js';

import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const restaurantId = clean(body.restaurant_id, 64);
  const email = clean(body.email, 200).toLowerCase();
  if (!restaurantId) return json({ error: 'restaurant_id is required' }, 400);

  /**
   * Who this checkout is for, answered by the session and never by the body.
   *
   * ── What taking it from the body allowed ────────────────────────────────
   *
   * This route accepted any restaurant_id from anyone, and verify-checkout
   * writes the resulting plan onto whatever Stripe's client_reference_id names.
   * That was described here as merely loose — "the worst a stranger can do is
   * pay for somebody else's subscription" — and that reading was wrong, because
   * the write does not only set `plan`. It overwrites stripe_subscription_id
   * and billing_address too.
   *
   * So: find a restaurant's id, which is in URLs and API responses, start a
   * checkout naming it, pay the $149. That restaurant's row now points at *your*
   * subscription. Theirs is orphaned — still billing them, and no longer
   * reachable from anything in this app. Then cancel yours, and the webhook
   * writes `cancelled` onto their row and takes their QR codes off the tables.
   * $149 to cut a competitor off and leave them paying for it.
   *
   * The fix is the one create-pro-checkout was built with from the start and
   * whose header already explains why: a paid plan attaches to somebody, so the
   * question "who is this for" has to be answered by a verified session.
   *
   * Ownership is re-read here rather than trusted from the client, and the
   * refusal is deliberately the same shape for "no such restaurant" and "not
   * yours" — telling a stranger which ids exist is its own small leak.
   */
  const user = await currentUser(env, request);
  if (!user) return json({ error: 'Sign in first.', code: 'unauthorized' }, 401);

  const owned = await serviceRole(env).entity('Restaurant')
    .filter({ id: restaurantId }, { select: 'id,owner_id' });
  if (!owned.length || String(owned[0].owner_id || '') !== String(user.id)) {
    console.error(`create-checkout: ${user.id} tried to pay for restaurant ${restaurantId}`);
    return json({ error: 'That restaurant is not on your account.', code: 'not_yours' }, 403);
  }

  const key = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRICE_ID;
  if (!key || !price) {
    /**
     * Name the one that is missing.
     *
     * "or" was accurate and useless: a secret can exist with an empty value,
     * so the dashboard shows both bindings present while one of them is a
     * blank string, and this message sent whoever was debugging it to check
     * two things that both looked fine. worker/lib/data.js already argues this
     * — a log saying only "misconfigured" costs an operator the evening it
     * takes to work out which one.
     *
     * The names go to the log, never to the response: which of our bindings is
     * unset is not a caller's business.
     */
    const missing = [!key && 'STRIPE_SECRET_KEY', !price && 'STRIPE_PRICE_ID'].filter(Boolean);
    console.error(`create-checkout: not configured — ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty or unset`);
    return json({ error: 'Billing is not configured yet.' }, 503);
  }

  const origin = env.PUBLIC_BASE_URL || new URL(request.url).origin;

  // Stripe's API is form-encoded, so this is a plain fetch — no SDK needed,
  // which keeps the Worker bundle small and avoids Node-only dependencies.
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    client_reference_id: restaurantId,
    success_url: `${origin}/restaurant-dashboard?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/restaurant-dashboard?checkout=cancelled`,
    'subscription_data[metadata][restaurant_id]': restaurantId,
    allow_promotion_codes: 'true',

    // Collect the billing address.
    //
    // Not cosmetic. Economic nexus is measured per state, and until this line
    // existed the state was captured nowhere — not on the Restaurant row, not
    // on the lead, and not in Stripe, because Checkout only asks for what the
    // card network requires. The customer list could not be broken down by
    // state at all, so the question "where do we have nexus" had no answer that
    // could be computed from anything.
    //
    // Retroactive only from here. Every subscription created before this ships
    // has no address on it, and Stripe cannot invent one — see
    // scripts/nexus-report.mjs, which reports those separately rather than
    // treating an unknown state as no exposure.
    billing_address_collection: 'required',

    /**
     * ── Why customer_update is NOT here ─────────────────────────────────────
     *
     * It used to be: `customer_update[address]` and `customer_update[name]`,
     * both 'auto', to keep the address on the Customer rather than only on the
     * expiring session. Stripe refuses that combination outright —
     *
     *   400  `customer_update` can only be used with `customer`.
     *
     * — because customer_update tells Stripe how to update an *existing*
     * customer, and this route never passes one: it hands over
     * `customer_email` and lets Checkout create the customer itself.
     *
     * So every restaurant checkout has been a 400 since that line was added.
     * The route answered "Could not start checkout" and nothing said why,
     * because the response body was logged but the log was never read — the
     * same shape of silent failure the header of worker/lib/base44.js
     * describes.
     *
     * Nothing is lost by removing it. In subscription mode Stripe creates the
     * Customer and saves the collected address onto it; customer_update was
     * only ever needed for a customer that already existed. The nexus report
     * reads it back through verify-checkout, which takes it from
     * `customer.address` or `customer_details.address` — both still populated
     * by billing_address_collection above.
     */
  });
  if (EMAIL_RE.test(email)) params.set('customer_email', email);

  try {
    const res = await fetchWithTimeout('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    }, TIMEOUTS.payment);

    const data = await res.json();
    if (!res.ok) {
      console.error('create-checkout: Stripe rejected', res.status, JSON.stringify(data));
      return json({ error: 'Could not start checkout.' }, 502);
    }
    return json({ ok: true, url: data.url });
  } catch (err) {
    console.error('create-checkout: Stripe request threw', err?.message);
    return json({ error: 'Could not start checkout.' }, 502);
  }
}
