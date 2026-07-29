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
  });
  if (EMAIL_RE.test(email)) params.set('customer_email', email);

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

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
