import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from "@sentry/react"
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'
import { registerServiceWorker } from '@/lib/registerServiceWorker'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: "production",
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value || "";
    if (msg.includes('ws.base44.com')) return null;
    if (msg.includes('WebSocket')) return null;
    if (msg.includes('base44-preview')) return null;
    return event;
  },
});

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