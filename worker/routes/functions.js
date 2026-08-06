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
import { serviceRole, currentUser, dataMisconfiguration, backendName } from '../lib/data.js';
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

// ── Restaurant settings ─────────────────────────────────────────────────────

/**
 * Where the line falls between "tell the operator" and "let it go public".
 *
 * `routed_to_google` is `stars > threshold`, so a threshold of four sends only
 * five-star guests to Google and hands everyone else to the operator first.
 *
 * It used to be three, which routed every four-star guest straight out. That is
 * the wrong side of the line twice over: it publishes a mediocre rating against
 * the average the restaurant is paying to raise, and it spends the one moment
 * that guest would have told them what was almost right — which is the half of
 * this product an operator cannot buy anywhere else.
 *
 * Changing it means changing it in five places at once: here, the client
 * fallback in src/components/RatingCapture.jsx, the dashboard form's initial
 * state, and the column default in both schema files. The server and the client
 * disagreeing about this is an operator not being paged about a rating the
 * screen told the guest was a complaint.
 */
export const DEFAULT_RATING_THRESHOLD = 4;

/**
 * The threshold a stored row actually means, as a number.
 *
 * One function because there were two readings of the same column and they did
 * not agree. `ownerView` coerced, on the grounds that `rating_threshold` is
 * `numeric` and a driver is entitled to hand that back as a string; the read in
 * submitGuestRating tested `Number.isFinite` on the raw value, which is false
 * for the string "3" — so the same row could be a three on the settings screen
 * and a four to the code deciding `routed_to_google`.
 *
 * That is the precise divergence every comment in this file says must not
 * exist: a guest shown "sorry about that, tell us more" whose rating went to
 * Google anyway, or an operator never paged about a complaint the app showed
 * the guest making. Whether any driver in this stack really does stringify a
 * numeric is beside the point — one of the two readings was wrong about it, and
 * a single function cannot be wrong in two directions at once.
 *
 * Null, undefined and empty are the default. Anything that will not coerce to a
 * finite number is the default too, rather than NaN — `stars > NaN` is false
 * for every rating, which would route nobody to Google and look like nothing
 * was wrong.
 */
export function ratingThreshold(value) {
  // Numbers and strings only, and `Number()` after that rather than around it.
  // `Number([])` is 0 and `Number(' ')` is 0, both finite, and zero is the one
  // value that must never be arrived at by accident: `routed_to_google` is
  // `stars > threshold`, so a zero publishes every rating to Google including
  // the one-star complaints this product exists to catch first.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return DEFAULT_RATING_THRESHOLD;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : DEFAULT_RATING_THRESHOLD;
  }
  if (typeof value !== 'number') return DEFAULT_RATING_THRESHOLD;
  return Number.isFinite(value) ? value : DEFAULT_RATING_THRESHOLD;
}

/** Days of trial a new restaurant starts with. Matches the copy on the form. */
const TRIAL_DAYS = 14;

/**
 * A url-safe name for the table tents.
 *
 * Apostrophes are removed rather than replaced. Every other punctuation mark
 * becomes a hyphen, which is right for "Fish & Chips" — but `Harry's` under that
 * rule is `harry-s`, and this string is printed on a card, read aloud down a
 * phone, and typed by hand when the QR does not scan. `harrys` is the name;
 * `harry-s` is a bug someone has to live with in print.
 *
 * Accents are folded for the same reason: `Café` becomes `cafe` rather than
 * `caf`, which is what dropping non-ascii would have produced.
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019`\u00b4]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Where a Google review link is allowed to land — host *and* path.
 *
 * RatingCapture.jsx calls `window.open` on this value, on a guest's phone,
 * moments after they scanned a QR code off a table. Unrestricted, the field is
 * a redirect to anywhere handed to strangers under the restaurant's name — and
 * it is reachable by any operator, and by anyone who claimed a restaurant
 * through the email trigger in supabase/migrations/0003. "Only an operator can
 * set it" is not a control when claiming a restaurant is an email away.
 *
 * ── Why the host alone is not the check ─────────────────────────────────────
 *
 * The first version of this allowed any path on any Google host, which let the
 * whole control be walked around without leaving Google:
 *
 *   https://www.google.com/url?q=https://evil.example  — Google's own
 *     off-site redirector. On an allowed host, and it goes anywhere.
 *   https://goo.gl/AbCdEf — a general-purpose shortener, not a Maps one. The
 *     destination is whatever the person who minted it chose.
 *
 * So `goo.gl` is gone (Google stopped serving those links in 2025 in any case)
 * and every remaining host carries a path rule. The property being enforced is
 * not "this is a Google domain" — it is "this lands on a Google review or Maps
 * page", which is the only thing a guest tapping "Leave a review" consented to.
 *
 * `maps.app.goo.gl` stays: those are minted by Google's own Maps share sheet
 * and resolve into Maps, so the destination space is not caller-chosen the way
 * a goo.gl short link's is. `business.google.com` is gone too — it is the
 * operator's admin console, never somewhere to send a guest.
 *
 * The TLD pattern is tightened to com / <cc> / co.<cc> / com.<cc>, which is
 * where a "Write a review" link from a localised Maps ends up. The old
 * `[a-z]{2,3}` also matched things like google.zip and google.top.
 */
