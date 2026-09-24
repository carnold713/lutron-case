import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import './styles.css'

// Touch kiosk: a long press would otherwise open Chromium's context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Last line of defence: if the app itself throws, show a calm screen
        and reload shortly, rather than leave a blank page in public. */}
    <ErrorBoundary fallback={<div className="fatal" />} reloadAfterMs={5000}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
