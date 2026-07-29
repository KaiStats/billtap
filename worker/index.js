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

    return env.ASSETS.fetch(request);
  },
};
