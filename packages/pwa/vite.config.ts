import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
//
// Note: @automerge/automerge's browser export condition is patched by
// scripts/patch-automerge.mjs (run via postinstall) to use fullfat_base64.js
// instead of fullfat_bundler.js, avoiding Vite 7's ESM WASM rejection.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: false, // use our own manifest.json in /public
      workbox: {
        // Cache strategies for different resource types
        runtimeCaching: [
          {
            // Feed images: cache-first, 30 day max age
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
            // API/fetch calls: network-first with cache fallback
            urlPattern: /^https?:\/\//,
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
        // App shell: precache all built assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // Skip waiting to activate new SW immediately
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: {
        // Enable PWA in dev for testing
        enabled: false,
      },
    }),
  ],

  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
