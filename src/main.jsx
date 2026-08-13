import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from "@sentry/react"
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'
import { registerServiceWorker } from '@/lib/registerServiceWorker'
import { ENVIRONMENT, DATABASE_REF } from '@/lib/environment'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Was hard-coded to "production". Every exception thrown on a laptop, in CI
  // or on a staging deploy arrived in the production feed looking exactly like
  // a diner's, which makes the feed useless for the thing it exists for:
  // knowing whether the live site is broken right now.
  environment: ENVIRONMENT,

  /**
   * Which build this frame came from.
   *
   * Injected by vite.config.js from one expression that also names the upload,
   * because a release that does not match the one the sourcemaps were uploaded
   * under is the single most common way sourcemaps look configured and resolve
   * nothing. Undefined in dev, where the source is not minified anyway.
   */
  release: typeof __SENTRY_RELEASE__ === 'string' ? __SENTRY_RELEASE__ : undefined,

  /**
   * ── Sampling, and what each rate is actually buying ────────────────────────
   *
   * These were 1.0 and 0.1, which are the values from Sentry's getting-started
   * page and not values anyone had multiplied out against this app.
   *
   * tracesSampleRate governs performance transactions, and
   * browserTracingIntegration below turns every fetch into a span. This app
   * polls: src/hooks/useLiveSplit calls the Worker every three seconds on every
   * phone at the table, so at 1.0 a five-person split sends a hundred spans a
   * minute, per table, for the length of a meal — a quota spent almost entirely
   * on the request that says nothing changed, and the instrumentation for it
   * running on a diner's phone. 10% of page loads still tells you if the app
   * got slower.
   *
   * replaysSessionSampleRate is the one that matters more, and it was recording
   * one session in ten of everybody. This is a bill-splitting app: the DOM it
   * captures is people's names, what they ordered and what they owe. Recording
   * a tenth of every table, indefinitely, to a third party, in case one of them
   * later reports a bug, is not a trade this product should be making silently.
   *
   * Zero here does not mean no replays. replaysOnErrorSampleRate stays at 1.0,
   * so a session that actually breaks is still recorded in full — which is the
   * only replay anybody has ever gone looking for.
   */
  tracesSampleRate: ENVIRONMENT === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  // Replay is added after boot instead of here — see attachSessionReplay below.
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value || "";
    if (msg.includes('WebSocket')) return null;
    return event;
  },
});

/**
 * Session Replay, loaded off the critical path.
 *
 * Listing replayIntegration() in integrations above pulled ~313 KB of parsed
 * source into the entry bundle and evaluated it before first paint — on every
 * page, including the marketing pages that exist to be fast. Deferring it to an
 * idle callback keeps the recording (replaysSessionSampleRate and
 * replaysOnErrorSampleRate above still apply) while letting the page render
 * first.
 *
 * The tradeoff: the first moments after boot are not recorded. For a session
 * replay used to reproduce user-reported bugs that is a fair trade; if you ever
 * need to debug something that happens during startup itself, move it back.
 */
function attachSessionReplay() {
  import('@/lib/sentry-replay')
    .then(({ default: replayIntegration }) => {
      Sentry.addIntegration(replayIntegration());
    })
    .catch(() => {
      // Offline, or an ad blocker eating anything named "sentry". Error
      // reporting keeps working; only replay is missing.
    });
}

/**
 * Wait for `load`, then for the main thread to go idle.
 *
 * Idle alone is not enough: the thread goes quiet while images are still in
 * flight, so a bare requestIdleCallback pulled the 123 KB chunk down at 363 ms,
 * competing with the hero image for bandwidth on the one page that most needs
 * it. Waiting for `load` first means replay never contends with anything the
 * user can see.
 */
function scheduleSessionReplay() {
  const whenIdle = () => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(attachSessionReplay, { timeout: 5000 });
    } else {
      // Safari has no requestIdleCallback.
      window.setTimeout(attachSessionReplay, 2000);
    }
  };

  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}

scheduleSessionReplay();

// Register PWA service worker for offline support and caching
registerServiceWorker().catch(err => console.error('Failed to register SW:', err))

// FIX 5: Mobile context for Sentry
Sentry.setContext("device", {
  is_mobile: /Mobi|Android/i.test(navigator.userAgent),
  screen_width: window.screen.width,
  screen_height: window.screen.height,
  pixel_ratio: window.devicePixelRatio,
  viewport_width: window.innerWidth,
  viewport_height: window.innerHeight,
  connection: navigator.connection?.effectiveType || 'unknown',
});
// Which database produced this error. Two environments' stack traces look
// identical; the project ref is the thing that tells them apart.
Sentry.setTag('database_ref', DATABASE_REF || 'unset');
Sentry.setTag('is_mobile', /Mobi|Android/i.test(navigator.userAgent));
Sentry.setTag(
  'browser',
  navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')
    ? 'ios_safari' : 'other'
);



ReactDOM.createRoot(document.getElementById('root')).render(
  <Sentry.ErrorBoundary fallback={({ error }) => (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem', color: '#f2f2f4', fontFamily: 'Inter, sans-serif', padding: '2rem', textAlign: 'center' }}>
      <div style={{ fontSize: '48px' }}>⚠️</div>
      <h2 style={{ color: '#00c896', fontSize: '24px', fontWeight: 700 }}>Something went wrong</h2>
      <p style={{ color: '#8b90a8', maxWidth: '400px' }}>We've been notified and are looking into it. Please refresh the page.</p>
      <button onClick={() => window.location.reload()} style={{ background: '#00c896', color: '#0a0e1a', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
        Refresh Page
      </button>
      <p style={{ color: '#4a5068', fontSize: '12px' }}>Error: {/** @type {any} */ (error)?.message}</p>
    </div>
  )}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </Sentry.ErrorBoundary>
)
