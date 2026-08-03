/**
 * POST /api/verify-checkout
 *
 * Asks Stripe whether a Checkout session actually paid, and records the answer.
 *
 * The browser used to do the recording: this route said yes or no, and the
 * dashboard then wrote plan: "active" onto its own Restaurant row through the
 * Base44 SDK. That made this a correctness boundary rather than a security one,
 * because a client that could write the row directly did not have to ask.
 *
 * The SDK is gone, so the write moved here — where it should have been. Now
 * both halves happen server-side and the only way to an active plan is a
 * Stripe session that Stripe itself says was paid.
 *
 * Still not a webhook. A customer who closes the tab on the Stripe page before
 * being redirected has paid and will not be marked active until they come back;
 * see RESTAURANTS_PAGE.md before this carries real revenue at scale.
 *
 * Bindings: STRIPE_SECRET_KEY (required)
 */
import { json, clean } from '../lib/email.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { serviceRole } from '../lib/data.js';

export async function onRequestPost({ request, env, ctx, requestId = null }) {
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

    // The billing address, stored on the Restaurant row below.
    //
    // Economic nexus is measured per state, and the state was captured nowhere
    // in this system — so "which states do we have nexus in" could not be
    // answered from the customer list at all. Stripe collects it now
    // (billing_address_collection in create-checkout); this is what carries it
    // back. Only the address: nothing else from the Stripe customer object is
    // any of this app's business.
    const customer = data.customer && typeof data.customer === 'object' ? data.customer : null;
    const address = customer?.address || data.customer_details?.address || null;
    const billingAddress = address
      ? {
          line1: address.line1 || '',
          line2: address.line2 || '',
          city: address.city || '',
          state: (address.state || '').toUpperCase(),
          postal_code: address.postal_code || '',
          country: (address.country || 'US').toUpperCase(),
        }
      : null;

    const restaurantId = data.client_reference_id || null;
    const subscriptionId = sub?.id || (typeof data.subscription === 'string' ? data.subscription : null);
    const currentPeriodEnd = sub?.current_period_end ? sub.current_period_end * 1000 : null;

    // The plan change, written here rather than handed back for the browser to
    // apply. Only on a paid session, and only when Stripe told us which
    // restaurant it was for.
    //
    // A throw here reaches the catch below and answers "could not verify". The
    // alternative — reporting ok while the row still says trial — leaves
    // somebody who has been charged looking at a dashboard that says they have
    // not paid, which is the outcome worth failing loudly for.
    if (paid && restaurantId) {
      await serviceRole(env).entity('Restaurant').update(restaurantId, {
        plan: 'active',
        stripe_subscription_id: subscriptionId || '',
        current_period_end: currentPeriodEnd,
        // Only written when Stripe actually returned one, so a partial read
        // never blanks an address already on file.
        ...(billingAddress?.state ? { billing_address: billingAddress } : {}),
      });
    }

    // A subscription changing state is a sensitive action by the same test as
    // the rest: if it went wrong, somebody's account of what happened would be
    // contested — "we were charged", "our plan changed and nobody told us".
    // The restaurant id and whether Stripe considered it paid are the whole
    // content of that dispute.
    await audit(env, ctx, {
      action: paid ? ACTIONS.BILLING_ACTIVATED : ACTIONS.BILLING_CHECKOUT,
      request,
      requestId,
      restaurantId,
      outcome: paid ? 'ok' : 'failed',
      detail: { status: data.status || null, plan: 'pro' },
    });

    return json({
      ok: true,
      paid,
      restaurant_id: restaurantId,
      subscription_id: subscriptionId,
      current_period_end: currentPeriodEnd,
      billing_address: billingAddress,
    });
  } catch (err) {
    console.error('verify-checkout: Stripe request threw', err?.message);
    return json({ error: 'Could not verify that payment.' }, 502);
  }
}
