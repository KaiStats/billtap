/**
 * Failures, deliberately rather than by default.
 *
 * ── What was wrong with the default ─────────────────────────────────────────
 *
 * Every one of the nine functions ended at the same line: catch anything,
 * console.error the message, return `{ error: 'Internal server error' }` with a
 * 500. That is three separate problems wearing one coat.
 *
 * A caller who mistypes an email and a caller who hits a database outage got
 * identical responses, so the app could not tell "fix your input" from "try
 * again in a minute" and showed the same dead end for both. Nothing tied the
 * message on someone's phone to the line in the logs, so "it said error" was
 * unactionable — and a diner cannot screenshot a stack trace. And a real bug
 * looked exactly like a rejected input, which is how a genuine outage sits
 * unnoticed inside normal-looking traffic.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A 4xx is the caller's to fix, so say precisely what is wrong.
 * A 5xx is ours, so say nothing beyond a request id — the detail goes to the
 * logs, where it cannot leak a table name, a key, or somebody's email address.
 *
 * Both carry a request id. That is the whole point: the person on the phone can
 * read six characters aloud and land on the exact log line.
 */

import { reportError } from './report.js';
import { recordError } from './error-log.js';
import { redactPublic, GENERIC } from '../../shared/redact.js';

/**
 * A short id for one request.
 *
 * Six characters, not a full uuid, because a human reads this off a screen and
 * says it out loud. 16^6 is ~17 million — collisions are possible and do not
 * matter, since it is only ever used to find recent log lines alongside a
 * timestamp and a route, never as a key.
 */
export function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * An error that knows what the caller should be told and what they should not.
 *
 * `code` is a stable machine-readable string. The browser switches on it — see
 * src/lib/errors.js — so changing one is a breaking change and adding one is
 * not. Never put a value in it; codes are a closed vocabulary, not a message.
 */
export class AppError extends Error {
  /**
   * @param code       stable identifier, e.g. 'session_expired'
   * @param message    shown to the caller when status < 500. Must be safe to
   *                   put on a stranger's screen.
   * @param status     HTTP status
   * @param options.detail   context for the logs only, never sent
   * @param options.retry    true when trying the same thing again may work
   */
  constructor(code, message, status = 400, { detail = null, retry = false } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.retry = retry;
  }
}

export const badRequest = (code, message, options) => new AppError(code, message, 400, options);
export const unauthorized = (code, message, options) => new AppError(code, message, 401, options);
export const forbidden = (code, message, options) => new AppError(code, message, 403, options);
export const notFound = (code, message, options) => new AppError(code, message, 404, options);
export const conflict = (code, message, options) => new AppError(code, message, 409, options);
export const gone = (code, message, options) => new AppError(code, message, 410, options);

/**
 * A dependency failed — the database, the model, the mail provider.
 *
 * 502 rather than 500 on purpose: it says the fault is downstream, and it is
 * the difference between a client that gives up and one that offers to retry.
 * Retryable by default, because that is what makes it worth distinguishing.
 */
export const upstream = (code, message, options = {}) =>
  new AppError(code, message, 502, { retry: true, ...options });

/**
 * ── The last line between an internal detail and a stranger's screen ────────
 *
 * Everything above is careful about *which* message goes out. This is careful
 * about what is *in* it, which is a different question and the one that gets
 * lost: publicShape sends an AppError's message verbatim, and that message is a
 * string a developer wrote months ago in a file nobody re-reads at review time.
 *
 * Two ways that goes wrong, neither hypothetical in a codebase this size. A
 * message built by interpolation — `Could not reach ${url}` — publishes a
 * hostname the moment somebody passes one. And publicShape's 5xx branch
 * returned `error.message` for any AppError at or above 500, contradicting the
 * rule at the top of this file ("a 5xx is ours, so say nothing beyond a request
 * id"). Nothing exploited that yet; a latent leak in the error path is still
 * the wrong thing to leave, because the error path is where the interesting
 * strings are.
 *
 * The patterns live in shared/redact.js because the browser needs them too.
 * src/lib/errors.js renders whatever arrives in `data.error`, and the Worker is
 * not the only thing that can put a string there — a browser test found a live
 * connection string reaching the screen through exactly that door.
 */

/**
 * True when a message had to be withheld, so the developer who wrote it finds
 * out. A leak caught silently is a leak that stays in the source.
 */
