# Deploying billtap.app

Two things about this deploy are easy to get wrong, so they are worth stating up
front:

- **Deploy with `npm run build:static`, not `npm run build`.** The plain build
  works, it just skips prerendering, which is the whole reason the marketing
  pages are indexable.
- **The `/restaurants` art has to be self-hosted once**, by hand, before you
  drive paid traffic at that page. Until then it loads full-size PNGs from a
  Higgsfield CDN URL tied to a personal account.

---

## 1. Get the branch

```bash
git checkout main
git pull
npm install
```

`npm install` now also pulls `playwright`, used by the prerender step. It
downloads a browser on first install. If that was skipped in your environment:

```bash
npx playwright install chromium
```

## 2. Self-host the marketing art  — one time per page

Both `/` and `/restaurants` are illustrated with Higgsfield (Nano Banana 2)
renders. Straight out of the box they are served from Higgsfield's CDN as
2400–3168px PNGs, so a 190px thumbnail downloads a file sized for the hero, and
the URLs are tied to a personal Higgsfield account.

```bash
node scripts/fetch-art.mjs
```

This downloads each original once (cached in `.cache/`, gitignored) and
re-encodes it to WebP at every width that slot actually renders at — roughly 46
files into `public/img/restaurants/` and 28 into `public/img/landing/`. It
prints the before/after byte count.

Then flip the switch in **both** assets modules:

```bash
sed -i '' 's/^const SELF_HOSTED = false;/const SELF_HOSTED = true;/' src/lib/landing-assets.js
sed -i '' 's/^const SELF_HOSTED = false;/const SELF_HOSTED = true;/' src/lib/restaurant-assets.js
grep -n "^const SELF_HOSTED" src/lib/landing-assets.js src/lib/restaurant-assets.js
```

Both must read `true`. The pages then emit `srcset`/`sizes` and browsers fetch
the smallest file that covers each slot. On the first run for `/restaurants`
that took the originals from **126 MB to about 537 KB** on a desktop load.

Commit the generated images — they are part of the site, not build output:

```bash
git add public/img src/lib/landing-assets.js src/lib/restaurant-assets.js
git commit -m "Self-host the marketing art at responsive widths"
```

If a download fails, the page keeps working — it falls back to the CDN URLs.
Nothing breaks; you just do not get the saving.

## 3. Check it locally

```bash
npm test        # 20 tests: worker routing, security headers, route drift
npm run lint
npm run build:static
npm run preview
```

`build:static` should report `7/7 routes prerendered`. If it reports fewer, the
prerender could not mount React for those routes — fix that before deploying,
because those pages will fall back to the empty-shell HTML crawlers cannot read.

## 4. Deploy

```bash
npm run deploy
```

That is `build:static` followed by `wrangler deploy`.

You cannot ship a half-built `dist/` any more, whichever way you invoke it. If
prerendering fails, `scripts/prerender.mjs` deletes every snapshot and writes
`dist/PRERENDER-FAILED`; `wrangler.jsonc` runs `scripts/verify-dist.mjs` as its
`build.command`, so even `npx wrangler deploy` typed straight into a terminal
aborts:

```
────────────────────────────────────────────────────────────────
  DEPLOY BLOCKED — dist/ is not in a shippable state
────────────────────────────────────────────────────────────────
  • prerendering failed and left dist/ incomplete:
    Playwright has no browser installed

  Fix:  npx playwright install chromium && npm run build:static
```

This guard exists because the opposite happened once. `build:static` is
`vite build && node scripts/prerender.mjs`; the prerender step died on a missing
browser, but vite had already written a valid `dist/` without snapshots, and a
follow-up `wrangler deploy` shipped it. The Worker's fallback to the SPA shell is
deliberately graceful, so the only symptom in production was the wrong `<title>`.

The verifier also rejects a snapshot whose `<div id="root">` is empty — that
means React never rendered, so the file would be as useless to a crawler as no
snapshot at all.

Then confirm the things that only exist in production:

