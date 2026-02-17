/**
 * @freed/shared - Shared types and utilities for Freed
 *
 * "Their algorithms optimize for profit. Optimize yours for life."
 */

// Re-export all types
export * from "./types.js";

// Re-export ranking algorithm (browser-safe, no Automerge)
export * from "./ranking.js";

// Re-export OPML utilities (browser-safe, no Automerge)
export * from "./opml.js";

// Note: schema.js is NOT re-exported here because it imports Automerge
// which uses WebAssembly and requires special bundler configuration.
// For schema operations, import directly from '@freed/shared/schema' in Node.js/Tauri.
