/**
 * POST /api/create-checkout
 *
 * Opens a Stripe Checkout session for the $149/mo subscription and returns its
 * URL. The browser redirects there; Stripe handles the card, so no payment
 * details ever touch this app.
 *
 * ── Whose restaurant this is for ─────────────────────────────────────────────
 *
 * Used to be answered by trusting `body.restaurant_id`. `client_reference_id`
 * carries that value into the Stripe session, and verify-checkout later writes
 * `plan: "active"` onto whatever restaurant that id names — so a caller could
 * pay for their own subscription and have it activate someone else's row,
 * overwriting that restaurant's stripe_subscription_id and billing address
 * with their own. Restaurant ids are not secrets; they show up in QR URLs.
 *
 * Fixed the way saveMyRestaurant already fixes the same question: there is no
 * id parameter. The row is found from the signed-in operator's own identity via
 * findOrAdoptRestaurant, the same lookup getRestaurantDashboardData uses to
 * decide what to show them — so a caller can only ever start checkout for the
 * restaurant already reachable from their own dashboard, never for one named in
 * the request.
 *
 * Bindings:
 *   STRIPE_SECRET_KEY   required
 *   STRIPE_PRICE_ID     required — the recurring $149/mo price
 *   PUBLIC_BASE_URL     optional, defaults to the request's own origin
 */
import { json, clean, EMAIL_RE } from '../lib/email.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';
import { serviceRole, currentUser } from '../lib/data.js';
import { AppError, errorResponse } from '../lib/errors.js';
import { audit as recordAudit } from '../lib/audit.js';
import { findOrAdoptRestaurant } from './functions.js';

export async function onRequestPost({ request, env, ctx, requestId: id }) {
  const route = 'create-checkout';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const user = await currentUser(env, request);
  if (!user) {
    return errorResponse(
      new AppError('unauthorized', 'Sign in to manage billing.', 401),
      { id, route, env, ctx, request, requestBody: body },
    );
  }

  const svc = serviceRole(env);
  const record = (entry) => recordAudit(env, ctx, { ...entry, request, requestId: id });
  const restaurant = await findOrAdoptRestaurant(svc, user, record);
  if (!restaurant) {
    return errorResponse(
      new AppError('restaurant_not_found', 'Create your restaurant before subscribing.', 404),
      { id, route, env, ctx, request, requestBody: body },
    );
  }
  const restaurantId = restaurant.id;

  const key = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRICE_ID;
  if (!key || !price) {
    console.error('create-checkout: STRIPE_SECRET_KEY or STRIPE_PRICE_ID not configured');
    return json({ error: 'Billing is not configured yet.' }, 503);
  }

  const origin = env.PUBLIC_BASE_URL || new URL(request.url).origin;

  // Prefer the operator's own signed-in address over whatever the body claims,
  // since the body is no longer trusted for identity at all — but still accept
  // a body email as a prefill for an operator whose Supabase account carries
  // none (a social sign-in with no address, for instance).
  const bodyEmail = clean(body?.email, 200).toLowerCase();
  const contactEmail = (user.email || '').toLowerCase() || (EMAIL_RE.test(bodyEmail) ? bodyEmail : '');

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
  if (EMAIL_RE.test(contactEmail)) params.set('customer_email', contactEmail);

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
      return errorResponse(
        new AppError('stripe_checkout_rejected', 'Could not start checkout.', 502, {
          detail: { stripe_status: res.status, restaurant_id: restaurantId },
        }),
        { id, route, env, ctx, request, requestBody: body },
      );
    }
    return json({ ok: true, url: data.url });
  } catch (err) {
    // An unexpected throw (network failure, Stripe unreachable) rather than a
    // controlled rejection — passed through as-is, not wrapped, so logError
    // keeps the real stack instead of the generic one an AppError gets. The
    // caller still gets a safe, reassuring message: see shared/redact.js's
    // GENERIC, which publicShape substitutes for anything that is not an
    // AppError.
    return errorResponse(err, { id, route, env, ctx, request, requestBody: body });
  }
}
