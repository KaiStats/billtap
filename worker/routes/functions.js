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
import { serviceRole, asCaller, currentUser, dataMisconfiguration, backendName } from '../lib/data.js';
// Straight from db.js rather than through the backend switch: storage is
// Supabase's and there is no Base44 equivalent to route to. createReceiptUpload
// checks the backend itself before calling this.
import { createSignedUpload } from '../lib/db.js';
import { validateReceiptParse as computeParse } from '../../shared/receipt-math.js';
import { AppError, errorResponse, requestId } from '../lib/errors.js';
import { audit as recordAudit, ACTIONS } from '../lib/audit.js';
import { firstInWindow } from '../lib/rate-limit.js';

/**
 * The audit hook when nobody supplied one.
 *
 * onRequestPost always passes a real one, so in production this is unreachable.
 * It exists because the rule in worker/lib/audit.js — recording an action must
 * never be able to break it — has to hold at this boundary too. A handler
 * called directly, by a test or by a future path, does its work and skips the
 * row rather than throwing on a missing dependency.
 */
const NO_AUDIT = async () => {};

/** One page of a dashboard read. */
const DASHBOARD_PAGE = 1000;

/**
 * The ceiling on a dashboard read, across all pages.
 *
 * Chosen to be far past any real restaurant and still bounded. A room seating
 * a hundred people, rated by every table, every night, takes years to reach it
 * — and if one ever does, the response says so rather than the operator quietly
 * receiving part of their list.
 */
const DASHBOARD_MAX = 20000;

/**
 * Every row for one restaurant, walked in pages, with a hard stop.
 *
 * `filter` with no limit is one unbounded query whose size is the restaurant's
 * whole history. Paging does not make the payload smaller — the client needs
 * all of it, because it averages the ratings and exports the contacts — but it
 * does mean no single query is unbounded, and it gives a place to stop.
 *
 * Falls back to the single read on a backend that cannot express a limit, which
 * is the behaviour that was there before.
 */
