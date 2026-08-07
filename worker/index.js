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
import { onRequestPost as waitlist } from './routes/waitlist.js';
import { onRequestPost as ratingAlert } from './routes/rating-alert.js';
import { onRequestPost as createCheckout } from './routes/create-checkout.js';
import { onRequestPost as verifyCheckout } from './routes/verify-checkout.js';
import { onRequestPost as invokeFunction } from './routes/functions.js';
import { onRequestPost as monthlyReport } from './routes/monthly-report.js';
import { onRequestPost as scanReceipt } from './routes/scan-receipt.js';
import { onRequestGet as health } from './routes/health.js';
import { onRequestGet as errorLog } from './routes/error-log.js';
import { scheduled as nightlyBackup } from './routes/nightly-backup.js';
import { scheduled as applyRetention } from './routes/retention.js';
import { scheduled as reconcileBilling } from './routes/reconcile-billing.js';
import { rateLimit } from './lib/rate-limit.js';
import { assertEnvironmentIsolated } from './lib/environment.js';
import { errorResponse, requestId } from './lib/errors.js';
import { reportError } from './lib/report.js';

/** Where the app's own functions answer. */
const FN_PREFIX = '/api/fn/';

/**
 * The schedule that runs the retention pass rather than the backup.
 *
 * Must match an entry in wrangler.jsonc's triggers.crons exactly — Cloudflare
 * hands the scheduled handler the schedule string it fired for, and a typo here
 * means the retention job never runs while the backup quietly runs twice.
 * worker/index.test.mjs checks the two against each other.
 */
export const RETENTION_CRON = '30 9 * * *';
/**
 * Its own invocation, like the other two, for the same subrequest-budget
 * reason — this one makes an API call per subscribed restaurant. 10:00, after
 * the backup and the retention pass, so a plan change is never the reason a
 * night's snapshot differs from the row it was taken from.
 */
export const RECONCILE_CRON = '0 10 * * *';

