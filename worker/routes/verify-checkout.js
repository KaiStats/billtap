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
 * ── The write also now checks WHO it is for ──────────────────────────────────
 *
 * Stripe's `client_reference_id` is only as trustworthy as what create-checkout
 * put there, and until that endpoint was fixed it took the value straight from
 * the request body — so a `cs_` id could exist whose client_reference_id names
 * a restaurant the person who paid does not operate. Their money would have
 * bought someone else's account an active plan, overwriting that restaurant's
 * stripe_subscription_id and billing address in the process.
 *
 * create-checkout no longer trusts the body, so a session minted from here on
 * cannot carry a mismatched id. This route still checks anyway, because a
 * session minted by the OLD code before that fix shipped remains a valid,
 * completable `cs_` id — closing the door up front does nothing for one already
 * in flight. If the resolved restaurant's owner is not the caller, nothing is
 * written and `paid` is reported as false to this caller: correct from where
 * they stand, since as far as their own account is concerned nothing changed.
 *
 * Still not a webhook. A customer who closes the tab on the Stripe page before
 * being redirected has paid and will not be marked active until they come back;
 * see RESTAURANTS_PAGE.md before this carries real revenue at scale.
 *
 * Bindings: STRIPE_SECRET_KEY (required)
 */
import { json, clean } from '../lib/email.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { serviceRole, currentUser } from '../lib/data.js';
import { AppError, errorResponse } from '../lib/errors.js';

import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';

export async function onRequestPost({ request, env, ctx, requestId = null }) {
  const route = 'verify-checkout';
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

  const user = await currentUser(env, request);
  if (!user) {
    return errorResponse(
      new AppError('unauthorized', 'Sign in to manage billing.', 401),
      { id: requestId, route, env, ctx, request, requestBody: body },
    );
  }

  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('verify-checkout: STRIPE_SECRET_KEY not configured');
    return json({ error: 'Billing is not configured yet.' }, 503);
  }

  try {
    const res = await fetchWithTimeout(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription&expand[]=customer`,
      { headers: { Authorization: `Bearer ${key}` } },
      TIMEOUTS.payment,
    );
    const data = await res.json();

    if (!res.ok) {
      return errorResponse(
        new AppError('stripe_verify_rejected', 'Could not verify that payment.', 502, {
          detail: { stripe_status: res.status },
        }),
        { id: requestId, route, env, ctx, request, requestBody: body },
      );
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
    // apply. Only on a paid session, only when Stripe told us which restaurant
    // it was for, and only when that restaurant actually belongs to whoever is
    // asking — see the header comment for why the last check still matters even
    // after create-checkout stopped trusting the body.
    //
    // A throw here reaches the catch below and answers "could not verify". The
    // alternative — reporting ok while the row still says trial — leaves
    // somebody who has been charged looking at a dashboard that says they have
    // not paid, which is the outcome worth failing loudly for.
    let authorized = false;
    if (paid && restaurantId) {
      const rows = await serviceRole(env).entity('Restaurant').filter({ id: restaurantId });
      const restaurant = rows[0];
      authorized = Boolean(restaurant && restaurant.owner_id === user.id);

      if (authorized) {
        await serviceRole(env).entity('Restaurant').update(restaurantId, {
          plan: 'active',
          stripe_subscription_id: subscriptionId || '',
          current_period_end: currentPeriodEnd,
          // Only written when Stripe actually returned one, so a partial read
          // never blanks an address already on file.
          ...(billingAddress?.state ? { billing_address: billingAddress } : {}),
        });
      } else {
        console.error(
          'verify-checkout: session client_reference_id does not belong to the caller',
          { restaurantId, callerUserId: user.id },
        );
      }
    }

    // A subscription changing state is a sensitive action by the same test as
    // the rest: if it went wrong, somebody's account of what happened would be
    // contested — "we were charged", "our plan changed and nobody told us".
    // The restaurant id, whether Stripe considered it paid, and whether the
    // caller was actually allowed to claim it are the whole content of that
    // dispute.
    await audit(env, ctx, {
      action: paid ? ACTIONS.BILLING_ACTIVATED : ACTIONS.BILLING_CHECKOUT,
      request,
      requestId,
      restaurantId,
      actorUserId: user.id,
      outcome: paid && authorized ? 'ok' : paid ? 'unauthorized' : 'failed',
      detail: { status: data.status || null, plan: 'pro' },
    });

    // Reported as false to THIS caller when the write was refused: from where
    // they stand nothing changed, regardless of what Stripe itself considers
    // true of the session. Never rely on a caller's own client-side check
    // (the dashboard's is coincidental) to be the thing standing between an
    // unauthorized session and a response that reads as success.
    const reportPaid = paid && (restaurantId ? authorized : true);

    return json({
      ok: true,
      paid: reportPaid,
      restaurant_id: reportPaid ? restaurantId : null,
      subscription_id: reportPaid ? subscriptionId : null,
      current_period_end: reportPaid ? currentPeriodEnd : null,
      billing_address: reportPaid ? billingAddress : null,
    });
  } catch (err) {
    // Passed through unwrapped for the same reason create-checkout does this —
    // logError keeps the real stack for an unexpected throw only when the
    // error is not an AppError, and shared/redact.js's GENERIC is already a
    // safe, reassuring message for a payment failure.
    return errorResponse(err, { id: requestId, route, env, ctx, request, requestBody: body });
  }
}
