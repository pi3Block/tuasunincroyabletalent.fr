import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Sentry error tracking (optional — enabled when VITE_SENTRY_DSN is set)
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
      release: 'voicejury-frontend@0.1.0',
      tracesSampleRate: 0.1,
    })
    console.log('[Sentry] Initialized for frontend')
  }).catch(() => {
    // @sentry/react not installed, skip silently
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
