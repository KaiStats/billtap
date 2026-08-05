/**
 * Printing a caught error in the browser, without printing what is in it.
 *
 * ── The leak this closes ────────────────────────────────────────────────────
 *
 * `console.error("Failed to parse receipt:", err)` writes the error's message
 * AND its stack into the devtools console of every phone at the table. A
 * browser test found it: with /api/scan-receipt stubbed to answer 500 with an
 * internal body, the console printed a live connection string and two bundle
 * frames with line numbers.
 *
 * That is the same exposure the whole server-side error split exists to
 * prevent, arriving through a door nobody was watching, because "it's only the
 * console" reads as private and is not. It is one tap away on a phone, it is
 * captured by screen-recording and support tooling, and it is the first place
 * anyone looks when deciding whether an app is worth probing.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 *
 * The redacted sentence and the request id — the same two things the user is
 * shown — so a developer watching the console still sees which call failed and
 * can join it to the server's log line. The full object goes to Sentry, which
 * is storage the client cannot read.
 *
 * In development the raw error is printed as before, because there the console
 * IS the tool and there is no stranger holding the phone.
 */
import * as Sentry from '@sentry/react';
import { describeError } from '@/lib/errors';

/**
 * @param {string} what   what was being attempted, e.g. 'parse receipt'
 * @param {any} error     the caught thing
 * @param {object} [tags] extra Sentry tags
 */
export function logClientError(what, error, tags = undefined) {
  Sentry.captureException(error, tags ? { tags } : undefined);

  if (import.meta.env.DEV) {
    console.error(`Failed to ${what}:`, error);
    return;
  }

  const { message, requestId, code } = describeError(error);
  // One line, already redacted by describeError, plus the id that makes it
  // findable in the Worker's log and in the error_log table.
  console.error(`Failed to ${what}: ${message}${requestId ? ` (request ${requestId})` : ''}${code ? ` [${code}]` : ''}`);
}
