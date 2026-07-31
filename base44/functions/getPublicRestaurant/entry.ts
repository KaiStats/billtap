/**
 * POST /functions/getPublicRestaurant  { slug } or { id }
 *
 * The four fields a guest is allowed to know about a restaurant: its name, its
 * slug, where to send a happy review, and the star threshold that decides happy
 * from unhappy.
 *
 * It exists so Restaurant.read can be closed. That rule was `null` —
 * unrestricted — because two guest-facing screens read the row directly:
 * TableEntry (/r/<slug>) and RatingCapture. Unrestricted read on that entity
 * also hands anyone `alert_email`, `alert_phone`, `owner_id`, `plan`,
 * `stripe_customer_id` and `stripe_subscription_id` for every restaurant on the
 * platform, anonymously, through this app's own /api/apps proxy. Those are the
 * operator's private contact details and billing state.
 *
 * So the projection is the point. Anything added to Restaurant.jsonc from now
 * on stays invisible here unless it is named in PUBLIC_FIELDS, which is the
 * safe default — a new field is private until someone decides otherwise.
 *
 * Deliberately unauthenticated: a diner scanning a table tent has no account,
 * and that is the entire premise of the product.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const ALLOWED_ORIGINS = [
  'https://billtap.app',
  'https://www.billtap.app',
];

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** The only fields that ever leave this endpoint. */
const PUBLIC_FIELDS = ['id', 'name', 'slug', 'google_review_url', 'rating_threshold'];

function secureJson(data, status = 200, origin = null) {
  const headers = { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

/** Copy across only the allow-listed fields. Never spread the stored row. */
function project(row) {
  const out = {};
  for (const field of PUBLIC_FIELDS) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    const headers = { ...NO_CACHE_HEADERS };
    if (ALLOWED_ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }
    return new Response(null, { status: 204, headers });
  }

  try {
    const base44 = createClientFromRequest(req);
    const { slug, id } = await req.json();

    if ((!slug || typeof slug !== 'string') && (!id || typeof id !== 'string')) {
      return secureJson({ error: 'slug or id is required' }, 400, origin);
    }

    const query = slug ? { slug } : { id };
    const rows = await base44.asServiceRole.entities.Restaurant.filter(query);
    const restaurant = rows?.[0];

    // Same shape for "no such slug" as for a typo, which is all a guest needs.
    if (!restaurant) return secureJson({ error: 'Not found' }, 404, origin);

    return secureJson({ restaurant: project(restaurant) }, 200, origin);
  } catch (error) {
    console.error('getPublicRestaurant error:', error?.message);
    return secureJson({ error: 'Internal server error' }, 500, origin);
  }
});
