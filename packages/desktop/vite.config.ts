import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "url";
import pkg from "./package.json" with { type: "json" };

// Resolve workspace packages directly from their TypeScript source so that
// worktrees don't need to build dist/ artifacts before running the dev server.
const src = (name: string) =>
  fileURLToPath(new URL(`../${name}/src`, import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@freed/ui': src('ui'),
      '@freed/shared': src('shared'),
      '@freed/sync': src('sync'),
      '@freed/capture-rss': src('capture-rss'),
      '@freed/capture-x': src('capture-x'),
      '@freed/capture-save': src('capture-save'),
      '@freed/capture-facebook': src('capture-facebook'),
      '@freed/capture-instagram': src('capture-instagram'),
    },
  },
  plugins: [wasm(), topLevelAwait(), react()],

  // Tauri development server
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Optimize for Tauri
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  // Unit test configuration
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    // Polyfill Blob.prototype.text (missing from jsdom's older Blob spec).
    setupFiles: ["./src/vitest.setup.ts"],
    // Tauri IPC and plugins are unavailable in the test environment, so we
    // mock their modules via vi.mock() inside each test file.
    globals: true,
    // Force workspace packages through vitest's transform pipeline so that
    // vi.mock() can intercept their imports correctly.
    server: {
      deps: {
        inline: [/@freed\//],
      },
    },
  },
});
