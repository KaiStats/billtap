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

export default replayIntegration;
