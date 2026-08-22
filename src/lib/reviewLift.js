/**
 * What the restaurant's Google listing has done since they started paying.
 *
 * ── Why this is a module and not three lines in the dashboard ───────────────
 *
 * It is the renewal conversation. A GM deciding whether $149 a month is worth
 * keeping asks "were my reviews 89 or not, and what are they now" — and the
 * answer has to be arithmetic anyone can check, not a number the app asserts.
 * Putting it here means it can be tested against the cases that would
 * embarrass it: a baseline nobody set, a count that went down, a stale figure.
 *
 * ── The honesty rules ───────────────────────────────────────────────────────
 *
 * No baseline means no claim. A restaurant that never entered a starting count
 * has no lift to show, and defaulting the baseline to zero would report every
 * review they have ever had as though BillTap produced it. That is the one
 * mistake in here that would be actively dishonest, so it returns null.
 *
 * A drop is reported as a drop. Reviews can be removed by Google, and a
 * product that only ever renders a positive number is one nobody should trust
 * with the positive ones either.
 */

/** Beyond this, a hand-entered figure is stale enough to say so on screen. */
export const STALE_DAYS = 30;

const DAY = 86400000;

/**
 * @returns {null | {
 *   countStart: number|null, countNow: number|null, countDelta: number|null,
 *   ratingStart: number|null, ratingNow: number|null, ratingDelta: number|null,
 *   ageDays: number|null, stale: boolean,
 * }}
 *   null when there is nothing honest to say.
 */
export function reviewLift(restaurant, now = Date.now()) {
  if (!restaurant) return null;

  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  const countStart = num(restaurant.google_review_count_start);
  const countNow = num(restaurant.google_review_count);
  const ratingStart = num(restaurant.google_rating_start);
  const ratingNow = num(restaurant.google_rating);

  const haveCount = Number.isFinite(countStart) && Number.isFinite(countNow);
  const haveRating = Number.isFinite(ratingStart) && Number.isFinite(ratingNow);

  // Nothing to compare against is not a lift of zero.
  if (!haveCount && !haveRating) return null;

  const takenAt = num(restaurant.google_reviews_at);
  const ageDays = Number.isFinite(takenAt) ? Math.max(0, Math.floor((now - takenAt) / DAY)) : null;

  return {
    countStart: haveCount ? countStart : null,
    countNow: haveCount ? countNow : null,
    countDelta: haveCount ? countNow - countStart : null,
    ratingStart: haveRating ? ratingStart : null,
    ratingNow: haveRating ? ratingNow : null,
    // Rounded to one decimal so floating point cannot render 0.30000000000000004.
    ratingDelta: haveRating ? Math.round((ratingNow - ratingStart) * 10) / 10 : null,
    ageDays,
    // An unknown age counts as stale: a figure with no timestamp is one nobody
    // can vouch for, and the screen should ask rather than assert.
    stale: ageDays === null || ageDays > STALE_DAYS,
  };
}
