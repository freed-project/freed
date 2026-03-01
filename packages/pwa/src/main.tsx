import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Register service worker with auto-update
registerSW({
  onNeedRefresh() {
    // New content available — auto-update silently in background
    console.log('[PWA] New version available, updating...')
  },
  onOfflineReady() {
    console.log('[PWA] App ready for offline use')
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
