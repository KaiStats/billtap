/**
 * POST /functions/submitGuestRating
 *
 *   { action: 'rate',    session_id, stars }              -> { rating_id }
 *   { action: 'contact', rating_id, email?, comment? }    -> { ok: true }
 *
 * The guest's whole write path into the two entities that hold the B2B asset:
 * the restaurant's guest email list and its private low-star feedback.
 *
 * Both entities previously declared `create`, `read` and `update` as `null` —
 * unrestricted — because RatingCapture wrote them straight from an anonymous
 * browser. That made every guest email address and every unhappy comment on the
 * platform readable and writable by anyone who knew the app id, which ships in
 * the client bundle. Closing the rules means the writes have to come through
 * here instead.
 *
 * The part that matters most is `restaurant_id`. It used to arrive from the
 * client, which made the server-side stamping createSession performs pointless:
 * anyone could post a rating attributed to any restaurant, and the dashboard
 * computes its averages straight off these rows. Here it is read off the stored
 * Session and the client's value is ignored entirely.
 *
 * Unauthenticated by design — a diner has no account — so treat every field in
 * the body as hostile and derive anything that matters from stored state.
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_COMMENT = 1500;
const MAX_EMAIL = 200;

function secureJson(data, status = 200, origin = null) {
  const headers = { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

const clean = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

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
    const body = await req.json();
    const action = body?.action;

    // ── Phase 1: the star tap ────────────────────────────────────────────────
    if (action === 'rate') {
      const { session_id, stars } = body;

      if (!session_id || typeof session_id !== 'string') {
        return secureJson({ error: 'session_id is required' }, 400, origin);
      }

      const value = Number(stars);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        return secureJson({ error: 'stars must be an integer 1-5' }, 400, origin);
      }

      // restaurant_id comes from the stored session, never from the caller.
      // This is the whole reason the write moved server-side.
      const sessions = await base44.asServiceRole.entities.Session.filter({ id: session_id });
      const session = sessions?.[0];
      if (!session) return secureJson({ error: 'Session not found' }, 404, origin);
      if (!session.restaurant_id) {
        // A consumer split with no restaurant attached has nobody to rate.
        return secureJson({ error: 'Session has no restaurant' }, 400, origin);
      }

      // One rating per session. Without this the endpoint is an unbounded row
      // factory for anyone holding a session id, and every extra row is another
      // /api/rating-alert that can be fired at the operator.
      const existing = await base44.asServiceRole.entities.GuestRating.filter({
        session_id,
      });
      if (existing?.length) {
        return secureJson({ rating_id: existing[0].id, existing: true }, 200, origin);
      }

      const threshold = await ratingThreshold(base44, session.restaurant_id);

      const row = await base44.asServiceRole.entities.GuestRating.create({
        restaurant_id: session.restaurant_id,
        session_id,
        stars: value,
        routed_to_google: value > threshold,
        created_at: Date.now(),
      });

      return secureJson({ rating_id: row.id }, 200, origin);
    }

    // ── Phase 2: the email and the comment, once the guest offers them ───────
    if (action === 'contact') {
      const { rating_id } = body;
      if (!rating_id || typeof rating_id !== 'string') {
        return secureJson({ error: 'rating_id is required' }, 400, origin);
      }

      const ratings = await base44.asServiceRole.entities.GuestRating.filter({ id: rating_id });
      const rating = ratings?.[0];
      if (!rating) return secureJson({ error: 'Rating not found' }, 404, origin);

      const email = clean(body.email, MAX_EMAIL).toLowerCase();
      const comment = clean(body.comment, MAX_COMMENT);
      const restaurantId = rating.restaurant_id;

      const patch = {};
      if (comment) patch.comment = comment;
      if (email && EMAIL_RE.test(email)) patch.guest_email = email;
      if (Object.keys(patch).length) {
        await base44.asServiceRole.entities.GuestRating.update(rating_id, patch);
      }

      // The guest list. Upsert rather than insert, so a regular turns into a
      // visit count instead of a duplicate row.
      if (email && EMAIL_RE.test(email)) {
        const contacts = await base44.asServiceRole.entities.GuestContact.filter({
          restaurant_id: restaurantId,
          email,
        });
        if (contacts?.length) {
          await base44.asServiceRole.entities.GuestContact.update(contacts[0].id, {
            visits: (contacts[0].visits || 1) + 1,
            last_seen: Date.now(),
          });
        } else {
          await base44.asServiceRole.entities.GuestContact.create({
            restaurant_id: restaurantId,
            email,
            opted_in: true,
            visits: 1,
            first_seen: Date.now(),
            last_seen: Date.now(),
          });
        }
      }

      return secureJson({ ok: true }, 200, origin);
    }

    return secureJson({ error: "action must be 'rate' or 'contact'" }, 400, origin);
  } catch (error) {
    console.error('submitGuestRating error:', error?.message);
    return secureJson({ error: 'Internal server error' }, 500, origin);
  }
});

/**
 * The restaurant's own happy/unhappy cutoff, defaulting to 3.
 *
 * Read here rather than taken from the client so `routed_to_google` reflects
 * the operator's configured threshold instead of whatever the browser believed
 * — the flag decides whether a guest is sent to Google, so it is worth being
 * the server's opinion.
 */
async function ratingThreshold(base44, restaurantId) {
  try {
    const rows = await base44.asServiceRole.entities.Restaurant.filter({ id: restaurantId });
    const value = rows?.[0]?.rating_threshold;
    return Number.isFinite(value) ? value : 3;
  } catch {
    return 3;
  }
}
