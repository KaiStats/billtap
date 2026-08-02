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
import { validateReceiptParse as computeParse } from '../../shared/receipt-math.js';

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

// ── Host keys ───────────────────────────────────────────────────────────────
//
// Who is allowed to confirm that money arrived?
//
// Only the person whose Venmo it went to. For a split created by a signed-in
// user that is answerable from Base44's own rules — created_by_id is them. For
// a split created from a table tent it is not: the guest has no account, the
// row has no owner, and Session's update rule (base44/entities/Session.jsonc)
// therefore matches nobody. The host of a table-tent split could not confirm a
// payment at all, and src/pages/ReceiptDetail.jsx decided who was host from a
// `?host=1` query parameter, which is not authorization, it is a suggestion.
//
// So creating a split mints a secret. The creator gets it once and keeps it in
// their browser; the session stores only its SHA-256. Presenting the secret is
// what proves you are the host. It works identically for both kinds of host,
// it survives Base44 having no opinion about guests, and losing it costs you
// the host controls rather than someone else's money.

/**
 * Change one participant, and notice if the write was lost.
 *
 * Base44's REST layer replaces the whole Session row on a PUT and offers no
 * compare-and-swap, so any read-modify-write here can be trampled: the host
 * confirms Alice while a diner taps "I've sent it" as Bob, both read the same
 * participants array, and whichever saves second reinstates the other's stale
 * row. At a table of six that is not hypothetical — it is two thumbs moving at
 * once, and the casualty is a payment record.
 *
 * Rather than pretend a lock exists, this checks its own work. After writing it
 * reads back; if the change it just made is not there, it was the loser of a
 * race and starts again from the winner's version. The loser always detects,
 * so both changes survive — the retry re-applies onto whatever landed rather
 * than onto the snapshot it started with.
 *
 * `mutate(session)` returns the patch to write, or null to mean "nothing to do".
 * `settled(session)` says whether this call's intent is visible in a fresh read.
 */
async function patchSession(svc, sessionId, mutate, settled, attempts = 3) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rows = await svc.entity('Session').filter({ id: sessionId });
    latest = rows[0];
    if (!latest) return null;

    const patch = mutate(latest);
    if (!patch) return latest;

    latest = await svc.entity('Session').update(sessionId, patch);
    if (settled(latest)) return latest;

    // Someone else's save landed on top of ours. Loop: the next read sees their
    // version and our change is re-applied over it instead of under it.
  }
  return latest;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function mintHostKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

/**
 * True when this request may act as the host of `session`.
 *
 * Either identity is sufficient and neither is trusted from the body alone:
 * the key is checked against the stored hash, and ownership against Base44's
 * answer for who the caller is.
 */
async function isHost(env, request, session, providedKey) {
  if (session.host_key_hash && typeof providedKey === 'string' && providedKey) {
    if (safeEqual(await sha256Hex(providedKey), session.host_key_hash)) return true;
  }
  if (!session.created_by_id) return false;
  const user = await currentUser(env, request);
  return Boolean(user && user.id && user.id === session.created_by_id);
}

// ── The functions ───────────────────────────────────────────────────────────

