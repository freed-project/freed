#!/usr/bin/env node
/**
 * Patch @automerge/automerge package.json exports
 *
 * Ensures the `browser` export condition uses `fullfat_bundler.js` (which
 * imports .wasm files via ESM) rather than `fullfat_base64.js` (which inlines
 * the WASM binary as a base64 string).
 *
 * With vite-plugin-wasm handling ESM WASM imports, the bundler entry gives us:
 *   - Separate .wasm asset (streamed via WebAssembly.instantiateStreaming)
 *   - ~65% smaller JS bundle (no base64 bloat)
 *   - Independent caching of WASM vs app code
 *
 * Run automatically via the root `postinstall` script.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(
  __dirname,
  "../node_modules/@automerge/automerge/package.json",
);

try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  let patched = 0;

  for (const [key, entry] of Object.entries(pkg.exports ?? {})) {
    if (typeof entry !== "object" || !entry.browser) continue;
    const browser = entry.browser;
    if (typeof browser === "object" && typeof browser.import === "string") {
      if (browser.import.includes("fullfat_base64")) {
        const before = browser.import;
        browser.import = before.replace("fullfat_base64", "fullfat_bundler");
        patched++;
        console.log(
          `[patch-automerge] ${key}.browser.import: ${before} → ${browser.import}`,
        );
      }
    }
  }

  if (patched > 0) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`[patch-automerge] Patched ${patched} export(s)`);
  } else {
    console.log("[patch-automerge] No patching needed (already correct)");
  }
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("[patch-automerge] @automerge/automerge not found, skipping");
  } else {
    console.error("[patch-automerge] Error:", err.message);
    process.exit(1);
  }
}
