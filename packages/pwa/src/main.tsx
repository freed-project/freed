import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { notifyUpdateAvailable } from './lib/pwa-updater'
import './index.css'
import App from './App.tsx'

registerSW({
  onNeedRefresh() {
    notifyUpdateAvailable()
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
