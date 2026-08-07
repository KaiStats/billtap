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
    case "cancelled":
      return {
        tone: "#8b8b8b",
        headline: "Subscription cancelled",
        heading: "Subscription cancelled",
        detail: "Your guests can still split checks, but reviews and alerts have stopped. Resubscribe any time.",
      };
    default:
      return {
        tone: "#f0b429",
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
