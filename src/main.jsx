import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerServiceWorker } from '@/lib/registerServiceWorker'

// Register PWA service worker for offline support and caching
registerServiceWorker().catch(err => console.error('Failed to register SW:', err))

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)