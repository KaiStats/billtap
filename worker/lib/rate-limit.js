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
 * That is deliberate: the binding is committed commented out in wrangler.jsonc,
 * so a deploy cannot fail on a feature that may not be enabled for this account
 * — after a day of deploys failing for surprising reasons, adding another way
 * to fail was not worth it. Uncommenting is the whole activation.
 *
 * Application-level dedupe still stands regardless: rating-alert claims
 * GuestRating.alerted_at before sending, and createSession caps a restaurant at
 * 100 guest sessions an hour. This is the outer wall, not the only one.
 */

/** Public POST endpoints that take no credentials. */
const LIMITED = new Set([
  '/api/rating-alert',
  '/api/restaurant-lead',
  '/api/fn/createSession',
  '/api/fn/joinSession',
  '/api/fn/markMePaid',
  '/api/fn/submitGuestRating',
  '/api/fn/verifyQRToken',
  '/api/fn/getSplitStatus',
  // Every call spends money at the model provider, so this is worth a limit —
  // but a table is one NAT, so it is keyed per participant below rather than
  // per address.
  '/api/scan-receipt',
]);

/**
 * Base44's own auth endpoints, reached through the /api/apps/** proxy.
 *
 * These were not limited at all, and not by decision — worker/index.js hands
 * anything under /api/apps/ straight to the proxy and returns, so the check
 * below never ran for them. That left the two most worth protecting wide open:
 * reset-password-request sends an email to any address handed to it, which is a
 * way to bomb an inbox using this app's domain and its reputation, and
 * /auth/login is an unmetered guess-the-password endpoint.
 *
 * Matched by pattern because the app id sits in the middle of the path.
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
