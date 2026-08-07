/**
 * Whether a restaurant is being served, and what stops when it is not.
 *
 * Nothing enforced payment before this. `trial_ends_at` was written once and
 * read once, for display; `plan` appeared outside the Stripe routes only in
 * `ownerView`. A trial that ran out kept full service forever and so did a
 * cancelled subscription — the price was $149 a month and nothing collected it.
 *
 * Two properties carry the weight here, and both are about which way a mistake
 * runs:
 *
 *   **Ambiguity serves.** Every unknown resolves to entitled. Wrongly cutting
 *   off a paying restaurant takes away what they bought and they hear about it
 *   from a guest; wrongly serving an unpaid one costs a month and is fixed by
 *   asking. Those are not the same size of error.
 *
 *   **The guest is never the lever.** A diner at the table did not fail to pay
 *   us. Splitting a bill, leaving a rating and leaving an email all keep
 *   working no matter what the restaurant's billing is doing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entitlement, isEntitled, GRACE_DAYS, STALE_DAYS } from '../shared/entitlement.js';

const NOW = Date.UTC(2026, 7, 7);
const DAY = 86400000;
const inDays = (n) => NOW + n * DAY;

// ── The trial ───────────────────────────────────────────────────────────────

test('a running trial is served and an expired one is not', () => {
  assert.equal(isEntitled({ plan: 'trial', trial_ends_at: inDays(3) }, NOW), true);
  assert.equal(isEntitled({ plan: 'trial', trial_ends_at: inDays(-1) }, NOW), false);

  const over = entitlement({ plan: 'trial', trial_ends_at: inDays(-1) }, NOW);
  assert.equal(over.state, 'trial_expired');
});

test('a trial with no end date is served, because that gap is ours', () => {
  // Mariposa's shape: created by hand in SQL, no trial date, because nothing
  // outside saveMyRestaurant sets one. Migration 0011 backfills these and gives
  // the column a default — but the code must not cut a restaurant off over a
  // hole in our own data entry while that migration is unapplied.
  assert.equal(isEntitled({ plan: 'trial', trial_ends_at: null }, NOW), true);
  assert.equal(isEntitled({ plan: 'trial' }, NOW), true);
});

// ── The subscription ────────────────────────────────────────────────────────

test('an active subscription inside its period is served', () => {
  assert.equal(isEntitled({ plan: 'active', current_period_end: inDays(12) }, NOW), true);
});

test('a subscribed row with no period end is served', () => {
  // An older row, or a checkout that answered without an expanded
  // subscription. They paid; the missing column is not their problem.
  assert.equal(isEntitled({ plan: 'active', current_period_end: null }, NOW), true);
});

test('past_due is served through the grace window and not past it', () => {
  const nearly = { plan: 'past_due', current_period_end: inDays(-(GRACE_DAYS - 1)) };
  assert.equal(isEntitled(nearly, NOW), true, 'Stripe is still retrying the card');

  const done = { plan: 'past_due', current_period_end: inDays(-(GRACE_DAYS + 1)) };
  assert.equal(isEntitled(done, NOW), false);
  assert.equal(entitlement(done, NOW).state, 'lapsed');
});

test('cancelled stops immediately, with no grace', () => {
  // The one state that is a decision rather than an inference. They asked.
  assert.equal(isEntitled({ plan: 'cancelled', current_period_end: inDays(20) }, NOW), false);
  assert.equal(entitlement({ plan: 'cancelled' }, NOW).state, 'cancelled');
});

test('an active row nobody has refreshed lapses only after the backstop', () => {
  // current_period_end advances when the nightly reconcile writes it. If that
  // job breaks, a healthy monthly subscription goes stale — so the threshold
  // has to be longer than any real cycle plus Stripe's retry window, or a
  // broken cron would cut off paying restaurants.
  assert.ok(STALE_DAYS > 30, 'the backstop must outlast a monthly cycle');

  const stale = { plan: 'active', current_period_end: inDays(-(STALE_DAYS - 5)) };
  assert.equal(isEntitled(stale, NOW), true, 'a month past renewal is not evidence of anything');

  const abandoned = { plan: 'active', current_period_end: inDays(-(STALE_DAYS + 1)) };
  assert.equal(isEntitled(abandoned, NOW), false);
  assert.match(entitlement(abandoned, NOW).reason, /reconcile/);
});

// ── The unknowns ────────────────────────────────────────────────────────────

test('an unrecognised plan is a trial, never a subscription', () => {
  // A Stripe status or a webhook this build has not heard of. Falling to
  // "trial" means the trial clock decides; falling to "active" would confer a
  // subscription nobody here can see evidence of.
  assert.equal(isEntitled({ plan: 'paused_by_stripe', trial_ends_at: inDays(2) }, NOW), true);
  assert.equal(isEntitled({ plan: 'paused_by_stripe', trial_ends_at: inDays(-2) }, NOW), false);
});

test('no restaurant is not an ambiguity', () => {
  assert.equal(isEntitled(null, NOW), false);
  assert.equal(isEntitled(undefined, NOW), false);
  assert.equal(entitlement(null, NOW).state, 'none');
});

test('every answer carries a state and a reason worth logging', () => {
  const rows = [
    null,
    { plan: 'trial', trial_ends_at: inDays(1) },
    { plan: 'trial', trial_ends_at: inDays(-1) },
    { plan: 'trial' },
    { plan: 'active', current_period_end: inDays(5) },
    { plan: 'past_due', current_period_end: inDays(-1) },
    { plan: 'cancelled' },
    { plan: 'nonsense' },
  ];
  for (const r of rows) {
    const e = entitlement(r, NOW);
    assert.equal(typeof e.entitled, 'boolean', JSON.stringify(r));
    assert.ok(e.state && e.reason, `${JSON.stringify(r)} produced no state/reason`);
  }
});
