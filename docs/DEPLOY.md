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

## 2. Self-host the /restaurants art  — one time

The fifteen images are Higgsfield renders currently served from their CDN as
2400–3168px PNGs, so a 190px thumbnail downloads a file sized for the hero.

```bash
node scripts/fetch-restaurant-art.mjs
```

This downloads each original once (cached in `.cache/`, which is gitignored) and
re-encodes it to WebP at every width that slot actually renders at — about 46
files into `public/img/restaurants/`. It prints the before/after byte count.

Then flip the switch in `src/lib/restaurant-assets.js`:

```js
const SELF_HOSTED = true;
```

The page starts emitting `srcset`/`sizes` and browsers fetch the smallest file
that covers each slot. Commit the generated images — they are part of the site,
not build output:

```bash
git add public/img/restaurants src/lib/restaurant-assets.js
git commit -m "Self-host the /restaurants art"
```

If the download fails, the page keeps working — it falls back to the CDN URLs.
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
npx wrangler deploy
```

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

## Known open items

- **Logo colour.** The mark in `public/icons/icon.svg` uses violet `#7c3aed`;
  `/restaurants` is built on gold `#f0b429`. They clash on the OG cards. Pick one
  and `node scripts/build-brand-images.mjs` will regenerate the icons and cards.
- **Dependabot.** 13 vulnerabilities on `main` (8 high) as of the last push.
- **`run_worker_first: true`** routes every request through the Worker, including
  static assets. Correct, but it turns asset hits into billable Worker requests.
  `wrangler` 4.115 supports exclusion patterns if that becomes a cost issue —
  test carefully, since narrowing it wrongly makes the edge routing unreachable
  again (`npm test` catches the obvious version).
