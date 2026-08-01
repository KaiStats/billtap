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
 * Returns a 429 Response when the caller is over the limit, or null to proceed.
 *
 * A limiter that throws must not take the endpoint down with it — being unable
 * to check the limit is not a reason to refuse a paying restaurant's diner.
 */
export async function rateLimit(request, env, path) {
  if (!LIMITED.has(path)) return null;

  const limiter = env.API_RATE_LIMITER;
  if (!limiter) return null;

  try {
    const { success } = await limiter.limit({ key: clientKey(request) });
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

export { LIMITED };