const GOOGLE_TLD = String.raw`(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})`;
const GOOGLE_LINK_RULES = [
  // Business Profile short links: g.page/r/<cid>/review, g.page/<name>/review.
  { host: /^(?:www\.)?g\.page$/, path: /^\/[\w-]+(?:\/[\w-]+)*\/?$/ },
  // Maps share links.
  { host: /^maps\.app\.goo\.gl$/, path: /^\/[\w-]+\/?$/ },
  // The "Write a review" form itself — the shape a place_id link takes.
  { host: /^search\.google\.com$/, path: /^\/local\/writereview\/?$/ },
  // Maps place pages on google.com and its country variants.
  { host: new RegExp(String.raw`^(?:www\.)?google\.${GOOGLE_TLD}$`), path: /^\/maps(?:\/|$)/ },
  // maps.google.<tld>, where the place is usually in the query string.
  { host: new RegExp(String.raw`^maps\.google\.${GOOGLE_TLD}$`), path: /^\/(?:maps(?:\/|$))?$/ },
];

/**
 * True for an https link that lands on a Google review or Maps page.
 *
 * Exported so the test can assert the refusals directly — the interesting
 * cases are all strings the endpoint must say no to, and reaching them through
 * an HTTP round trip would only obscure which one failed.
 */
export function isGoogleReviewUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  // `https://google.com@evil.example/` parses with evil.example as the host and
  // google.com as a username. Refusing any userinfo at all is cheaper than
  // reasoning about it.
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  return GOOGLE_LINK_RULES.some((rule) => rule.host.test(host) && rule.path.test(path));
}

/**
 * The fields an operator may set on their own restaurant, and only those.
 *
 * One validator for both the create and the update path. Two would drift, and
 * the direction they drift in is predictable: the create path is written first,
 * the update path is written under time pressure later, and the field that ends
 * up unchecked is whichever one was added last.
 *
 * Everything else on the row is server-owned and silently ignored when sent:
 * `plan` and `trial_ends_at` are what the operator is being billed on,
 * the Stripe ids are what the billing routes match against, `owner_id` is the
 * answer to "whose restaurant is this", and the slug is on printed cards. A
 * request carrying any of them is not refused — a browser sending back the row
 * it was given should not fail — it just does not get to set them.
 *
 * @returns {{ error: string } | { patch: object, fields: string[] }}
 */
