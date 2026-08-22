/**
 * The number a GM decides renewal on.
 *
 * `routed_to_google` counts taps, which says the app did its job rather than
 * that the restaurant got anything. This is the outcome, and because it is the
 * figure used to justify a price, the cases that matter are the ones where an
 * eager version of it would overclaim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reviewLift, STALE_DAYS } from './lib/reviewLift.js';

const NOW = Date.UTC(2026, 9, 1);
const DAY = 86400000;
const daysAgo = (n) => NOW - n * DAY;

test('the lift is the difference, and it is plain arithmetic', () => {
  const lift = reviewLift({
    google_review_count_start: 89, google_review_count: 134,
    google_rating_start: 4.1, google_rating: 4.4,
    google_reviews_at: daysAgo(1),
  }, NOW);

  assert.equal(lift.countDelta, 45);
  assert.equal(lift.ratingDelta, 0.3);
  assert.equal(lift.countStart, 89);
  assert.equal(lift.countNow, 134);
});

test('no baseline means no claim, never a lift measured from zero', () => {
  // The one dishonest failure available here. Defaulting the baseline to zero
  // would report every review the restaurant has ever had — most of them
  // earned long before BillTap existed — as though this product produced them.
  assert.equal(reviewLift({ google_review_count: 134 }, NOW), null);
  assert.equal(reviewLift({ google_rating: 4.4 }, NOW), null);
  assert.equal(reviewLift({}, NOW), null);
  assert.equal(reviewLift(null, NOW), null);
});

test('a drop is reported as a drop', () => {
  // Google removes reviews. A panel that can only render good news is one
  // nobody should believe when it renders good news.
  const lift = reviewLift({
    google_review_count_start: 120, google_review_count: 111,
    google_rating_start: 4.5, google_rating: 4.2,
    google_reviews_at: daysAgo(2),
  }, NOW);

  assert.equal(lift.countDelta, -9);
  assert.equal(lift.ratingDelta, -0.3);
});

test('a rating delta never renders as floating-point noise', () => {
  // 4.4 - 4.1 is 0.30000000000000004 in IEEE 754, and that on a dashboard
  // makes the whole panel look like it is guessing.
  const lift = reviewLift({
    google_review_count_start: 1, google_review_count: 1,
    google_rating_start: 4.1, google_rating: 4.4,
    google_reviews_at: NOW,
  }, NOW);
  assert.equal(String(lift.ratingDelta), '0.3');
});

test('one half without the other still reports what it has', () => {
  // An operator who entered a count but never a rating gets the count.
  const countOnly = reviewLift({
    google_review_count_start: 10, google_review_count: 20, google_reviews_at: NOW,
  }, NOW);
  assert.equal(countOnly.countDelta, 10);
  assert.equal(countOnly.ratingDelta, null);

  const ratingOnly = reviewLift({
    google_rating_start: 4.0, google_rating: 4.5, google_reviews_at: NOW,
  }, NOW);
  assert.equal(ratingOnly.ratingDelta, 0.5);
  assert.equal(ratingOnly.countDelta, null);
});

test('a hand-entered figure goes stale, and an undated one is stale on sight', () => {
  const fresh = reviewLift({
    google_review_count_start: 1, google_review_count: 2, google_reviews_at: daysAgo(3),
  }, NOW);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.ageDays, 3);

  const old = reviewLift({
    google_review_count_start: 1, google_review_count: 2, google_reviews_at: daysAgo(STALE_DAYS + 1),
  }, NOW);
  assert.equal(old.stale, true);

  // No timestamp at all: nobody can vouch for the number, so the screen must
  // ask rather than assert.
  const undated = reviewLift({ google_review_count_start: 1, google_review_count: 2 }, NOW);
  assert.equal(undated.stale, true);
  assert.equal(undated.ageDays, null);
});

test('a flat month is a real answer, not a missing one', () => {
  // Zero lift has to render. Hiding it would mean the panel only ever appears
  // when it flatters, which is the same dishonesty as a baseline of zero.
  const lift = reviewLift({
    google_review_count_start: 100, google_review_count: 100, google_reviews_at: NOW,
  }, NOW);
  assert.notEqual(lift, null);
  assert.equal(lift.countDelta, 0);
});
