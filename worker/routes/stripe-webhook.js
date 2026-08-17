/**
 * POST /api/stripe-webhook — Stripe telling us what actually happened.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * Until now the only thing that recorded a payment was verify-checkout, which
 * runs when Stripe redirects the browser back to the app. Its own header says
 * what that costs: "A customer who closes the tab on the Stripe page before
 * being redirected has paid and will not be marked active until they come
 * back."
 *
 * For a restaurant on $149 that is a support ticket somebody notices. For a
 * consumer on ninety-nine cents it is fatal — at volume, people pay, close the
 * tab, do not get what they bought, and do not write in about a dollar. They
 * charge it back, or they just remember the product as broken.
 *
 * It is also the only way to hear about anything that happens *after* the
 * checkout. A renewal, a cancellation, a card that stops working: none of them
 * involve a browser at all, so none of them can be caught by a redirect. The
 * nightly reconcile in reconcile-billing.js was the compensating control for
 * that, and it only ever looked at restaurants.
 *
 * ── The signature is the whole security model ───────────────────────────────
 *
 * This endpoint takes no credentials and grants paid plans. Anyone who finds
 * the URL can POST to it. What stands between that and free Pro for the
 * internet is the HMAC below and nothing else, so it is checked before the body
 * is parsed, let alone acted on — and an unconfigured secret refuses every
 * request rather than waving them through.
 *
 * Bindings:
 *   STRIPE_WEBHOOK_SECRET  required. From the Stripe dashboard, `whsec_...`
 *   STRIPE_SECRET_KEY      required, to read the subscription back
 */
import { json } from '../lib/email.js';
import { serviceRole } from '../lib/data.js';
import { audit, ACTIONS } from '../lib/audit.js';
import { fetchWithTimeout, TIMEOUTS } from '../lib/http.js';
import { PLAN_FOR } from './reconcile-billing.js';
import { subscriptionPeriodEnd } from '../lib/stripe.js';

/**
 * How far out of step with Stripe's clock a request may be, in seconds.
 *
 * Five minutes is Stripe's own recommendation. The timestamp is inside the
 * signed payload, so an attacker cannot alter it — what this stops is a replay:
 * a genuine, correctly signed "subscription created" captured off the wire and
 * posted again next year.
 */
const TOLERANCE_SECONDS = 300;

const enc = new TextEncoder();

/** Constant-time compare, so a wrong signature cannot be found a byte at a time. */
function sameSignature(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Is this really Stripe, and is it recent?
 *
 * The header looks like `t=1492774577,v1=5257a869...,v1=...`. More than one v1
 * appears while a signing secret is being rotated, and both are valid during
 * that window — checking only the first would break every delivery for the
 * length of a rotation, which is the moment nobody wants a billing outage.
 */
export async function verifyStripeSignature(rawBody, header, secret) {
  if (!secret || typeof header !== 'string' || !header) return { ok: false, reason: 'missing' };

  const parts = Object.create(null);
  const signatures = [];
  for (const piece of header.split(',')) {
    const [k, v] = piece.split('=');
    if (k === 'v1') signatures.push(v);
    else if (k) parts[k] = v;
  }

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'no_timestamp' };
  if (!signatures.length) return { ok: false, reason: 'no_signature' };

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > TOLERANCE_SECONDS) return { ok: false, reason: 'too_old' };

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`)));

  return signatures.some((s) => sameSignature(s, expected))
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

/** The subscription behind an event, read back from Stripe rather than trusted. */
async function readSubscription(env, subscriptionId) {
  if (!subscriptionId || !env?.STRIPE_SECRET_KEY) return null;
  const res = await fetchWithTimeout(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
    TIMEOUTS.payment,
  );
  /**
   * A missing subscription is an answer; a broken connection is not.
   *
   * ── The event that vanished ─────────────────────────────────────────────
   *
   * Every non-2xx returned null here, and null flowed into the `!subject ||
   * !subscription` branch below, which answers 200 with reason 'no_subject'.
   * A 200 tells Stripe the delivery succeeded and it never retries. So a rate
   * limit, a 500 from Stripe, or a timeout on the read of a *paid*
   * checkout.session.completed permanently discarded that payment: the
   * customer was charged, the webhook said fine, and nothing else ever looks
   * at it — the nightly reconciler walks Restaurant rows and has never touched
   * `profiles`, so a consumer Pro subscriber would simply never get Pro.
   *
   * 404 keeps the old behaviour on purpose, because that genuinely means the
   * subscription is not in this account and no amount of retrying will change
   * it. Everything else throws, the caller answers 502, and Stripe retries with
   * backoff for three days — which is what the retry schedule is for.
   */
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`stripe subscription read failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Which product this event is about, and who it belongs to.
 *
 * Read from metadata rather than guessed from the shape of the id. Both
 * products put their own key on the subscription at checkout — `user_id` for
 * consumer Pro, `restaurant_id` for a restaurant — so an event that carries
 * neither is something else in the account entirely and is left alone rather
 * than applied to whichever row happened to match.
 */