export function restaurantPatch(body, { creating = false } = {}) {
  const patch = {};
  const fields = [];
  const has = (key) => body?.[key] !== undefined && body?.[key] !== null;

  if (creating || has('name')) {
    const name = clean(body?.name, 80);
    if (!name) return { error: 'Give the restaurant a name.' };
    patch.name = name;
    fields.push('name');
  }

  if (has('google_review_url')) {
    const raw = clean(body.google_review_url, 500);
    if (!raw) {
      // An empty string is "clear it", which is a legitimate thing to want:
      // it puts the Google handoff back to disabled rather than pointing it
      // somewhere stale.
      patch.google_review_url = null;
    } else if (!isGoogleReviewUrl(raw)) {
      return {
        error: 'That has to be an https link to Google — the "Share review form" '
          + 'link from your Google Business profile, which looks like https://g.page/r/…/review.',
      };
    } else {
      patch.google_review_url = raw;
    }
    fields.push('google_review_url');
  }

  if (has('alert_email')) {
    const email = clean(body.alert_email, 200).toLowerCase();
    if (email && !EMAIL_RE.test(email)) return { error: "That alert email doesn't look right." };
    patch.alert_email = email || null;
    fields.push('alert_email');
  }

  if (has('alert_phone')) {
    const phone = clean(body.alert_phone, 32);
    // Digits and the punctuation people write phone numbers with. Loose enough
    // for an international number, tight enough that the field is not a free
    // text column on a row the alert path reads.
    if (phone && !/^\+?[\d\s().-]{7,32}$/.test(phone)) {
      return { error: "That phone number doesn't look right." };
    }
    patch.alert_phone = phone || null;
    fields.push('alert_phone');
  }

  if (has('rating_threshold')) {
    const threshold = Number(body.rating_threshold);
    // One to four, matching the form. Five would mean nothing is ever routed to
    // Google, which is the product switched off rather than configured, and a
    // value the dashboard cannot produce should not arrive by another door.
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 4) {
      return { error: 'Alert threshold must be between 1 and 4 stars.' };
    }
    patch.rating_threshold = threshold;
    fields.push('rating_threshold');
  }

  return { patch, fields };
}

/**
 * The operator's own view of their restaurant.
 *
 * An allow-list rather than a spread, for the same reason getPublicRestaurant
 * is one: this row also holds `owner_id`, `legacy_owner_id` and the two Stripe
 * ids. The operator is entitled to more of their row than a guest is, and still
 * not to those — a Stripe subscription id in a browser is a support call away
 * from being pasted into a chat window.
 */
export function ownerView(r) {
  return {
    id: r.id,
    name: r.name ?? '',
    slug: r.slug,
    google_review_url: r.google_review_url ?? null,
    alert_email: r.alert_email ?? null,
    alert_phone: r.alert_phone ?? null,
    rating_threshold: ratingThreshold(r.rating_threshold),
    plan: r.plan ?? 'trial',
    trial_ends_at: r.trial_ends_at ?? null,
    current_period_end: r.current_period_end ?? null,
  };
}

/**
 * A slug nobody else holds, or null.
 *
 * Checked as service role against every restaurant, not through the caller's
 * own view. An owner-scoped read would find only their own rows, so every other
 * restaurant's slug would come back free — and two restaurants sharing a slug
 * means one of them has table tents pointing at the other's listing.
 *
 * The check is not the guarantee — the unique index on `restaurants.slug` is.
 * Two operators creating the same name in the same second can both be told a
 * slug is free, and the second insert then fails and surfaces as a 500 they
 * retry, at which point the slug really is taken and they get the suffix. That
 * is the right way round: the loser of the race sees an error and tries again,
 * rather than both of them succeeding and one restaurant's printed cards
 * resolving to the other's page.
 */
async function reserveSlug(svc, name) {
  const base = slugify(name);
  // A name that survives slugify as nothing — 北京烤鸭, or a name that is all
  // punctuation — used to fall back to the bare word `restaurant`, which hands
  // the first such operator /r/restaurant and the second /r/restaurant-2. The
  // first is worse than the second: it reads like a placeholder somebody forgot
  // to fill in, and it is claimed first-come by whoever signs up earliest.
  //
  // A random tail is not a good slug either — nothing here can make one out of
  // a name with no ascii in it. It is only the honest version: unmistakably
  // machine-assigned, so the operator asks for a real one instead of printing
  // it on a table tent believing we chose it. Giving them a way to choose is
  // the actual fix and it is a product decision, not a rename in this function.
  const candidates = [];
  if (base) {
    candidates.push(base);
    for (let n = 2; n <= 9; n += 1) candidates.push(`${base.slice(0, 37)}-${n}`);
    // A short random tail after the numbered ones, so a popular name does not
    // depend on nine sequential round trips being enough.
    for (let n = 0; n < 3; n += 1) {
      candidates.push(`${base.slice(0, 35)}-${crypto.randomUUID().slice(0, 4)}`);
    }
  } else {
    // Never the bare word, and never a leading hyphen either — `-a1b2` is what
    // the numbered branch produces when base is empty.
    for (let n = 0; n < 4; n += 1) {
      candidates.push(`restaurant-${crypto.randomUUID().slice(0, 6)}`);
    }
  }

  for (const candidate of candidates) {
    const taken = await svc.entity('Restaurant').filter({ slug: candidate });
    if (!taken.length) return candidate;
  }
  return null;
}

