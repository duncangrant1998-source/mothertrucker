import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import ErrorFallback from './components/ErrorFallback.jsx'
import { initSentry } from './lib/sentry.js'

// Before createRoot, so a crash during the very first render is still caught
// and reported rather than happening while the SDK is uninstalled.
initSentry()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={ErrorFallback}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