const HANDLERS = {
  /**
   * A diner's own view of the split, cheap enough to ask for repeatedly.
   *
   * The three screens used to watch base44.entities.Session.subscribe() for
   * changes. That was never going to work for the people this product is for.
   * The socket connects anonymously — its own URL reads app_id=null&token=null —
   * and Session's read rule matches created_by_id or a participant id that is a
   * Base44 user. A guest is neither, so nothing was ever delivered to them: the
   * table sat watching a screen that could not change, which is precisely the
   * moment the product is sold on.
   *
   * Worse if it had worked. Claim.jsx wrote event.data straight into state, and
   * event.data is the raw row — every diner's amount_owed and, since the last
   * change, host_key_hash with it. This returns the same scoped view
   * joinSession does: names, who has settled, your own share, nothing else.
   */
  async getSplitStatus({ env, body }) {
    const { session_id, participant_id } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }
    if (participant_id !== undefined && participant_id !== null
        && !PARTICIPANT_RE.test(String(participant_id))) {
      return json({ error: 'Invalid participant_id' }, 400);
    }

    const sessions = await serviceRole(env).entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);

    return json({ session: scopeForParticipant(session, participant_id || null) });
  },

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

  /**
   * Advisory arithmetic check on a parsed receipt. No stored data involved.
   *
   * The scan no longer waits on this — the browser runs the same function from
   * shared/receipt-math.js, because a network round trip to add up a column of
   * numbers the phone is already holding is time spent in front of someone
   * staring at a spinner. Kept for any caller that wants the check server-side,
   * and sharing the implementation is what stops the two answers drifting.
   */
  async validateReceiptParse({ body }) {
    const result = computeParse(body);
    if (result.error) return json(result, 400);
    return json(result);
  },

  /**
   * Mints the signed QR token for a session. Host only.
   *
   * Either proof works. It used to accept only a signed-in owner, which meant
   * the host of a table-tent split — the flow the product is sold on — could
   * not produce the QR code their table needs to scan. They had made a split
   * nobody could join.
   */
  async generateQRSignature({ env, request, body }) {
    const { session_id, host_key } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    if (host_key) {
      const rows = await serviceRole(env).entity('Session').filter({ id: session_id });
      if (!rows[0]) return json({ error: 'Session not found' }, 404);
      if (!(await isHost(env, request, rows[0], host_key))) {
        return json({ error: 'Not the host of this split' }, 403);
      }
    } else {
      const user = await currentUser(env, request);
      if (!user) return json({ error: 'Unauthorized' }, 401);

      // Ownership via the caller's own credentials: if Base44's rules would not
      // show them this session, they do not get a token for it.
      const mine = await asCaller(env, request).entity('Session').filter({ id: session_id });
      if (!mine.length) return json({ error: 'Session not found' }, 404);
    }

    const expiry = Date.now() + 30 * 60 * 1000;
    const sig = await hmac(qrSecret(env), `${session_id}.${expiry}`);
    return json({ qr_token: `${session_id}.${expiry}.${sig}`, expires_at: expiry });
  },

  /**
   * The host's own settings for a split: where to send the money, whether
   * claiming has opened, and the amounts in a custom split.
   *
   * All three were raw Session.update calls from src/pages/SessionHost.jsx, so
   * all three were governed by Base44's update rule — created_by_id must equal
   * the caller. A table-tent split has no created_by_id, so for a guest host
   * every one of them failed silently. The most damaging was the payment
   * details: without them the claim screen has no Venmo handle to send anyone
   * to, so nobody at that table could pay at all.
   */
  async updateSplitSettings({ env, request, body }) {
    const { session_id, host_key, host_payment_info, status, custom_amounts } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);
    if (!(await isHost(env, request, session, host_key))) {
      return json({ error: 'Only the host can change this split' }, 403);
    }

    const patch = {};

    if (host_payment_info !== undefined) {
      const method = host_payment_info?.method;
      const handle = clean(host_payment_info?.handle, 64);
      if (!['venmo', 'cashapp', 'zelle'].includes(method)) {
        return json({ error: 'Pick Venmo, Cash App or Zelle' }, 400);
      }
      if (!handle) return json({ error: 'A payment handle is required' }, 400);
      patch.host_payment_info = { method, handle };
    }

    // The host opening claiming, and nothing else. 'completed' belongs to
    // confirmPayment, which is the only place the last 'paid' can be written.
    if (status !== undefined) {
      if (status !== 'claiming') return json({ error: 'status can only be set to claiming' }, 400);
      if (session.status !== 'completed') patch.status = 'claiming';
    }

    if (custom_amounts !== undefined) {
      if (!custom_amounts || typeof custom_amounts !== 'object') {
        return json({ error: 'custom_amounts must be an object' }, 400);
      }
      const rows = session.participants || [];
      const total = Number(session.total_amount) || 0;

      // Say what is actually wrong. A host who retypes the amounts so they add
      // up to the bill, not realising one diner is already settled, would
      // otherwise be told their $30 of amounts comes to $45 — a number that
      // appears nowhere on their screen and that they cannot act on.
      const frozen = rows.filter((p) => {
        if (p.payment_status !== 'paid') return false;
        const asked = Number(custom_amounts[p.participant_id]);
        return Number.isFinite(asked) && Math.abs(asked - (Number(p.amount_owed) || 0)) > 0.005;
      });
      if (frozen.length) {
        const names = frozen.map((p) => p.name || 'Someone').join(', ');
        return json({
          error: `${names} already paid, so that amount cannot change. Undo the confirmation first if it was wrong.`,
        }, 409);
      }

      const next = rows.map((p) => {
        // A settled diner's amount is frozen here for the same reason it is in
        // joinSession: they have already handed over a number, and quietly
        // restating it would leave them marked paid against a figure they never
        // sent.
        if (p.payment_status === 'paid') return p;
        const raw = custom_amounts[p.participant_id];
        if (raw === undefined) return p;
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount < 0) return p;
        return { ...p, amount_owed: Math.round(amount * 100) / 100 };
      });

      // The table must still be paying the bill. Rejecting rather than silently
      // storing a set of amounts that do not add up is the difference between
      // a host noticing now and a host noticing when they are short.
      const sum = next.reduce((s, p) => s + (Number(p.amount_owed) || 0), 0);
      if (Math.abs(sum - total) > 0.05) {
        return json({
          error: `Those amounts add up to $${sum.toFixed(2)}, but the bill is $${total.toFixed(2)}.`,
        }, 400);
      }

      patch.participants = next;
      patch.split_mode = 'custom';
    }

    if (!Object.keys(patch).length) return json({ error: 'Nothing to change' }, 400);

    const updated = await svc.entity('Session').update(session_id, patch);
    return json({ session: publicSession(updated) });
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

  /**
   * Creates a split. The one function a guest reaches with no account at all.
   *
   * Auth is conditional: a restaurant_slug means a diner scanned a table tent,
   * and requiring a login there would defeat the entire product.
   */
  async createSession({ env, request, body }) {
    const { title, image_url, items, tax, tip, split_mode, total_amount: customTotal, restaurant_slug } = body;
    const user = await currentUser(env, request);

    if (!user && !restaurant_slug) return json({ error: 'Unauthorized' }, 401);
    if (!title || typeof title !== 'string' || !title.trim()) {
      return json({ error: 'title is required' }, 400);
    }

    const mode = ['itemized', 'even', 'custom'].includes(split_mode) ? split_mode : 'itemized';
    const taxVal = Number(tax) || 0;
    const tipVal = Number(tip) || 0;
    if (taxVal < 0 || tipVal < 0) return json({ error: 'tax and tip cannot be negative' }, 400);
    if (taxVal > 10000 || tipVal > 10000) return json({ error: 'tax or tip value is unreasonably large' }, 400);

    const list = Array.isArray(items) ? items : [];
    const subtotal = list.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
    const total = mode === 'itemized'
      ? subtotal + taxVal + tipVal
      : (Number(customTotal) || subtotal + taxVal + tipVal);

    if (total > 10000) return json({ error: 'Bill total cannot exceed $10,000' }, 400);

    const svc = serviceRole(env);

    // Derived server-side, never accepted from the client — otherwise anyone
    // could attribute ratings, and the guest emails attached to them, to a
    // restaurant they have never been to.
    let restaurantId = null;
    try {
      if (restaurant_slug) {
        const bySlug = await svc.entity('Restaurant').filter({ slug: restaurant_slug });
        if (bySlug.length) restaurantId = bySlug[0].id;
      } else if (user) {
        const owned = await svc.entity('Restaurant').filter({ owner_id: user.id });
        if (owned.length) restaurantId = owned[0].id;
      }
    } catch (e) {
      console.error('createSession: restaurant lookup failed', e?.message);
    }

    // Guests are rate-limited per restaurant rather than per account. Skipping
    // it would leave an unauthenticated endpoint minting rows without bound.
    if (!user && restaurantId) {
      try {
        const since = Date.now() - 60 * 60 * 1000;
        const recent = await svc.entity('Session').filter({ restaurant_id: restaurantId });
        const inWindow = recent.filter((s) => {
          const t = new Date(s.created_date).getTime();
          return !Number.isNaN(t) && t >= since;
        });
        if (inWindow.length >= 100) {
          return json({ error: 'This restaurant has too many splits in progress. Try again shortly.' }, 429);
        }
      } catch (e) {
        // A failed count must not block a paying restaurant's diners.
        console.error('createSession: guest rate-limit check failed', e?.message);
      }
    }

    // As the caller when there is one, so created_by_id is the real owner and
    // the session shows up in their dashboard; as the app for a guest, who has
    // no id to stamp.
    const writer = user ? asCaller(env, request) : svc;

    // Minted here and returned exactly once. Only the hash is stored, so a leak
    // of the Session row does not hand anyone the host controls.
    const hostKey = mintHostKey();

    const session = await writer.entity('Session').create({
      title: title.trim().slice(0, 100),
      image_url: image_url || null,
      split_mode: mode,
      total_amount: Math.round(total * 100) / 100,
      tax: Math.round(taxVal * 100) / 100,
      tip: Math.round(tipVal * 100) / 100,
      items: list,
      participants: [],
      status: 'waiting',
      expires_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
      host_key_hash: await sha256Hex(hostKey),
      ...(restaurantId ? { restaurant_id: restaurantId } : {}),
    });

    return json({ session: publicSession(session), host_key: hostKey });
  },

  /**
   * The host's own view of a split: everyone, and what everyone owes.
   *
   * Needed because Base44's read rule on Session matches created_by_id or a
   * participant id, and the host of a table-tent split is neither — the row has
   * no owner and they never joined as a diner. Reading it through the SDK
   * returned nothing, so the screen that lists who has paid was empty for
   * exactly the person it exists for.
   */
  async getSessionAsHost({ env, request, body }) {
    const { session_id, host_key } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);

    if (!(await isHost(env, request, session, host_key))) {
      return json({ error: 'Not the host of this split' }, 403);
    }

    return json({ session: publicSession(session) });
  },

  /**
   * The host confirming that money actually arrived — or taking it back.
   *
   * This is the only thing in the product that writes 'paid'. A diner tapping
   * "I've sent payment" writes pending_verification and nothing more, because a
   * diner asserting they paid is not evidence that they did; the person whose
   * Venmo it lands in is the only one who knows.
   *
   * It replaces a raw Session.update from src/pages/ReceiptDetail.jsx that sent
   * the whole participants array back. That is the same shape of bug the audit
   * found in joinSession: two confirmations at once and one is silently erased,
   * and a crafted client could rewrite every amount in the split. Here the
   * caller names one participant and the server patches that row against stored
   * data.
   */
  async confirmPayment({ env, request, body }) {
    const { session_id, participant_id, host_key, action = 'confirm' } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }
    if (!participant_id || !PARTICIPANT_RE.test(String(participant_id))) {
      return json({ error: 'Invalid participant_id' }, 400);
    }
    if (action !== 'confirm' && action !== 'undo') {
      return json({ error: "action must be 'confirm' or 'undo'" }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);

    if (!(await isHost(env, request, session, host_key))) {
      return json({ error: 'Only the host can confirm a payment' }, 403);
    }

    const participants = session.participants || [];
    const target = participants.find((p) => p.participant_id === participant_id);
    if (!target) return json({ error: 'Participant not found in session' }, 404);

    // Idempotent. The host taps twice on a slow connection, or two host devices
    // confirm the same diner; both must land on one settled row, not two.
    const alreadySettled = target.payment_status === 'paid';
    if (action === 'confirm' && alreadySettled) {
      return json({ session: publicSession(session), unchanged: true });
    }
    if (action === 'undo' && !alreadySettled) {
      return json({ session: publicSession(session), unchanged: true });
    }

    const wanted = action === 'confirm' ? 'paid' : 'unpaid';

    const updated = await patchSession(
      svc,
      session_id,
      (fresh) => {
        const rows = fresh.participants || [];
        if (!rows.find((p) => p.participant_id === participant_id)) return null;

        const next = rows.map((p) => {
          if (p.participant_id !== participant_id) return p;
          if (action === 'undo') {
            const { paid_amount, paid_at, ...rest } = p;
            return { ...rest, payment_status: 'unpaid' };
          }
          return {
            ...p,
            payment_status: 'paid',
            // What was actually settled, recorded at the moment it was settled.
            // amount_owed keeps moving as people join and claim; this does not,
            // so a host can see that Alice paid $26 against a share that later
            // became $31 rather than being shown one comforting number.
            paid_amount: Math.round((Number(p.amount_owed) || 0) * 100) / 100,
            paid_at: Date.now(),
          };
        });

        // The one place a split can complete, because it is the one place the
        // last 'paid' can be written.
        const everyonePaid = next.length > 0 && next.every((p) => p.payment_status === 'paid');
        return {
          participants: next,
          status: everyonePaid
            ? 'completed'
            : (fresh.status === 'completed' ? 'claiming' : fresh.status),
        };
      },
      (fresh) => (fresh.participants || [])
        .find((p) => p.participant_id === participant_id)?.payment_status === wanted,
    );

    if (!updated) return json({ error: 'Session not found' }, 404);
    return json({ session: publicSession(updated) });
  },

  /**
   * Joins a split and claims items.
   *
   * The port fixes what the original did here. It wrote the client's entire
   * `items` and `participants` arrays back to the session, so two people
   * claiming at the same table raced: whoever saved second overwrote the other's
   * claim with their own stale snapshot, silently. The same trust let a crafted
   * client rewrite anyone's amount_owed or mark another diner paid.
   *
   * Now only the caller's own participant row and their own claim deltas are
   * applied, against the stored session rather than the one the browser
   * remembers.
   */
  async joinSession({ env, body }) {
    const { session_id, participant_id, name, items } = body;
    if (!session_id || typeof session_id !== 'string') return json({ error: 'session_id is required' }, 400);
    if (!participant_id || !PARTICIPANT_RE.test(String(participant_id))) {
      return json({ error: 'Invalid participant_id' }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);
    if (session.expires_at && session.expires_at < Date.now()) {
      return json({ error: 'Session has expired' }, 410);
    }

    const current = session.participants || [];
    const already = current.find((p) => p.participant_id === participant_id);
    if (!already && current.length >= 50) {
      return json({ error: 'Session is full (max 50 participants)' }, 400);
    }

    // Once the host has confirmed the money arrived, the diner's side of the
    // split is closed. Letting them keep claiming would change what they owe
    // after they had already paid it, and their row is frozen below, so the
    // claim would be recorded against an amount that no longer updates.
    if (already?.payment_status === 'paid') {
      return json({ error: 'Your payment is already settled for this split' }, 409);
    }

    const splitMode = session.split_mode || 'itemized';
    const cleanName = clean(name, 40);
    const storedItems = Array.isArray(session.items) ? session.items : [];

    // Apply this caller's claim deltas to the STORED items, one item at a time.
    let nextItems = storedItems;
    if (splitMode === 'itemized' && Array.isArray(items)) {
      const wanted = new Set(
        items.filter((i) => (i.claimed_by || []).includes(participant_id)).map((i) => i.id),
      );
      const touched = new Set(items.map((i) => i.id));

      for (const item of items) {
        const original = storedItems.find((i) => i.id === item.id);
        if (!original) continue;
        const originalClaimed = original.claimed_by || [];
        const stealing =
          wanted.has(item.id) &&
          originalClaimed.length > 0 &&
          !originalClaimed.includes(participant_id);
        if (stealing) return json({ error: `Item "${original.name}" is already claimed` }, 409);
      }

      // Everything except this caller's own membership is carried over from the
      // stored row, so a concurrent claim by someone else survives.
      nextItems = storedItems.map((stored) => {
        if (!touched.has(stored.id)) return stored;
        const others = (stored.claimed_by || []).filter((id) => id !== participant_id);
        return { ...stored, claimed_by: wanted.has(stored.id) ? [...others, participant_id] : others };
      });
    }

    const count = already ? current.length : current.length + 1;
    const evenShare = count > 0 ? Math.round(((session.total_amount || 0) / count) * 100) / 100 : 0;

    /** This caller's share, recomputed from stored data — never taken from the body. */
    const shareFor = (pid) => {
      if (splitMode === 'even') return evenShare;
      if (splitMode === 'custom') return current.find((p) => p.participant_id === pid)?.amount_owed || 0;
      const claimed = nextItems.filter((i) => (i.claimed_by || []).includes(pid));
      const sub = claimed.reduce((s, i) => {
        const share = (i.claimed_by || []).length || 1;
        return s + ((Number(i.price) || 0) * (Number(i.quantity) || 1)) / share;
      }, 0);
      const allSub = nextItems.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
      const ratio = allSub > 0 ? sub / allSub : 0;
      const extras = (Number(session.tax) || 0) + (Number(session.tip) || 0);
      return Math.round((sub + extras * ratio) * 100) / 100;
    };

    let nextParticipants = already
      ? current.map((p) =>
          p.participant_id === participant_id
            ? { ...p, ...(cleanName ? { name: cleanName } : {}) }
            : p,
        )
      : [...current, {
          participant_id,
          name: cleanName || 'Anonymous',
          amount_owed: 0,
          payment_status: 'unpaid',
        }];

    // payment_status is never taken from the request: markMePaid owns it, and
    // accepting it here would let one diner mark another as paid.
    //
    // A settled diner's amount is frozen. Every join recalculates what everyone
    // owes, and in an even split that moves all of them — so a fifth person
    // arriving after Alice's $30 was confirmed would quietly restate her share
    // as $24 and leave her marked paid against a number she never sent. Her row
    // stops moving once the host confirms it; the arithmetic for everyone still
    // owing continues as before.
    nextParticipants = nextParticipants.map((p) => (
      p.payment_status === 'paid'
        ? p
        : { ...p, amount_owed: splitMode === 'even' ? evenShare : shareFor(p.participant_id) }
    ));

    const updated = await svc.entity('Session').update(session_id, {
      participants: nextParticipants,
      status: session.status === 'waiting' ? 'claiming' : session.status,
      ...(splitMode === 'itemized' ? { items: nextItems } : {}),
    });

    return json({ session: scopeForParticipant(updated, participant_id) });
  },

  /** Marks the caller — and only the caller — as having sent payment. */
  async markMePaid({ env, body }) {
    const { session_id, participant_id } = body;
    if (!session_id || typeof session_id !== 'string') return json({ error: 'session_id is required' }, 400);
    if (!participant_id || !PARTICIPANT_RE.test(String(participant_id))) {
      return json({ error: 'Invalid participant_id' }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);

    const participants = session.participants || [];
    const me = participants.find((p) => p.participant_id === participant_id);
    if (!me) return json({ error: 'Participant not found in session' }, 404);

    // Already settled by the host — leave it alone. Without this, a diner
    // returning to the tab and tapping the button again would move themselves
    // from 'paid' back to 'pending_verification', undoing the host's
    // confirmation and putting a settled bill back on their to-do list.
    if (me.payment_status === 'paid') {
      return json({ session: scopeForParticipant(session, participant_id), unchanged: true });
    }

    // pending_verification, not paid: only the host confirms receipt of money.
    // Completion is decided in confirmPayment, which is the only place the last
    // 'paid' can be written — asserting you have sent money is not the same
    // event as the money arriving.
    //
    // Through patchSession because this is the likeliest collision in the
    // product: five people round a table tapping "I've sent it" within a few
    // seconds of each other while the host works down the same list.
    const updated = await patchSession(
      svc,
      session_id,
      (fresh) => {
        const rows = fresh.participants || [];
        const mine = rows.find((p) => p.participant_id === participant_id);
        if (!mine || mine.payment_status === 'paid') return null;
        return {
          participants: rows.map((p) =>
            p.participant_id === participant_id ? { ...p, payment_status: 'pending_verification' } : p,
          ),
          status: fresh.status,
        };
      },
      (fresh) => {
        const mine = (fresh.participants || []).find((p) => p.participant_id === participant_id);
        // 'paid' also settles this call: the host confirmed while we were
        // writing, and that is a stronger statement than the one we came to make.
        return mine?.payment_status === 'pending_verification' || mine?.payment_status === 'paid';
      },
    );

    if (!updated) return json({ error: 'Session not found' }, 404);
    return json({ session: scopeForParticipant(updated, participant_id) });
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

/**
 * A guest's view of a session.
 *
 * Everyone at the table shares one session row, but a diner has no business
 * seeing what anyone else owes, nor the host's payment details. Only the
 * caller's own amount_owed is included; names and paid-or-not stay visible
 * because the table needs to see who has settled up.
 */
function scopeForParticipant(session, participantId) {
  return {
    id: session.id,
    title: session.title,
    split_mode: session.split_mode,
    total_amount: session.total_amount,
    tax: session.tax,
    tip: session.tip,
    items: session.items,
    status: session.status,
    expires_at: session.expires_at,
    host_payment_info: session.host_payment_info,
    participants: (session.participants || []).map((p) => ({
      participant_id: p.participant_id,
      name: p.name,
      payment_status: p.payment_status,
      ...(p.participant_id === participantId
        ? { amount_owed: p.amount_owed, paid_amount: p.paid_amount, paid_at: p.paid_at }
        : {}),
    })),
    // Needed by the client to decide whether to show the rating prompt at all.
    ...(session.restaurant_id ? { restaurant_id: session.restaurant_id } : {}),
  };
}

/**
 * The host's view: everything about the split except the thing that grants
 * control of it.
 *
 * host_key_hash never leaves the Worker. It is only a SHA-256 and so not
 * directly usable, but a hash handed to every client is a hash somebody will
 * eventually run a wordlist against, and there is no reason for it to travel.
 */
function publicSession(session) {
  const { host_key_hash, ...rest } = session || {};
  return rest;
}