/**
 * The caller's restaurant: the one they own, or an unclaimed one that is
 * theirs by email and has been waiting for them.
 *
 * ── The failure this exists to stop ─────────────────────────────────────────
 *
 * Ownership is `owner_id`, and a row created by hand in SQL has none. The
 * trigger in migration 0003 is what normally fills it in, and it does not fire
 * here for two reasons at once: it only matches rows carrying a
 * `legacy_owner_id` (a hand-made row has none), and it only fires on INSERT
 * into auth.users (an operator who already has an account will never insert
 * again).
 *
 * Mariposa is both of those. Without this, its GM signs in, is shown the
 * *create* form because nothing matches his owner_id, types the name he already
 * has, and gets a second restaurant on `mariposa-2`. Every table tent already
 * printed points at `/r/mariposa` — the row he no longer owns — so his ratings
 * and his alerts go on landing there while his dashboard reads zero forever.
 * Nobody finds out from an error; they find out from a month of silence.
 *
 * ── Why claiming by email is not a new key to anything ──────────────────────
 *
 * This is the same trust model migration 0003 already documents and the same
 * one magic-link sign-in has by construction: whoever controls the inbox can
 * hold a session as that address regardless, so matching on it grants nothing
 * that was not already reachable. What changes here is only *when* it can
 * happen — at any sign-in rather than only at the first one.
 *
 * The blast radius is the same as 0003's, for the same reason: only a row with
 * `owner_id` null is adoptable, and every row this endpoint creates sets
 * `owner_id` at creation. A restaurant that has an owner cannot be taken from
 * them by anyone, through here or anywhere else.
 *
 * Both lookups resolve oldest-first. `filter()` sends no `order` unless asked
 * and PostgREST is under no obligation to be consistent without one, so an
 * operator who somehow has two rows should at least see the same one on every
 * request rather than flipping between them — which is the difference between
 * a duplicate that can be merged by hand and one whose dashboard changes
 * between refreshes.
 */
