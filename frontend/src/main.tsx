import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
// Self-hosted IBM Plex Sans (latin subset): Vite fingerprints the woff2
// files into /assets, cacheable AND service-worker cached for the offline shell.
import '@fontsource/ibm-plex-sans/latin-300.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/extras.css'
import { applyPrefs, loadPrefs } from './lib/prefs'

// Apply theme, density, and font tokens immediately on boot
applyPrefs(loadPrefs())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Application Error">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)

// Offline app shell: hashed /assets are cache-first, the
// HTML shell is network-first with a cache fallback, and /api/* is always
// passed straight to the network: business data offline behaviour stays
// entirely with the Dexie queue (lib/sync.ts).
if ('serviceWorker' in navigator && (import.meta.env.PROD || window.location.search.includes('sw=1'))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell unavailable: the app still works online */
    })
  })
}
