/**
 * Worker entry point.
 *
 * wrangler.jsonc routes /api/* here first; everything else is served straight
 * from ./dist, with unmatched paths falling back to index.html so the SPA boots
 * on deep links.
 *
 * The route handlers live in functions/api/*.js as plain modules taking
 * ({request, env}). They were written against the Pages Functions signature,
 * which this dispatches to unchanged — the logic is identical either way.
 */
import { onRequestPost as restaurantLead } from '../functions/api/restaurant-lead.js';
import { onRequestPost as ratingAlert } from '../functions/api/rating-alert.js';
import { onRequestPost as createCheckout } from '../functions/api/create-checkout.js';
import { onRequestPost as verifyCheckout } from '../functions/api/verify-checkout.js';
import { onRequestPost as monthlyReport } from '../functions/api/monthly-report.js';
import { proxyToBase44 } from '../functions/api/base44-proxy.js';

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
