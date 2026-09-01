#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PWA_OPTIONAL_SURFACE_CACHE_NAME,
  PWA_OPTIONAL_SURFACE_FILENAME_PATTERN,
  PWA_OPTIONAL_SURFACE_URL_PATTERN,
} from "./lib/pwa-optional-assets.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST_ROOT = path.join(REPO_ROOT, "packages", "pwa", "dist");
const ASSET_ROOT = path.join(DIST_ROOT, "assets");

function fail(message) {
  throw new Error(`PWA optional asset policy failed: ${message}`);
}

function optionalAssets() {
  return readdirSync(ASSET_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => PWA_OPTIONAL_SURFACE_FILENAME_PATTERN.test(name))
    .sort();
}

function extractPrecacheUrls(serviceWorker) {
  const start = serviceWorker.indexOf("precacheAndRoute([");
  if (start < 0) fail("generated service worker has no precache manifest");
  const end = serviceWorker.indexOf("],{})", start);
  if (end < 0) fail("generated service worker precache manifest is unreadable");
  return new Set(
    [...serviceWorker.slice(start, end).matchAll(/url:["']([^"']+)["']/g)]
      .map((match) => match[1]),
  );
}

function validate() {
  const assets = optionalAssets();
  if (!assets.some((name) => name.startsWith("MapView-"))) {
    fail("production build has no lazy MapView chunk");
  }
  if (!assets.some((name) => name.startsWith("FriendsView-"))) {
    fail("production build has no lazy FriendsView chunk");
  }

  const serviceWorker = readFileSync(path.join(DIST_ROOT, "sw.js"), "utf8");
  if (!serviceWorker.includes(PWA_OPTIONAL_SURFACE_CACHE_NAME)) {
    fail(`generated service worker has no ${PWA_OPTIONAL_SURFACE_CACHE_NAME} cache`);
  }
  if (!serviceWorker.includes(PWA_OPTIONAL_SURFACE_URL_PATTERN.source)) {
    fail("generated service worker has no optional surface route matcher");
  }

  const precacheUrls = extractPrecacheUrls(serviceWorker);
  const sqliteWasm = readdirSync(ASSET_ROOT)
    .filter((name) => /^sqlite3-[^/]+\.wasm$/.test(name));
  if (sqliteWasm.length !== 1) {
    fail("production build must contain exactly one hashed SQLite WebAssembly asset");
  }
  if (!precacheUrls.has(`assets/${sqliteWasm[0]}`)) {
    fail("SQLite WebAssembly is missing from the offline app-shell precache");
  }
  const leaked = assets.filter((name) => precacheUrls.has(`assets/${name}`));
  if (leaked.length > 0) {
    fail(`optional assets entered precache: ${leaked.join(", ")}`);
  }

  const bytes = assets.reduce(
    (total, name) => total + statSync(path.join(ASSET_ROOT, name)).size,
    0,
  );
  console.log(
    `PWA optional asset policy passed: ${assets.length.toLocaleString("en-US")} on-demand assets, ${bytes.toLocaleString("en-US")} bytes excluded from precache.`,
  );
}

try {
  validate();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
