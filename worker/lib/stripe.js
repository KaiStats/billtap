/**
 * Reading a Stripe subscription without caring which API version sent it.
 *
 * ── The move that breaks everything quietly ─────────────────────────────────
 *
 * Stripe relocated `current_period_start` / `current_period_end` from the
 * Subscription onto its individual items in API version 2025-03-31.basil. Any
 * event destination created today defaults to something well past that — the
 * dashboard offered 2026-07-29.dahlia — so `subscription.current_period_end`
 * arrives `undefined`, and every caller that read it got null.
 *
 * Null is not a loud failure here, which is what makes it dangerous:
 *
 *   - Consumer Pro writes plan_expires_at = null, and resolvePartyLimit reads
 *     `if (!expires || Date.now() < expires)` — a null expiry means a plan that
 *     never ends. Cancel, and you keep unlimited party size forever, free.
 *   - Restaurants write current_period_end = null, and entitlement.js measures
 *     both the grace period and staleness from it.
 *
 * So the version of the API a webhook happens to be configured with would
 * decide whether cancellation works. It is read from both shapes instead, which
 * costs nothing and means neither a new destination nor an old one can be wrong.
 *
 * @param {any} subscription a Stripe Subscription, from any API version
 * @returns {number|null} epoch milliseconds, or null when genuinely absent
 */
export function subscriptionPeriodEnd(subscription) {
  const direct = subscription?.current_period_end;

  // The newer shape. Items can bill on different cycles in principle; the
  // furthest one out is the date the subscription is actually paid through,
  // which is the question every caller here is asking.
  const fromItems = (subscription?.items?.data || [])
    .map((item) => Number(item?.current_period_end))
    .filter((n) => Number.isFinite(n) && n > 0);

  const seconds = Number.isFinite(Number(direct)) && Number(direct) > 0
    ? Number(direct)
    : (fromItems.length ? Math.max(...fromItems) : null);

  // Stripe counts in seconds and every column in this schema holds
  // milliseconds — a thousand-fold error here reads as a plan that ended in 1970.
  return seconds ? seconds * 1000 : null;
}