function noteRedaction(original, route) {
  console.error(JSON.stringify({
    level: 'error',
    redacted_public_message: true,
    route,
    // The original goes to the log, which is the whole point of the split: the
    // detail exists, it is simply not on the caller's screen.
    original,
  }));
}

/**
 * Whatever the caller is allowed to know about this failure.
 *
 * An AppError under 500 carries a message written to be read by a stranger. Any
 * other error — a TypeError, a thrown string, a database driver's complaint
 * naming a column — is replaced wholesale. That replacement is not politeness;
 * an unredacted upstream message is how a schema, a hostname or a customer's
 * email address ends up in somebody's browser console.
 */
export function publicShape(error, id, route = 'unknown') {
  if (error instanceof AppError) {
    // Applied to 4xx as much as 5xx. A 400 assembled by interpolation can
    // publish a hostname just as easily as a 502 can, and the caller-facing
    // sentence is the one place neither is ever acceptable.
    const safe = redactPublic(error.message);
    if (!safe && error.message) noteRedaction(error.message, route);

    return {
      body: {
        error: safe || (error.status < 500 ? 'That request could not be completed.' : GENERIC),
        code: error.code,
        request_id: id,
        ...(error.retry ? { retry: true } : {}),
      },
      status: error.status,
    };
  }

  // Anything that is not an AppError — a TypeError, a thrown string, a driver's
  // complaint naming a column — is replaced wholesale and never inspected. Its
  // message was not written for a stranger, so no amount of scanning makes it
  // safe to show one.
  return {
    body: {
      error: GENERIC,
      code: 'internal',
      request_id: id,
      retry: true,
    },
    status: 500,
  };
}

/**
 * One structured line per failure, for Cloudflare's log search.
 *
 * JSON rather than prose so `request_id` and `code` are queryable fields
 * instead of substrings someone has to grep for at the moment they are least
 * calm. The stack goes in only for the unexpected ones — an AppError is a
 * decision this code made on purpose, and its stack is noise.
 */
export function logError(error, { id, route, extra = {} }) {
  const line = {
    at: new Date().toISOString(),
    level: error instanceof AppError && error.status < 500 ? 'warn' : 'error',
    request_id: id,
    route,
    code: error instanceof AppError ? error.code : 'internal',
    status: error instanceof AppError ? error.status : 500,
    message: error?.message || String(error),
    ...(error instanceof AppError && error.detail ? { detail: error.detail } : {}),
    ...(error instanceof AppError ? {} : { stack: error?.stack?.split('\n').slice(0, 4).join(' | ') }),
    ...extra,
  };
  // Deliberately console.error even for a 4xx warn: Workers only ship
  // console.error and console.log to tail, and a 400 spike is a signal too —
  // it is usually a client bug or somebody probing.
  console.error(JSON.stringify(line));
}

/**
 * The response, the log line, the report, and the request id, from one call.
 *
 * Every catch block in the Worker should be this and nothing else. Where it is
 * not, the halves drift: a message gets logged that was never sent, or sent and
 * never logged, and the request id stops meaning anything.
 *
 * `env` and `ctx` are optional and only reach worker/lib/report.js, which sends
 * 5xx onward to Sentry so the incident outlives Cloudflare's log retention —
 * days, against the months the browser's half of the same incident gets. Both
 * absent means log-only, which is what a direct handler call in a test does and
 * what every environment does until a DSN is bound.
 */
export function errorResponse(
  error,
  {
    id = requestId(),
    route = 'unknown',
    extra = {},
    env = null,
    ctx = null,
    request = null,
    // Named for what it is rather than `body`, which is already the name of the
    // response body destructured out of publicShape below.
    requestBody = null,
  } = {},
) {
  logError(error, { id, route, extra });
  reportError(env, ctx, error, { id, route, extra });
  // The durable, queryable half. Cloudflare keeps the line above for days and
  // Sentry keeps the 5xx for months; this keeps everything for ninety and can
  // be filtered by date, route and severity. See worker/lib/error-log.js.
  recordError(env, ctx, error, { id, route, request, body: requestBody, method: request?.method });
  const { body, status } = publicShape(error, id, route);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      // On the response as well as in the body, so a failure with no parseable
      // body — a 502 from in front of the Worker, a truncated read — can still
      // be traced.
      'X-Request-Id': id,
    },
  });
}

// Re-exported so a caller does not have to know the list lives in shared/.
export { redactPublic, GENERIC };
