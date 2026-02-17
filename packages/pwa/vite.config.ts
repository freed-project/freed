import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Note: @automerge/automerge's browser export condition is patched by
// scripts/patch-automerge.mjs (run via postinstall) to use fullfat_base64.js
// instead of fullfat_bundler.js, avoiding Vite 7's ESM WASM rejection.
export default defineConfig({
  plugins: [react()],

  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
