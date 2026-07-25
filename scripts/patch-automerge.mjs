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

function fail(lines) {
  console.error(`[patch-automerge] ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(`[patch-automerge] ${line}`);
  process.exit(1);
}

try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const version = pkg.version ?? "unknown";

  // Classify every browser.import entry before touching any of them. The old
  // version only counted the ones it rewrote, so "nothing to rewrite" and "this
  // package no longer looks the way I expect" produced the same cheerful line
  // and the same exit 0. That is the wrong way round for a patch whose whole
  // job is keeping a multi-megabyte base64 blob out of the bundle: if the
  // upstream layout moves, the build stays green and silently ships the heavy
  // entry point. Better to stop the install than to lose the saving quietly.
  const alreadyBundler = [];
  const needsPatch = [];
  // Entrypoints that mention neither name are simply not this patch's business.
  // ./slim is the real example: it ships no WASM of its own, so it never had a
  // fullfat variant. Recorded only so the failure message below can show what
  // the package did look like.
  const unrelated = [];

  for (const [key, entry] of Object.entries(pkg.exports ?? {})) {
    if (typeof entry !== "object" || entry === null) continue;
    const browser = entry.browser;
    if (typeof browser !== "object" || browser === null) continue;
    if (typeof browser.import !== "string") continue;

    if (browser.import.includes("fullfat_bundler")) alreadyBundler.push(key);
    else if (browser.import.includes("fullfat_base64")) needsPatch.push(key);
    else unrelated.push(`${key} -> ${browser.import}`);
  }

  if (alreadyBundler.length + needsPatch.length === 0) {
    fail([
      `Found no fullfat_base64 or fullfat_bundler browser export in @automerge/automerge ${version}.`,
      "This patch redirects the browser entry away from the base64 build, which",
      "inlines the WASM binary into JS and costs roughly 65% of the bundle.",
      "Finding neither name means the upstream export layout changed and this",
      "patch is now a no-op, so the build would quietly ship the heavy entry.",
      unrelated.length
        ? `browser.import entries present: ${unrelated.join(", ")}`
        : "No browser.import entries were present at all.",
      "Re-target this script at the new layout, or drop it if upstream fixed the",
      "default. Do not silence it without checking the bundle size first.",
    ]);
  }

  if (needsPatch.length === 0) {
    console.log(
      `[patch-automerge] Already correct: ${alreadyBundler.length} browser export(s) on fullfat_bundler (v${version})`,
    );
  } else {
    for (const key of needsPatch) {
      const browser = pkg.exports[key].browser;
      const before = browser.import;
      browser.import = before.replace("fullfat_base64", "fullfat_bundler");
      console.log(
        `[patch-automerge] ${key}.browser.import: ${before} → ${browser.import}`,
      );
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(
      `[patch-automerge] Patched ${needsPatch.length} export(s) (v${version})`,
    );
  }
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("[patch-automerge] @automerge/automerge not found, skipping");
  } else {
    console.error("[patch-automerge] Error:", err.message);
    process.exit(1);
  }
}
