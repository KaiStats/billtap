/**
 * Worker entry point.
 *
 * wrangler.jsonc routes /api/* here first; everything else is served straight
 * from ./dist, with unmatched paths falling back to index.html so the SPA boots
 * on deep links.
 *
 * The route handlers live in worker/routes/*.js as plain modules taking
 * ({request, env}). They keep the Pages Functions signature they were written
 * against; this dispatches to them directly.
 *
 * They must NOT live in a top-level functions/ directory. Base44's repo sync
 * claims that path: it moved all of them into base44/functions/<name>/entry.ts
 * on its own, which broke every import here and registered Cloudflare handlers
 * as Base44 Deno functions. Keep Cloudflare code under worker/.
 */
import { onRequestPost as restaurantLead } from './routes/restaurant-lead.js';
import { onRequestPost as ratingAlert } from './routes/rating-alert.js';
import { onRequestPost as createCheckout } from './routes/create-checkout.js';
import { onRequestPost as verifyCheckout } from './routes/verify-checkout.js';
import { onRequestPost as invokeFunction } from './routes/functions.js';
import { onRequestPost as monthlyReport } from './routes/monthly-report.js';
import { onRequestPost as scanReceipt } from './routes/scan-receipt.js';
import { scheduled as nightlyBackup } from './routes/nightly-backup.js';
import { scheduled as applyRetention } from './routes/retention.js';
import { rateLimit } from './lib/rate-limit.js';
import { assertEnvironmentIsolated } from './lib/environment.js';
import { errorResponse, requestId } from './lib/errors.js';

/** Where the app's own functions answer. */
const FN_PREFIX = '/api/fn/';

/** POST-only endpoints owned by this app. */
const POST_ROUTES = {
  '/api/restaurant-lead': restaurantLead,
  '/api/rating-alert': ratingAlert,
  '/api/create-checkout': createCheckout,
  '/api/verify-checkout': verifyCheckout,
  '/api/monthly-report': monthlyReport,
  // The receipt parse, straight to the model. See routes/scan-receipt.js for
  // why it no longer goes through Base44.
  '/api/scan-receipt': scanReceipt,
};

const json = (data, status) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * Every path the SPA actually renders. Keep in sync with the <Route> table in
 * src/App.jsx.
 *
 * Anything outside this list is a genuine miss. The assets binding still hands
 * back index.html — that is what not_found_handling: "single-page-application"
 * is for, and the QR deep links depend on it — but it does so with a 200, which
 * Search Console reports as a Soft 404 and which tells crawlers every typo is a
 * real page. Serving the same shell with a 404 status keeps the SPA booting
 * while being honest about what was found.
 */
const SPA_ROUTES = new Set([
  '/',
  '/about',
  '/blog',
  '/changelog',
  '/claim',
  '/restaurants',
  '/privacy',
  '/terms',
  '/security',
  '/icon-generator',
  '/login',
  '/register',
  // Both redirect to /login now — there is no password to reset. They stay
  // listed because they are in Base44's old emails and in people's history, and
  // an unlisted path is served with a 404 status: the app would still boot and
  // still redirect, but the response would report itself as not found to
  // anybody watching, including crawlers.
  '/forgot-password',
  '/reset-password',
  '/home',
  '/new-receipt',
  '/dashboard',
  '/session-host',
  '/receipt-detail',
  '/profile',
  '/restaurant-dashboard',
]);

/** Per-table guest links from the QR tents: /r/<slug>. */
const DYNAMIC_ROUTES = [/^\/r\/[^/]+$/];

/** Real HTML files that are not SPA routes and must pass through untouched. */
const STATIC_HTML = new Set(['/offline.html']);

/**
 * Routes with a prerendered snapshot, written by scripts/prerender.mjs during
 * `npm run build:static`.
 *
 * Serving these means a crawler's first fetch contains the actual copy, headings
 * and metadata instead of an empty <div id="root">. Absent — after a plain
 * `npm run build` — every route falls through to the SPA shell and the site
 * works exactly as before, just without the head start.
 */
export const PRERENDERED = {
  '/': '/index-prerendered.html',
  '/restaurants': '/restaurants.html',
  '/about': '/about.html',
  '/blog': '/blog.html',
  '/changelog': '/changelog.html',
  '/privacy': '/privacy.html',
  '/terms': '/terms.html',
  '/security': '/security.html',
};

