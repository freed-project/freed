/**
 * Structured file-based logger for Freed Desktop.
 *
 * Thin wrapper around @tauri-apps/plugin-log that writes to the platform log
 * file (~/Library/Logs/freed/freed.log on macOS, rotated at 10 MB in Rust).
 *
 * In test mode (VITE_TEST_TAURI=1) the Tauri plugin is unavailable, so all
 * calls fall back to the corresponding console.* method.
 *
 * Usage:
 *   import { log } from "./logger";
 *   log.info("[rss-poller] heartbeat feeds=12");
 *   log.warn("[content-fetcher] fetch_url TIMEOUT url=https://...");
 *   log.error("[automerge-worker] request TIMEOUT op=MERGE_DOC");
 */

import type { SyncEventKind } from "@freed/ui/lib/debug-store";

const IS_TEST = import.meta.env.VITE_TEST_TAURI === "1";

// Lazily import the plugin so we don't break test-mode builds that mock
// @tauri-apps modules with lightweight stubs (the mock doesn't ship plugin-log).
async function loadPlugin() {
  if (IS_TEST) return null;
  try {
    return await import("@tauri-apps/plugin-log");
  } catch {
    return null;
  }
}

const pluginPromise = loadPlugin();

async function write(
  level: "debug" | "info" | "warn" | "error",
  message: string,
): Promise<void> {
  const plugin = await pluginPromise;
  if (!plugin) {
    (console[level] ?? console.log)(`[freed] ${message}`);
    return;
  }
  try {
    await plugin[level](message);
  } catch {
    // Never let logging blow up the caller.
    console[level]?.(`[freed] ${message}`);
  }
}

export const log = {
  debug: (msg: string) => void write("debug", msg),
  info: (msg: string) => void write("info", msg),
  warn: (msg: string) => void write("warn", msg),
  error: (msg: string) => void write("error", msg),
};

/**
 * Map a SyncEventKind to a log level.
 * Used by debug-store to write DebugPanel events to the log file as well.
 */
export function syncEventLevel(kind: SyncEventKind): "debug" | "info" | "warn" | "error" {
  if (kind === "error" || kind === "merge_err") return "error";
  if (kind === "disconnected" || kind === "reconnecting" || kind === "connect_timeout") return "warn";
  return "info";
}
