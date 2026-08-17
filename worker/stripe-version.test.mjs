/**
 * The same subscription, sent by two different API versions.
 *
 * Stripe moved current_period_end from the Subscription onto its items in
 * 2025-03-31.basil. A destination created today defaults well past that, so
 * the field simply is not where three callers were looking — and the failure is
 * silent: a null expiry means "never expires" to resolvePartyLimit, so a
 * cancelled Pro plan would have kept unlimited party size, free, forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { subscriptionPeriodEnd } from './lib/stripe.js';

const SECONDS = 1800000000;

test('the old shape, where the field is on the subscription', () => {
  assert.equal(subscriptionPeriodEnd({ current_period_end: SECONDS }), SECONDS * 1000);
});

test('the new shape, where it is on the item', () => {
  assert.equal(
    subscriptionPeriodEnd({ items: { data: [{ current_period_end: SECONDS }] } }),
    SECONDS * 1000,
  );
});

test('milliseconds, not seconds, because every column here holds milliseconds', () => {
  // A thousand-fold error reads as a subscription that ended in 1970, which
  // entitlement.js would treat as long expired.
  const ms = subscriptionPeriodEnd({ current_period_end: SECONDS });
  assert.ok(ms > 1e12, `${ms} looks like seconds`);
});

test('several items bill on different cycles, so the furthest out wins', () => {
  // That is the date the subscription is genuinely paid through, which is the
  // question every caller is really asking.
  assert.equal(
    subscriptionPeriodEnd({ items: { data: [
      { current_period_end: SECONDS },
      { current_period_end: SECONDS + 86400 },
    ] } }),
    (SECONDS + 86400) * 1000,
  );
});

test('genuinely absent is still null, and not zero or NaN', () => {
  // null has a meaning downstream — "no paid period to honour" — and NaN or 0
  // would be written into the column as a date in 1970.
  for (const input of [null, undefined, {}, { items: { data: [] } }, { current_period_end: null }]) {
    assert.equal(subscriptionPeriodEnd(input), null, `${JSON.stringify(input)}`);
  }
});

test('a malformed value is not trusted into the column', () => {
  assert.equal(subscriptionPeriodEnd({ current_period_end: 'soon' }), null);
  assert.equal(subscriptionPeriodEnd({ current_period_end: 0 }), null);
});

test('the old field wins when both are present, since they agree in practice', () => {
  assert.equal(
    subscriptionPeriodEnd({ current_period_end: SECONDS, items: { data: [{ current_period_end: 1 }] } }),
    SECONDS * 1000,
  );
});
