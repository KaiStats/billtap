/**
 * POST /api/fn/<name> — the Base44 functions, running here instead.
 *
 * Base44 blocks backend functions on this app's plan: every invoke answers
 * "Functions are blocked - app owner lacks backend functions capability". That
 * covers creating a split, joining one, verifying a QR, marking paid — so the
 * product could not perform a single core action while the marketing pages
 * rendered perfectly, because those are prerendered and touch no API.
 *
 * The bodies here are ports of base44/functions/<name>/entry.ts. Those files
 * stay in the repo: they are the reference, they still describe the intended
 * behaviour, and if the plan ever gains the capability they are what would run.
 * When you change behaviour, change both, or the next person will read the one
 * that is not executing.
 *
 * src/api/base44Client.js rewrites functions.invoke() to point at this route,
 * so every call site is unchanged and the SDK's { data } response shape is
 * preserved.
 */
import { json } from '../lib/email.js';
import { serviceRole, asCaller, currentUser, appId } from '../lib/base44.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Guest participant ids are minted client-side; keep the shape constrained. */
const PARTICIPANT_RE = /^p_\d+_[a-z0-9]+$/;

// ── QR token signing ────────────────────────────────────────────────────────
//
// HMAC-SHA256 over "<session_id>.<expiry>", base64url. Same scheme as
// generateQRSignature/verifyQRToken so tokens minted before this port still
// verify — a token in a printed QR outlives the deploy that changed how it is
// checked.

const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function qrSecret(env) {
  const secret = env.QR_SIGNING_SECRET || env.BASE44_MASTER_KEY;
  if (!secret) throw new Error('No QR signing secret configured');
  return secret;
}

