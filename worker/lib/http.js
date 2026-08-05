/**
 * Outbound calls that give up.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 *
 * Twelve places in this Worker call fetch(). Eleven had no timeout of any kind,
 * and the twelfth — scan-receipt.js — wrote one by hand with the reason next to
 * it: "A scan that hangs is worse than one that fails: the diner is watching a
 * spinner and the table is waiting." That reasoning was correct and it applies
 * to every other call in the file list, none of which had it.
 *
 * A Worker's fetch does not time out on its own. A slow or wedged dependency —
 * PostgREST, the auth endpoint, Stripe, Twilio — holds the invocation open until
 * Cloudflare's own proxy timeout, roughly a hundred seconds. What that looks
 * like at a table is a diner tapping "I've sent it" and watching nothing happen
 * for over a minute, on a screen that polls every three seconds, so the failures
 * stack up behind each other.
 *
 * ── Why a shared helper rather than an AbortController per call site ────────
 *
 * Eleven hand-rolled controllers is eleven chances to forget the clearTimeout,
 * and a leaked timer in a Worker keeps the isolate alive. More to the point, the
 * budget is a decision worth seeing in one place: the numbers below say how long
 * this app is prepared to make somebody wait for each dependency, and that is
 * easier to argue with when it is a table than when it is scattered.
 */

/**
 * How long each dependency gets, in milliseconds.
 *
 * Set by who is waiting and what it costs to fail:
 *
 *   database   A diner is watching. Three of these can happen in one request
 *              (read, compare-and-swap, re-read), so the ceiling is a third of
 *              what the whole request can afford.
 *   auth       One round trip to /auth/v1/user, on the path of every call that
 *              needs an identity. Short: failing it returns null, which every
 *              handler already treats as the ordinary anonymous case.
 *   storage    Signing, listing and deleting receipt images. Nobody waits on
 *              the nightly ones; the signing call is on the upload path.
 *   audit      Fire-and-forget through waitUntil. Bounded so a wedged insert
 *              cannot hold an isolate open after the response has gone.
 *   email      Nobody is watching a spinner, but the caller is awaiting it.
 *   sms        Same, and it spends money, so a hang must not be retried by a
 *              client that gave up and tried again.
 *   payment    Stripe, on a checkout the operator is watching. The most
 *              patience here, because an abandoned checkout is worse than a
 *              slow one and Stripe is the least likely of these to be wrong.
 */
export const TIMEOUTS = {
  database: 10_000,
  auth: 5_000,
  storage: 15_000,
  audit: 5_000,
  email: 10_000,
  sms: 10_000,
  payment: 20_000,
};

/**
 * fetch(), with a deadline.
 *
 * Throws a TimeoutError on expiry rather than returning a synthetic response,
 * so a caller cannot mistake "gave up" for "answered". Every call site here
 * already has a catch that turns a thrown error into its own failure shape —
 * db.js into a DbError, email.js into { ok: false }, the handlers into a 502
 * through worker/lib/errors.js — so the distinction survives.
 *
 * The timer is always cleared, including on the throwing path. A stray
 * setTimeout in a Worker keeps the isolate from being reclaimed, which turns a
 * dependency being slow into this app being expensive.
 */
export async function fetchWithTimeout(url, init = {}, ms = TIMEOUTS.database) {
  // A caller that brought its own signal keeps it — scan-receipt.js has its own
  // controller and its own reason for the number it chose.
  if (init.signal) return fetch(url, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error(`Request timed out after ${ms}ms`);
      timeout.name = 'TimeoutError';
      timeout.timeout = ms;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