/**
 * The snapshots are reachable at their own .html paths, which would be
 * duplicate content — two URLs, identical page. The canonical tag inside each
 * one already points at the clean route; this makes it a redirect as well so
 * crawlers never have to reconcile the two.
 */
const PRERENDERED_ALIASES = Object.fromEntries(
  Object.entries(PRERENDERED).map(([route, file]) => [file, route]),
);

/**
 * Legacy capitalised paths. App.jsx redirects these client-side too, but a 301
 * at the edge consolidates link equity and saves a render.
 */
/**
 * Headers that only work when sent as real headers.
 *
 * index.html carries a <meta http-equiv="Content-Security-Policy">, but browsers
 * ignore frame-ancestors delivered that way — it logs a console warning and the
 * site stays framable. Clickjacking protection has to come from a header, so it
 * is set here for HTML responses.
 *
 * Deliberately not touching the resource directives (script-src, img-src, ...).
 * Those already work from the meta tag, and a header CSP would intersect with
 * it, where one mistake silently blocks the Base44 data layer or the pixels.
 */
const HTML_SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  /**
   * Permissions-Policy has exactly the frame-ancestors problem described above,
   * and index.html has been carrying it as a <meta http-equiv> the whole time.
   *
   * No browser reads Permissions-Policy from a meta tag — it is defined as a
   * response header and only ever parsed as one. So the camera, microphone and
   * geolocation locks the app believed it had were not applied on any request
   * ever served. Unlike the CSP next to it, nothing warned: the tag is simply
   * ignored, and a scanner reading the HTML reports it as present.
   *
   * The value is a superset of the meta's. This app calls neither getUserMedia
   * nor the geolocation API anywhere in src/ — verified, not assumed — so
   * denying them costs nothing and means a future dependency cannot quietly
   * start asking a diner for their camera at a restaurant table.
   */
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
};

/** Returns a copy of `response` with the HTML security headers applied. */
function withSecurityHeaders(response, status = response.status) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(HTML_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status, statusText: response.statusText, headers });
}

const LEGACY_REDIRECTS = {
  '/About': '/about',
  '/Blog': '/blog',
  '/Changelog': '/changelog',
  '/Claim': '/claim',
  '/Restaurants': '/restaurants',
  '/Home': '/home',
  '/NewReceipt': '/new-receipt',
  '/Dashboard': '/dashboard',
  '/SessionHost': '/session-host',
  '/ReceiptDetail': '/receipt-detail',
  '/Profile': '/profile',
};