async function findOrAdoptRestaurant(svc, user, audit = NO_AUDIT) {
  const owned = await svc.entity('Restaurant')
    .filter({ owner_id: user.id }, { order: 'created_date' });
  if (owned[0]) return owned[0];

  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!email) return null;

  // Matched on the address in the database and narrowed to unclaimed here,
  // rather than sending `owner_id=is.null` — worker/lib/base44.js cannot
  // express an operator and refuses rather than silently answering with
  // everything, so a query shaped that way would work on Supabase and throw on
  // the other backend. The read is still one indexed lookup: the rows sharing
  // an alert_email are one restaurant's, not a table scan.
  //
  // `alert_email` is stored lowercased — restaurantPatch lowercases every write
  // and migration 0010 folded the rows that predate it — so this is an exact
  // match rather than a pattern, and no address containing a `%` or a `_` can
  // widen it.
  const sharing = await svc.entity('Restaurant').filter({ alert_email: email });
  const orphan = sharing
    .filter((row) => row.owner_id === null || row.owner_id === undefined)
    .sort((a, b) => String(a.created_date ?? '').localeCompare(String(b.created_date ?? '')))[0];
  if (!orphan) return null;

  const claimed = await svc.entity('Restaurant').update(orphan.id, { owner_id: user.id });
  await audit({
    action: ACTIONS.RESTAURANT_CLAIMED,
    restaurantId: orphan.id,
    actorUserId: user.id,
    detail: { slug: orphan.slug },
  });
  return claimed || { ...orphan, owner_id: user.id };
}

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
        // The third reading of this column, and the one RatingCapture decides
        // which screen a guest sees from. Through the same function as the
        // other two: the guest-facing branch and the server's routed_to_google
        // disagreeing is the failure ratingThreshold exists to make impossible.
        rating_threshold: ratingThreshold(r.rating_threshold),
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

      // Ownership against the stored row, not the database's view of the caller.
      // This read used to go through asCaller. sessions has RLS on and no
      // policies, so a caller-scoped select returns zero rows for everybody and
      // every signed-in host got "Session not found" for their own split.
      const mine = await serviceRole(env).entity('Session').filter({ id: session_id });
      if (!mine.length) return json({ error: 'Session not found' }, 404);
      // Same 404 as a missing split: whether a session id exists is not
      // something a stranger needs confirmed.
      if (mine[0].created_by_id !== user.id) return json({ error: 'Session not found' }, 404);
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

      let threshold = DEFAULT_RATING_THRESHOLD;
      try {
        const rows = await svc.entity('Restaurant').filter({ id: session.restaurant_id });
        // Through the same reading ownerView uses, so the number deciding
        // routed_to_google here and the number the settings screen shows the
        // operator are the same number. See ratingThreshold.
        if (rows[0]) threshold = ratingThreshold(rows[0].rating_threshold);
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

    // Always the service role, with the owner stamped explicitly below.
    // This was `user ? asCaller(env, request) : svc`, which was right against
    // Base44 (it stamped created_by_id from the caller's token) and wrong
    // against Supabase: sessions is RLS-on with no policies, so the insert ran
    // as `authenticated` against a default-deny table and returned 42501.
    // A guest could create a split and a signed-in operator could not.
    const writer = svc;

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
      // Nothing else fills this in any more. It is what puts the split in the
      // operator dashboard and what isHost() falls back to without a host key.
      // From the verified user, never from the request body.
      created_by_id: user?.id || null,
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
   * Create the caller's restaurant, or patch it. The settings pane's write half.
   *
   * ── Why this did not exist ────────────────────────────────────────────────
   *
   * The dashboard used to create and patch Restaurant rows straight from the
   * browser through the Base44 SDK. Deleting Base44 took that path with it and
   * nothing replaced it, so the settings form has been refusing both of its
   * writes and telling operators to send an email. That is not a missing
   * nicety: `google_review_url` lives here, RatingCapture disables the Google
   * handoff without one, and so a new restaurant puts tents on its tables,
   * sends every happy guest to a dead button, and never sees a review. It also
   * holds `alert_email`, so nobody can self-onboard into being paged at all.
   *
   * ── Ownership is never in the body ────────────────────────────────────────
   *
   * This is the question that stopped it being written during the cutover, and
   * the answer is to remove it rather than to check it. There is no id
   * parameter. The row is found by `owner_id` from the signed-in user, so there
   * is nothing to tamper with and no way to address someone else's restaurant —
   * not by guessing an id, not by sending one back that was never yours. An
   * operator has exactly one restaurant reachable from here: their own, or the
   * one they are about to create.
   *
   * Everything server-owned is dropped rather than refused — see
   * restaurantPatch. The slug in particular is assigned once and a rename does
   * not move it: `/r/<slug>` is encoded in printed table tents, and a slug that
   * followed the name would 404 every card already sitting on a table.
   */
  async saveMyRestaurant({ env, request, body, audit = NO_AUDIT }) {
    const user = await currentUser(env, request);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const svc = serviceRole(env);
    // Adopts an unclaimed row that is already this operator's before deciding
    // this is a create — otherwise a hand-made row goes on existing beside the
    // duplicate this would have minted. See findOrAdoptRestaurant.
    const existing = await findOrAdoptRestaurant(svc, user, audit);

    const parsed = restaurantPatch(body, { creating: !existing });
    if (parsed.error) return json({ error: parsed.error }, 400);
    const { patch, fields } = parsed;

    if (!existing) {
      const slug = await reserveSlug(svc, patch.name);
      if (!slug) {
        return json({ error: 'Could not reserve a web address for that name. Try a different one.' }, 409);
      }

      const row = await svc.entity('Restaurant').create({
        ...patch,
        slug,
        owner_id: user.id,
        // The address the operator signed in with, when they did not give one.
        // It is also what migration 0003 matches a migrated restaurant on, so
        // leaving it empty would quietly cost them the claim as well as the
        // alerts.
        alert_email: patch.alert_email ?? (user.email || null),
        rating_threshold: patch.rating_threshold ?? DEFAULT_RATING_THRESHOLD,
        plan: 'trial',
        trial_ends_at: Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
        created_at: Date.now(),
      });

      await audit({
        action: ACTIONS.RESTAURANT_CREATED,
        restaurantId: row.id,
        actorUserId: user.id,
        detail: { slug, fields: fields.join(',') },
      });
      return json({ restaurant: ownerView(row) });
    }

    // Nothing to write. Answering with the current row rather than a 400 keeps
    // a save that changed nothing from reading as a failure on the screen.
    if (!fields.length) return json({ restaurant: ownerView(existing) });

    const row = await svc.entity('Restaurant').update(existing.id, patch);
    await audit({
      action: ACTIONS.RESTAURANT_UPDATED,
      restaurantId: existing.id,
      actorUserId: user.id,
      // Which columns moved, never what they moved to: alert_email and the
      // review URL are both in this list.
      detail: { fields: fields.join(',') },
    });
    return json({ restaurant: ownerView(row || { ...existing, ...patch }) });
  },

  /**
   * Does the caller own a restaurant, and what is it called.
   *
   * ── Why this is not getRestaurantDashboardData ────────────────────────────
   *
   * The screen asking is /profile, and all it needs is whether to draw a link.
   * getRestaurantDashboardData answers the same question and would be the wrong
   * way to ask it twice over: it pages every rating and every contact the
   * restaurant has, on a screen that shows none of them, and it writes a
   * `guests.exported` audit row every time it runs.
   *
   * That second one is the worse half. That row exists so "did anyone export
   * our guest list" has an answer. Firing it on a profile page load would bury
   * the real exports under navigation noise and quietly destroy the only signal
   * there is.
   *
   * ── Why it adopts ─────────────────────────────────────────────────────────
   *
   * Through findOrAdoptRestaurant, like the other two entry points. A row made
   * by hand has no owner_id until something claims it, and the claim was
   * reachable only from a screen the operator had no way to find — which is the
   * whole reason this endpoint exists. Leaving adoption out would withhold the
   * link from exactly the people who cannot get there without it.
   */
  async getMyRestaurantSummary({ env, request, audit = NO_AUDIT }) {
    const user = await currentUser(env, request);
    // Not a 401. This is asked in order to decide whether to draw a link, and
    // an anonymous caller is an ordinary diner rather than a failure.
    if (!user) return json({ restaurant: null });

    const restaurant = await findOrAdoptRestaurant(serviceRole(env), user, audit);
    // Two fields: what to label the link, and nothing else. A response this
    // cheap to ask for should not carry a row.
    return json({
      restaurant: restaurant ? { slug: restaurant.slug, name: restaurant.name ?? '' } : null,
    });
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
    // The same lookup the write path uses, so an operator whose row was made by
    // hand sees their restaurant on the first load rather than a create form
    // offering to make them a second one.
    const restaurant = await findOrAdoptRestaurant(svc, user, audit);
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
      // The read half the settings form never had. Without it the form had
      // nothing to populate from and no way to show an operator what is
      // currently set — which is the other half of why the pane was inert.
      //
      // Allow-listed by ownerView, not spread: the Stripe ids and owner_id do
      // not travel to a browser just because the caller owns the row.
      restaurant: ownerView(restaurant),
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
    return errorResponse(new AppError('unknown_function', `Unknown function: ${name}`, 404), { id, route, env, ctx, request });
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
      { id, route, env, ctx, request },
    );
  }
  if (missing) {
    return errorResponse(
      new AppError('misconfigured', 'Service misconfigured', 500, { detail: missing }),
      { id, route, env, ctx, request },
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
      { id, route, env, ctx, request },
    );
  }

  let body = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return errorResponse(
        new AppError('body_too_large', 'That request is too large.', 413),
        { id, route, env, ctx, request, requestBody: body },
      );
    }
    if (raw) body = JSON.parse(raw);
  } catch {
    return errorResponse(new AppError('invalid_json', 'Invalid JSON', 400), { id, route, env, ctx, request, requestBody: body });
  }

  // A JSON body that is not an object indexes nothing. Every handler destructures
  // fields off `body`, and `null` — valid JSON — makes each of them throw a
  // TypeError that surfaces as a 500 for what is plainly a bad request.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(
      new AppError('invalid_json', 'Expected a JSON object', 400),
      { id, route, env, ctx, request, requestBody: body },
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
    return errorResponse(error, { id, route, env, ctx, request, requestBody: body });
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
