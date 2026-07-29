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
8. First of the month, `monthlyRestaurantReport` aggregates and Cloudflare mails it

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
| `base44/functions/monthlyRestaurantReport/` | Scheduled aggregation, hands off to Cloudflare |
| `functions/api/monthly-report.js` | Sends the month-end report via Postmark |
| `functions/api/rating-alert.js` | Instant low-rating alert |
| `functions/api/restaurant-lead.js` | New-lead alert |
| `functions/_lib/email.js` | Shared email (Postmark/Resend) + SMS (Twilio) helper |
| `functions/api/create-checkout.js` | Stripe Checkout session |
| `functions/api/verify-checkout.js` | Server-side payment confirmation |

## Configuration

**Cloudflare** (Settings → Environment variables):

| Variable | Required | Default |
| --- | --- | --- |
| `POSTMARK_SERVER_TOKEN` | yes* | — |
| `POSTMARK_MESSAGE_STREAM` | no | `outbound` |
| `RESEND_API_KEY` | yes* | — |
| `LEAD_NOTIFY_TO` | no | `alerts@billtap.app` |
| `LEAD_NOTIFY_FROM` | no | `BillTap <alerts@billtap.app>` |
| `RESTAURANT_TZ` | no | `America/Los_Angeles` |
| `TWILIO_ACCOUNT_SID` | for SMS | — |
| `TWILIO_AUTH_TOKEN` | for SMS | — |
| `TWILIO_FROM_NUMBER` | for SMS | — |
| `STRIPE_SECRET_KEY` | for billing | — |
| `STRIPE_PRICE_ID` | for billing | — |
| `PUBLIC_BASE_URL` | no | request origin |
| `REPORT_WEBHOOK_SECRET` | for reports | — |

\* One email provider is required, not both. Postmark wins when its token is
present — that account owns `billtap.app`, so mail comes from
`alerts@billtap.app`. Resend is the fallback and can only send from
`grandeza.io`, so with Resend alone set `LEAD_NOTIFY_FROM` accordingly.

SMS is dormant until all three Twilio values are set; operators then get a text
*and* an email on every low rating. An operator who leaves the phone field blank
gets email only. Billing endpoints return 503 until the Stripe pair is set.

**Base44** (scheduling only): `REPORT_WEBHOOK_URL`
(`https://billtap.app/api/monthly-report`) and `REPORT_WEBHOOK_SECRET`, matching
the Cloudflare value. Schedule `monthlyRestaurantReport` for the 1st.

### No mail leaves Base44

`monthlyRestaurantReport` aggregates the numbers — the one step that needs data
access — and POSTs them to `/api/monthly-report`, which sends through Postmark.
Base44 holds no mail credentials and talks to no mail provider. Alerts, lead
notifications and reports all leave from Cloudflare as `alerts@billtap.app`.

The aggregation reads via `base44.asServiceRole` — a scheduled run has no
signed-in user, so user-scoped reads would come back empty.

**Sender:** Postmark owns `billtap.app`, so alerts and reports come from
`alerts@billtap.app`. Falling back to Resend means sending from `grandeza.io`,
since that is the only domain verified there.

Persistence never depends on email: ratings, contacts and leads are written
before any notification is attempted, so a mail failure costs the alert, not the
data.

## Onboarding a restaurant

1. Owner signs in → `/restaurant-dashboard` → enters name + alert email
2. 14-day trial starts, a `slug` is assigned (collision-safe)
3. Owner pastes their **Google review URL** — until then the Google handoff
   button stays disabled, since there is nowhere to send happy guests
4. Print the table QR shown on the dashboard

## Billing

`/api/create-checkout` opens a Stripe Checkout session for the $149/mo price and
returns its URL; card details never touch this app. On return, the dashboard
calls `/api/verify-checkout`, which asks Stripe directly whether the session
paid, then writes `plan: "active"` through the SDK as the signed-in owner.

Set `STRIPE_PRICE_ID` to a **recurring** $149/month price, not a one-off.

**Known gap — add before this carries volume:** there is no Stripe webhook, so
renewals, failed payments and cancellations do not flow back automatically. A
subscription cancelled in Stripe still reads `active` here until someone changes
it. `verify-checkout` also decides payment server-side, but the plan write itself
happens client-side — an owner could set their own row to `active` through the
SDK. Fine for a pilot; wire `functions/api/stripe-webhook.js` against
`customer.subscription.*` before it matters.

## Not built: POS integration

The flyer claims "works with your POS — no new hardware, no disruption", which is
accurate: BillTap sits beside the POS and needs nothing from it. There is **no**
Toast/Square/Clover data integration. Adding one is not just code — each vendor
requires a partner account, OAuth credentials and app review, so automatic check
import would need those in hand first.

## Imagery

Hero and detail images were generated with Higgsfield (Nano Banana 2) and point
at Higgsfield's CDN, with CSS gradient fallbacks beneath so a dead URL degrades
rather than breaks. To self-host, see `src/lib/restaurant-assets.js`.
