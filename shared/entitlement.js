/**
 * Whether a restaurant is entitled to the paid half of this product, right now.
 *
 * ── What this closes ────────────────────────────────────────────────────────
 *
 * Nothing enforced payment. `trial_ends_at` was written once at creation and
 * read once for display; it was never compared against the clock anywhere on
 * the server. `plan` appeared outside the Stripe routes in exactly one place —
 * also display. So a trial that ran out kept full service forever, and so did a
 * subscription somebody cancelled.
 *
 * The pricing is $149/month for everybody with nobody grandfathered, and a
 * price nothing collects is not a price.
 *
 * ── What "entitled" gates, and what it must never gate ──────────────────────
 *
 * Gated: the Google review handoff, low-rating alerts, the monthly report —
 * the things the operator is buying.
 *
 * Never gated: a guest splitting a bill. The diner at the table did not fail to
 * pay us and has no idea there is a billing problem; breaking their evening to
 * collect from somebody else is both cruel and useless. Guest ratings and
 * contact captures are still *recorded* too, for a related reason: that data is
 * the restaurant's, it cannot be recovered once refused, and the moment they
 * pay it should be there waiting rather than a hole in their history.
 *
 * ── Which way this fails ────────────────────────────────────────────────────
 *
 * Open, deliberately, at every ambiguity. Wrongly denying a paying restaurant
 * takes away something they bought and they find out from a guest; wrongly
 * serving an unpaid one costs a month of margin and is recoverable by asking.
 * Those are not the same size of mistake, so every unknown here resolves to
 * entitled.
 *
 * That principle is why there are two thresholds rather than one.
 */

/**
 * Days of service after a period ends while Stripe is still retrying a card.
 *
 * Stripe's default dunning runs a couple of weeks. A week of grace covers the
 * common case — a card that expired and gets replaced — without giving a month
 * away, and it applies only once billing has actually reported trouble.
 */
export const GRACE_DAYS = 7;

/**
 * The backstop for an `active` row nobody has refreshed.
 *
 * `current_period_end` only advances when something writes it: checkout, or the
 * nightly reconcile against Stripe. If that reconcile stops running, the date
 * goes stale on a perfectly healthy subscription — so treating "stale" as
 * "lapsed" too eagerly would cut off paying restaurants the day a cron broke.
 *
 * Hence forty-five days: longer than any monthly cycle plus Stripe's whole
 * retry window, so a live subscription can never reach it, and short enough
 * that a subscription genuinely cancelled behind our back does not run free
 * indefinitely. It is a bound on the damage, not the mechanism — the reconcile
 * job is the mechanism.
 */
export const STALE_DAYS = 45;

const DAY = 86400000;

/**
 * @returns {{ entitled: boolean, state: string, reason: string }}
 *   `state` is for the operator's screen, `reason` for a log line. `entitled`
 *   is the only thing a gate should branch on.
 */
