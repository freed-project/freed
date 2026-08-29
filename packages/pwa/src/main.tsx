import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapDocumentTheme } from '@freed/ui/lib/theme'
import {
  type Account,
  type Person,
  type ReachOutLog,
} from '@freed/shared'
import type {
  LibraryCoreDeviceContactQueryRequestV1,
  LibraryCoreDeviceContactSyncMutationV1,
} from '@freed/shared/library-core'
import './index.css'
import App from './App.tsx'
import { installConsoleBugReportCapture, installGlobalBugReportCapture } from '@freed/ui/lib/bug-report'

bootstrapDocumentTheme()

const previewLabel = import.meta.env.VITE_FREED_PREVIEW_LABEL?.trim() || ""

if (previewLabel) {
  document.title = `Freed Preview | ${previewLabel}`
}

if (import.meta.env.DEV) {
  void Promise.all([
    import("./lib/store"),
    import("./lib/library-core-runtime"),
    import("./lib/library-core-sqlite-runtime"),
  ]).then(([store, libraryCore, sqliteCore]) => {
    const w = window as unknown as Record<string, unknown>
    const settle = async () => {
      await libraryCore.ensurePwaLibraryCoreLocalSampleState()
      const preview = await import("./lib/library-core-preview-bootstrap")
      await preview.settlePwaLibraryCorePreviewIntents()
      const state = store.useAppStore.getState()
      store.useAppStore.setState({
        libraryItemVersion: (state.libraryItemVersion ?? 0) + 1,
        savedFeedVersion: (state.savedFeedVersion ?? 0) + 1,
        searchCorpusVersion: state.searchCorpusVersion + 1,
      })
    }
    const run = async (action: () => Promise<void>) => {
      await libraryCore.ensurePwaLibraryCoreLocalSampleState()
      await action()
      await settle()
    }
    w.__FREED_STORE__ = store.useAppStore
    w.__FREED_LIBRARY_CORE__ = {
      mutateDeviceContactSync: (
        mutation: LibraryCoreDeviceContactSyncMutationV1,
      ) => sqliteCore.mutatePwaDeviceContactSync(mutation),
      queryDeviceContacts: (
        query: LibraryCoreDeviceContactQueryRequestV1,
      ) => sqliteCore.queryPwaDeviceContacts(query),
      replacePerson: (person: Person, accounts: readonly Account[]) =>
        run(() => libraryCore.replacePwaLibraryCoreFriend(
          person,
          accounts,
        )),
      addAccount: (account: unknown) =>
        run(() => libraryCore.upsertPwaLibraryCoreAccount(account as Account)),
      appendReachOut: (personId: string, entry: ReachOutLog) =>
        run(() => libraryCore.appendPwaLibraryCorePersonReachOut(
          personId,
          entry,
        )),
      addItems: (items: unknown) =>
        run(() => store.useAppStore.getState().addItems(items as never)),
      addFeed: (feed: unknown) =>
        run(() => store.useAppStore.getState().addFeed(feed as never)),
      removeAllFeeds: (includeItems: boolean) =>
        run(() => store.useAppStore.getState().removeAllFeeds(includeItems)),
      facetSummary: async () => {
        await libraryCore.ensurePwaLibraryCoreLocalSampleState()
        return libraryCore.readPwaLibraryCoreFacetSummary()
      },
    }
  })
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

installGlobalBugReportCapture('pwa')
installConsoleBugReportCapture('pwa')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
