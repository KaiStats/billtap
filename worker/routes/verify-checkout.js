/**
 * POST /api/verify-checkout
 *
 * Asks Stripe whether a Checkout session actually paid. The browser calls this
 * when it lands back on the dashboard, then writes the plan change through the
 * Base44 SDK as the signed-in owner.
 *
 * Whether the subscription is live is decided here, server-side against Stripe —
 * the client cannot talk its way into an active plan by lying about the session.
 * It can still write its own Restaurant row directly through the SDK, so this is
 * a correctness boundary rather than a hard security one; see RESTAURANTS_PAGE.md
 * on adding a webhook before this carries real revenue at scale.
 *
 * Bindings: STRIPE_SECRET_KEY (required)
 */
import { json, clean } from '../lib/email.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const sessionId = clean(body.session_id, 200);
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return json({ error: 'A Stripe checkout session id is required' }, 400);
  }

  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('verify-checkout: STRIPE_SECRET_KEY not configured');
    return json({ error: 'Billing is not configured yet.' }, 503);
  }

  try {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription&expand[]=customer`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const data = await res.json();

    if (!res.ok) {
      console.error('verify-checkout: Stripe rejected', res.status, JSON.stringify(data));
      return json({ error: 'Could not verify that payment.' }, 502);
    }

    const paid = data.payment_status === 'paid' || data.status === 'complete';
    const sub = data.subscription && typeof data.subscription === 'object' ? data.subscription : null;

    // The billing address, returned so the dashboard can store it on the
    // Restaurant row.
    //
    // Economic nexus is measured per state, and the state was captured nowhere
    // in this system — so "which states do we have nexus in" could not be
    // answered from the customer list at all. Stripe collects it now
    // (billing_address_collection in create-checkout); this is what carries it
    // back. Only the address: nothing else from the Stripe customer object is
    // any of this app's business.
    const customer = data.customer && typeof data.customer === 'object' ? data.customer : null;
    const address = customer?.address || data.customer_details?.address || null;

    return json({
      ok: true,
      paid,
      restaurant_id: data.client_reference_id || null,
      subscription_id: sub?.id || (typeof data.subscription === 'string' ? data.subscription : null),
      current_period_end: sub?.current_period_end ? sub.current_period_end * 1000 : null,
      billing_address: address
        ? {
            line1: address.line1 || '',
            line2: address.line2 || '',
            city: address.city || '',
            state: (address.state || '').toUpperCase(),
            postal_code: address.postal_code || '',
            country: (address.country || 'US').toUpperCase(),
          }
        : null,
    });
  } catch (err) {
    console.error('verify-checkout: Stripe request threw', err?.message);
    return json({ error: 'Could not verify that payment.' }, 502);
  }
}