function subjectOf(object) {
  const meta = object?.metadata || {};
  if (meta.user_id) return { kind: 'pro', id: String(meta.user_id) };
  if (meta.restaurant_id) return { kind: 'restaurant', id: String(meta.restaurant_id) };
  return null;
}

/**
 * Grant or revoke, by writing what Stripe just said.
 *
 * Idempotent on purpose, because Stripe retries: it delivers at least once, not
 * exactly once, and the same event arriving twice must not do anything twice.
 * Every write here is a set-to-a-value rather than an increment or an append,
 * so replaying an event lands on the same row state it landed on the first
 * time.
 */
async function applySubscription(env, subject, subscription) {
  const svc = serviceRole(env);
  const status = subscription?.status || null;
  const periodEnd = subscriptionPeriodEnd(subscription);

  /**
   * The same map the nightly reconciler uses, imported rather than restated.
   *
   * ── Why they must not disagree ──────────────────────────────────────────
   *
   * This function had its own two-way rule: active or trialing, else cancelled.
   * The reconciler maps past_due and unpaid to 'past_due', and entitlement.js
   * honours that with GRACE_DAYS — seven days past the period end before a
   * restaurant loses anything, so a card that expires over a weekend does not
   * take the QR codes off the tables while the owner is closed.
   *
   * The webhook fires on invoice.payment_failed within seconds, and it wrote
   * 'cancelled'. So the grace period existed in three files and was reachable
   * from none of them: the reconciler ran at night, found a row already marked
   * cancelled, and agreed with it. A restaurant paying $149 a month lost
   * service the moment a renewal was retried.
   *
   * `incomplete` is deliberately absent from the map and left undefined here —
   * a checkout that has not finished must not knock a row off the trial it is
   * still legitimately on.
   */
  const nextPlan = PLAN_FOR[status];
  if (!nextPlan) return { kind: subject.kind, id: subject.id, plan: null, skipped: status };

  const entitled = nextPlan === 'active' || nextPlan === 'past_due';

  if (subject.kind === 'pro') {
    const rows = await svc.entity('Profile').filter({ id: subject.id }, { select: 'id' });
    const patch = {
      /**
       * past_due stays 'pro' because plan_expires_at is what ends it.
       *
       * resolvePartyLimit already refuses a pro plan whose expiry has passed,
       * so a lapsed subscriber loses unlimited party size at the end of the
       * period they paid for — which is what the comment this replaced claimed
       * was happening, while the code cut them off mid-retry instead.
       */
      /**
       * The clock ends Pro, not the event — which is what migration 0017 says
       * this column is for: "nobody is cut off mid-month and nobody keeps Pro
       * forever: they run to the end of what they paid for."
       *
       * The code did the first half of that and not the second. Writing 'free'
       * the moment a cancellation or a failed retry arrived took the plan away
       * immediately, because resolvePartyLimit only ever reads plan_expires_at
       * from inside `if (plan === 'pro')` — so once the row says free, the
       * expiry it was supposed to be governed by is never consulted again. A
       * subscriber who cancelled three days into a month they had already paid
       * for sat down with eleven friends that evening and the eleventh was
       * turned away.
       *
       * Cancelling still means cancelled; it just takes effect when the paid
       * period runs out. With no future expiry to honour — an immediate
       * cancellation, a trial abandoned, a subscription that never had a period
       * — it falls to free right now, as it should.
       */
      plan: entitled || (periodEnd && periodEnd > Date.now()) ? 'pro' : 'free',
      plan_expires_at: periodEnd,
    };

    /**
     * Written only when there is something to write.
     *
     * These were plain assignments that fell back to null, which quietly
     * cleared a good value: Stripe returns `customer` as an id string on a bare
     * read and as an expanded object when anything expands it, and the second
     * shape wrote null over the first. That matters more than it looks, because
     * create-pro-checkout now reads stripe_customer_id for two decisions — reuse
     * the existing Stripe customer rather than minting a second one, and refuse
     * a second fourteen-day trial. Blanking it hands back both bugs.
     */
    const customerId = typeof subscription?.customer === 'string'
      ? subscription.customer
      : subscription?.customer?.id;
    if (customerId) patch.stripe_customer_id = String(customerId);
    if (subscription?.id) patch.stripe_subscription_id = subscription.id;
    if (rows.length) await svc.entity('Profile').update(subject.id, patch);
    else await svc.entity('Profile').create({ id: subject.id, ...patch });
    return { kind: 'pro', id: subject.id, plan: patch.plan };
  }

  await svc.entity('Restaurant').update(subject.id, {
    plan: nextPlan,
    stripe_subscription_id: subscription?.id || '',
    current_period_end: periodEnd,
  });
  return { kind: 'restaurant', id: subject.id, plan: nextPlan };
}

