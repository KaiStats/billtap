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
| `worker/routes/monthly-report.js` | Sends the month-end report via Postmark |
| `worker/routes/rating-alert.js` | Instant low-rating alert |
| `worker/routes/restaurant-lead.js` | New-lead alert |
| `worker/lib/email.js` | Shared email (Postmark/Resend) + SMS (Twilio) helper |
| `worker/routes/create-checkout.js` | Stripe Checkout session |
| `worker/routes/verify-checkout.js` | Server-side payment confirmation at signup |
| `worker/routes/base44-proxy.js` | Proxies /api/apps/** to Base44 |
| `worker/index.js` | Worker entry — routes /api/*, serves ./dist |
| `wrangler.jsonc` | Deploy config |
| `base44/functions/stripeWebhook/` | Renewals, failed cards, cancellations |

## Deploying to Cloudflare

Cloudflare has retired Pages for new projects, so this deploys as a **Worker with
static assets**: `npm run build` emits `./dist`, then `npx wrangler deploy`
uploads the assets plus `worker/index.js`. Config lives in `wrangler.jsonc`.

**Create the project:** Cloudflare → Workers & Pages → Create application →
Connect to Git → `KaiStats/billtap`.

| Field | Value |
| --- | --- |
| Project name | `billtap` (lowercase, letters/numbers/hyphens only) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**Build-time variables** — Vite inlines these, so they must be set *before* the
build or the app ships pointing at nothing:

```
VITE_BASE44_APP_ID         <your Base44 app id>
VITE_BASE44_APP_BASE_URL   <your Base44 app URL>
```

**DNS:** attach both `billtap.app` and `www.billtap.app` to the Worker. The apex
currently has no record at all, which is why the domain does not resolve — the
printed flyer QR depends on it.

### How routing works

`wrangler.jsonc` sets `run_worker_first: ["/api/*"]`, so API paths reach the
Worker and everything else is served straight from `./dist`.
`not_found_handling: "single-page-application"` makes unmatched paths fall back
to `index.html`, which is what lets `/restaurants` and `/r/<slug>` survive a cold
visit.

Both parts matter. Without `run_worker_first`, the SPA fallback would answer
`/api/*` with `index.html` and every API call — including the Base44 data layer
the whole app runs on — would return HTML instead of JSON.

### Why /api/apps/** is proxied

`src/api/base44Client.js` builds the SDK with `serverUrl: ''`, so every entity,
auth and function call is issued **same-origin** as `/api/apps/<appId>/...`. That
works when Base44 serves the app itself. Served from Cloudflare there is no such
route, so without `worker/routes/base44-proxy.js` every read and write in the app
— the consumer bill-splitter included — would 404.

Proxying rather than repointing the SDK at `https://base44.app` keeps requests
same-origin, so nothing depends on Base44's CORS policy for the `billtap.app`
origin and cookie auth keeps working. Set `BASE44_API_ORIGIN` if your Base44 API
lives somewhere other than `https://base44.app`.

### First smoke test after deploying

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://billtap.app/restaurants   # 200
curl -sS -o /dev/null -w "%{http_code}\n" https://billtap.app/r/anything    # 200 (SPA boots)
curl -sS -X POST https://billtap.app/api/restaurant-lead \
  -H 'Content-Type: application/json' -d '{}'                              # 400, not 404
```

A **404** on the last one means the Worker did not deploy. A **400** means it
did — that is the endpoint rejecting an empty body, which is correct.

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

Base44 also needs `STRIPE_WEBHOOK_SECRET` for the subscription webhook.

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

### Keeping state honest after signup

`verify-checkout` only ever runs once. `base44/functions/stripeWebhook` handles
everything after: renewals, failed cards and cancellations.

Point Stripe at `https://<your-app-domain>/functions/stripeWebhook` and subscribe
to `customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed` and `invoice.payment_succeeded`. Set
`STRIPE_WEBHOOK_SECRET` (the `whsec_…` value) in Base44.

It lives in Base44 because it writes data, which Base44 still owns; it sends no
mail. Signatures are verified against the **raw** body before parsing — parsing
first would re-serialise the bytes and break the HMAC. Replays outside a
5-minute window are rejected, and multiple `v1` signatures are accepted so a
signing-secret rotation doesn't drop events. Data errors return 500 so Stripe
retries rather than silently dropping a cancellation.

Plan states: `trial` → `active` → `past_due` (payment failed, service continues)
→ `cancelled`. The dashboard renders all four.

**Remaining caveat:** `verify-checkout` decides payment server-side, but the
signup plan write happens client-side, so an owner could set their own row to
`active` through the SDK. The webhook corrects it on the next Stripe event.

## Not built: POS integration

The flyer claims "works with your POS — no new hardware, no disruption", which is
accurate: BillTap sits beside the POS and needs nothing from it. There is **no**
Toast/Square/Clover data integration. Adding one is not just code — each vendor
requires a partner account, OAuth credentials and app review, so automatic check
import would need those in hand first.

## Imagery

Hero and detail images were generated with Higgsfield (Nano Banana 2) and point
at Higgsfield's CDN, with CSS gradient fallbacks beneath so a dead URL degrades
rather than breaks.

**Self-host them before this page carries real traffic** — the CDN is Higgsfield's,
not yours, and those URLs can disappear without notice. Two commands and a
one-line edit:

```bash
mkdir -p public/img
curl -o public/img/restaurants-hero.png \
  "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5/hf_20260729_145319_1db26e63-a913-47d4-af26-0c55a6a8ae7e.png"
curl -o public/img/restaurants-detail.png \
  "https://d8j0ntlcm91z4.cloudfront.net/user_3F5ssCqR5J7p1iLhp9GPzJjUxk5/hf_20260729_145616_4a63691c-b043-4ed2-9e77-a054b53fbdb5.png"
```

Then in `src/lib/restaurant-assets.js` replace the two exported URLs with
`/img/restaurants-hero.png` and `/img/restaurants-detail.png`. Nothing else
changes — the CSP already allows `img-src 'self'`.

## Do not put Cloudflare code in a top-level functions/

Base44's repo sync claims that path. It moved every file from `functions/` into
`base44/functions/<name>/entry.ts` on its own — renaming `.js` to `.ts` and
nesting each in a folder — which broke every import in `worker/index.js` and
registered Cloudflare handlers as Base44 Deno functions.

Cloudflare code lives under `worker/`: `worker/index.js` for routing,
`worker/routes/` for handlers, `worker/lib/` for shared helpers. Base44 leaves
that alone.

Base44 also commits to `main` unprompted — it has applied RLS rules and migrated
workflows. Pull before branching.
