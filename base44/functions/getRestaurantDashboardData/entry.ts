/**
 * POST /functions/getRestaurantDashboardData
 *
 * The signed-in operator's own guest ratings and guest contacts.
 *
 * Exists because GuestRating.read and GuestContact.read are now admin-only.
 * They had to be closed — as `null` they let anyone on the internet enumerate
 * every restaurant's guest email list and every private complaint — but the
 * dashboard is a legitimate reader of exactly one restaurant's worth of that
 * data, so it needs a door.
 *
 * Ownership is established from the caller's own identity and then used to pick
 * the restaurant. No restaurant_id is accepted from the client, because an id
 * in the request body is precisely the parameter an operator would edit to read
 * a competitor's guest list.
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

function secureJson(data, status = 200, origin = null) {
  const headers = { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
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

    const user = await base44.auth.me();
    if (!user) return secureJson({ error: 'Unauthorized' }, 401, origin);

    // Whose restaurant this is comes from the session, never the request body.
    const owned = await base44.asServiceRole.entities.Restaurant.filter({ owner_id: user.id });
    const restaurant = owned?.[0];

    // No restaurant yet is the ordinary pre-onboarding state, not an error.
    if (!restaurant) return secureJson({ restaurant: null, ratings: [], contacts: [] }, 200, origin);

    const [ratings, contacts] = await Promise.all([
      base44.asServiceRole.entities.GuestRating.filter({ restaurant_id: restaurant.id }),
      base44.asServiceRole.entities.GuestContact.filter({ restaurant_id: restaurant.id }),
    ]);

    return secureJson(
      { restaurant_id: restaurant.id, ratings: ratings || [], contacts: contacts || [] },
      200,
      origin,
    );
  } catch (error) {
    console.error('getRestaurantDashboardData error:', error?.message);
    return secureJson({ error: 'Internal server error' }, 500, origin);
  }
});