export async function onRequestPost({ request, env, ctx, requestId = null }) {
  const secret = env?.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Refuses rather than accepts. An unconfigured secret here would mean an
    // endpoint that grants paid plans to anyone who can find the URL.
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not configured — refusing every delivery');
    return json({ error: 'Not configured' }, 503);
  }

  // The raw bytes, before anything parses them. The signature covers the exact
  // body Stripe sent, so a round trip through JSON.parse and JSON.stringify
  // would re-order keys and fail every check.
  const raw = await request.text();

  const verdict = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret);
  if (!verdict.ok) {
    console.error(JSON.stringify({ at: new Date().toISOString(), job: 'stripe-webhook', rejected: verdict.reason }));
    return json({ error: 'Bad signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const type = event?.type || '';
  const object = event?.data?.object || {};

  try {
    let subject = subjectOf(object);
    let subscription = null;

    if (type === 'checkout.session.completed') {
      // The session carries the metadata we set at checkout; the subscription
      // it created carries the dates. Read the subscription back from Stripe
      // rather than trusting anything in the payload beyond the signature.
      /**
       * client_reference_id is a fallback of last resort, not a source of truth.
       *
       * create-pro-checkout sets it to a user_id, but create-checkout sets it to
       * a restaurant_id — so trusting it to mean 'pro' would misfile a restaurant
       * checkout. The subscription metadata is authoritative and is read below;
       * this only stands in when there is no subscription to read at all, and
       * applySubscription's Profile path fails the auth.users FK if the id was
       * really a restaurant, so a wrong guess cannot cross-grant — it errors and
       * retries rather than provisioning the wrong account.
       */
      subject = subject || (object.client_reference_id
        ? { kind: 'pro', id: String(object.client_reference_id) }
        : null);
      subscription = await readSubscription(env, typeof object.subscription === 'string' ? object.subscription : null);
      if (subscription) subject = subjectOf(subscription) || subject;
    } else if (type.startsWith('customer.subscription.')) {
      /**
       * Re-read the live subscription instead of trusting the event payload.
       *
       * Stripe delivers at-least-once and out-of-order, so a stale
       * `subscription.updated` (past_due, canceled) can arrive after a newer
       * `active` one. Applying the payload verbatim would write the old status
       * over the new and drag plan_expires_at backwards, briefly downgrading a
       * paying customer. Reading the subscription back gets Stripe's current
       * truth regardless of which event triggered us — the same thing the
       * invoice and checkout branches already do. On a read failure, fall back
       * to the payload rather than dropping the event.
       */
      const fresh = await readSubscription(env, typeof object.id === 'string' ? object.id : null);
      subscription = fresh || object;
      subject = subjectOf(subscription) || subject;
    } else if (type === 'invoice.payment_failed' || type === 'invoice.paid') {
      subscription = await readSubscription(env, typeof object.subscription === 'string' ? object.subscription : null);
      if (subscription) subject = subjectOf(subscription);
    } else {
      // Every other event type Stripe sends. Acknowledged so it is not retried
      // forever, and otherwise ignored.
      return json({ ok: true, ignored: type });
    }

    if (!subject || !subscription) {
      /**
       * Signed, understood, and not matchable to anybody here.
       *
       * Answering 200 is still right — Stripe must stop retrying an event
       * nothing will ever act on, and subjectOf refuses to guess a subject on
       * purpose: awarding a paid plan to whichever row happened to match is a
       * worse failure than awarding none.
       *
       * ── Why this now shouts ─────────────────────────────────────────────
       *
       * It used to return silently, and that silence hid a live subscription.
       * A $0.99 Pro plan was bought through a Stripe Payment Link, which
       * attaches none of the metadata create-pro-checkout sets, so the event
       * arrived, matched nothing, and vanished — money collected, nothing
       * provisioned, and no trace anywhere to notice it by. It was only found
       * by reading the Stripe dashboard against an empty profiles table.
       *
       * The same hole is open on the $149 restaurant links. So an unmatched
       * *subscription* is now an incident: logged loudly with the ids needed to
       * find it in Stripe, and written to the audit log so it shows up in the
       * same place every other billing event does.
       *
       * Scoped to subscription-bearing events on purpose. A plain 'no_subject'
       * on some other product in the same account is genuinely uninteresting,
       * and crying wolf about it is how a real one gets scrolled past.
       */
      if (subscription || type === 'checkout.session.completed') {
        const customer = typeof subscription?.customer === 'string'
          ? subscription.customer
          : subscription?.customer?.id || object?.customer || null;
        console.error(JSON.stringify({
          at: new Date().toISOString(),
          job: 'stripe-webhook',
          alarm: 'paid_subscription_not_matched_to_an_account',
          event: type,
          subscription_id: subscription?.id || object?.subscription || null,
          customer_id: customer,
          status: subscription?.status || null,
          hint: 'created outside create-pro-checkout/create-checkout — a Payment Link or the Stripe dashboard. Nothing was provisioned.',
        }));
        await audit(env, ctx, {
          action: ACTIONS.BILLING_UNMATCHED,
          request,
          requestId,
          outcome: 'error',
          detail: {
            event: type,
            subscription_id: subscription?.id || object?.subscription || null,
            customer_id: customer,
          },
        });
      }
      return json({ ok: true, ignored: type, reason: 'no_subject' });
    }

    const result = await applySubscription(env, subject, subscription);

    await audit(env, ctx, {
      action: result.plan === 'pro' || result.plan === 'active'
        ? ACTIONS.BILLING_ACTIVATED
        : ACTIONS.BILLING_RECONCILED,
      request,
      requestId,
      ...(result.kind === 'restaurant' ? { restaurantId: result.id } : { actorUserId: result.id }),
      detail: { source: 'webhook', event: type, plan: result.plan, subscription_status: subscription.status },
    });

    return json({ ok: true, applied: result.kind, plan: result.plan });
  } catch (error) {
    /**
     * A 500, deliberately, so Stripe retries.
     *
     * This is the one place in the app where failing loudly is right: Stripe
     * redelivers on a non-2xx with backoff for days, and the alternative is
     * answering 200 to an event we could not apply — which loses a payment
     * somebody has already made, silently, with no second chance.
     */
    console.error('stripe-webhook: could not apply event', type, error?.message);
    return json({ error: 'Could not apply that event' }, 500);
  }
}
