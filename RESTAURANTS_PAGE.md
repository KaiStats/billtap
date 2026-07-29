# BillTap for Restaurants

The B2B product behind the flyer: guests split the check free, the restaurant
gets the reviews and the guest list.

## The loop

1. Guest scans the table tent → `/r/<slug>` (`src/pages/TableEntry.jsx`)
2. They split and pay through the existing flow
3. On "I've paid", `RatingCapture` opens (`src/components/RatingCapture.jsx`)
4. **Above** the restaurant's threshold → one-tap handoff to its Google review URL
5. **At or below** → private feedback, and `/api/rating-alert` pages the operator
6. Either way the email lands in `GuestContact`
7. Operator watches it all at `/restaurant-dashboard`
8. First of the month, `monthlyRestaurantReport` emails the numbers

Sessions are stamped with `restaurant_id` **server-side** in `createSession`,
derived from the authenticated host's own `Restaurant` row. It is never accepted
from the client — otherwise anyone could attribute ratings, and the guest emails
attached to them, to a restaurant they don't own.

## Files

| File | Role |
| --- | --- |
| `src/pages/Restaurants.jsx` | Marketing page + lead capture |
| `src/pages/TableEntry.jsx` | `/r/:slug` — what the table tent points at |
| `src/pages/RestaurantDashboard.jsx` | Stats, low-rating queue, guest list, settings, table QR |
| `src/components/RatingCapture.jsx` | Post-payment rating, routing, email capture |
| `base44/entities/Restaurant.jsonc` | Restaurant config |
| `base44/entities/GuestRating.jsonc` | Every rating, and whether it was routed to Google |
| `base44/entities/GuestContact.jsonc` | The guest list |
| `base44/entities/RestaurantLead.jsonc` | Inbound sales leads |
| `base44/functions/monthlyRestaurantReport/` | Scheduled monthly email |
| `functions/api/rating-alert.js` | Instant low-rating alert |
| `functions/api/restaurant-lead.js` | New-lead alert |
| `functions/_lib/email.js` | Shared Resend helper |

## Configuration

**Cloudflare** (Settings → Environment variables):

| Variable | Required | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | — |
| `LEAD_NOTIFY_TO` | no | `alerts@billtap.app` |
| `LEAD_NOTIFY_FROM` | no | `BillTap <alerts@grandeza.io>` |
| `RESTAURANT_TZ` | no | `America/Los_Angeles` |

**Base44** (for the scheduled report): `RESEND_API_KEY`, optionally `REPORT_FROM`.
Schedule `monthlyRestaurantReport` for the 1st of each month.

**Sender caveat:** only `grandeza.io` is verified in Resend today, so mail sends
from there. Verify `billtap.app` and change `LEAD_NOTIFY_FROM` / `REPORT_FROM` —
nothing else changes.

Persistence never depends on email: ratings, contacts and leads are written
before any notification is attempted, so a mail failure costs the alert, not the
data.

## Onboarding a restaurant

1. Owner signs in → `/restaurant-dashboard` → enters name + alert email
2. 14-day trial starts, a `slug` is assigned (collision-safe)
3. Owner pastes their **Google review URL** — until then the Google handoff
   button stays disabled, since there is nowhere to send happy guests
4. Print the table QR shown on the dashboard

## Not built: POS integration

The flyer claims "works with your POS — no new hardware, no disruption", which is
accurate: BillTap sits beside the POS and needs nothing from it. There is **no**
Toast/Square/Clover data integration, and building one is not just code — each
vendor requires a partner account, OAuth credentials and app review. Don't sell
automatic check import until those are in hand.

## Imagery

Hero and detail images were generated with Higgsfield (Nano Banana 2) and point
at Higgsfield's CDN, with CSS gradient fallbacks beneath so a dead URL degrades
rather than breaks. To self-host, see `src/lib/restaurant-assets.js`.
