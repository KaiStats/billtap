/**
 * Session Replay, isolated behind a dynamic import.
 *
 * Replay is ~313 KB of parsed source — the single largest dependency in the
 * app, and it was being evaluated during boot on every page, including the
 * marketing pages where nobody is going to file a bug report.
 *
 * It lives in its own module for one reason: it is the only place
 * replayIntegration is referenced, so Rollup can put it in a separate chunk
 * instead of the entry bundle. Import this lazily and nothing else.
 *
 * Nothing here throws into the app. If the chunk fails to load — offline, a
 * blocked CDN, an ad blocker eating anything named "sentry" — error reporting
 * carries on without replay, which is exactly the tradeoff we want.
 */
import { replayIntegration } from '@sentry/react';

/**
 * ── Masking, stated rather than inherited ───────────────────────────────────
 *
 * This was `export default replayIntegration` — called with no options, so the
 * privacy of every recording rested on three library defaults. They are
 * currently the right ones: @sentry-internal/replay defaults maskAllText,
 * maskAllInputs and blockAllMedia to true, read out of the installed build
 * rather than assumed. That is exactly the problem. Nothing in this repo said
 * so, and nothing would notice if a version flipped one.
 *
 * What the DOM here contains is what makes it worth spelling out. This is a
 * bill-splitting app: a replay is people's names, what they ordered, what each
 * of them owes, and the host's payment handle. A default changing under a `^8`
 * range would start shipping all of it to a third party, and the first anyone
 * would know is on opening a replay and finding it legible.
 *
 * Written out, a Sentry upgrade that changes a default is either a diff in this
 * file or nothing at all. src/observability.test.mjs asserts all three are named.
 */
export default () => replayIntegration({
  maskAllText: true,
  maskAllInputs: true,
  blockAllMedia: true,
});
