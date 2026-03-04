import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    VitePWA({
      // autoUpdate: new service worker activates immediately without waiting for
      // user interaction. Combined with skipWaiting + clientsClaim below, every
      // deployment propagates to all open tabs on next page focus/load.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: false,
      workbox: {
        // Skip the waiting phase so the new SW activates the moment it installs,
        // rather than sitting in `waiting` until the user closes all tabs.
        skipWaiting: true,
        runtimeCaching: [
          {
            // API routes must bypass the service worker entirely — Workbox's
            // NetworkFirst strategy doesn't handle POST requests correctly and
            // will silently hang the fetch (no network request, no error).
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // Article HTML cached by the PWA reader (Layer 2 for PWA devices).
            // CacheFirst: once cached, served offline indefinitely up to 30 days.
            // The PWA reader writes to this cache after a successful live fetch.
            urlPattern: ({ url }) => url.pathname.startsWith('/content/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'freed-articles-v1',
              expiration: {
                maxEntries: 5_000,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            // Automerge relay sync -- NetworkFirst so we always attempt live sync
            // but fall back to last cached state when offline.
            urlPattern: ({ url }) => url.pathname === '/sync',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'freed-sync-v1',
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'freed-images',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            // Automerge WASM: cache-first, loaded once at startup.
            // Not precached because automerge emits a duplicate web/ WASM
            // via low_level.js that's never actually fetched at runtime.
            urlPattern: /\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'freed-wasm',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            // Catch-all for external resources (CDN, external APIs).
            // Same-origin fetches not matched above bypass the SW natively.
            urlPattern: /^https?:\/\/(?!freed-pwa)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'freed-network',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        clientsClaim: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],

  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
