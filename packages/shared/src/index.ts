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

// Re-export focus text utilities (browser-safe, no deps)
export * from "./focus-text.js";

// Re-export store types (browser-safe, no deps)
export * from "./store-types.js";

// Re-export friends identity resolution and CRM utilities (browser-safe, no deps)
export * from "./friends.js";

// Re-export location extraction utilities (browser-safe, no deps)
export * from "./location.js";

// Re-export sample data generators (browser-safe, no deps)
export * from "./sample-data.js";

// Re-export legal metadata and acceptance helpers (browser-safe, no deps)
export * from "./legal.js";
export * from "./legal-storage.js";

// Note: schema.js is NOT re-exported here because it imports Automerge
// which uses WebAssembly and requires special bundler configuration.
// For schema operations, import directly from '@freed/shared/schema' in Node.js/Tauri.