/** POST-only endpoints owned by this app. */
const POST_ROUTES = {
  '/api/restaurant-lead': restaurantLead,
  // The landing page's consumer sign-up. See routes/waitlist.js: the form has
  // been reporting an error to every visitor since the Base44 SDK was removed.
  '/api/waitlist': waitlist,
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
  /**
   * HTTP Strict Transport Security.
   *
   * Without it, the first request of a session is the one that is not
   * protected: somebody types billtap.app, the browser tries http://, and
   * anything between them and Cloudflare gets to answer first. On a
   * restaurant's shared wifi — which is where this product is used, by people
   * who have never visited before and are typing the domain off a table tent —
   * that is the realistic attack, not a certificate forgery.
   *
   * Two years, subdomains included, and preload NOT requested. The omission is
   * the deliberate part: `preload` gets the domain baked into browser binaries
   * and is slow and awkward to reverse, while max-age simply expires. This is
   * reversible by removing the line and waiting, which is the property worth
   * keeping while the app is still moving.
   *
   * Safe here because the site is Cloudflare-fronted and HTTPS-only already;
   * nothing is served over plain HTTP that this would break. Set on HTML
   * responses, which is where a browser first learns the policy.
   */
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
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
    /**
     * One job per invocation, dispatched on which schedule fired.
     *
     * They both used to run from the 09:00 firing, back to back through
     * waitUntil. That is one Worker invocation, and a Worker invocation has one
     * subrequest budget — so the two jobs were spending from the same pot. Both
     * spend in bulk: the backup pages every entity, and the retention pass does
     * a write and a storage delete per session plus the orphan sweep. Whichever
     * ran second would be the one that ran out, at 09:00, with nobody watching.
     *
     * Separate schedules in wrangler.jsonc give them separate invocations and
     * separate budgets. 09:00 backup, 09:30 retention — in that order so a
     * restore taken from the night's snapshot holds the data as it was before
     * the guest names were removed.
     *
     * An unrecognised cron runs the backup. A schedule added to wrangler.jsonc
     * and not wired up here should not silently do nothing, and the backup is
     * the safe thing to do twice.
     */
    if (event?.cron === RECONCILE_CRON) {
      ctx.waitUntil(
        reconcileBilling(env)
          .then((summary) => {
            console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }));
          })
          .catch((error) => {
            console.error(JSON.stringify({
              at: new Date().toISOString(), job: 'reconcile-billing', level: 'error', message: error.message,
            }));
            reportError(env, ctx, error, { id: requestId(), route: 'cron/reconcile-billing' });
          }),
      );
      return;
    }

    if (event?.cron === RETENTION_CRON) {
      ctx.waitUntil(
        applyRetention(env)
          .then((summary) => {
            console.log(JSON.stringify({ at: new Date().toISOString(), job: 'retention', ...summary }));
          })
          .catch((error) => {
            // Logged, never rethrown. An exception out of a scheduled handler
            // marks the whole invocation failed, and the useful half of that
            // signal is already in this line.
            console.error(JSON.stringify({
              at: new Date().toISOString(),
              job: 'retention',
              level: 'error',
              message: error?.message || String(error),
            }));
            reportError(env, ctx, error, { id: requestId(), route: 'cron/retention' });
          }),
      );
      return;
    }

    /**
     * The backup, and the reason its failure has to leave this Worker.
     *
     * It throws on purpose — an unconfigured or partial backup must mark the
     * invocation failed rather than report success. But "the invocation is
     * marked failed" is a number on a Cloudflare dashboard nobody opens at
     * 09:00, and the moment it matters is Incident 3, where the first question
     * is how old the last good snapshot is. A backup that has been failing for
     * three weeks and a backup that ran last night look identical from here.
     *
     * So the same reporter the request path uses (worker/lib/report.js, added
     * for exactly this class of invisible failure) is given the exception
     * before it is rethrown. Still a no-op without a DSN, still incapable of
     * failing anything: the rethrow below happens either way.
     */
    ctx.waitUntil(
      nightlyBackup(env).catch((error) => {
        reportError(env, ctx, error, { id: requestId(), route: 'cron/nightly-backup' });
        throw error;
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
    /**
     * The outermost boundary, and it did not exist.
     *
     * Everything below this line was individually careful — the environment
     * check has a catch, the POST table has a catch, invokeFunction has a catch
     * — and nothing caught the gaps between them. `new URL(request.url)`,
     * `rateLimit`, `Response.redirect` on a malformed target, and every
     * `env.ASSETS.fetch` call sat outside all of it, so a throw from any of
     * them left the Worker entirely.
     *
     * What a caller gets then is Cloudflare's 1101 page: no message, no request
     * id, no structured log line, and — since Layer 12 — no Sentry event
     * either, because every one of those is produced by errorResponse and
     * errorResponse is what never ran. The most important failure in the
     * application was the one it could say least about.
     *
     * One try, wrapping the whole handler, is the fix. Every inner catch stays:
     * they produce better messages than this can, and this is the floor rather
     * than the plan.
     */
    const outerId = requestId();
    try {
      return await serve(request, env, ctx, outerId);
    } catch (error) {
      return errorResponse(error, {
        id: outerId,
        route: `unhandled ${new URL(request.url).pathname}`,
        env,
        ctx,
        request,
      });
    }
  },
};

/**
 * The handler proper. Split out so the boundary above is one unmissable line
 * rather than an indentation change across four hundred lines of routing.
 */
async function serve(request, env, ctx, outerId) {
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

    /**
     * The one URL an uptime monitor can be pointed at.
     *
     * Above the function dispatch and outside the POST tables because it is the
     * only GET under /api/, and before anything that touches the database
     * because a check that needs the database to answer cannot report that the
     * database is down.
     *
     * Left out of the rate limiter's list on purpose: a monitor polling every
     * thirty seconds is 2 requests a minute against a 60 budget, but every
     * monitor in the world shares a handful of source addresses, and an
     * availability check that reports 429 during an incident is worse than no
     * check. The shallow answer costs no subrequests, which is what makes that
     * safe; ?deep=1 costs one and is not what a monitor should poll.
     */
    if (path === '/api/health') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return health({ request, env });
    }

    /**
     * The error log, read back. Guarded by its own secret and 404 without one —
     * see routes/error-log.js for why it is 404 rather than 401.
     *
     * Above the rate limiter's reach for the same reason /api/health is: an
     * on-call engineer paging through failures during an incident is exactly
     * the traffic a per-address limit would refuse.
     */
    if (path === '/api/error-log') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return errorLog({ request, env });
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
      // The id minted by the boundary above, not a second one. A request that
      // fails has exactly one identifier whether it failed inside a handler or
      // in the routing between them — otherwise the number a caller reads out
      // depends on where it broke, which is the one thing they cannot know.
      const id = outerId;
      try {
        const response = await handler({ request, env, ctx, requestId: id });
        const headers = new Headers(response.headers);
        headers.set('X-Request-Id', id);
        return new Response(response.body, { status: response.status, headers });
      } catch (error) {
        return errorResponse(error, { id, route: path, env, ctx, request });
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
}
