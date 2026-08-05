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

  const key = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRICE_ID;
  if (!key || !price) {
    console.error('create-checkout: STRIPE_SECRET_KEY or STRIPE_PRICE_ID not configured');
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

    // Keep the address on the Customer, not only on this one Checkout Session,
    // or it is gone the moment the session expires.
    'customer_update[address]': 'auto',
    'customer_update[name]': 'auto',
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
