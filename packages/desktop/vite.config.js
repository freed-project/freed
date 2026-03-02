var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify((_a = process.env.npm_package_version) !== null && _a !== void 0 ? _a : 'dev'),
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
});
