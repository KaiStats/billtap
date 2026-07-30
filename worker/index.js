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
import { onRequestPost as monthlyReport } from './routes/monthly-report.js';
import { proxyToBase44 } from './routes/base44-proxy.js';

const BASE44_PREFIX = '/api/apps/';

/** POST-only endpoints owned by this app. */
const POST_ROUTES = {
  '/api/restaurant-lead': restaurantLead,
  '/api/rating-alert': ratingAlert,
  '/api/create-checkout': createCheckout,
  '/api/verify-checkout': verifyCheckout,
  '/api/monthly-report': monthlyReport,
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
  '/icon-generator',
  '/login',
  '/register',
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Base44 data layer. The SDK is built with serverUrl: '', so entity, auth
    // and function calls arrive same-origin under /api/apps/<appId>/...
    if (path.startsWith(BASE44_PREFIX)) {
      return proxyToBase44(request, env, path.slice(BASE44_PREFIX.length));
    }

    const handler = POST_ROUTES[path];
    if (handler) {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      return handler({ request, env });
    }

    // An unmatched /api/* path must 404 as JSON. Falling through to the assets
    // binding would hand back index.html and turn a typo into a parse error.
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

    const legacy = LEGACY_REDIRECTS[path];
    if (legacy) {
      return Response.redirect(new URL(legacy + url.search, url.origin).toString(), 301);
    }

    // Treat /about/ and /about as the same route.
    const route = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
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