/** Constant-time-ish compare, so a bad signature leaks nothing by timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── The functions ───────────────────────────────────────────────────────────

const HANDLERS = {
  /** Guest-visible restaurant fields, and nothing else. */
  async getPublicRestaurant({ env, body }) {
    const { slug, id } = body;
    if ((!slug || typeof slug !== 'string') && (!id || typeof id !== 'string')) {
      return json({ error: 'slug or id is required' }, 400);
    }
    const svc = serviceRole(env);
    const rows = await svc.entity('Restaurant').filter(slug ? { slug } : { id });
    const r = rows[0];
    if (!r) return json({ error: 'Not found' }, 404);

    // Allow-list, never a spread: Restaurant also holds alert_email,
    // alert_phone, owner_id and the Stripe ids.
    return json({
      restaurant: {
        id: r.id,
        name: r.name,
        slug: r.slug,
        google_review_url: r.google_review_url,
        rating_threshold: r.rating_threshold,
      },
    });
  },

  /** Advisory arithmetic check on a parsed receipt. No stored data involved. */
  async validateReceiptParse({ body }) {
    const { items, tax, tip, total } = body;
    if (!Array.isArray(items)) return json({ error: 'Invalid items array' }, 400);

    const itemSum = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
    const calculated = itemSum + (Number(tax) || 0) + (Number(tip) || 0);
    const difference = Math.abs(calculated - (Number(total) || 0));

    const warnings = [];
    if (Number(total) && difference > 0.05) {
      warnings.push(`Items add up to $${calculated.toFixed(2)} but the total reads $${Number(total).toFixed(2)}.`);
    }
    for (const i of items) {
      if (!i.name || !String(i.name).trim()) warnings.push('An item has no name.');
      if (!Number.isFinite(Number(i.price)) || Number(i.price) < 0) {
        warnings.push(`"${String(i.name || 'An item')}" has an unreadable price.`);
      }
    }

    return json({
      valid: warnings.length === 0,
      warnings: warnings.slice(0, 5),
      item_sum: Math.round(itemSum * 100) / 100,
      calculated_total: Math.round(calculated * 100) / 100,
    });
  },

  /** Mints the signed QR token for a session. Host only. */
  async generateQRSignature({ env, request, body }) {
    const { session_id } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    const user = await currentUser(env, request);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    // Ownership via the caller's own credentials: if Base44's rules would not
    // show them this session, they do not get a token for it.
    const mine = await asCaller(env, request).entity('Session').filter({ id: session_id });
    if (!mine.length) return json({ error: 'Session not found' }, 404);

    const expiry = Date.now() + 30 * 60 * 1000;
    const sig = await hmac(qrSecret(env), `${session_id}.${expiry}`);
    return json({ qr_token: `${session_id}.${expiry}.${sig}`, expires_at: expiry });
  },

  /** Checks a scanned token and hands back the session id it points at. */
  async verifyQRToken({ env, body }) {
    const { qr_token } = body;
    if (!qr_token || typeof qr_token !== 'string') {
      return json({ valid: false, error: 'qr_token is required' }, 400);
    }

    const parts = qr_token.split('.');
    if (parts.length !== 3) return json({ valid: false, error: 'Malformed QR code' }, 400);

    const [sessionId, expiryRaw, sig] = parts;
    const expiry = Number(expiryRaw);
    if (!Number.isFinite(expiry)) return json({ valid: false, error: 'Malformed QR code' }, 400);
    if (Date.now() > expiry) return json({ valid: false, error: 'This QR code has expired' }, 400);

    const expected = await hmac(qrSecret(env), `${sessionId}.${expiry}`);
    if (!safeEqual(expected, sig)) return json({ valid: false, error: 'Invalid QR code' }, 400);

    return json({ valid: true, session_id: sessionId });
  },

  /** The guest's rating, and then their email and comment. */
  async submitGuestRating({ env, body }) {
    const svc = serviceRole(env);
    const action = body?.action;

    if (action === 'rate') {
      const { session_id } = body;
      if (!session_id || typeof session_id !== 'string') {
        return json({ error: 'session_id is required' }, 400);
      }
      const stars = Number(body.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return json({ error: 'stars must be an integer 1-5' }, 400);
      }

      // restaurant_id off the stored session, never from the caller — the whole
      // reason this write is server-side.
      const sessions = await svc.entity('Session').filter({ id: session_id });
      const session = sessions[0];
      if (!session) return json({ error: 'Session not found' }, 404);
      if (!session.restaurant_id) return json({ error: 'Session has no restaurant' }, 400);

      // One rating per session, or the endpoint is an unbounded row factory and
      // every extra row is another alert that can be fired at the operator.
      const existing = await svc.entity('GuestRating').filter({ session_id });
      if (existing.length) return json({ rating_id: existing[0].id, existing: true });

      let threshold = 3;
      try {
        const rows = await svc.entity('Restaurant').filter({ id: session.restaurant_id });
        if (Number.isFinite(rows[0]?.rating_threshold)) threshold = rows[0].rating_threshold;
      } catch { /* default stands */ }

      const row = await svc.entity('GuestRating').create({
        restaurant_id: session.restaurant_id,
        session_id,
        stars,
        routed_to_google: stars > threshold,
        created_at: Date.now(),
      });
      return json({ rating_id: row.id });
    }

    if (action === 'contact') {
      const { rating_id } = body;
      if (!rating_id || typeof rating_id !== 'string') {
        return json({ error: 'rating_id is required' }, 400);
      }
      const ratings = await svc.entity('GuestRating').filter({ id: rating_id });
      const rating = ratings[0];
      if (!rating) return json({ error: 'Rating not found' }, 404);

      const email = clean(body.email, 200).toLowerCase();
      const comment = clean(body.comment, 1500);
      const validEmail = email && EMAIL_RE.test(email);

      const patch = {};
      if (comment) patch.comment = comment;
      if (validEmail) patch.guest_email = email;
      if (Object.keys(patch).length) await svc.entity('GuestRating').update(rating_id, patch);

      if (validEmail) {
        const contacts = await svc.entity('GuestContact').filter({
          restaurant_id: rating.restaurant_id, email,
        });
        if (contacts.length) {
          await svc.entity('GuestContact').update(contacts[0].id, {
            visits: (contacts[0].visits || 1) + 1,
            last_seen: Date.now(),
          });
        } else {
          await svc.entity('GuestContact').create({
            restaurant_id: rating.restaurant_id,
            email,
            opted_in: true,
            visits: 1,
            first_seen: Date.now(),
            last_seen: Date.now(),
          });
        }
      }
      return json({ ok: true });
    }

    return json({ error: "action must be 'rate' or 'contact'" }, 400);
  },

  /** The operator's own ratings and contacts. Ownership from their identity. */
  async getRestaurantDashboardData({ env, request }) {
    const user = await currentUser(env, request);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const svc = serviceRole(env);
    const owned = await svc.entity('Restaurant').filter({ owner_id: user.id });
    const restaurant = owned[0];
    if (!restaurant) return json({ restaurant: null, ratings: [], contacts: [] });

    const [ratings, contacts] = await Promise.all([
      svc.entity('GuestRating').filter({ restaurant_id: restaurant.id }),
      svc.entity('GuestContact').filter({ restaurant_id: restaurant.id }),
    ]);
    return json({ restaurant_id: restaurant.id, ratings, contacts });
  },
};

export async function onRequestPost({ request, env, name }) {
  const handler = HANDLERS[name];
  if (!handler) return json({ error: `Unknown function: ${name}` }, 404);

  if (!appId(env)) {
    console.error(`fn/${name}: BASE44_APP_ID is not configured`);
    return json({ error: 'Service misconfigured' }, 500);
  }

  let body = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  try {
    return await handler({ request, env, body });
  } catch (error) {
    // Surface the function name: these all answer on one route, so an
    // unlabelled stack trace says nothing about which one failed.
    console.error(`fn/${name} failed:`, error?.message);
    return json({ error: 'Internal server error' }, 500);
  }
}

export { HANDLERS };
