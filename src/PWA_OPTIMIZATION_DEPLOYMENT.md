# PWA caching — superseded

This file, and three siblings that told the same story
(`PWA_REFACTOR_SUMMARY.md`, `IMPLEMENTATION_CHANGES.md`,
`PWA_REFACTOR_COMPLETE.md` — removed by the same commit that rewrote this one,
recoverable from git history if ever needed), described a Workbox-based
core-shell caching pipeline as "✅ Complete" and "READY FOR DEPLOYMENT":
`vite.config.augment.js` running a Workbox plugin, precaching `app.js` /
`vendor.js` / `styles.css`, runtime strategies per asset type, and specific
metrics (73% memory reduction, 1.8s load time).

**None of it shipped.** `docs/DEPLOY.md`'s "Dependency vulnerabilities"
section already records why, in the course of explaining an unrelated
`npm audit` cleanup: `workbox-build` and `workbox-window` were removed
"along with the dead `src/vite.config.js` and `src/vite.config.augment.js`
that referenced them. Vite only reads the *root* config, so that plugin
never ran." The bundle names this file describes (`app.js`, `vendor.js`,
`styles.css`) do not exist either — the real build emits Vite's
content-hashed names (`index-D_aMljtz.js` and similar), which is precisely
what the real service worker's caching strategy depends on.

**What actually runs today** is `public/service-worker.js` — hand-written,
no Workbox, no build-time plugin. Read its own header comment for the real
strategy and the reasoning behind it: cache-first forever for
content-addressed `/assets/*` files, stale-while-revalidate for everything
else, split specifically to avoid a real incident this repo already had
(a broken `/fonts.js` staying cached indefinitely under a cache-first rule
that didn't distinguish hashed from unhashed filenames).

If PWA caching needs work again, start from `public/service-worker.js` as
it exists today, not from this document.
