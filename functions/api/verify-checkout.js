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
import { json, clean } from '../_lib/email.js';

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
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const data = await res.json();

    if (!res.ok) {
      console.error('verify-checkout: Stripe rejected', res.status, JSON.stringify(data));
      return json({ error: 'Could not verify that payment.' }, 502);
    }

    const paid = data.payment_status === 'paid' || data.status === 'complete';
    const sub = data.subscription && typeof data.subscription === 'object' ? data.subscription : null;

    return json({
      ok: true,
      paid,
      restaurant_id: data.client_reference_id || null,
      subscription_id: sub?.id || (typeof data.subscription === 'string' ? data.subscription : null),
      current_period_end: sub?.current_period_end ? sub.current_period_end * 1000 : null,
    });
  } catch (err) {
    console.error('verify-checkout: Stripe request threw', err?.message);
    return json({ error: 'Could not verify that payment.' }, 502);
  }
}
