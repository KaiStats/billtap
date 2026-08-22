/**
 * What the dashboard tells an operator about their own billing.
 *
 * This screen said two things at once in production. Mariposa's row is
 * `plan: 'trial'` with `trial_ends_at: NULL` — the shape every hand-created
 * restaurant has, because nothing outside saveMyRestaurant sets a trial end
 * date — and the page rendered "Active plan" in its header above a card
 * reading "Free trial".
 *
 * The header's rule was `plan === "trial" && trial_ends_at ? … : "Active
 * plan"`, so *every* state that failed that condition printed "Active plan".
 * A missing date was the visible case. `past_due` and `cancelled` were the
 * dangerous ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planSummary, trialDaysLeft, demoHoursLeft } from './lib/plan.js';

const NOW = Date.UTC(2026, 7, 6);
const DAY = 86400000;
const HOUR = 3600000;

test('a trial with no end date says trial, not "Active plan"', () => {
  // Mariposa, exactly: created by hand in SQL during the Supabase cutover.
  const { headline, heading } = planSummary({ plan: 'trial', trial_ends_at: null }, NOW);
  assert.equal(headline, 'Free trial');
  assert.equal(heading, 'Free trial', 'and the card beneath it agrees');
});

test('a card that was declined is not reported as an active plan', () => {
  // The one that matters. An operator whose payment failed was told, in the
  // largest text on the screen, that everything was fine — while the card
  // below said the opposite. This is the state most in need of being noticed.
  const declined = planSummary({ plan: 'past_due' }, NOW);
  assert.equal(declined.headline, 'Payment failed');
  assert.equal(declined.tone, '#e5484d');

  const gone = planSummary({ plan: 'cancelled' }, NOW);
  assert.equal(gone.headline, 'Subscription cancelled');
});

test('the header and the billing card cannot disagree', () => {
  // The property, rather than any one string: both come from one call, so
  // there is no second rule left to drift.
  for (const plan of ['trial', 'active', 'past_due', 'cancelled', undefined, 'something_new']) {
    for (const trial_ends_at of [null, NOW + 5 * DAY]) {
      const s = planSummary({ plan, trial_ends_at }, NOW);
      assert.ok(s.headline, `${plan}/${trial_ends_at} produced no headline`);
      assert.ok(s.heading && s.detail && s.tone);
      // "Active plan" was the old catch-all and is the wrong answer for
      // everything except an actual active subscription.
      if (plan !== 'active') {
        assert.notEqual(s.headline, 'Subscription active', `${plan} must not read as paying`);
      }
    }
  }
});

test('a trial with an end date counts down to it', () => {
  const s = planSummary({ plan: 'trial', trial_ends_at: NOW + 5 * DAY }, NOW);
  assert.match(s.headline, /^Trial ends /);
  assert.equal(s.detail, '5 days left, then $149/month. Cancel anytime.');

  const last = planSummary({ plan: 'trial', trial_ends_at: NOW + DAY }, NOW);
  assert.equal(last.detail, '1 day left, then $149/month. Cancel anytime.');
});

test('an expired trial counts to zero rather than backwards', () => {
  assert.equal(trialDaysLeft({ trial_ends_at: NOW - 9 * DAY }, NOW), 0);
  assert.equal(trialDaysLeft({ trial_ends_at: null }, NOW), null);
  assert.equal(trialDaysLeft({}, NOW), null);
  assert.equal(trialDaysLeft(null, NOW), null);
});

test('a demo says demo, not "Free trial"', () => {
  // A demo row is entitled, so without its own arm it falls through every
  // branch to the default and is described to the person who created it as a
  // customer on a fourteen-day clock. Both halves of that are wrong.
  const demo = { demo: true, demo_expires_at: NOW + 6 * HOUR, plan: 'trial', trial_ends_at: null };
  const s = planSummary(demo, NOW);
  assert.equal(s.headline, 'Demo');
  assert.equal(s.heading, 'Demo');
  assert.equal(s.tone, '#f0b429', 'gold — the brand colour, and the one the table tents are printed in');
  assert.match(s.detail, /6 hours/);
  assert.match(s.detail, /not a customer account/);
  assert.match(s.detail, /never reach your numbers/);

  assert.equal(demoHoursLeft(demo, NOW), 6);
  assert.equal(demoHoursLeft({ demo_expires_at: NOW - 5 * HOUR }, NOW), 0, 'counts to zero, not backwards');
  assert.equal(demoHoursLeft({}, NOW), null);
  assert.equal(demoHoursLeft(null, NOW), null);
});

test('an expired demo does not say "Trial ended"', () => {
  // That copy is a lie in every clause: nothing here was a trial, there is no
  // service to have stopped, and there is no $149 that turns it back on.
  const s = planSummary({ demo: true, demo_expires_at: NOW - HOUR }, NOW);
  assert.equal(s.headline, 'Demo expired');
  assert.notEqual(s.heading, 'Trial ended');
  assert.ok(!/\$149/.test(s.detail), 'nobody was ever going to be billed for this');
});

test('a demo with no expiry still reads as a demo', () => {
  // entitlement() serves it — the fail-open direction — so this screen has to
  // have something honest to say about it rather than falling through.
  const s = planSummary({ demo: true, demo_expires_at: null }, NOW);
  assert.equal(s.heading, 'Demo');
});

test('a reference account says so, not "Trial ended"', () => {
  // Mariposa's actual shape after migration 0011: plan: 'trial' with a real
  // trial_ends_at that has since passed. entitlement() serves her anyway —
  // the reference_account arm — so the screen must not read that stale date
  // as a warning nobody meant to raise.
  const s = planSummary(
    { reference_account: true, plan: 'trial', trial_ends_at: NOW - 9 * DAY },
    NOW,
  );
  assert.equal(s.headline, 'Reference account');
  assert.equal(s.heading, 'Reference account');
  assert.notEqual(s.heading, 'Trial ended');
  assert.ok(!/Trial ends/.test(s.headline));
});

test('an unrecognised plan is treated as a trial, not as paying', () => {
  // A plan string this build has never heard of — a webhook shipped ahead of
  // the client, say. Failing to "Free trial" understates what the operator
  // has; failing to "Subscription active" tells them they are covered when
  // nothing here knows that. Understating is the safe direction.
  const s = planSummary({ plan: 'paused_by_stripe' }, NOW);
  assert.equal(s.heading, 'Free trial');
});
