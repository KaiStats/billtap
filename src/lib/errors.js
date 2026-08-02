/**
 * What the browser does with a failure.
 *
 * ── What was wrong with alert() ─────────────────────────────────────────────
 *
 * "Failed to process receipt. Please try again." in a modal dialog, nine times
 * across the app. Three problems with that, and they compound.
 *
 * It is not true often enough to be useful. The receipt failed because the
 * photo was too dark, or because the model timed out, or because the phone
 * dropped off the wifi mid-upload — and "try again" is correct advice for
 * exactly one of those.
 *
 * It blocks. An alert() is modal and freezes the page, on a phone, at a
 * restaurant table, usually while someone else is waiting to scan.
 *
 * It cannot be reported. There is nothing to screenshot but the sentence, so
 * "the app said error" is where every support conversation starts and stops.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 *
 * The Worker returns { error, code, request_id, retry } — see
 * worker/lib/errors.js. This turns that into three things a screen needs: what
 * to say, whether to offer a retry button, and the id to show underneath.
 */

/**
 * Advice worth giving, per error code.
 *
 * Only codes where the app genuinely knows something the server's message does
 * not — usually about what the person should do with their hands. Where the
 * server already wrote a good sentence, it wins; it has the amounts and the
 * names and this file does not.
 */
const ADVICE = {
  // The one failure a diner can actually fix, and the fix is physical.
  scan_unreadable: 'Try again with more light, and get the whole receipt in frame.',
  scan_timeout: 'The reader took too long. Try again, or enter the items by hand.',
  // Nothing they did. Say so, because the default assumption is that they broke it.
  internal: 'Nothing was charged or changed.',
  not_host: 'Ask whoever started this split to confirm it from their phone.',
  session_expired: 'Splits expire after 30 days. Start a new one.',
  rate_limited: 'Too many tries in a row. Wait a moment.',
};

/**
 * A thrown thing, turned into what a screen can render.
 *
 * @returns {{ message: string, code: string, requestId: string|null,
 *             retry: boolean, advice: string|null }}
 */
export function describeError(error) {
  // src/api/base44Client.js attaches the parsed body to `error.data` and the
  // status to `error.status`. Anything else is a network failure or a bug.
  const data = error?.data || {};
  const code = data.code || (error?.status ? 'http_error' : 'offline');

  if (code === 'offline') {
    return {
      // Distinguished from a server error on purpose: the action to take is
      // completely different, and telling someone with no signal to "try again"
      // is worse than telling them why.
      message: 'No connection.',
      code,
      requestId: null,
      retry: true,
      advice: 'Check your signal and try again — nothing was lost.',
    };
  }

  return {
    message: data.error || error?.message || 'Something went wrong.',
    code,
    requestId: data.request_id || null,
    // Absent means no. An unknown failure from an old deploy should not offer a
    // retry button that does nothing.
    retry: data.retry === true,
    advice: ADVICE[code] || null,
  };
}

/**
 * Whether trying the identical request again could plausibly work.
 *
 * A 4xx says the request was wrong, so repeating it produces the same 4xx —
 * with one exception, 429, which is a statement about timing rather than about
 * the request.
 */
export function isRetryable(error) {
  const status = error?.status;
  if (status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}
