import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { notifyUpdateAvailable, setUpdateSwCallback } from './lib/pwa-updater'
import './index.css'
import App from './App.tsx'

// Keep --visual-viewport-height in sync with the portion of the screen
// above the software keyboard. Falls back gracefully when visualViewport
// is unavailable (non-iOS or server-side render).
function syncVisualViewport() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--visual-viewport-height', `${h}px`)
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncVisualViewport)
  window.visualViewport.addEventListener('scroll', syncVisualViewport)
}
syncVisualViewport()

const updateSW = registerSW({
  onNeedRefresh() {
    notifyUpdateAvailable()
  },
  onOfflineReady() {
    console.log('[PWA] App ready for offline use')
  },
})
setUpdateSwCallback(updateSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
