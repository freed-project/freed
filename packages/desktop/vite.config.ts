import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "url";
import pkg from "./package.json" with { type: "json" };

// Resolve workspace packages directly from their TypeScript source so that
// worktrees don't need to build dist/ artifacts before running the dev server.
const src = (name: string) =>
  fileURLToPath(new URL(`../${name}/src`, import.meta.url));

// When VITE_TEST_TAURI=1, swap every @tauri-apps/* import for a thin mock
// module so the UI runs in plain Chromium without a Tauri binary.
const mock = (name: string) =>
  fileURLToPath(
    new URL(`src/__mocks__/@tauri-apps/${name}`, import.meta.url),
  );

const tauriMockAliases: Record<string, string> = process.env.VITE_TEST_TAURI
  ? {
      "@tauri-apps/api/core": mock("api/core.ts"),
      "@tauri-apps/api/event": mock("api/event.ts"),
      "@tauri-apps/api/path": mock("api/path.ts"),
      "@tauri-apps/plugin-process": mock("plugin-process/index.ts"),
      "@tauri-apps/plugin-updater": mock("plugin-updater/index.ts"),
      "@tauri-apps/plugin-shell": mock("plugin-shell/index.ts"),
      "@tauri-apps/plugin-fs": mock("plugin-fs/index.ts"),
      "@tauri-apps/plugin-store": mock("plugin-store/index.ts"),
    }
  : {};

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
      '@freed/capture-linkedin': src('capture-linkedin'),
      ...tauriMockAliases,
    },
  },
  plugins: [wasm(), topLevelAwait(), react()],

  // vite-plugin-wasm must also be applied to the worker sub-bundle.
  // Without this, Vite 7's worker pipeline processes automerge.worker.ts
  // without WASM support and fails on the automerge_wasm_bg.wasm import.
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },

  // Tauri development server.
  // strictPort is only enforced when running with the real Tauri binary (tauri:dev),
  // because tauri.conf.json hardcodes http://localhost:1420 as the devUrl.
  // In mock mode (VITE_TEST_TAURI=1) we let Vite pick any free port so that
  // multiple worktrees can run in parallel without colliding.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: !process.env.VITE_TEST_TAURI,
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
