# /restaurants — landing + lead capture

Pre-sell page for the B2B offer. It exists to collect founding-partner leads and
gauge demand; none of the restaurant features (low-rating alerts, review routing,
POS integration) are built yet.

## What ships

| File | Role |
| --- | --- |
| `src/pages/Restaurants.jsx` | The page |
| `src/lib/restaurant-assets.js` | Hero/detail image URLs (swappable) |
| `base44/entities/RestaurantLead.jsonc` | Lead schema |
| `functions/api/restaurant-lead.js` | Cloudflare Pages Function — sends the alert email |
| `public/_redirects` | Edge routing so the flyer QR resolves |
| `src/App.jsx`, `src/components/BottomNav.jsx` | Route wiring, nav suppression |

## Submit flow

1. Browser validates, then writes a `RestaurantLead` row via the Base44 SDK —
   the same path the existing Waitlist capture uses.
2. Browser POSTs to `/api/restaurant-lead`, which sends the alert email.

The write happens **first and the email second, deliberately**: the lead is the
thing that must not be lost. If the email fails, the visitor still sees success
and the row is already saved. A hidden honeypot field drops bot submissions.

## Required configuration

Set on the Cloudflare project (Settings → Environment variables):

| Variable | Required | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | — |
| `LEAD_NOTIFY_TO` | no | `alerts@billtap.app` |
| `LEAD_NOTIFY_FROM` | no | `BillTap Leads <leads@grandeza.io>` |

**Sender caveat:** Resend currently has only `grandeza.io` verified, so alerts
send from that domain. To send from `billtap.app`, add and verify it in Resend,
then set `LEAD_NOTIFY_FROM` to an address on it. Nothing else changes.

Without `RESEND_API_KEY` the endpoint returns `{ok: true, notified: false}` and
logs the misconfiguration — leads still save, you just don't get the email.

## If BillTap is on Workers, not Pages

`functions/api/restaurant-lead.js` and `_redirects` are Cloudflare **Pages**
conventions. On Workers-with-static-assets they are inert: the endpoint 404s
(leads still save, no email arrives) and the deep link relies on
`not_found_handling: "single-page-application"` in `wrangler.jsonc`. Porting is
small — the handler body is standard `fetch`, so it drops into a Worker route
with `onRequestPost({request, env})` swapped for `fetch(request, env)`.

## Imagery

Hero and detail images were generated with Higgsfield (Nano Banana 2) and point
at Higgsfield's CDN. Every section has a CSS gradient fallback beneath, so a dead
URL degrades rather than breaks. To self-host, see the comment at the top of
`src/lib/restaurant-assets.js`.