export default {
  /**
   * Cron entry point. wrangler.jsonc's triggers.crons decides when.
   *
   * The backup lives here rather than in base44/functions because Base44 blocks
   * backend functions on this app's plan — a nightly job there would never run,
   * which is part of why the previous one had not.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightlyBackup(env));

    /**
     * The retention schedule in src/pages/Privacy.jsx, applied.
     *
     * Separately waitUntil'd rather than chained onto the backup, because the
     * two have opposite failure postures and must not share one. The backup
     * throws when it cannot do its job — a backup that reports success and
     * stores nothing is the thing it is designed against — and chaining would
     * mean a missing R2 binding silently stops guest names being removed.
     *
     * Order still matters within the night: the backup runs first, so a
     * restore taken from it holds the data as it was before redaction rather
     * than after. Both start here; nothing depends on which finishes.
     */
    ctx.waitUntil(
      applyRetention(env)
        .then((summary) => {
          console.log(JSON.stringify({ at: new Date().toISOString(), job: 'retention', ...summary }));
        })
        .catch((error) => {
          // Logged, never rethrown. An exception out of a scheduled handler
          // fails the whole invocation, and taking the backup down with it is
          // the one outcome worse than a night of unredacted names.
          console.error(JSON.stringify({
            at: new Date().toISOString(),
            job: 'retention',
            level: 'error',
            message: error?.message || String(error),
          }));
        }),
    );
  },

  /**
   * `ctx` is here for waitUntil, which the audit trail needs.
   *
   * worker/lib/audit.js must never make the caller wait on a bookkeeping write
   * and must never fail an action by failing to record it — see the header
   * there. Without a ctx to hand it, every audited action would either block on
   * the insert or drop it.
   */
  async fetch(request, env, ctx) {
    // Before anything else: is this deployment allowed to touch the database it
    // has been handed? A non-production environment carrying production's app
    // id stops here rather than serving, because the alternative is a developer
    // writing rows into a live restaurant's bills and finding out later.
    //
    // Checked per request rather than at module load: a Worker that throws
    // while loading returns a 1101 with no message and nothing useful in the
    // logs, and the whole value of this check is the sentence it prints.
    try {
      assertEnvironmentIsolated(env);
    } catch (error) {
      console.error(`environment misconfigured: ${error?.message}`);
      return json({ error: 'Service misconfigured', detail: error?.message }, 500);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Rate limiting runs first, before anything can short-circuit past it.
    //
    // It used to sit below the proxy branch, which returns for every
    // /api/apps/** path — so Base44's own auth endpoints, forwarded through
    // that proxy, were never checked. reset-password-request sends an email to
    // whatever address it is given and /auth/login is a password oracle; both
    // were unmetered. Returns null and lets the request through when the
    // binding is absent or the check itself throws, so this can only ever cost
    // an attacker, never a diner. See worker/lib/rate-limit.js.
    if (path.startsWith('/api/')) {
      const limited = await rateLimit(request, env, path);
      if (limited) return limited;
    }

    // There was a proxy here forwarding /api/apps/** to Base44, because the SDK
    // was built with serverUrl: '' and issued every entity, auth and function
    // call same-origin under that prefix. Nothing in the browser speaks to
    // Base44 any more, so the prefix is gone and those paths 404 as JSON like
    // any other unmatched /api/ path.

    // The app's functions. These were Base44 backend functions until Base44
    // blocked them on this app's plan, at which point every one of them
    // answered "Functions are blocked" and no core operation worked.
    // src/api/functions.js is what calls them.
    if (path.startsWith(FN_PREFIX)) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const name = path.slice(FN_PREFIX.length);
      // No slashes: the name indexes a handler table, not a filesystem.
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) return json({ error: 'Not found' }, 404);
      return invokeFunction({ request, env, ctx, name });
    }

    const handler = POST_ROUTES[path];
    if (handler) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      // These handlers predate the error layer and each has its own catch. The
      // wrapper is here for what they do not catch — a throw during parsing, an
      // exhausted subrequest budget — which previously surfaced as Cloudflare's
      // own 1101 page: no message, no id, nothing to search for.
      const id = requestId();
      try {
        const response = await handler({ request, env, ctx, requestId: id });
        const headers = new Headers(response.headers);
        headers.set('X-Request-Id', id);
        return new Response(response.body, { status: response.status, headers });
      } catch (error) {
        return errorResponse(error, { id, route: path });
      }
    }

    // An unmatched /api/* path must 404 as JSON. Falling through to the assets
    // binding would hand back index.html and turn a typo into a parse error.
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

    const legacy = LEGACY_REDIRECTS[path] || PRERENDERED_ALIASES[path];
    if (legacy) {
      return Response.redirect(new URL(legacy + url.search, url.origin).toString(), 301);
    }

    // Treat /about/ and /about as the same route.
    const route = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

    // Prefer the prerendered snapshot when one was built for this route.
    const snapshot = PRERENDERED[route];
    if (snapshot && request.method === 'GET') {
      // When the snapshot is absent the assets binding answers with the SPA
      // shell anyway (not_found_handling), which is precisely the fallback we
      // want — so this one call covers both cases.
      const hit = await env.ASSETS.fetch(new Request(new URL(snapshot, url.origin), request));
      if (hit.status === 200) return withSecurityHeaders(hit);
    }
    const known =
      SPA_ROUTES.has(route) ||
      STATIC_HTML.has(route) ||
      DYNAMIC_ROUTES.some((re) => re.test(route));

    const response = await env.ASSETS.fetch(request);

    // Only rewrite the status when the assets binding fell back to the SPA
    // shell for a path we do not serve. Real files — hashed bundles, icons,
    // robots.txt, sitemap.xml — come back with their own content type and are
    // passed through untouched.
    const isHtml = (response.headers.get('content-type') || '').includes('text/html');
    if (!isHtml) return response;

    // Unknown route: the assets binding fell back to the SPA shell with a 200.
    // Same body, honest status.
    if (!known && response.status === 200) return withSecurityHeaders(response, 404);

    return withSecurityHeaders(response);
  },
};
