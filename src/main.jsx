import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from "@sentry/react"
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'
import { registerServiceWorker } from '@/lib/registerServiceWorker'
import { ENVIRONMENT, APP_ID } from '@/lib/environment'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Was hard-coded to "production". Every exception thrown on a laptop, in CI
  // or on a staging deploy arrived in the production feed looking exactly like
  // a diner's, which makes the feed useless for the thing it exists for:
  // knowing whether the live site is broken right now.
  environment: ENVIRONMENT,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  // Replay is added after boot instead of here — see attachSessionReplay below.
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value || "";
    if (msg.includes('ws.base44.com')) return null;
    if (msg.includes('WebSocket')) return null;
    if (msg.includes('base44-preview')) return null;
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
// identical; the app id is the thing that tells them apart.
Sentry.setTag('base44_app_id', APP_ID || 'unset');
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
      <p style={{ color: '#4a5068', fontSize: '12px' }}>Error: {error?.message}</p>
    </div>
  )}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </Sentry.ErrorBoundary>
)