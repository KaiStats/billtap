# Handoff: make the receipt scan fast

Written for whoever picks this up next. It assumes you have not seen this
codebase before.

---

## 1. The diagnosis, including what the last pass got wrong

The scan is two sequential network round trips, and **Base44 is a middleman on
both of them**:

```
phone → Cloudflare Worker → base44.app → their storage        (upload; wait for a URL)
phone → Cloudflare Worker → base44.app → their LLM gateway → Gemini   (model; wait)
```

The image is transferred twice — once from the phone to Base44's storage, then
again when Base44's gateway fetches it back out to hand to the model. Each
round trip carries the Cloudflare hop *and* the Base44 hop, and the second
cannot start until the first returns a URL.

The previous pass (commit `06b1e18`) optimised the client end: it starts the
upload when the photo is picked rather than when the button is tapped, moved a
third round trip's worth of arithmetic into the browser, and cut the bytes with
WebP. Those are real and they should stay — they hide the upload behind the
user's own reaction time. **But they shave the edges of a path that should not
exist in that shape.** The structural cost is the two chained hops through a
third party, and no amount of client work removes it.

**There is no AI provider key in this codebase.** Grep confirms it: no
`GEMINI_API_KEY`, no `OPENAI_API_KEY`, nothing. Every model call is Base44's,
billed and rate-limited by Base44, queued behind Base44's infrastructure, at
whatever latency their gateway adds. That is the thing to change.

---

## 2. Measure before you touch anything

Do not skip this. Every fix attempted so far, including the last one, was
reasoned from architecture rather than from numbers.

Instrumentation already exists — `src/lib/scanTiming.js`, wired into
`src/pages/NewReceipt.jsx`. It emits three phase timings (`compress`, `upload`,
`model`) plus the compression result:

- **Console**, in dev: `npm run dev`, scan a receipt, read the `console.table`.
- **Sentry**: a breadcrumb on every scan, attached to any later error.
- **gtag**: event `receipt_scan_timing` with `total_ms`, `upload`, `model`.

Get the real distribution from production before deciding anything. Specifically
you need to know **the ratio of `upload` to `model`**, because it decides which
of the two fixes below matters more. Do it on a phone on a restaurant's wifi,
not on a laptop on fibre — the whole problem is that they differ.

Expected shape, to be confirmed rather than assumed: `compress` 200–800 ms,
`upload` 1–4 s, `model` 2–6 s.

---

## 3. The change

### 3a. Collapse the two round trips into one, and cut Base44 out of it

Send the image bytes straight to the model from the Worker, inline. No
intermediate storage, no URL, no second hop.

```
phone → Cloudflare Worker → Gemini        (one round trip)
```

**New file: `worker/routes/scan-receipt.js`**, routed at `POST /api/scan-receipt`
from `worker/index.js` alongside the other `POST_ROUTES`.

- Accept the compressed image as raw bytes or `multipart/form-data`. Do **not**
  base64 it in the browser — that is a third larger on the wire and costs main
  thread time on a phone. Let the Worker do the base64 for Gemini's `inlineData`.
- Call `generateContent` with `inlineData` (`mimeType` + base64 `data`), and use
  the provider's structured-output mode with the same JSON schema currently
  passed to `InvokeLLM` in `NewReceipt.jsx`.
- **Check the current model list before choosing one.** Base44 calls its model
  `gemini_3_flash`; the direct API uses its own names and they change. Pick the
  fastest vision-capable flash-tier model available when you do this, and put
  the choice behind an env var so it can be changed without a deploy.
- Cap `maxOutputTokens`. A receipt parse is a few hundred tokens; leaving it
  unbounded lets a bad response run long.
- The key goes in `wrangler secret put GEMINI_API_KEY --env production`, and
  separately for staging. See §5 on environments — this matters.

**Client change in `src/pages/NewReceipt.jsx`:** replace the
`UploadFile` → `InvokeLLM` pair with one `fetch('/api/scan-receipt')` carrying
the output of `compressImage()`. Keep `startScanTimer()`; rename the `upload`
mark to `scan` so the timings stay comparable.

Expected saving: one full round trip plus the Base44 gateway's overhead on the
other. If `upload` and `model` are each ~2 s today, this should land nearer 2–3 s
total rather than 4–6 s.

### 3b. Get the image off the critical path entirely

The receipt image is shown on the review screen and stored on the session. None
of that has to happen before the diner sees their items.

In the Worker, after the model responds, persist the image with
`ctx.waitUntil(...)` so it does not block the response. R2 is the natural place
— note that **R2 is not yet enabled on this Cloudflare account** (see
`wrangler.jsonc`, the `r2_buckets` block is committed commented out and the
nightly backup depends on the same thing). Enabling it is one dashboard action
plus `npx wrangler r2 bucket create`.

Meanwhile the review screen can display the local `URL.createObjectURL(file)`
preview it already has. The diner never waits on a round trip for a picture of
their own receipt.

