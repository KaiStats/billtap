/**
 * What a restaurant's billing state says, in one place.
 *
 * ── Why this is not two pieces of logic ─────────────────────────────────────
 *
 * RestaurantDashboard rendered the billing state twice from two different
 * rules, and they disagreed. The header asked
 * `plan === "trial" && trial_ends_at`, and printed "Active plan" whenever that
 * was false. The billing card switched on `plan`.
 *
 * Two failures came out of that, and the second is the serious one:
 *
 *   A hand-created row has `plan: 'trial'` and no `trial_ends_at` — nothing
 *   sets one outside saveMyRestaurant. The header fell through to "Active
 *   plan" while the card underneath said "Free trial". Mariposa read exactly
 *   that in production.
 *
 *   Worse: `past_due` and `cancelled` also fail that condition. A restaurant
 *   whose card had been declined, or whose subscription had been cancelled,
 *   was told "Active plan" in the largest text on the screen — while the card
 *   below said "Payment failed". The one operator who most needs to notice
 *   something is the one it reassured.
 *
 * So both now come from here. They cannot drift, because there is nothing left
 * to drift from.
 *
 * `now` is a parameter so a test can pin it rather than move with the clock.
 */
import { entitlement, isEntitled } from '../../shared/entitlement.js';

/** BillTap gold. The brand colour, and the one the table tents are printed in. */
const GOLD = "#f0b429";

/** Hours until a demo page deletes itself, or null when nothing is counting. */
export function demoHoursLeft(restaurant, now = Date.now()) {
  if (!restaurant?.demo_expires_at) return null;
  return Math.max(0, Math.ceil((Number(restaurant.demo_expires_at) - now) / 3600000));
}

/** Days until the trial ends, or null when there is no end date to count to. */
export function trialDaysLeft(restaurant, now = Date.now()) {
  if (!restaurant?.trial_ends_at) return null;
  return Math.max(0, Math.ceil((restaurant.trial_ends_at - now) / 86400000));
}

/**
 * @returns {{ tone: string, headline: string, heading: string, detail: string }}
 *   `headline` is the one-line state for the page header; `heading` and
 *   `detail` are the billing card. Same source, so they agree by construction.
 */
export function planSummary(restaurant, now = Date.now()) {
  const days = trialDaysLeft(restaurant, now);
  const renews = restaurant?.current_period_end
    ? `Renews ${new Date(restaurant.current_period_end).toLocaleDateString()}. $149/month.`
    : "$149/month.";

  /**
   * A demo page, and it says so before it says anything about billing.
   *
   * Above the block below because a demo row *is* entitled — see the demo arm
   * in shared/entitlement.js — so without this it falls through every branch
   * and lands on the `default:` arm, which renders "Free trial" and counts down
   * to a `trial_ends_at` a demo row does not have. That is a sales demo being
   * described to its own operator as a customer on a fourteen-day clock, which
   * is wrong in both halves.
   *
   * The copy says the two things that stop it being mistaken for a restaurant:
   * nobody is being billed, and it deletes itself. This screen is the only
   * place a demo row is ever described in words, so if it is going to be
   * ambiguous anywhere it will be here.
   */
  const { state: current } = entitlement(restaurant, now);
  if (current === 'demo') {
    const hours = demoHoursLeft(restaurant, now);
    return {
      tone: GOLD,
      headline: "Demo",
      heading: "Demo",
      detail: (hours !== null
        ? `Deletes itself in ${hours} hour${hours === 1 ? "" : "s"}. `
        : "Deletes itself when the cleanup job next runs. ")
        + "This is a sales demo, not a customer account — nobody is being billed for it, "
        + "and its ratings never reach your numbers.",
    };
  }

  /**
   * Service has stopped, and saying so plainly comes before everything else.
   *
   * The same rule the Worker gates on — shared/entitlement.js — decides
   * this, so the screen and the server cannot disagree about whether a
   * restaurant is being served. An operator finding out from a guest that
   * their Google button is dead is the failure this exists to prevent, and a
   * dashboard that still reads "Free trial" while the alerts have stopped is
   * the same lie in a quieter voice.
   */
  if (!isEntitled(restaurant, now)) {
    const state = current; // one entitlement() call for the whole function
    /**
     * An expired demo, before the "Trial ended" copy can claim it.
     *
     * Nothing here was ever a trial, so that copy would be a lie in every
     * clause of it — there is no service to have stopped, no $149 to turn it
     * back on with, and nothing collected to still be here. In practice this is
     * unreachable, because the nightly job deletes expired demo rows; it exists
     * for the night that job does not run, which is precisely the night nobody
     * is watching the screen it renders.
     */
    if (state === 'demo_expired') {
      return {
        tone: "#8b8b8b",
        headline: "Demo expired",
        heading: "Demo expired",
        detail: "This demo page has expired and is due to be deleted. Create a new one from /new.",
      };
    }
    if (state === 'cancelled') {
      return {
        tone: "#8b8b8b",
        headline: "Subscription cancelled",
        heading: "Subscription cancelled",
        detail: "Review routing, alerts and your monthly report have stopped. Your guests can still split checks. Resubscribe any time and it all comes back — nothing was deleted.",
      };
    }
    if (state === 'lapsed') {
      return {
        tone: "#e5484d",
        headline: "Payment failed — service paused",
        heading: "Payment failed — service paused",
        detail: "We couldn't take payment, so review routing and alerts have stopped. Update your card, or call (702) 844-0938. Your ratings and guest list are untouched.",
      };
    }
    return {
      tone: "#e5484d",
      headline: "Trial ended",
      heading: "Trial ended",
      detail: "Review routing, alerts and your monthly report have stopped. Subscribe for $149/month to turn them back on — everything you collected is still here.",
    };
  }

  switch (restaurant?.plan) {
    case "active":
      return {
        tone: "#30a46c",
        headline: "Subscription active",
        heading: "Subscription active",
        detail: renews,
      };
    case "past_due":
      return {
        tone: "#e5484d",
        headline: "Payment failed",
        heading: "Payment failed",
        detail: "Stripe couldn't charge your card. Update it from the receipt email, or call (702) 844-0938 — your service is still on for now.",
      };
    // No `cancelled` arm: entitlement() denies that state, so the block above
    // answers it first and a second copy here could only ever drift.
    default:
      return {
        tone: GOLD,
        // A trial with no end date is still a trial. Saying so is the whole
        // point — the alternative claimed the operator was paying.
        headline: restaurant?.trial_ends_at
          ? `Trial ends ${new Date(restaurant.trial_ends_at).toLocaleDateString()}`
          : "Free trial",
        heading: "Free trial",
        detail: days !== null
          ? `${days} day${days === 1 ? "" : "s"} left, then $149/month. Cancel anytime.`
          : "$149/month when your trial ends. Cancel anytime.",
      };
  }
}
