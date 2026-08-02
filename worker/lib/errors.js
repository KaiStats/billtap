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
 * Whatever the caller is allowed to know about this failure.
 *
 * An AppError under 500 carries a message written to be read by a stranger. Any
 * other error — a TypeError, a thrown string, a database driver's complaint
 * naming a column — is replaced wholesale. That replacement is not politeness;
 * an unredacted upstream message is how a schema, a hostname or a customer's
 * email address ends up in somebody's browser console.
 */
export function publicShape(error, id) {
  if (error instanceof AppError && error.status < 500) {
    return {
      body: { error: error.message, code: error.code, request_id: id, ...(error.retry ? { retry: true } : {}) },
      status: error.status,
    };
  }
  if (error instanceof AppError) {
    return {
      body: {
        error: error.message || 'Something went wrong on our end.',
        code: error.code,
        request_id: id,
        ...(error.retry ? { retry: true } : {}),
      },
      status: error.status,
    };
  }
  return {
    body: {
      error: 'Something went wrong on our end. Nothing was charged or changed.',
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
 * The response, the log line, and the request id, from one call.
 *
 * Every catch block in the Worker should be this and nothing else. Where it is
 * not, the two halves drift: a message gets logged that was never sent, or sent
 * and never logged, and the request id stops meaning anything.
 */
export function errorResponse(error, { id = requestId(), route = 'unknown', extra = {} } = {}) {
  logError(error, { id, route, extra });
  const { body, status } = publicShape(error, id);
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
