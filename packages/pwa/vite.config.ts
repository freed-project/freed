import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import topLevelAwait from "vite-plugin-top-level-await";
import { VitePWA } from "vite-plugin-pwa";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import pkg from "./package.json" with { type: "json" };
import { getBuildMetadata } from "../../scripts/lib/build-metadata.mjs";

// Resolve workspace packages directly from their TypeScript source so that
// worktrees don't need to build dist/ artifacts before running the dev server.
const src = (name: string) =>
  fileURLToPath(new URL(`../${name}/src`, import.meta.url));

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const workspaceNodeModules = fileURLToPath(
  new URL("../../node_modules", import.meta.url),
);
const fsAllow = [
  workspaceRoot,
  workspaceNodeModules,
  (() => {
    try {
      return realpathSync(workspaceNodeModules);
    } catch {
      return workspaceNodeModules;
    }
  })(),
];

const buildMetadata = getBuildMetadata(pkg.version);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildMetadata.appVersion),
    __BUILD_KIND__: JSON.stringify(buildMetadata.buildKind),
    __BUILD_COMMIT_SHA__: JSON.stringify(buildMetadata.commitSha),
    __BUILD_COMMIT_REF__: JSON.stringify(buildMetadata.commitRef),
    __BUILD_DEPLOYED_AT__: JSON.stringify(buildMetadata.deployedAt),
  },
  resolve: {
    alias: {
      "@freed/capture-save": src("capture-save"),
      "@freed/ui": src("ui"),
      "@freed/shared": src("shared"),
      "@freed/sync": src("sync"),
    },
  },
  worker: {
    format: "es",
    plugins: () => [topLevelAwait()],
  },
  optimizeDeps: {
    exclude: ["maplibre-gl/dist/maplibre-gl-worker.mjs"],
  },
  server: {
    fs: {
      allow: fsAllow,
    },
  },
  build: {
    target: "esnext",
  },

  plugins: [
    {
      name: "reject-retired-automerge-assets",
      generateBundle(_options, bundle) {
        const retiredAssets = Object.keys(bundle).filter((fileName) =>
          fileName.toLowerCase().includes("automerge"),
        );
        if (retiredAssets.length > 0) {
          throw new Error(
            `The retired PWA Automerge runtime leaked into the production bundle: ${retiredAssets.join(", ")}`,
          );
        }
      },
    },
    topLevelAwait(),
    react(),
    VitePWA({
      // A stale app shell can reference hashed assets that no longer exist.
      // Activate new workers immediately so an obsolete shell cannot strand
      // the app before React is able to render an update prompt.
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: false,
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // API routes must bypass the service worker entirely — Workbox's
            // NetworkFirst strategy doesn't handle POST requests correctly and
            // will silently hang the fetch (no network request, no error).
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            // Article HTML cached by the PWA reader (Layer 2 for PWA devices).
            // CacheFirst: once cached, served offline indefinitely up to 30 days.
            // The PWA reader writes to this cache after a successful live fetch.
            urlPattern: ({ url }) => url.pathname.startsWith("/content/"),
            handler: "CacheFirst",
            options: {
              cacheName: "freed-articles-v1",
              expiration: {
                maxEntries: 5_000,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            // Saved reader HTML is pinned by user intent and has no time based
            // expiration. Manual cache clearing can still remove it.
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/pinned-content/"),
            handler: "CacheFirst",
            options: {
              cacheName: "freed-articles-pinned-v1",
              expiration: {
                maxEntries: 10_000,
              },
            },
          },
          {
            // Automerge relay sync -- NetworkFirst so we always attempt live sync
            // but fall back to last cached state when offline.
            urlPattern: ({ url }) => url.pathname === "/sync",
            handler: "NetworkFirst",
            options: {
              cacheName: "freed-sync-v1",
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "freed-images",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            // Catch-all for external resources (CDN, external APIs).
            // Same-origin fetches not matched above bypass the SW natively.
            urlPattern: /^https?:\/\/(?!freed-pwa)/,
            handler: "NetworkFirst",
            options: {
              cacheName: "freed-network",
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],

  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/vitest.setup.ts"],
  },
});