```bash
curl -s https://billtap.app/robots.txt | head -3
curl -s https://billtap.app/sitemap.xml | head -5
curl -s https://billtap.app/restaurants | grep -o '<title>[^<]*</title>'
curl -s -o /dev/null -w '%{http_code}\n' https://billtap.app/definitely-not-a-page   # expect 404
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://billtap.app/Restaurants  # expect 301
```

The `<title>` check is the important one. If it returns
`More Google Reviews for Your Restaurant | BillTap`, prerendering is live and
crawlers are getting real HTML. If it returns
`BillTap — Split Bills in 30 Seconds`, you deployed a plain `npm run build`.

## 5. Google Search Console

Only after the deploy is live, or you will submit against 404s.

1. Add the property at <https://search.google.com/search-console>.
   A **Domain** property (DNS TXT record at your registrar) is better than a URL
   prefix — it covers `www`/non-`www` and `http`/`https` in one place.
2. **Verify.** `index.html` already loads GA4 (`G-XEEM8Q99JG`), so if your Google
   account is an admin on that Analytics property, verification is instant with
   no code change. Otherwise use the DNS TXT record, or paste the
   `google-site-verification` token into `index.html` as a meta tag.
3. **Sitemaps → submit `sitemap.xml`.**
4. **URL Inspection** on `https://billtap.app/restaurants` → *Request Indexing*,
   to jump the queue for the page you are running ads to.

Expect Search Console to stay quiet for a few days. That is normal.

---

## Brand colours

Gold `#f0b429` on ink `#0b0b0d`. There is no violet in the brand.

Every raster icon and OG card is generated from `public/icons/icon.svg`, so
change that file and re-run:

```bash
node scripts/build-brand-images.mjs
```

Do not hand-edit anything in `public/icons/*.png` or `public/img/og-*.png` — the
next run of that script overwrites them.

One inconsistency is still open and is a design decision, not a bug: the
signed-in app (Dashboard, Home, SessionHost, the error screens) is built on green
`#00c896` with a `#0a0e1a` background, which is a different palette from the gold
marketing pages. Unifying it means restyling the app surface, so it was left
alone.

## Dependency vulnerabilities

Down from 13 to 8. Every remaining one is either dev-only or does not apply to
this app; nothing exploitable in the shipped bundle is outstanding.

Fixed:

- **`react-quill`** — removed. Nothing imported it.
- **`workbox-build` / `workbox-window`** — removed, along with the dead
  `src/vite.config.js` and `src/vite.config.augment.js` that referenced them.
  Vite only reads the *root* config, so that plugin never ran; the packages were
  carrying five high advisories for a PWA setup that was never wired up. The
  service worker at `public/service-worker.js` is hand-written and unaffected.
- **`react-router` / `react-router-dom` 6.30.4 → 7.18.2** — fixes an open
  redirect leading to XSS in `<Link>` and `useNavigate`, which this app does use.
  v6 has no patched release; 6.30.4 is the last v6 and is vulnerable. The upgrade
  was near drop-in: all nine APIs in use kept their signatures.

Remaining, and why:

- **6 × eslint toolchain** (`eslint`, `@eslint/*`, `eslint-plugin-react`,
  `minimatch`, `brace-expansion`). Dev-only — none of it ships. eslint 10 fixes
  three of them, but `eslint-plugin-react@7.37.5`, the latest, declares
  `eslint: ^3 || … || ^9.7` and genuinely crashes on eslint 10
  (`contextOrFilename.getFilename is not a function`). Revisit when the plugin
  supports eslint 10.
- **2 × react-router** — an RSC-mode CSRF advisory affecting `>=7.12.0 <8.3.0`.
  It requires React Server Components and server actions. This app is a
  client-side SPA with neither, so it does not apply. **Do not "fix" this by
  downgrading to 7.11.0 as `npm audit` suggests** — that reintroduces the open
  redirect and XSS, which do apply.

Re-check with `npm audit`. GitHub's Dependabot count may differ slightly; it
scans the lockfile, `npm audit` scans the installed tree.
