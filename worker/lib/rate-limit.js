/**
 * Per-IP rate limiting for the unauthenticated API surface.
 *
 * The audit put "WAF rate-limit rules on the five public /api routes" on the
 * ship-blocker list. This does it in code instead of the dashboard, so the
 * limits are versioned, reviewable, and travel with a fresh clone rather than
 * living as console state nobody can see in a diff.
 *
 * Why it matters here specifically: these endpoints have to be open. A diner
 * scanning a table tent has no account, so createSession, joinSession,
 * markMePaid, submitGuestRating and rating-alert all accept anonymous callers
 * by design. Anonymous and unbounded are different things — rating-alert sends
 * an SMS per call, and there is no spend cap on the Twilio account.
 *
 * Uses Cloudflare's native rate limiting binding, which needs no KV, no Durable
 * Object and no external store.
 *
 * ── Absent binding means no limiting ────────────────────────────────────────
 *
 * If API_RATE_LIMITER is not bound this returns null and the request proceeds.
 * That is deliberate: it means commenting the binding out of wrangler.jsonc is
 * a safe way to switch limiting off in a hurry, and that a deploy cannot fail
 * on a feature an account might not have.
 *
 * The binding is LIVE — see the block in wrangler.jsonc. This header used to
 * say it was committed commented out, which was true when it was written and
 * has not been since; a comment that describes a security control as off when
 * it is on is worth correcting, because the next person reads it before they
 * read the config.
 *
 * Application-level dedupe still stands regardless: rating-alert claims
 * GuestRating.alerted_at before sending, and createSession caps a restaurant at
 * 100 guest sessions an hour. This is the outer wall, not the only one.
 */

/**
 * Every /api endpoint metered here.
 *
 * It listed eight of the fourteen functions. Three of the six omissions are
 * added below; the other three are omitted on purpose and that is written out
 * underneath, because an unexplained gap in a list like this reads as an
 * oversight and gets "fixed" into an outage.
 *
 * getPublicRestaurant is an anonymous read keyed on a restaurant slug, and
 * slugs are public — they are in the URLs on the table tents — so this is the
 * one endpoint here where an attacker needs to guess nothing at all.
 * validateReceiptParse touches no database but runs arithmetic across a
 * caller-supplied array, so it is metered for CPU rather than for rows.
 * generateQRSignature mints an access grant and computes an HMAC.
 *
 * All three are called once per user action and never polled, so a per-address
 * limit cannot collide with normal use the way it would below.
 */
const LIMITED = new Set([
  '/api/rating-alert',
  '/api/restaurant-lead',
  '/api/fn/createSession',
  '/api/fn/joinSession',
  '/api/fn/markMePaid',
  '/api/fn/submitGuestRating',
  '/api/fn/verifyQRToken',
  '/api/fn/getSplitStatus',
  '/api/fn/getPublicRestaurant',
  '/api/fn/validateReceiptParse',
  '/api/fn/generateQRSignature',
  // Every call spends money at the model provider, so this is worth a limit —
  // but a table is one NAT, so it is keyed per participant below rather than
  // per address.
  '/api/scan-receipt',
]);

/**
 * ── Deliberately NOT limited: getSessionAsHost, confirmPayment,
 *    updateSplitSettings ─────────────────────────────────────────────────────
 *
 * These are the host's endpoints, and the case for metering them is real: each
 * loads a session row before it tests the host key, so a caller with no key can
 * make the Worker do database work. They are still left open, for two reasons
 * that outweigh it.
 *
 * The work is bounded and the ids are not guessable. Without a valid session id
 * the read is one primary-key lookup that returns nothing, and session ids are
 * not enumerable — an attacker cannot turn this into volume without already
 * knowing which bills to ask about.
 *
 * And metering them per address would break the product. src/hooks/useLiveSplit
 * polls getSessionAsHost every 3 seconds while a host screen is open — 20 calls
 * a minute, per host — and getSessionAsHost carries no participant id, so it
 * would key on CF-Connecting-IP. A restaurant's wifi is one NAT: three tables
 * with the host screen open exceed 60 a minute between them, doing nothing but
 * watching who has paid. That is the precise failure this file was rewritten to
 * avoid, and adding it back under the heading of hardening would be worse than
 * the gap.
 *
 * What would let them be metered safely: a bucket key these calls can supply
 * that is neither the address nor the host secret — a hash of the host key sent
 * as its own header, the way X-BillTap-Participant works for the diner-side
 * endpoints. Until that exists, this is the honest trade.
 */

