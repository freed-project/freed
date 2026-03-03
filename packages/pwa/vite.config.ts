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
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: false,
      workbox: {
        runtimeCaching: [
          {
            // API routes must bypass the service worker entirely — Workbox's
            // NetworkFirst strategy doesn't handle POST requests correctly and
            // will silently hang the fetch (no network request, no error).
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
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
