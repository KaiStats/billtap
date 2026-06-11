import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from "@sentry/react"
import App from '@/App.jsx'
import ErrorBoundary from '@/components/ErrorBoundary'
import '@/index.css'
import { registerServiceWorker } from '@/lib/registerServiceWorker'

Sentry.init({
  dsn: "https://2d6bc6bc301da49be092401a0c9eb90c@o4510642913607680.ingest.us.sentry.io/4511544951701504",
});

// Register PWA service worker for offline support and caching
registerServiceWorker().catch(err => console.error('Failed to register SW:', err))

ReactDOM.createRoot(document.getElementById('root')).render(
  <Sentry.ErrorBoundary fallback={
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-6 max-w-md">
        <h2 className="text-white font-bold text-lg mb-2">Something went wrong</h2>
        <p className="text-white/40 text-sm">Please refresh the page or try again later.</p>
      </div>
    </div>
  }>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </Sentry.ErrorBoundary>
)