/**
 * Base44's own auth endpoints, once reached through the /api/apps/** proxy.
 *
 * Kept as a matcher rather than deleted, and it is important to be honest about
 * why: the proxy is gone — worker/index.js answers everything under /api/ that
 * it does not recognise with a JSON 404 — so nothing matches these today and
 * they protect nothing. They stay because the patterns are the record of which
 * paths were unmetered and why it mattered (reset-password-request emails any
 * address handed to it; /auth/login is a password oracle), and because a
 * matcher costs nothing while a rediscovered proxy route would cost plenty.
 *
 * If Base44 is ever fully removed, remove these with it.
 */
const LIMITED_PATTERNS = [
  /^\/api\/apps\/[^/]+\/auth\/reset-password-request\/?$/,
  /^\/api\/apps\/[^/]+\/auth\/reset-password\/?$/,
  /^\/api\/apps\/[^/]+\/auth\/login\/?$/,
  /^\/api\/apps\/[^/]+\/auth\/register\/?$/,
  /^\/api\/apps\/[^/]+\/auth\/resend-otp\/?$/,
];

/** Whether this path is subject to a limit at all. */
export function isLimited(path) {
  return LIMITED.has(path) || LIMITED_PATTERNS.some((re) => re.test(path));
}

/**
 * Endpoints a whole table hammers at once, on one wifi connection.
 *
 * Keying these by IP punishes the exact scene the product is sold for. Six
 * people at a table are one CF-Connecting-IP, because the restaurant's wifi is
 * one NAT — and on a busy Friday it is every table in the room. Each of them
 * claiming five items, tapping paid, and their screens polling for who else has
 * settled runs to hundreds of calls a minute from a single address, all of it
 * legitimate. The first thing a per-IP limit would have done in production is
 * 429 a paying restaurant's diners mid-meal.
 *
 * So these are keyed per participant instead. That is weaker against a
 * determined attacker, who can mint a new participant id and get a fresh
 * bucket — accepted, because what they get for it is cheap database work that
 * is already bounded elsewhere: createSession caps a restaurant at 100 guest
 * splits an hour, a split holds at most 50 participants, and none of these
 * endpoints spends money.
 *
 * The endpoints that do spend money stay on the IP. rating-alert sends an SMS
 * per call against an account with no spend cap, restaurant-lead sends email,
 * createSession writes rows. Those are worth being strict about even at the
 * cost of an occasional false positive.
 */
const PER_PARTICIPANT = new Set([
  '/api/fn/joinSession',
  '/api/fn/markMePaid',
  '/api/fn/verifyQRToken',
  '/api/fn/getSplitStatus',
  '/api/scan-receipt',
]);

/**
 * The caller's address.
 *
 * CF-Connecting-IP is set by Cloudflare's edge and cannot be spoofed by the
 * client the way X-Forwarded-For can, so it is the only header worth keying on.
 */
function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/**
 * Participant ids are minted client-side, so this header is not a claim about
 * identity — it only decides which bucket the request counts against. The shape
 * check keeps one caller from spraying arbitrary keys, and anything that fails
 * it falls back to the address.
 */
const PARTICIPANT_RE = /^p_\d+_[a-z0-9]+$/;

function limitKey(request, path) {
  const ip = clientKey(request);
  if (!PER_PARTICIPANT.has(path)) return ip;
  const participant = request.headers.get('X-BillTap-Participant');
  return participant && PARTICIPANT_RE.test(participant) ? `p:${participant}` : ip;
}

/**
 * Returns a 429 Response when the caller is over the limit, or null to proceed.
 *
 * A limiter that throws must not take the endpoint down with it — being unable
 * to check the limit is not a reason to refuse a paying restaurant's diner.
 */
export async function rateLimit(request, env, path) {
  if (!isLimited(path)) return null;

  const limiter = env.API_RATE_LIMITER;
  if (!limiter) return null;

  try {
    const { success } = await limiter.limit({ key: limitKey(request, path) });
    if (success) return null;
  } catch (error) {
    console.error('rate-limit check failed, allowing request:', error?.message);
    return null;
  }

  return new Response(
    JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        // A real number, so a client can back off rather than hammer.
        'Retry-After': '60',
      },
    },
  );
}

export { LIMITED, LIMITED_PATTERNS, PER_PARTICIPANT, limitKey };
