import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.env.DEV) {
  Promise.all([import("./lib/store"), import("./lib/automerge")]).then(
    ([store, automerge]) => {
      const w = window as unknown as Record<string, unknown>
      w.__FREED_STORE__ = store.useAppStore
      w.__FREED_AUTOMERGE__ = automerge
    },
  )
}

// Keep viewport CSS variables in sync with the actual visible area.
// --visual-viewport-height: area above the software keyboard (and address bar).
//   Used to constrain overlay max-heights so content is never buried.
// --keyboard-height: software keyboard height only (not address bar).
//   Used to translateY the BottomSheet container up when the keyboard opens,
//   while keeping the container at 100lvh so its background bleeds to the
//   physical screen bottom (behind the Safari address bar).
function syncVisualViewport() {
  const vvh = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--visual-viewport-height', `${vvh}px`)
  document.documentElement.style.setProperty(
    '--keyboard-height',
    `${Math.max(0, window.innerHeight - vvh)}px`,
  )
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncVisualViewport)
  window.visualViewport.addEventListener('scroll', syncVisualViewport)
}
syncVisualViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
