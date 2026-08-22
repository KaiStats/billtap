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

// ── The demo ────────────────────────────────────────────────────────────────
//
// A page stood up at a table for somebody who has bought nothing. It is ours,
// there is no customer, and so there is no payment question to fail open about
// — which makes it the least ambiguous case in the function and the one whose
// answer matters most in the moment it is being watched.

test('a demo inside its window is served', () => {
  const live = { demo: true, demo_expires_at: inDays(0.5) };
  assert.equal(isEntitled(live, NOW), true);
  assert.equal(entitlement(live, NOW).state, 'demo');
});

test('a demo past its expiry is denied outright, with no grace', () => {
  // Grace protects a paying restaurant from our own billing errors. There is
  // nobody here to protect, and every extra hour is a page carrying a
  // stranger's business name staying live past the conversation it was for.
  const done = { demo: true, demo_expires_at: inDays(-0.5) };
  assert.equal(isEntitled(done, NOW), false);
  assert.equal(entitlement(done, NOW).state, 'demo_expired');
});

test('a demo with no expiry is served, consistent with the rest of the file', () => {
  // The Mariposa direction: a gap in our own data entry is not a reason to
  // break the demo while a prospect is holding the phone. The cleanup job is
  // what makes the clock real; the column is only what it reads.
  assert.equal(isEntitled({ demo: true, demo_expires_at: null }, NOW), true);
  assert.equal(isEntitled({ demo: true }, NOW), true);
});

test('nothing downstream can override the demo arm', () => {
  // The arm comes first on purpose. A demo row is `plan: 'trial'` with a null
  // trial date, but it must stay entitled even carrying the states that stop a
  // real restaurant — otherwise a stale column decides whether the one moment
  // this whole feature exists for happens at all.
  const expires = inDays(0.5);
  for (const contamination of [
    { plan: 'cancelled' },
    { plan: 'trial', trial_ends_at: inDays(-30) },
    { plan: 'past_due', current_period_end: inDays(-90) },
    { plan: 'active', current_period_end: inDays(-(STALE_DAYS + 10)) },
  ]) {
    const row = { ...contamination, demo: true, demo_expires_at: expires };
    assert.equal(isEntitled(row, NOW), true, JSON.stringify(contamination));
    assert.equal(entitlement(row, NOW).state, 'demo', JSON.stringify(contamination));
  }
});

test('demo is a flag, not a guess — a real restaurant is unaffected', () => {
  // `demo: false` is what migration 0013 gives every existing row, so the arm
  // must be inert for all of them.
  assert.equal(entitlement({ demo: false, plan: 'cancelled' }, NOW).state, 'cancelled');
  assert.equal(entitlement({ plan: 'cancelled' }, NOW).state, 'cancelled');
});

// ── The reference account ──────────────────────────────────────────────────
//
// Mariposa's row, specifically: a real pilot with a real trial_ends_at that
// migration 0011 gave her, deliberately kept off the billing clock rather
// than left off it by accident. See migration 0023.

test('a reference account is served with no trial_ends_at at all', () => {
  const row = { reference_account: true, plan: 'trial', trial_ends_at: null };
  assert.equal(isEntitled(row, NOW), true);
  assert.equal(entitlement(row, NOW).state, 'reference');
});

test('a reference account is served past an expired trial_ends_at', () => {
  // The exact shape that would otherwise deny her: migration 0011 wrote a
  // real date, the date ran out, and none of that is a decision anybody made
  // about whether her demo should still work.
  const row = { reference_account: true, plan: 'trial', trial_ends_at: inDays(-1) };
  assert.equal(isEntitled(row, NOW), true);
  assert.equal(entitlement(row, NOW).state, 'reference');
});

test('nothing downstream can override the reference-account arm', () => {
  for (const contamination of [
    { plan: 'cancelled' },
    { plan: 'trial', trial_ends_at: inDays(-30) },
    { plan: 'past_due', current_period_end: inDays(-90) },
    { plan: 'active', current_period_end: inDays(-(STALE_DAYS + 10)) },
  ]) {
    const row = { ...contamination, reference_account: true };
    assert.equal(isEntitled(row, NOW), true, JSON.stringify(contamination));
    assert.equal(entitlement(row, NOW).state, 'reference', JSON.stringify(contamination));
  }
});

test('reference_account is a flag, not a guess — an ordinary row is unaffected', () => {
  // default false, per migration 0023 — the arm must be inert for every row
  // that does not carry it explicitly.
  assert.equal(entitlement({ reference_account: false, plan: 'cancelled' }, NOW).state, 'cancelled');
  assert.equal(entitlement({ plan: 'cancelled' }, NOW).state, 'cancelled');
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
    { demo: true, demo_expires_at: inDays(0.5) },
    { demo: true, demo_expires_at: inDays(-0.5) },
    { demo: true },
    { reference_account: true, plan: 'trial', trial_ends_at: null },
    { reference_account: true, plan: 'trial', trial_ends_at: inDays(-30) },
  ];
  for (const r of rows) {
    const e = entitlement(r, NOW);
    assert.equal(typeof e.entitled, 'boolean', JSON.stringify(r));
    assert.ok(e.state && e.reason, `${JSON.stringify(r)} produced no state/reason`);
  }
});