export function entitlement(restaurant, now = Date.now()) {
  if (!restaurant) {
    // Not an ambiguity. There is no restaurant to serve, so there is nothing to
    // fail open about.
    return { entitled: false, state: 'none', reason: 'no restaurant' };
  }

  /**
   * A demo page, stood up at a table for somebody who has not bought anything.
   *
   * First, and above everything below it, because this is the least ambiguous
   * case in the function. The row is ours. There is no customer, no payment,
   * and therefore no payment question to fail open about — so none of the
   * reasoning underneath applies to it, and letting a `plan` or a stale
   * `trial_ends_at` reach a demo row is how the demo stops working.
   *
   * It must be entitled, because being entitled is the entire point. The thing
   * being sold is the low-rating alert arriving while a prospect is holding the
   * phone; an unentitled demo is a demo that does nothing at the exact moment
   * it is being watched, and does it silently. That was the live behaviour of
   * the hand-made rows this replaces, fourteen days after each was typed.
   *
   * ── The asymmetry with the rest of the file is deliberate ─────────────────
   *
   * A demo with no expiry is served, consistent with the fail-open principle
   * above and with the Mariposa precedent at `!trialEnd`: a gap in our own data
   * entry is not a reason to break the demo.
   *
   * An expired one is denied outright, with none of the grace the paid states
   * get. Grace exists to protect a paying restaurant from our own billing
   * errors — there is nobody here to protect. Extending it would only mean a
   * page bearing a stranger's business name staying live longer than the
   * conversation that produced it.
   *
   * `demo_expired` should never reach anybody's eyes: the nightly job in
   * worker/routes/retention.js deletes these rows. The state exists for the
   * night that job does not run, so the page degrades to an expired demo rather
   * than to a live-looking one for a business that never agreed to it.
   */
  if (restaurant.demo) {
    const expires = Number(restaurant.demo_expires_at) || null;
    if (!expires || now < expires) {
      return { entitled: true, state: 'demo', reason: 'demo restaurant' };
    }
    return { entitled: false, state: 'demo_expired', reason: 'demo expired' };
  }

  /**
   * A row we deliberately keep off the billing clock, not a gap in one.
   *
   * ── Mariposa, specifically ────────────────────────────────────────────────
   *
   * She is the first pilot and the live sales demo. Migration 0011 gave her
   * row a real `trial_ends_at`, which was the honest fix for "a NULL date reads
   * as an accidental forever" — but it also means her trial now runs out on the
   * same clock as everybody else's, and the alert she is demoed with goes
   * silent at that clock's mercy, not by anyone's decision.
   *
   * "Her trial is deliberately open-ended" and "our entitlement logic silently
   * gives free service to any row with a NULL date" used to be the same state:
   * `plan: 'trial'`, `trial_ends_at: null`. This flag is what tells them apart.
   * It says nothing about payment — that is still `plan` and `trial_ends_at`,
   * untouched — it only says this particular row is not on that clock, on
   * purpose, because somebody set the flag rather than because a column was
   * left blank.
   *
   * Second in line, after the demo arm and before the trial/subscription
   * checks below, for the same reason those checks do not apply to a demo row:
   * there is no billing question here for `plan` or `trial_ends_at` to answer.
   *
   * No expiry, unlike `demo`. A demo is a page stood up for a stranger who has
   * agreed to nothing and is torn down by worker/routes/retention.js; a
   * reference account is ours, kept on purpose, for as long as it is useful as
   * a live demo restaurant. Migration 0023 adds the column, default false, and
   * sets it for Mariposa specifically — nothing else is affected.
   */
  if (restaurant.reference_account) {
    return { entitled: true, state: 'reference', reason: 'reference account — not on the billing clock' };
  }

  const plan = restaurant.plan || 'trial';
  const periodEnd = Number(restaurant.current_period_end) || null;
  const trialEnd = Number(restaurant.trial_ends_at) || null;

  if (plan === 'cancelled') {
    // The one state that is somebody's decision rather than an inference. No
    // grace: they asked to stop.
    return { entitled: false, state: 'cancelled', reason: 'subscription cancelled' };
  }

  if (plan === 'active' || plan === 'past_due') {
    if (!periodEnd) {
      // Subscribed, but nothing ever recorded when the period ends — an older
      // row, or a checkout that answered without an expanded subscription.
      // They paid; serve them.
      return { entitled: true, state: plan, reason: 'no period end recorded' };
    }
    const grace = plan === 'past_due' ? GRACE_DAYS : STALE_DAYS;
    if (now < periodEnd + grace * DAY) {
      return { entitled: true, state: plan, reason: 'within period' };
    }
    return {
      entitled: false,
      state: 'lapsed',
      reason: plan === 'past_due'
        ? `past_due and ${GRACE_DAYS} days past period end`
        : `active but ${STALE_DAYS} days past period end — reconcile may be stale`,
    };
  }

  // Trial, and anything unrecognised. An unknown plan string is treated as a
  // trial rather than as paid: a webhook or a Stripe status this build has not
  // heard of should not silently confer a subscription.
  if (!trialEnd) {
    // The Mariposa case. A row created by hand in SQL has no trial date, and
    // migration 0011 gives the column a default so new ones cannot. Serving it
    // is the fail-open choice; refusing would cut off a restaurant because of a
    // gap in our own data entry.
    return { entitled: true, state: 'trial', reason: 'trial with no end date' };
  }
  if (now < trialEnd) {
    return { entitled: true, state: 'trial', reason: 'trial running' };
  }
  return { entitled: false, state: 'trial_expired', reason: 'trial ended' };
}

/** Shorthand for the gates, which only ever want the boolean. */
export function isEntitled(restaurant, now = Date.now()) {
  return entitlement(restaurant, now).entitled;
}
