#!/usr/bin/env node
/**
 * Patch @automerge/automerge package.json exports
 *
 * Vite 7 resolves the `browser` export condition to `fullfat_bundler.js`,
 * which imports raw `.wasm` files via ESM — an unsupported pattern that
 * triggers Vite's "ESM integration proposal for Wasm" rejection.
 *
 * The `fullfat_base64.js` entry inlines the WASM binary as base64, avoiding
 * the problem entirely. This script patches the exports map so the `browser`
 * condition points there instead.
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
      if (browser.import.includes("fullfat_bundler")) {
        const before = browser.import;
        browser.import = before.replace("fullfat_bundler", "fullfat_base64");
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
  // Non-fatal — the package might not be installed yet
  if (err.code === "ENOENT") {
    console.log("[patch-automerge] @automerge/automerge not found, skipping");
  } else {
    console.error("[patch-automerge] Error:", err.message);
    process.exit(1);
  }
}
