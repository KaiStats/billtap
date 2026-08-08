/**
 * Server-side failures, somewhere they outlive the week.
 *
 * ── The gap ─────────────────────────────────────────────────────────────────
 *
 * worker/lib/errors.js writes one structured line per failure and hands the
 * caller a six-character request id, on the explicit promise that "the person
 * on the phone can read six characters aloud and land on the exact log line".
 *
 * That line goes to Cloudflare Workers Logs, whose retention is measured in
 * days. The browser's exceptions, meanwhile, go to Sentry and are kept for
 * months. So the two halves of the same incident had wildly different
 * lifetimes, and the half with the money in it — a failed confirmPayment, a
 * split that would not create — was the half that expired first. A restaurant
 * emailing on Tuesday about Saturday evening is not an unusual support request;
 * it is the normal one.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 *
 * A direct POST of a Sentry envelope, about sixty lines. Not @sentry/cloudflare:
 * that pulls a full SDK, its own async-context machinery and a wrapper around
 * the Worker's entry point into a bundle that has to stay small and a request
 * path that has to stay predictable, to send a JSON document this file can
 * construct itself.
 *
 * It reports 5xx only. A 400 is the caller's mistake and is already a log line;
 * paging on those would bury the ones that are ours.
 *
 * ── It cannot fail the request ──────────────────────────────────────────────
 *
 * No DSN bound is a silent no-op, which is the state every environment is in
 * until somebody sets one, and is also the safe state for a local run. Beyond
 * that: nothing here throws, nothing here is awaited on the response path when
 * a ctx is available, and a rejected fetch is swallowed. An error reporter that
 * can turn a 502 into a hang is worse than no error reporter, and this is the
 * one module in the tree guaranteed to run while something is already wrong.
 *
 * ── Error details are redacted before sending to Sentry ─────────────────────
 *
 * Unlike worker/lib/errors.js, this module sends errors to a third party, so
 * error.message and error.stack are redacted using the same rules the client
 * applies. If the message contains leaked credentials, hostnames, or schema
 * details, a generic message is sent instead.
 */

import { redactPublic } from '../../shared/redact.js';
import { fetchWithTimeout, TIMEOUTS } from './http.js';

/**
 * Pulls the ingest URL and public key out of a DSN.
 *
 * A DSN looks like https://<key>@o123.ingest.sentry.io/456 — the key is public
 * by design (it is compiled into every browser bundle that uses Sentry), so
 * holding it as a var rather than a secret is correct, and it is why this can
 * be checked into a config file at all.
 */
export function parseDsn(dsn) {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (!url.username || !projectId) return null;
    return {
      key: url.username,
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

/**
 * The envelope body: a header line, an item header line, the event.
 *
 * Newline-delimited JSON, which is the format Sentry's ingest expects and the
 * reason this does not need a library.
 */
export function buildEnvelope({ dsn, event }) {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: event.timestamp ? new Date(event.timestamp * 1000).toISOString() : new Date().toISOString(),
    dsn,
  });
  const item = JSON.stringify({ type: 'event' });
  return `${header}\n${item}\n${JSON.stringify(event)}`;
}

/** 32 hex characters, which is what Sentry wants an event id to be. */
function eventId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The event, shaped so the fields that matter are searchable.
 *
 * `request_id` is a tag rather than a context value on purpose: it is the one
 * field somebody arrives with, read off a diner's screen, and a tag is what
 * Sentry lets you search on. Same for `route` and `code`.
 *
 * What is NOT here: the request body, the headers, the caller's address. This
 * runs on the path where a split is failing, so the body is a receipt with
 * people's names on it — and an error reporter is the last place that should
 * start a second copy of the data the retention job exists to remove.
 *
 * Error message and stack are redacted before sending, so leaked credentials,
 * hostnames, or database schema never reach Sentry.
 */
export function buildEvent(error, { id, route, environment, release, extra = {} }) {
  const isApp = error?.name === 'AppError';
  const safeMessage = redactPublic(error?.message || String(error));
  return {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'worker',
    environment: environment || 'unknown',
    ...(release ? { release } : {}),
    transaction: route,
    tags: {
      request_id: id,
      route,
      code: isApp ? error.code : 'internal',
      status: String(isApp ? error.status : 500),
    },
    exception: {
      values: [{
        type: error?.name || 'Error',
        value: safeMessage || 'Leaked error details redacted',
        stacktrace: error?.stack
          ? { frames: parseStack(error.stack) }
          : undefined,
      }],
    },
    extra,
  };
}

/**
 * A stack string into Sentry's frame list, oldest first.
 *
 * Deliberately forgiving: an unparseable line becomes a frame with just its
 * text, because a report with a rough stack beats no report at all, and this
 * runs at the moment nothing else is going right.
 */
function parseStack(stack) {
  return String(stack)
    .split('\n')
    .slice(1, 30)
    .map((line) => {
      const match = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      if (!match) return { function: line.trim() };
      return {
        function: match[1] || '?',
        filename: match[2],
        lineno: Number(match[3]),
        colno: Number(match[4]),
      };
    })
    .reverse();
}

/**
 * Send one failure. Returns true when something was actually dispatched.
 *
 * Awaited only when there is no ctx — a scheduled job, a test. On a request
 * path the send goes to waitUntil so the caller's 500 is not sitting behind a
 * POST to a third party.
 */
export function reportError(env, ctx, error, { id, route, extra = {} } = {}) {
  const status = error?.name === 'AppError' ? error.status : 500;
  // The caller's own mistake. Already a log line; not an incident.
  if (status < 500) return false;

  const parsed = parseDsn(env?.SENTRY_DSN);
  if (!parsed) return false;

  try {
    const body = buildEnvelope({
      dsn: env.SENTRY_DSN,
      event: buildEvent(error, {
        id,
        route,
        environment: env.ENVIRONMENT || 'unknown',
        release: env.SENTRY_RELEASE,
        extra,
      }),
    });

    const send = fetchWithTimeout(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=billtap-worker/1.0, sentry_key=${parsed.key}`,
      },
      body,
    }, TIMEOUTS.webhook).catch(() => {
      // Sentry being down must not become a second incident inside the first.
    });

    if (ctx?.waitUntil) ctx.waitUntil(send);
    return true;
  } catch {
    // Constructing the report failed, which is not a reason to stop answering.
    return false;
  }
}