async function readAll(svc, entity, restaurantId) {
  if (!svc.queryOperators) {
    return { rows: await svc.entity(entity).filter({ restaurant_id: restaurantId }), truncated: false };
  }

  const rows = [];
  for (let offset = 0; offset < DASHBOARD_MAX; offset += DASHBOARD_PAGE) {
    const page = await svc.entity(entity).filter(
      { restaurant_id: restaurantId },
      { limit: DASHBOARD_PAGE, offset, order: 'created_date' },
    );
    rows.push(...page);
    if (page.length < DASHBOARD_PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

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

/**
 * A JSON response the caller can be told to skip re-reading.
 *
 * ── Why the polled reads get this and nothing else does ─────────────────────
 *
 * getSplitStatus and getSessionAsHost are the only endpoints in the product
 * called on a timer. src/hooks/useLiveSplit polls one of them every three
 * seconds on every phone at the table, so a five-person split with the host
 * screen open is six callers at twenty calls a minute — 120 requests a minute,
 * per table, each answered with the entire session: every item, every claim,
 * every participant.
 *
 * Almost none of those responses differ from the one before. The client already
 * knows this — it fingerprints what arrives and discards anything identical —
 * so the bytes were crossing a restaurant's wifi, being parsed, hashed and
 * thrown away, twenty times a minute per diner, for the length of a meal.
 *
 * The hash is taken over the exact bytes that would have been sent, which is
 * what makes this safe rather than merely cheap: an unchanged ETag means a
 * byte-identical body, so there is no state in which a diner is told "nothing
 * changed" about a response that would have differed. In particular it hashes
 * the *scoped* body, so a diner whose own amount moved gets a new tag even when
 * the table's shared view did not.
 *
 * The database read still happens. This saves the response, not the query — the
 * freshness of the answer is unchanged, and that is deliberate. A screen at a
 * table showing a stale total is the one failure this product cannot have.
 */
async function etagJson(request, payload) {
  const body = JSON.stringify(payload);
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(body));
  const etag = `"${[...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0')).join('')}"`;

  const headers = { 'Cache-Control': 'no-store', ETag: etag };

  if (request?.headers?.get('If-None-Match') === etag) {
    // No body, by definition — a 304 carrying one is malformed, and the
    // Response constructor refuses it.
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

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
 * ── It did not detect anything ──────────────────────────────────────────────
 *
 * This checked `settled()` against the value `update()` returned, and both
 * backends issue their write with `return=representation` — Supabase PATCH,
 * Base44 PUT — so that value is the row as THIS write left it. A loser's own
 * change is by definition present in its own echo. `settled()` was true every
 * time and the retry loop never ran once.
 *
 * Demonstrated with two handlers that both call this: the host confirms Alice
 * while Bob taps "I've sent it", both reading before either writes. Bob's write
 * lands, the host's stale array lands on top, and Bob is 'unpaid' having been
 * told he succeeded. His audit row says he self-reported; the session says he
 * never did.
 *
 * ── What it does now ────────────────────────────────────────────────────────
 *
 * A real compare-and-swap, where the backend can express one. Read `version`,
 * write `version + 1`, and condition the write on the value that was read.
 * Postgres evaluates the guard and the update as one statement, so of two
 * racing writers exactly one matches; the other updates zero rows, gets null
 * back, and loops to re-apply on top of the winner. Neither change is lost, and
 * the loser finds out on the write itself rather than by guessing from a read.
 *
 * Requires supabase/migrations/0005_sessions_version.sql. If that has not been
 * applied, worker/lib/db.js reports the undefined column, this falls back for
 * the rest of the isolate's life, and the fallback below is what runs.
 *
 * ── The fallback, and what it is worth ──────────────────────────────────────
 *
 * Base44's REST layer has no conditional write, so on that backend this writes
 * unconditionally and then does a GENUINE re-read — a `filter()`, not the
 * write's echo — to see whether the change survived.
 *
 * Be clear about what that buys: it catches the case where the other write
 * lands inside our write-then-read window, and misses the case where it lands
 * after our re-read. It is a narrower window, not a closed one. It is the best
 * available against a backend that only offers last-writer-wins, and it is the
 * reason the Supabase path is the one worth being on.
 *
 * `mutate(session)` returns the patch to write, or null to mean "nothing to do".
 * It may throw an AppError to refuse outright — a claim that collided with
 * someone else's is a 409, not something to retry into.
 * `settled(session)` says whether this call's intent is visible in a fresh read.
 */
/**
 * Set once if the database has no `version` column, i.e. migration 0005 has not
 * been applied to whatever this Worker is pointed at.
 *
 * Module scope so one failed write teaches the whole isolate rather than every
 * request rediscovering it. Deliberately fails open to the weaker scheme: a
 * Worker that refused to write bills because a migration was outstanding would
 * be a worse outage than the race it is guarding against.
 */
let conditionalWritesUnavailable = false;

/** Does this failure mean "no such column", as opposed to a real write error? */
function isUndefinedColumn(error) {
  const body = error?.body;
  if (body && typeof body === 'object' && body.code === '42703') return true;
  return /42703|column .*version.* does not exist/i.test(String(error?.message || ''));
}

async function patchSession(svc, sessionId, mutate, settled, attempts = 3) {
  let latest = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const rows = await svc.entity('Session').filter({ id: sessionId });
    latest = rows[0];
    if (!latest) return null;

    const patch = mutate(latest);
    if (!patch) return latest;

    const canSwap =
      svc.conditionalWrites &&
      !conditionalWritesUnavailable &&
      typeof latest.version === 'number';

    if (canSwap) {
      // Compare-and-swap. null means zero rows matched: somebody else's write
      // moved the version between our read and now, so start over from theirs.
      let written;
      try {
        written = await svc.entity('Session').update(
          sessionId,
          { ...patch, version: latest.version + 1 },
          { ifMatch: { version: latest.version } },
        );
      } catch (error) {
        if (!isUndefinedColumn(error)) throw error;
        // Migration 0005 is outstanding. Say so once — loudly, because the
        // fallback is the behaviour that loses a diner's claim — and carry on
        // through the unconditional path below.
        conditionalWritesUnavailable = true;
        console.error(
          JSON.stringify({
            level: 'error',
            code: 'sessions_version_missing',
            message:
              'sessions.version is absent, so writes cannot be conditional. Apply ' +
              'supabase/migrations/0005_sessions_version.sql. Concurrent claims can be lost until then.',
          }),
        );
        written = undefined;
      }
      if (written) return written;
      if (!conditionalWritesUnavailable) continue;
    }

    await svc.entity('Session').update(sessionId, patch);

    // A genuine read, not the update's return value — see above.
    const after = await svc.entity('Session').filter({ id: sessionId });
    latest = after[0] || latest;
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

// ── Participant keys ────────────────────────────────────────────────────────
//
// Who is allowed to act as one diner in a split?
//
// participant_id was the answer, and it could not be. It is minted in the
// browser, and scopeForParticipant lists every participant's id in every poll
// response — it has to, so the table can see who claimed what and who has
// settled. The thing that authorised acting as a diner was therefore published
// to everyone at that diner's table, and to anyone the claim link reached.
//
// Measured against the handlers as they were, any diner could read another's
// exact amount_owed by replaying an id out of the response they had just been
// handed; could call markMePaid as them, so the host saw a diner asserting they
// had sent money when they had not; and could call joinSession as them to
// release their claims — leaving them owing nothing and the table short.
//
// So a diner gets a secret too, exactly as the host does. Same shape as the
// host key deliberately: minted once, only its SHA-256 stored, and a second
// mechanism would be a second thing to get wrong.

/** 18 bytes, base64url. Same generator as the host key, one size down. */
function mintParticipantKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(18)));
}

/**
 * Whether `providedKey` proves the caller is `participant`.
 *
 * ── Rows minted before this existed ───────────────────────────────────────
 *
 * A participant with no stored hash predates participant keys. Splits live for
 * thirty days, so on the day this ships every split in flight is in that state,
 * and refusing them would strand tables mid-meal — diners unable to claim, mark
 * themselves paid, or see their own share, with no way to obtain a key for a
 * row that has none.
 *
 * Those rows are therefore allowed through, and joinSession mints a key for
 * them the next time the diner's client calls it, which Claim.jsx does on load.
 * The permissive window is bounded by the split's own expiry rather than open
 * ended, and no session created after this deploy is ever in it.
 */
async function isParticipant(participant, providedKey) {
  if (!participant) return false;
  if (!participant.participant_key_hash) return true;
  if (typeof providedKey !== 'string' || !providedKey) return false;
  return safeEqual(await sha256Hex(providedKey), participant.participant_key_hash);
}

/** True when this row still needs a key minted for it. */
const needsKey = (participant) => Boolean(participant) && !participant.participant_key_hash;

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
  async getSplitStatus({ env, request, body }) {
    const { session_id, participant_id, participant_key } = body;
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

    /**
     * Which diner this caller is allowed to be shown as themselves.
     *
     * It used to be whichever one they named. Since the previous response hands
     * out every participant's id, that meant asking twice — once as yourself to
     * learn the ids, once as somebody else — returned their amount_owed,
     * paid_amount and paid_at. The scoping below is the only thing keeping one
     * diner's share from the rest of the table, so the id alone cannot be what
     * unlocks it.
     *
     * A caller who names a diner without holding their key is not refused; they
     * are simply nobody, and get the same view a bystander with the link gets.
     * Refusing outright would turn a stale key into a broken screen for a diner
     * who has done nothing wrong, and there is nothing here worth refusing over
     * — everything withheld is withheld either way.
     */
    const rows = session.participants || [];
    const claimed = participant_id ? rows.find((p) => p.participant_id === participant_id) : null;
    const asSelf = (await isParticipant(claimed, participant_key)) ? participant_id : null;

    return etagJson(request, { session: scopeForParticipant(session, asSelf || null) });
  },

  /**
   * A ticket to upload one receipt photograph.
   *
   * ── The hole this closes ──────────────────────────────────────────────────
   *
   * Migration 0004 grants anon insert on the receipts bucket, because the
   * person photographing the bill is a guest with no account and there is no
   * credential to demand. src/lib/uploadReceipt.js therefore posts straight
   * from the browser to Supabase Storage — which means the upload never reaches
   * this Worker, and the rate limiter has never seen one. 0004's header argues
   * the bucket's size limit stops it being "free unbounded storage"; that
   * bounds each object at 10 MB and says nothing at all about how many, and
   * nothing else bounded that either.
   *
   * Minting a signed upload URL puts the decision back here without moving the
   * bytes: this call is metered like every other, and the browser still uploads
   * directly to storage, so a 10 MB photo does not round-trip through an
   * isolate on a restaurant's wifi.
   *
   * ── Why the key is minted here ────────────────────────────────────────────
   *
   * The client used to choose it. The bucket is public and the key is the only
   * thing standing between one table's bill and anyone who fancies looking, so
   * who generates it is not a detail — a caller that picks its own key can pick
   * a guessable one, or one that collides with a key it wants to learn about.
   * The uuid is generated on this side and the caller only says what kind of
   * image it is.
   *
   * Still anonymous, and it must stay that way: requiring a session here would
   * mean photographing a receipt needs an account, which is the product gone.
   */
  async createReceiptUpload({ env, body }) {
    if (backendName(env) !== 'supabase') {
      // The bucket is Supabase's. On the Base44 backend there is nothing to
      // sign, and the client falls back to its direct upload.
      return json({ error: 'Signed uploads are not available.', code: 'not_configured' }, 503);
    }

    // Matches ALLOWED_TYPES in worker/routes/scan-receipt.js, plus jpg for the
    // extension form. The extension decides how the object is served back, so
    // it is an allow-list rather than whatever the caller sent.
    const ALLOWED = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
    const raw = typeof body?.extension === 'string' ? body.extension.toLowerCase() : '';
    const extension = ALLOWED.has(raw) ? raw : 'jpg';

    const key = `${crypto.randomUUID()}.${extension}`;

    try {
      const { path, token } = await createSignedUpload(env, 'receipts', key);
      return json({ path, token, bucket: 'receipts' });
    } catch (error) {
      // Not fatal to the caller: uploadReceipt falls back to the direct write
      // that has always worked, so a signing outage costs metering rather than
      // the ability to photograph a bill.
      console.error('createReceiptUpload: signing failed', error?.message);
      return json({ error: 'Could not prepare the upload.', code: 'sign_failed' }, 503);
    }
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
  async generateQRSignature({ env, request, body, audit = NO_AUDIT }) {
    const { session_id, host_key } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    if (host_key) {
      const rows = await serviceRole(env).entity('Session').filter({ id: session_id });
      if (!rows[0]) return json({ error: 'Session not found' }, 404);
      if (!(await isHost(env, request, rows[0], host_key))) {
        await audit({
          action: ACTIONS.HOST_KEY_REJECTED,
          sessionId: session_id,
          restaurantId: rows[0].restaurant_id,
          actorHostKey: host_key,
          outcome: 'denied',
          detail: { reason: 'qr_signature' },
        });
        throw new AppError('not_host', 'Not the host of this split.', 403);
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

    // A QR token is what lets a stranger at a table open this bill. Issuing one
    // is a grant of access, so it is recorded as one — otherwise "how did they
    // get into our split" has no answer at all.
    await audit({
      action: ACTIONS.HOST_KEY_ISSUED,
      sessionId: session_id,
      actorHostKey: host_key,
      detail: { reason: 'qr_token' },
    });

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
  async updateSplitSettings({ env, request, body, audit = NO_AUDIT }) {
    const { session_id, host_key, host_payment_info, status, custom_amounts } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);
    if (!(await isHost(env, request, session, host_key))) {
      await audit({
        action: ACTIONS.HOST_KEY_REJECTED,
        sessionId: session_id,
        restaurantId: session.restaurant_id,
        actorHostKey: host_key,
        outcome: 'denied',
        detail: { reason: 'update_settings' },
      });
      throw new AppError('not_host', 'Only the host can change this split.', 403);
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

    /**
     * Recomputes the participant rows for a set of custom amounts.
     *
     * Takes the session to work from, so it can run twice: once here against
     * the row this request read, to produce the friendly 400/409 a host can act
     * on, and again inside patchSession against whatever version the write
     * actually lands on.
     *
     * Refusals are thrown, not returned, because the second call happens inside
     * a mutate callback that can only hand back a patch. onRequestPost renders
     * them as the same statuses and sentences either way.
     */
    const applyCustomAmounts = (from) => {
      const rows = from.participants || [];
      const total = Number(from.total_amount) || 0;

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
        throw new AppError(
          'already_paid',
          `${names} already paid, so that amount cannot change. Undo the confirmation first if it was wrong.`,
          409,
        );
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
        throw new AppError(
          'amounts_do_not_add_up',
          `Those amounts add up to $${sum.toFixed(2)}, but the bill is $${total.toFixed(2)}.`,
          400,
        );
      }

      return next;
    };

    if (custom_amounts !== undefined) {
      if (!custom_amounts || typeof custom_amounts !== 'object') {
        return json({ error: 'custom_amounts must be an object' }, 400);
      }
      // Validated now so an unacceptable request is refused before anything is
      // written; recomputed again below against the row being written onto.
      applyCustomAmounts(session);
      patch.split_mode = 'custom';
    }

    if (!Object.keys(patch).length && custom_amounts === undefined) {
      return json({ error: 'Nothing to change' }, 400);
    }

    /**
     * Through patchSession, because this writes `participants` — the same whole
     * array every other handler rewrites.
     *
     * A host setting custom amounts while a diner joins is not a rare shape: it
     * is what a host does the moment they see the split is uneven, which is
     * while people are still arriving. Written unconditionally, whichever
     * landed second erased the other — either the new arrival vanished, or the
     * host's amounts silently reverted with the screen still showing them.
     */
    const updated = await patchSession(
      svc,
      session_id,
      (fresh) => ({
        ...patch,
        ...(custom_amounts !== undefined ? { participants: applyCustomAmounts(fresh) } : {}),
        // Re-evaluated against the fresh row: confirmPayment may have completed
        // the split while this was in flight, and reopening it then would undo
        // a completion the host did not ask to undo.
        ...(patch.status === 'claiming' && fresh.status === 'completed' ? { status: fresh.status } : {}),
      }),
      (fresh) => {
        if (patch.host_payment_info) {
          const stored = fresh.host_payment_info || {};
          if (stored.handle !== patch.host_payment_info.handle) return false;
        }
        if (custom_amounts === undefined) return true;
        // Every amount we asked for is the amount now stored.
        return (fresh.participants || []).every((p) => {
          const asked = Number(custom_amounts[p.participant_id]);
          if (!Number.isFinite(asked) || p.payment_status === 'paid') return true;
          return Math.abs((Number(p.amount_owed) || 0) - Math.round(asked * 100) / 100) < 0.005;
        });
      },
    );

    if (!updated) return json({ error: 'Session not found' }, 404);

    // "Someone changed my split after we agreed it" is a dispute between two
    // people at one table, and this row is the only witness to it. The previous
    // mode is kept alongside the new one, because what changed matters more
    // than what it is now.
    await audit({
      action: ACTIONS.SPLIT_SETTINGS_CHANGED,
      sessionId: session_id,
      restaurantId: session.restaurant_id,
      actorHostKey: host_key,
      detail: {
        split_mode: updated.split_mode,
        previous_split_mode: session.split_mode,
        status: updated.status,
        previous_status: session.status,
        participant_count: (updated.participants || []).length,
      },
    });

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
  async submitGuestRating({ env, body, audit = NO_AUDIT }) {
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
      // A guest handing over their email address, and it being kept. Recorded
      // because "why are you emailing me" deserves an answer with a date on it.
      await audit({
        action: ACTIONS.RATING_SUBMITTED,
        restaurantId: rating.restaurant_id,
        detail: { reason: 'contact_opt_in' },
      });
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
  async createSession({ env, request, body, audit = NO_AUDIT }) {
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

    /**
     * The line items, normalised to the five fields the app actually uses.
     *
     * They were stored exactly as the client sent them: any length, any shape,
     * any extra fields, any string size. This row is then handed back to every
     * diner at the table on every poll, so an oversized items array is not just
     * a large write — it is a large read repeated for the length of a meal.
     *
     * 200 is well past a real receipt. The longest genuine one seen here is a
     * few dozen lines; the review screen makes a diner tap through each of them
     * before the split is created, so nobody is arriving here with hundreds by
     * accident.
     *
     * Field-by-field rather than a spread, so an unknown key from a crafted
     * client cannot be persisted and served back to the table. `id` is kept as
     * given because joinSession matches claims on it, and `claimed_by` because
     * a split can be created with items already assigned — but both are
     * constrained to the shapes the rest of the code assumes.
     */
    const rawList = Array.isArray(items) ? items : [];
    if (rawList.length > 200) {
      return json({ error: 'That receipt has too many line items.' }, 400);
    }
    const list = rawList
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        id: typeof item.id === 'string' && item.id ? item.id.slice(0, 64) : `item-${index}`,
        name: clean(item.name, 120),
        price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        claimed_by: Array.isArray(item.claimed_by)
          ? item.claimed_by.filter((pid) => typeof pid === 'string' && PARTICIPANT_RE.test(pid)).slice(0, 50)
          : [],
      }));

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

    /**
     * Guest splits one restaurant may start in an hour.
     *
     * Named rather than left inline so the number is findable. It is the only
     * capacity ceiling in the product, and a venue busy enough to reach it
     * legitimately is a venue whose diners are being turned away — which is why
     * reaching it is logged.
     */
    const GUEST_SESSIONS_PER_HOUR = 100;

    /**
     * Guests are rate-limited per restaurant rather than per account. Skipping
     * it would leave an unauthenticated endpoint minting rows without bound.
     *
     * ── This read had no bound of its own ─────────────────────────────────
     *
     * It asked for every session the restaurant had ever had — `select=*`, no
     * limit, no time predicate — and then counted the last hour in JavaScript.
     * On the guest critical path, on an endpoint that takes no credentials, on
     * a table whose rows carry the whole items and participants arrays.
     *
     * A restaurant doing forty splits a night crosses ten thousand rows inside
     * a year, and every one of them was pulled across the wire and parsed into
     * a 128 MB isolate to answer a question about the previous sixty minutes.
     * The index for exactly this query — sessions (restaurant_id, created_date
     * desc) — has been in 0001 the whole time and nothing was using it.
     *
     * The count is what matters, so ask for the count: the hour as a predicate,
     * two columns instead of forty, and one more row than the threshold so a
     * busy restaurant reads 101 rows rather than its entire history.
     *
     * The JavaScript window filter stays. It is not redundant — base44.js
     * cannot express an operator and answers `queryOperators: false`, so on
     * that backend this still reads everything and the filter below is what
     * makes the answer correct. It costs one pass over at most 101 rows when
     * the database has already done the narrowing.
     */
    if (!user && restaurantId) {
      try {
        const since = Date.now() - 60 * 60 * 1000;
        const recent = svc.queryOperators
          ? await svc.entity('Session').filter(
              { restaurant_id: restaurantId, created_date: { gte: new Date(since).toISOString() } },
              { select: 'id,created_date', limit: 101 },
            )
          : await svc.entity('Session').filter({ restaurant_id: restaurantId });
        const inWindow = recent.filter((s) => {
          const t = new Date(s.created_date).getTime();
          return !Number.isNaN(t) && t >= since;
        });
        if (inWindow.length >= GUEST_SESSIONS_PER_HOUR) {
          /**
           * Logged, because this is the one refusal in the product a restaurant
           * can reach by being busy.
           *
           * It returned a 429 and recorded nothing anywhere. Abuse and success
           * look identical from outside — a hundred splits in an hour is either
           * somebody scripting the endpoint or a full room on a Saturday — and
           * the difference matters enormously to the restaurant, who in the
           * second case watches diners fail to start splits with no indication
           * that a ceiling exists at all. This line is what makes it visible in
           * the logs before it is visible as a support email.
           */
          console.warn(JSON.stringify({
            guest_session_cap: true,
            restaurant_id: restaurantId,
            in_window: inWindow.length,
            cap: GUEST_SESSIONS_PER_HOUR,
          }));
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

    // The start of the trail for this bill. Every later row about this split —
    // who claimed what, who was confirmed paid — hangs off this session id, and
    // without a row saying when and by whom it began, the rest has no anchor.
    await audit({
      action: ACTIONS.SPLIT_CREATED,
      sessionId: session.id,
      restaurantId: restaurantId,
      actorUserId: user?.id || null,
      actorHostKey: hostKey,
      detail: {
        amount: Math.round(total * 100) / 100,
        item_count: list.length,
        split_mode: mode,
      },
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
  async getSessionAsHost({ env, request, body, audit = NO_AUDIT }) {
    const { session_id, host_key } = body;
    if (!session_id || typeof session_id !== 'string') {
      return json({ error: 'session_id is required' }, 400);
    }

    const svc = serviceRole(env);
    const sessions = await svc.entity('Session').filter({ id: session_id });
    const session = sessions[0];
    if (!session) return json({ error: 'Session not found' }, 404);

    if (!(await isHost(env, request, session, host_key))) {
      await audit({
        action: ACTIONS.HOST_KEY_REJECTED,
        sessionId: session_id,
        restaurantId: session.restaurant_id,
        actorHostKey: host_key,
        outcome: 'denied',
        detail: { reason: 'host_view' },
      });
      throw new AppError('not_host', 'Not the host of this split.', 403);
    }

    /**
     * "Who could see my table's bill?" This is the read that answers it — every
     * name and every amount at that table, in one response.
     *
     * At most one row a minute, because this endpoint is polled. Every host
     * screen in the product runs src/hooks/useLiveSplit against it on a
     * three-second interval, so the unguarded version wrote twenty rows a
     * minute for as long as a host left the page up — 1,800 over a meal, from
     * one table — into a table with no delete path and no retention sweep. The
     * rejections below are NOT coalesced: a wrong host key is the security
     * event, and nothing polls with one.
     *
     * See firstInWindow() for why an unavailable sampler writes the row anyway.
     */
    if (await firstInWindow(env, `host-access:${session_id}`)) {
      await audit({
        action: ACTIONS.SPLIT_HOST_ACCESS,
        sessionId: session_id,
        restaurantId: session.restaurant_id,
        actorHostKey: host_key,
        detail: { participant_count: (session.participants || []).length, status: session.status },
      });
    }

    return etagJson(request, { session: publicSession(session) });
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
  async confirmPayment({ env, request, body, audit = NO_AUDIT }) {
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
      // Recorded, and recorded as denied. A rejected host key is the signature
      // of someone trying to mark themselves paid on a bill they do not own,
      // and it is the one failure here that is worth being able to count.
      await audit({
        action: ACTIONS.HOST_KEY_REJECTED,
        sessionId: session_id,
        restaurantId: session.restaurant_id,
        actorHostKey: host_key,
        actorParticipantId: participant_id,
        outcome: 'denied',
        detail: { reason: 'confirm_payment' },
      });
      throw new AppError('not_host', 'Only the host can confirm a payment.', 403);
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

    // The row that settles the argument. The amount is the point: "the host
    // confirmed $23.40 for p_17… at 8:42pm" is the entire content of a payment
    // dispute, and without the number this row cannot end one.
    const settled = (updated.participants || []).find((p) => p.participant_id === participant_id);
    await audit({
      action: action === 'confirm' ? ACTIONS.PAYMENT_CONFIRMED : ACTIONS.PAYMENT_UNCONFIRMED,
      sessionId: session_id,
      restaurantId: updated.restaurant_id,
      actorHostKey: host_key,
      actorParticipantId: participant_id,
      detail: {
        amount: action === 'confirm' ? settled?.paid_amount : (target.paid_amount ?? null),
        status: updated.status,
        verified_by: host_key ? 'host_key' : 'session',
      },
    });

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
   *
   * ── And now against a version of the row that is still current ─────────────
   *
   * Applying the deltas to stored data fixed a stale CLIENT snapshot. It did
   * nothing about two of these handlers running at once on the server, and this
   * was the only mutating handler that never went through patchSession — a
   * plain read-modify-write, on the endpoint with by far the highest collision
   * rate in the product. Everyone at a table joins within the same fifteen
   * seconds; that is the moment the QR code is for.
   *
   * Measured: two concurrent joins, Alice's and Bob's, both reading before
   * either writes. Alice was erased outright — gone from participants, her item
   * claim cleared, her $40 of a $60 bill uncollected — and her phone was
   * handed a 200. The existing regression test could not see it, because it
   * awaits Alice's call fully before starting Bob's.
   *
   * Everything below now recomputes from `fresh` inside the mutate callback, so
   * a retry re-applies onto whoever won rather than onto the snapshot this
   * request started from.
   */
  async joinSession({ env, body, audit = NO_AUDIT }) {
    const { session_id, participant_id, name, items, participant_key } = body;
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

    /**
     * Acting as an existing diner takes their key.
     *
     * This is the call that could do the most damage without one. Naming
     * somebody else's participant_id — which the previous poll response handed
     * out — let a caller rename them, release their item claims so they owed
     * nothing and the table came up short, or claim extra items for them so
     * they owed more than they ate.
     *
     * A row with no stored hash predates participant keys and is allowed
     * through; one is minted for it below. See isParticipant.
     */
    if (already && !(await isParticipant(already, participant_key))) {
      await audit({
        action: ACTIONS.HOST_KEY_REJECTED,
        sessionId: session_id,
        restaurantId: session.restaurant_id,
        actorParticipantId: participant_id,
        outcome: 'denied',
        detail: { reason: 'participant_key' },
      });
      throw new AppError(
        'not_participant',
        'That is not your place in this split.',
        403,
      );
    }

    // Once the host has confirmed the money arrived, the diner's side of the
    // split is closed. Letting them keep claiming would change what they owe
    // after they had already paid it, and their row is frozen below, so the
    // claim would be recorded against an amount that no longer updates.
    if (already?.payment_status === 'paid') {
      return json({ error: 'Your payment is already settled for this split' }, 409);
    }

    const cleanName = clean(name, 40);

    /**
     * Minted for anyone who does not have one — a diner joining now, or a row
     * created before participant keys existed.
     *
     * Generated once, outside the retry loop, so a retry does not hand back a
     * key different from the one it wrote.
     */
    const mintedKey = !already || needsKey(already) ? mintParticipantKey() : null;
    const mintedHash = mintedKey ? await sha256Hex(mintedKey) : null;

    /**
     * What this caller is asking for, from the body alone.
     *
     * Derived once, outside the retry, because it is a statement of intent — it
     * depends only on the request — while everything it is applied TO is read
     * fresh on each attempt.
     */
    const requested = Array.isArray(items) ? items : [];
    const wanted = new Set(
      requested.filter((i) => (i.claimed_by || []).includes(participant_id)).map((i) => i.id),
    );
    const touched = new Set(requested.map((i) => i.id));

    const updated = await patchSession(
      svc,
      session_id,
      (fresh) => {
        // Re-checked against the version being written onto, not the one this
        // request opened with. A split that expired, filled up or was settled
        // while we were deciding must not be joined on the retry.
        if (fresh.expires_at && fresh.expires_at < Date.now()) {
          throw new AppError('session_expired', 'Session has expired', 410);
        }
        const rows = fresh.participants || [];
        const mine = rows.find((p) => p.participant_id === participant_id);
        if (!mine && rows.length >= 50) {
          throw new AppError('session_full', 'Session is full (max 50 participants)', 409);
        }
        if (mine?.payment_status === 'paid') {
          throw new AppError('already_settled', 'Your payment is already settled for this split', 409);
        }

        const splitMode = fresh.split_mode || 'itemized';
        const storedItems = Array.isArray(fresh.items) ? fresh.items : [];

        // Apply this caller's claim deltas to the STORED items, one at a time.
        let nextItems = storedItems;
        if (splitMode === 'itemized' && requested.length) {
          for (const item of requested) {
            const original = storedItems.find((i) => i.id === item.id);
            if (!original) continue;
            const originalClaimed = original.claimed_by || [];
            const stealing =
              wanted.has(item.id) &&
              originalClaimed.length > 0 &&
              !originalClaimed.includes(participant_id);
            // A refusal, not a retry. Someone else holds this item and looping
            // would only re-read the same answer.
            if (stealing) {
              throw new AppError('item_claimed', `Item "${original.name}" is already claimed`, 409);
            }
          }

          // Everything except this caller's own membership is carried over from
          // the stored row, so a concurrent claim by someone else survives.
          nextItems = storedItems.map((stored) => {
            if (!touched.has(stored.id)) return stored;
            const others = (stored.claimed_by || []).filter((id) => id !== participant_id);
            return { ...stored, claimed_by: wanted.has(stored.id) ? [...others, participant_id] : others };
          });
        }

        const count = mine ? rows.length : rows.length + 1;
        const evenShare = count > 0 ? Math.round(((fresh.total_amount || 0) / count) * 100) / 100 : 0;

        /** This caller's share, recomputed from stored data — never taken from the body. */
        const shareFor = (pid) => {
          if (splitMode === 'even') return evenShare;
          if (splitMode === 'custom') return rows.find((p) => p.participant_id === pid)?.amount_owed || 0;
          const claimed = nextItems.filter((i) => (i.claimed_by || []).includes(pid));
          const sub = claimed.reduce((s, i) => {
            const share = (i.claimed_by || []).length || 1;
            return s + ((Number(i.price) || 0) * (Number(i.quantity) || 1)) / share;
          }, 0);
          const allSub = nextItems.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
          const ratio = allSub > 0 ? sub / allSub : 0;
          const extras = (Number(fresh.tax) || 0) + (Number(fresh.tip) || 0);
          return Math.round((sub + extras * ratio) * 100) / 100;
        };

        let nextParticipants = mine
          ? rows.map((p) =>
              p.participant_id === participant_id
                ? {
                  ...p,
                  ...(cleanName ? { name: cleanName } : {}),
                  // Only ever added, never replaced: a row that already has a
                  // hash keeps it, or a caller could rotate a diner's key out
                  // from under them and lock them out of their own share.
                  ...(mintedHash && needsKey(p) ? { participant_key_hash: mintedHash } : {}),
                }
                : p,
            )
          : [...rows, {
              participant_id,
              name: cleanName || 'Anonymous',
              amount_owed: 0,
              payment_status: 'unpaid',
              ...(mintedHash ? { participant_key_hash: mintedHash } : {}),
            }];

        // payment_status is never taken from the request: markMePaid owns it,
        // and accepting it here would let one diner mark another as paid.
        //
        // A settled diner's amount is frozen. Every join recalculates what
        // everyone owes, and in an even split that moves all of them — so a
        // fifth person arriving after Alice's $30 was confirmed would quietly
        // restate her share as $24 and leave her marked paid against a number
        // she never sent. Her row stops moving once the host confirms it; the
        // arithmetic for everyone still owing continues as before.
        nextParticipants = nextParticipants.map((p) => (
          p.payment_status === 'paid'
            ? p
            : { ...p, amount_owed: splitMode === 'even' ? evenShare : shareFor(p.participant_id) }
        ));

        return {
          participants: nextParticipants,
          status: fresh.status === 'waiting' ? 'claiming' : fresh.status,
          ...(splitMode === 'itemized' ? { items: nextItems } : {}),
        };
      },
      // Our intent is visible when we are in the split and every item we asked
      // for is recorded as ours. Membership alone is not enough: the write that
      // erased Alice also erased her claim, and a diner listed as owing nothing
      // is the same bug wearing a different number.
      (fresh) => {
        const rows = fresh.participants || [];
        if (!rows.find((p) => p.participant_id === participant_id)) return false;
        const freshItems = Array.isArray(fresh.items) ? fresh.items : [];
        return [...wanted].every((id) =>
          (freshItems.find((i) => i.id === id)?.claimed_by || []).includes(participant_id),
        );
      },
    );

    if (!updated) return json({ error: 'Session not found' }, 404);

    // Who claimed what, and what they were told they owe. The other half of a
    // "that was not my order" dispute — payment.self_reported says a diner sent
    // money, this says what the app had asked them for at that moment.
    await audit({
      action: ACTIONS.SPLIT_CLAIMED,
      sessionId: session_id,
      restaurantId: updated.restaurant_id,
      actorParticipantId: participant_id,
      detail: {
        amount: (updated.participants || []).find((p) => p.participant_id === participant_id)?.amount_owed ?? null,
        // From the row that was actually written, not the one this request
        // opened with — a retry may have landed on a split whose mode changed
        // underneath it, and the audit row has to describe what happened.
        split_mode: updated.split_mode || 'itemized',
        participant_count: (updated.participants || []).length,
      },
    });

    return json({
      session: scopeForParticipant(updated, participant_id),
      // Returned exactly once, the way createSession returns the host key. The
      // browser keeps it — see src/lib/participantKey.js — and sends it back on
      // every later call that acts as this diner. Absent on subsequent joins,
      // because there is nothing new to hand over.
      ...(mintedKey ? { participant_key: mintedKey } : {}),
    });
  },

  /** Marks the caller — and only the caller — as having sent payment. */
  async markMePaid({ env, body, audit = NO_AUDIT }) {
    const { session_id, participant_id, participant_key } = body;
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

    /**
     * "Only the caller" was not enforced by anything.
     *
     * The doc comment above this handler has always said it marks the caller
     * and only the caller, and the id in the body was the whole of the check —
     * an id every poll response publishes to the table. So any diner could
     * report that any other diner had sent money, and the host's screen would
     * show it. That is not a display bug: a host who believes a diner has paid
     * stops chasing them, and the table comes up short by that diner's share.
     */
    if (!(await isParticipant(me, participant_key))) {
      await audit({
        action: ACTIONS.HOST_KEY_REJECTED,
        sessionId: session_id,
        restaurantId: session.restaurant_id,
        actorParticipantId: participant_id,
        outcome: 'denied',
        detail: { reason: 'participant_key' },
      });
      throw new AppError('not_participant', 'That is not your place in this split.', 403);
    }

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

    // The other side of a payment dispute. This row says a diner asserted they
    // sent money at 8:31pm; the payment.confirmed row says the host agreed it
    // arrived at 8:42pm. Which is why the actor is recorded as a claim — nobody
    // verified anything here, and a trail that implied otherwise would be worse
    // than none.
    await audit({
      action: ACTIONS.PAYMENT_SELF_REPORTED,
      sessionId: session_id,
      restaurantId: updated.restaurant_id,
      actorParticipantId: participant_id,
      detail: { amount: Number(me.amount_owed) || 0, status: 'pending_verification' },
    });

    return json({ session: scopeForParticipant(updated, participant_id) });
  },

  /**
   * The operator's own ratings and contacts. Ownership from their identity.
   *
   * See readAll below for why these are paged rather than limited.
   */
  async getRestaurantDashboardData({ env, request, audit = NO_AUDIT }) {
    const user = await currentUser(env, request);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const svc = serviceRole(env);
    const owned = await svc.entity('Restaurant').filter({ owner_id: user.id });
    const restaurant = owned[0];
    if (!restaurant) return json({ restaurant: null, ratings: [], contacts: [] });

    /**
     * Both lists, read in pages rather than in one unbounded query.
     *
     * These were two `select=*` reads with no limit, growing with the
     * restaurant forever. The obvious fix — put a limit on them — is the wrong
     * one, and worth writing down so nobody applies it later: the client
     * computes the average rating over everything returned, shows
     * `contacts.length` as "Guest emails", and its CSV button exports exactly
     * the array it was given. A limit would not slow anything down; it would
     * quietly make the average wrong, the count wrong, and an operator's export
     * of their own guest list silently short. A truncated export that says
     * nothing is worse than a slow one.
     *
     * So: page it, cap it, and say so when the cap is hit. Every number stays
     * exact up to the ceiling, no single response is unbounded, and past the
     * ceiling the client is told rather than misled.
     */
    const [ratings, contacts] = await Promise.all([
      readAll(svc, 'GuestRating', restaurant.id),
      readAll(svc, 'GuestContact', restaurant.id),
    ]);

    // Every guest email this restaurant holds, in one response. That is the
    // largest disclosure of other people's data the app performs, and "did
    // anyone export our guest list" needs an answer that is not a shrug.
    await audit({
      action: ACTIONS.GUESTS_EXPORTED,
      restaurantId: restaurant.id,
      actorUserId: user.id,
      detail: { row_count: contacts.rows.length },
    });

    return json({
      restaurant_id: restaurant.id,
      ratings: ratings.rows,
      contacts: contacts.rows,
      // Only present when a list actually hit the ceiling, so the ordinary
      // response is byte-for-byte what it was. A client that ignores this is no
      // worse off than before; one that reads it can stop claiming a number is
      // the whole picture when it is not.
      ...(ratings.truncated || contacts.truncated
        ? {
          truncated: {
            ...(ratings.truncated ? { ratings: DASHBOARD_MAX } : {}),
            ...(contacts.truncated ? { contacts: DASHBOARD_MAX } : {}),
          },
        }
        : {}),
    });
  },
};

export async function onRequestPost({ request, env, ctx, name }) {
  // Minted before anything can fail, so even a rejected body carries one. The
  // caller is shown this and the log line and the audit row both carry it, so
  // "it said error, request 4f2a91" is one query rather than a conversation.
  const id = requestId();
  const route = `fn/${name}`;

  const handler = HANDLERS[name];
  if (!handler) {
    return errorResponse(new AppError('unknown_function', `Unknown function: ${name}`, 404), { id, route });
  }

  // Which database this Worker talks to is a binding, not an import — see
  // worker/lib/data.js. An unrecognised value throws here rather than falling
  // back, so a typo in the cutover surfaces on the first request instead of
  // quietly leaving the app on the old database.
  let missing;
  try {
    missing = dataMisconfiguration(env);
  } catch (error) {
    return errorResponse(
      new AppError('misconfigured', 'Service misconfigured', 500, { detail: error.message }),
      { id, route },
    );
  }
  if (missing) {
    return errorResponse(
      new AppError('misconfigured', 'Service misconfigured', 500, { detail: missing }),
      { id, route },
    );
  }

  /**
   * A ceiling on the body, before anything reads it.
   *
   * `request.text()` was unbounded. Nothing here needs a large body — the
   * biggest legitimate one is a 50-item receipt with participants, a few tens
   * of kilobytes — but an anonymous caller could hand this endpoint tens of
   * megabytes and the Worker would buffer all of it and then JSON.parse it,
   * inside a 128 MB isolate, before a single validation ran. That is a cheap
   * way to burn CPU and memory on an endpoint that takes no credentials, and
   * three of the fourteen functions here are reachable without any.
   *
   * 256 KB is roughly ten times the largest real payload. Checked against the
   * declared length first so an oversized request is refused without reading
   * it, and against the actual text too, because Content-Length is the
   * client's claim and a chunked body carries none at all.
   */
  const MAX_BODY_BYTES = 256 * 1024;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorResponse(
      new AppError('body_too_large', 'That request is too large.', 413),
      { id, route },
    );
  }

  let body = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return errorResponse(
        new AppError('body_too_large', 'That request is too large.', 413),
        { id, route },
      );
    }
    if (raw) body = JSON.parse(raw);
  } catch {
    return errorResponse(new AppError('invalid_json', 'Invalid JSON', 400), { id, route });
  }

  // A JSON body that is not an object indexes nothing. Every handler destructures
  // fields off `body`, and `null` — valid JSON — makes each of them throw a
  // TypeError that surfaces as a 500 for what is plainly a bad request.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(
      new AppError('invalid_json', 'Expected a JSON object', 400),
      { id, route },
    );
  }

  /**
   * Recording an action, bound to this request.
   *
   * Handed to handlers rather than imported by them so the request id and the
   * request itself cannot be forgotten at a call site — the two fields that
   * make a row traceable are the two most easily left out.
   */
  const record = (entry) => recordAudit(env, ctx, { ...entry, request, requestId: id });

  try {
    const response = await handler({ request, env, body, audit: record, requestId: id });
    // On every response, not just failures. A support conversation usually
    // starts with something that succeeded and should not have.
    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', id);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    // The function name is in `route`, because these all answer on one path and
    // an unlabelled stack says nothing about which of the thirteen failed.
    return errorResponse(error, { id, route });
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
 * The host's view: everything about the split except the things that grant
 * control of it.
 *
 * host_key_hash never leaves the Worker. It is only a SHA-256 and so not
 * directly usable, but a hash handed to every client is a hash somebody will
 * eventually run a wordlist against, and there is no reason for it to travel.
 *
 * The same now applies per diner. participant_key_hash sits inside the
 * participants array, so the outer destructure walks straight past it and every
 * host response would have carried one hash per person at the table. The
 * argument against shipping the host's hash is not weaker for being made about
 * six smaller ones.
 */
function publicSession(session) {
  const { host_key_hash, ...rest } = session || {};
  if (!Array.isArray(rest.participants)) return rest;
  return {
    ...rest,
    participants: rest.participants.map((participant) => {
      const { participant_key_hash, ...safe } = participant || {};
      return safe;
    }),
  };
}