### 3c. Stream, if the numbers say the model dominates

Only worth doing if §2 shows `model` is the larger term after 3a. Gemini
supports streaming; the review screen could fill in line items as they arrive
rather than after the last token. This is a real change to `NewReceipt.jsx`'s
state handling — do not start it before the measurement justifies it.

---

## 4. What must not break

Run `npm test` (259 tests, no browser needed) and `npm run test:ui` (96 tests,
needs Chromium and a built `dist/`). Both are green at `06b1e18`. The suites are
mutation-tested — deliberately broken to prove they catch it — so a failure is
worth reading rather than working around.

The ones that will bite you on this specific change:

| Test | What it protects |
| --- | --- |
| `the upload starts when the photo is chosen, not when the button is tapped` | The client-side win from `06b1e18`. Preserve it — start the scan request on file select, not on tap. |
| `retaking the photo uploads the new one, and the scan uses it` | Matching a retaken photo with the first upload attaches the wrong table's receipt. |
| `a slow upload is absorbed by the time spent looking at the preview` | The measured behaviour, not a proxy for it. |
| `the arithmetic check costs no network call at all` | Do not reintroduce the `validateReceiptParse` round trip. It runs in the browser now, from `shared/receipt-math.js`. |
| `a low-confidence scan opens the editor by itself and says why` | Confidence is computed from the parse. Whatever shape the new endpoint returns must still feed `parseConfidence()`. |

Also: `scripts/verify-dist.mjs` gates every deploy via wrangler's
`build.command`, and prerendering needs Chromium. `npm run build:static`, not
`npm run build`.

---

## 5. Landmines specific to this codebase

Read these before your first commit. Each one has already cost a day.

1. **Base44 blocks backend functions on this plan.** Every
   `base44.functions.invoke()` returns "Functions are blocked". That is why all
   nine functions live in `worker/routes/functions.js` and why
   `src/api/base44Client.js` overrides `invoke()` to hit `/api/fn/<name>`. Do
   not move logic back into `base44/functions/*/entry.ts` — those files are
   reference copies that do not execute.

2. **Base44 syncs this repo from `main` on its own schedule.** Work on a branch
   does not reach the deployed Base44 app. That is why RLS rule changes appeared
   to do nothing until they were merged.

3. **Do not create a top-level `functions/` directory.** Base44's sync claims
   that path and will move your files into `base44/functions/`, breaking every
   import. Cloudflare code lives under `worker/`.

4. **Environments are enforced, not conventional.** `worker/lib/environment.js`
   refuses to serve if a non-production deployment carries the production app
   id, or a live Stripe key. `scripts/check-env.mjs` fails the build without
   `VITE_ENVIRONMENT`. Set your own `GEMINI_API_KEY` per environment; do not
   share one across dev and prod.

5. **The app id must not carry an `app_` prefix.** `app_69a5…` returns "App not
   found" from Base44 while the bare id works. `worker/lib/base44.js` strips it;
   do not re-add it.

6. **Base44's realtime socket never delivers to a guest.** It connects
   anonymously and the read rules do not match a guest, so `Session.subscribe()`
   is dead for the people this product is for. Live updates go through
   `src/hooks/useLiveSplit.js`, which polls. Do not "fix" it back to a
   subscription.

7. **CSP is `default-src 'self'`** in `index.html`. If the browser ever needs to
   talk to a new origin, it must be added there — but for this change it should
   not, because the Worker is the one calling the model.

8. **Per-IP rate limiting punishes the intended use case.** A whole table is one
   NAT. `worker/lib/rate-limit.js` keys table endpoints per participant for this
   reason. If you add `/api/scan-receipt` to the limiter, key it the same way,
   and remember six people at one table share an address.

---

## 6. Acceptance criteria

- [ ] Production `receipt_scan_timing` events show **median `total_ms` under
      5,000** on a phone, on restaurant-grade wifi, with a real receipt.
- [ ] The scan makes **one** network request between the tap and the items
      appearing, not two.
- [ ] Parse accuracy does not regress. Scan ten real receipts before and after
      and compare item counts and totals by hand. **A wrong number on a bill is
      worse than a slow one** — if accuracy drops, raise the image quality back
      before shipping.
- [ ] `npm test` and `npm run test:ui` both green.
- [ ] `GEMINI_API_KEY` set separately for production and staging.
- [ ] The five tests in §4 still pass unmodified. If one has to change, say why
      in the commit message.

---

## 7. Things deliberately not done, so nobody re-litigates them

- **`MAX_EDGE` stays at 2000px** in `src/lib/compressImage.js`. Lower is smaller
  and starts losing the small print near the totals, which is the part that must
  be right.
- **No client-side OCR.** Tesseract in a worker sounds appealing and is markedly
  worse on a photographed receipt at an angle under restaurant lighting.
- **The image still gets stored.** Hosts refer back to it. It just should not be
  on the critical path.
