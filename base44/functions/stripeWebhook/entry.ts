import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Stripe webhook — keeps subscription state honest after the first payment.
 *
 * Without this, a card that fails or a subscription cancelled in Stripe still
 * reads "active" here forever, because /api/verify-checkout only ever runs once,
 * at signup.
 *
 * Point Stripe at: https://<your-app-domain>/functions/stripeWebhook
 * Subscribe to: customer.subscription.updated, customer.subscription.deleted,
 *               invoice.payment_failed, invoice.payment_succeeded
 *
 * Sends no mail — this only writes data, which is what Base44 still owns.
 *
 * Requires STRIPE_WEBHOOK_SECRET (the whsec_... value Stripe shows when you
 * create the endpoint).
 */

const TOLERANCE_SECONDS = 300;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Compare without leaking length or position through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify Stripe's signature over the RAW body. Parsing before verifying would
 * defeat the point — re-serialising changes the bytes and the HMAC with them.
 */
export async function verifyStripeSignature(rawBody: string, header: string, secret: string) {
  if (!header) return { ok: false, reason: 'missing_signature' };

  let timestamp = '';
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k?.trim() === 't') timestamp = v?.trim() ?? '';
    // Stripe sends multiple v1 entries while a signing secret is being rotated.
    if (k?.trim() === 'v1' && v) candidates.push(v.trim());
  }
  if (!timestamp || candidates.length === 0) return { ok: false, reason: 'malformed_signature' };

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  const matched = candidates.some((c) => timingSafeEqual(c, expected));
  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/** Stripe subscription status → the plan value stored on Restaurant. */
function planForStatus(status: string): string {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  return 'cancelled'; // canceled, incomplete_expired, paused
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    console.error('stripeWebhook: STRIPE_WEBHOOK_SECRET not configured');
    return json({ error: 'Not configured' }, 500);
  }

  const rawBody = await req.text();
  const verdict = await verifyStripeSignature(
    rawBody, req.headers.get('stripe-signature') || '', secret
  );
  if (!verdict.ok) {
    console.error('stripeWebhook: rejected —', verdict.reason);
    return json({ error: 'Invalid signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  try {
    const base44 = createClientFromRequest(req);
    // No user context on a webhook — service role is the only way to read/write.
    const svc = base44.asServiceRole.entities;
    const object = event.data?.object ?? {};

    // Resolve the subscription id for every event shape we subscribe to.
    const subscriptionId =
      event.type.startsWith('customer.subscription.')
        ? object.id
        : (typeof object.subscription === 'string' ? object.subscription : object.subscription?.id);

    if (!subscriptionId) {
      return json({ ok: true, ignored: event.type, reason: 'no_subscription_id' });
    }

    let matches = await svc.Restaurant.filter({ stripe_subscription_id: subscriptionId });

    // Fall back to the metadata we set at checkout, in case the webhook beats
    // the browser back from Stripe and the id hasn't been stored yet.
    if (!matches?.length) {
      const fromMeta = object.metadata?.restaurant_id;
      if (fromMeta) matches = await svc.Restaurant.filter({ id: fromMeta });
    }

    if (!matches?.length) {
      console.error('stripeWebhook: no restaurant for subscription', subscriptionId);
      return json({ ok: true, ignored: event.type, reason: 'restaurant_not_found' });
    }

    const restaurant = matches[0];
    const patch: Record<string, unknown> = { stripe_subscription_id: subscriptionId };

    switch (event.type) {
      case 'customer.subscription.deleted':
        patch.plan = 'cancelled';
        break;
      case 'customer.subscription.updated':
        patch.plan = planForStatus(object.status);
        if (object.current_period_end) patch.current_period_end = object.current_period_end * 1000;
        break;
      case 'invoice.payment_failed':
        patch.plan = 'past_due';
        break;
      case 'invoice.payment_succeeded':
        patch.plan = 'active';
        if (object.lines?.data?.[0]?.period?.end) {
          patch.current_period_end = object.lines.data[0].period.end * 1000;
        }
        break;
      default:
        return json({ ok: true, ignored: event.type });
    }

    await svc.Restaurant.update(restaurant.id, patch);
    console.log(`stripeWebhook: ${restaurant.name} → ${patch.plan} (${event.type})`);

    return json({ ok: true, restaurant_id: restaurant.id, plan: patch.plan });
  } catch (error) {
    // 500 so Stripe retries — a transient data error must not silently drop a
    // cancellation and leave someone on a plan they stopped paying for.
    console.error('stripeWebhook error:', error.message);
    return json({ error: 'Internal server error' }, 500);
  }
});
