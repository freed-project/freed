import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
