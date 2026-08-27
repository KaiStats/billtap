# BillTap for Restaurants

The B2B product behind the flyer: guests split the check free, the restaurant
gets the reviews and the guest list.

## The loop

1. Guest scans the table tent → `/r/<slug>` (`src/pages/TableEntry.jsx`)
2. They split and pay through the existing flow
3. On "I've paid", `RatingCapture` opens (`src/components/RatingCapture.jsx`)
4. **At or below** the restaurant's threshold → "What went wrong?" first, and
   `/api/rating-alert` pages the operator while the guest is still on site
5. **Every** guest then reaches the same one-tap handoff to the Google review
   URL — including the one who just typed a complaint, and the one who skipped
   the question
6. Either way the email lands in `GuestContact`
7. Operator watches it all at `/restaurant-dashboard`
8. First of the month, `monthlyRestaurantReport` aggregates and Cloudflare mails it

Sessions are stamped with `restaurant_id` **server-side** in `createSession`,
derived from the authenticated host's own `Restaurant` row. It is never accepted
from the client — otherwise anyone could attribute ratings, and the guest emails
attached to them, to a restaurant they don't own.

## The room that never presents a check

The loop above describes a table-service restaurant, and that is a minority of
the businesses this product is for. Counter service, coffee, fast casual,
bakeries, delis, taquerias, food trucks, breweries, pickup windows: the guest
pays **before** they eat, carries their own food, and leaves without anybody
ever asking how it was.

**The trigger is the problem, not a missing feature.** At a table, "you have
paid" and "you have finished" are the same moment, so hanging the rating off
payment is free and correct. At a counter they are opposite ends of the visit.
Wire the split flow into a taqueria and you collect ratings of the queue.

So the trigger moves off the payment event and onto the guest's own scan of a
code placed where finishing happens. Everything behind that scan is unchanged.

### The pay-first loop

1. Guest scans a code on the object they are holding when they finish →
   `/r/<slug>/rate` (`src/pages/TableEntry.jsx`, `rateFirst`)
2. The page opens on five stars. No bill, no receipt photo, nothing to type
3. A tap opens a `kind: 'rating_only'` session (migration 0024 — no items, no
   participants, `total_amount` 0, so nothing counts it as a bill) and hands
   the star to `RatingCapture`, which submits it as though it had been tapped
   there
4. From step 4 of the loop above, it is the same code: the threshold, the alert
   to the operator, the Google handoff every guest reaches

### Where the code goes

This is the whole of the training, and it is the half an operator gets wrong on
their own. The dashboard prints both codes with these lines on them.

| Put it | Why |
| --- | --- |
| The order-number tent | Already on their table for the whole meal, already handed over with the food, already collected and reused. Nothing to reprint per guest |
| The cup, the bag, the wrapper | Goes home with them and is in their hand at the last bite |
| The receipt footer | Square, Toast and Clover all take a custom message and URL. Reaches takeout, delivery pickup and drive-through, and costs nothing per guest |
| A sticker over the bus tub, or by the door | At a counter-service place the bin **is** the end of the meal. Every dine-in guest walks past it on the way out |
| **Not the register** | Asking there is asking about food nobody has eaten yet |

### Why the alert is worth more here

A dining room has a server who comes back to ask how everything is. A counter
has nobody. An unhappy guest at a counter leaves without a word, and the first
the operator hears of it is a review that is already public. This is the only
thing in the room that tells them while the guest is still standing there.

### What is a setting and what is not

`restaurants.service_style` (`'table' | 'counter'`, migration 0026) decides
**only** which screen a bare scan of `/r/<slug>` opens on. `/r/<slug>/rate`
opens rating-first at every restaurant regardless, because the two are not
exclusive — a dining room with a takeout window wants the tent on the tables
and the rating sticker on the bags, and no single flag on the row describes
both halves of that building. Set on the settings pane at
`/restaurant-dashboard`; defaults to `'table'`, so every tent already printed
keeps pointing at the screen it was printed for.

### The ceiling, which used to be one number

`createSession` caps guest sessions per restaurant per hour. It was 100 across
both kinds, which is right for splits and wrong for ratings by an order of
magnitude: a counter collects a rating from every guest rather than from the
fraction of tables that split a check. Left as it was, a busy coffee shop would
stop collecting reviews part-way through every lunch — and be refused with
"this restaurant has too many splits in progress", at a business that has never
presented a check. Worse, one pool couples them: an hour of ratings would lock
out the split flow, and a lock-out there is a table that cannot pay. The two
kinds are counted separately now: 100 splits, 600 ratings.

## The threshold does not hide the link

`rating_threshold` decides one thing: at or below it, the guest is asked what
went wrong and the operator is paged. It does not decide who is shown the Google
review link. Everyone is.

It used to do both. `submitGuestRating` stored `routed_to_google = stars >
rating_threshold` and `RatingCapture` used the same comparison to decide whether
the Google button rendered at all, so raising the threshold raised the bar a
guest had to clear before the app would let them review the place in public.
That is review gating, and it fails on three counts:

- **It is a deceptive practice.** The FTC's rule on consumer reviews covers
  suppressing solicited negative reviews. This solicited every guest and showed
  the link to some of them.
- **Google deletes what it catches.** Its review policy names the practice, and
  enforcement does not carefully spare the legitimate reviews collected the same
  way. A restaurant was paying for reviews that could vanish for how they were
  gathered.
- **It cost volume, which is what actually ranks.** Review count and recency
  outweigh the last tenth of a star in local search. At a threshold of four,
  every four-star guest — a happy guest, still at the table — was never asked.

The alert is untouched and is still the paid half of the product. Being asked
what went wrong before you are handed the comment card is what a good manager
does; taking the comment card away is not. If you are about to reintroduce a
branch where some guests do not reach `google_review_url`, that is this, again.

## Files

| File | Role |
| --- | --- |
| `src/pages/Restaurants.jsx` | Marketing page + lead capture |
| `src/pages/TableEntry.jsx` | `/r/:slug` — what the table tent points at; `/r/:slug/rate` — what the cup, the bag and the number tent point at |
| `src/pages/RestaurantDashboard.jsx` | Stats, low-rating queue, guest list, settings, table QR |
| `src/components/RatingCapture.jsx` | Post-payment rating, feedback, Google handoff, email capture |
| `supabase/migrations/` | The schema. `restaurants` is the config, `guest_ratings` every rating and whether the guest tapped through to Google, `guest_contacts` the guest list, `restaurant_leads` the inbound sales leads |
| `worker/lib/db.js` | Postgres over PostgREST, behind the interface the old Base44 SDK had — `TABLES` at the top is the entity-name-to-table map |
| `worker/routes/monthly-report.js` | Sends the month-end report via Postmark |
| `worker/routes/rating-alert.js` | Instant low-rating alert |
| `worker/routes/restaurant-lead.js` | New-lead alert |
| `worker/lib/email.js` | Shared email (Postmark/Resend) + SMS (Twilio) helper |
| `worker/routes/create-checkout.js` | Stripe Checkout session |
| `worker/routes/verify-checkout.js` | Server-side payment confirmation at signup |
| `worker/routes/stripe-webhook.js` | Renewals, failed cards, cancellations |
| `worker/index.js` | Worker entry — routes /api/*, serves ./dist |
| `wrangler.jsonc` | Deploy config |

## Deploying to Cloudflare

Cloudflare has retired Pages for new projects, so this deploys as a **Worker with
static assets**: `npm run build` emits `./dist`, then `npx wrangler deploy`
uploads the assets plus `worker/index.js`. Config lives in `wrangler.jsonc`.

**Create the project:** Cloudflare → Workers & Pages → Create application →
Connect to Git → `KaiStats/billtap`.

| Field | Value |
| --- | --- |
| Project name | `billtap` (lowercase, letters/numbers/hyphens only) |
| Build command | `npm run build:ci` |
| Deploy command | `npx wrangler deploy --env=""` |

**Not `npm run build`.** That is `vite build` alone: it emits a valid-looking
`dist/` with no prerendered snapshots, so `scripts/verify-dist.mjs` refuses the
deploy with "`/` has no snapshot" and every CI build fails. That is the gate
working, not a fault in it — a build with no snapshots is the exact SEO
regression prerendering exists to prevent.

`build:ci` is `build:static` with `playwright install chromium` in front.
Prerendering drives a real browser and Cloudflare's build image ships without
one. On a laptop you already have the browser, so `npm run build:static` remains
the right command there.

**Build-time variables** — Vite inlines these, so they must be set *before* the
build or the app ships pointing at nothing:

```
VITE_ENVIRONMENT           production
VITE_SUPABASE_URL          <your Supabase project URL>
VITE_SUPABASE_ANON_KEY     <the anon key, which is public by design>
```

These used to read `VITE_BASE44_APP_ID` and `VITE_BASE44_APP_BASE_URL`. Setting
those today ships a bundle that cannot sign anybody in.

**DNS:** attach both `billtap.app` and `www.billtap.app` to the Worker — the
routes in `wrangler.jsonc` expect all three patterns. The apex once had no
record at all and the domain did not resolve, which the printed flyer QR
depends on.

### How routing works

`wrangler.jsonc` sets `run_worker_first: ["/api/*"]`, so API paths reach the
Worker and everything else is served straight from `./dist`.
`not_found_handling: "single-page-application"` makes unmatched paths fall back
to `index.html`, which is what lets `/restaurants` and `/r/<slug>` survive a cold
visit.

Both parts matter. Without `run_worker_first`, the SPA fallback would answer
`/api/*` with `index.html` and every API call — including `/api/fn/*`, which the
whole app runs on — would return HTML instead of JSON.

There used to be a proxy here forwarding `/api/apps/**` to Base44, because the
SDK issued every read and write same-origin under that prefix. The SDK is gone;
the app talks to its own Worker, which talks to Postgres.

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
| `DATA_BACKEND` | yes | — (`supabase`, set in `wrangler.jsonc`) |
| `SUPABASE_URL` | yes | — |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — |
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
| `STRIPE_WEBHOOK_SECRET` | for billing | — |
| `REPORT_WEBHOOK_SECRET` | for reports | — |
| `GEMINI_API_KEY` | for receipt scanning | — |
| `QR_SIGNING_SECRET` | for table QR tokens | — |
| `DEMO_OPERATOR_EMAILS` | to create demo pages | — (empty denies everyone) |
| `DEMO_TTL_HOURS` | no | `24` (clamped 1–720) |

**`DEMO_TTL_HOURS` is short on purpose.** A demo publishes a live page carrying
a real business's name, for a business that has agreed to nothing, so every
extra hour is another hour that page can be found or stumbled on by the owner
whose name is on it. A day is the default because the page should not outlive
the conversation it was made for.

The "come back Tuesday" case is handled by extending the one demo that matters
rather than by keeping them all alive: `extendDemoRestaurant` pushes a live
demo's clock out on demand **without changing its slug**, so the URL already
handed over keeps working. Everything nobody asked about still expires tonight,
and `sweepExpiredDemos` hard-deletes it — row, ratings and contacts — on the
nightly retention pass.

Anything unset, empty, non-numeric, zero or negative falls back to 24 rather
than erroring: this code runs mid-sales-call, and a bad binding must not be
what stops a demo being created in front of a prospect.

**`SUPABASE_SERVICE_ROLE_KEY` is a runtime secret, not a build variable.**
`/api/rating-alert` uses it to look the rating up server-side and derive the
restaurant — that lookup is what stops the endpoint being an open mail relay.
Without it every low-rating alert returns 500 and nobody is paged, and nothing
tells you: `RatingCapture` fires the request best-effort and never reads the
response. Check the Worker log for `rating-alert: cannot page the operator` if
alerts go quiet.

Never prefix a secret with `VITE_`. Vite inlines every `VITE_*` variable into
the client bundle at build time, so a `VITE_SUPABASE_SERVICE_ROLE_KEY` would
ship a key that bypasses row-level security to every visitor.
`scripts/check-env.mjs` fails the build if the anon and service-role keys are
confused.

\* One email provider is required, not both. Postmark wins when its token is
present — that account owns `billtap.app`, so mail comes from
`alerts@billtap.app`. Resend is the fallback and can only send from
`grandeza.io`, so with Resend alone set `LEAD_NOTIFY_FROM` accordingly.

SMS is dormant until all three Twilio values are set; operators then get a text
*and* an email on every low rating. An operator who leaves the phone field blank
gets email only. Billing endpoints return 503 until the Stripe pair is set.

`/api/monthly-report` is triggered by a POST carrying `X-Report-Secret`, not by
one of the Worker's own crons. Those three — `0 9`, `30 9` and `0 10` in
`wrangler.jsonc` — are the nightly backup, the retention pass and the billing
reconcile, and `worker/index.test.mjs` checks each cron string against the
constant that dispatches it, because a typo means one job silently never runs
while another runs twice.

### All mail leaves from Cloudflare

Alerts, lead notifications and reports go out from the Worker as
`alerts@billtap.app`. There is one mail path and one sender.

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
paid and then writes `plan: "active"` itself, with the service role. Both halves
happen server-side, so the only route to an active plan is a real payment.

Set `STRIPE_PRICE_ID` to a **recurring** $149/month price, not a one-off.

### Keeping state honest after signup

`verify-checkout` only ever runs once. `worker/routes/stripe-webhook.js` handles
everything after: renewals, failed cards and cancellations.

Point Stripe at `https://billtap.app/api/stripe-webhook` and subscribe to
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_failed` and `invoice.payment_succeeded`. Set
`STRIPE_WEBHOOK_SECRET` (the `whsec_…` value) with `wrangler secret put`; the
handler refuses every delivery without it rather than trusting an unsigned one.

Signatures are verified against the **raw** body before parsing — parsing
first would re-serialise the bytes and break the HMAC. Replays outside a
5-minute window are rejected, and multiple `v1` signatures are accepted so a
signing-secret rotation doesn't drop events. Data errors return 500 so Stripe
retries rather than silently dropping a cancellation.

Plan states: `trial` → `active` → `past_due` (payment failed, service continues)
→ `cancelled`. The dashboard renders all four.

The client-side plan write that used to sit alongside this is gone. It let an
owner set their own row to `active` through the SDK without paying, and the
webhook only corrected it on the next Stripe event — which, for a subscription
that was never created, never came.

## Not built: POS integration

The flyer claims "works with your POS — no new hardware, no disruption", which is
accurate: BillTap sits beside the POS and needs nothing from it. There is **no**
Toast/Square/Clover data integration. Adding one is not just code — each vendor
requires a partner account, OAuth credentials and app review, so automatic check
import would need those in hand first.

## Imagery

Generated with Higgsfield (Nano Banana 2) to one brief — warm tungsten
hospitality photography, deep blacks, amber highlights keyed to the page's gold.
Every frame is deliberately text-free, because rendered lettering is the tell
that gives generated imagery away; all the type lives in the DOM.

**These are already self-hosted.** `SELF_HOSTED = true` in
`src/lib/restaurant-assets.js`, and the re-encoded WebP ladder is committed
under `public/img/restaurants/`. Nothing on the page fetches Higgsfield's CDN
at runtime, so a dead CDN URL costs nothing.

This section used to say the opposite and tell you to self-host before taking
real traffic. That was true when it was written and has not been since — the
work was done in `scripts/fetch-art.mjs` and the flag flipped. It is corrected
here because a doc that describes shipped work as outstanding sends the next
person to fix something that is not broken.

To regenerate the ladder after changing `ART_MANIFEST`:

```bash
node scripts/fetch-art.mjs   # downloads each original once, re-encodes to WebP
```

`scripts/verify-dist.mjs` scans the built output for every `/img/` and `/video/`
URL it references and fails the build if one is missing, so a dropped file is a
red build rather than a page of bare gradients.

### The product frames are not images

The `#product` section on `/restaurants` — the three phone mockups showing the
table tent, the rating screen and the operator's alert — is rendered markup, not
screenshots. It costs no image requests, stays sharp at any density, and a copy
change in `RatingCapture.jsx` that made it wrong shows up as a diff rather than
as a stale PNG nobody re-exports. The restaurant name in those frames comes from
one constant, `SAMPLE_RESTAURANT`, and must stay a non-real business — see the
comment above `#proof` for why naming a real one is the mistake that section was
torn out for.

## Do not put Cloudflare code in a top-level functions/

Base44's repo sync used to claim that path, and it moved every file from
`functions/` into `base44/functions/<name>/entry.ts` on its own — renaming `.js`
to `.ts` and nesting each in a folder — which broke every import in
`worker/index.js`. `base44/` no longer exists in this repository, so if the sync
is still connected anywhere it has nothing here to move; the layout it forced is
worth keeping either way.

Cloudflare code lives under `worker/`: `worker/index.js` for routing,
`worker/routes/` for handlers, `worker/lib/` for shared helpers.
