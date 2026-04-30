/**
 * @freed/shared - Shared types and utilities for Freed
 *
 * "Their algorithms optimize for profit. Optimize yours for life."
 */

// Re-export all types
export * from "./types";

// Re-export ranking algorithm (browser-safe, no Automerge)
export * from "./ranking";

// Re-export local content signal inference (browser-safe, no deps)
export * from "./content-signals";
export * from "./feed-signal-filters";
export * from "./local-ai";

// Re-export OPML utilities (browser-safe, no Automerge)
export * from "./opml";

// Re-export focus text utilities (browser-safe, no deps)
export * from "./focus-text";

// Re-export store types (browser-safe, no deps)
export * from "./store-types";
export * from "./navigation-state";

// Re-export friends identity resolution and CRM utilities (browser-safe, no deps)
export * from "./friends";
export * from "./identity-graph";
export * from "./contact-sync-state";

// Re-export location extraction utilities (browser-safe, no deps)
export * from "./location";

// Re-export sample data generators (browser-safe, no deps)
export * from "./sample-data";

// Re-export shared theme metadata (browser-safe, no deps)
export * from "./themes";
export * from "./release-channel";

// Re-export legal metadata and acceptance helpers (browser-safe, no deps)
export * from "./legal";
export * from "./legal-storage";
export * from "./bug-report";

// Note: schema.js is NOT re-exported here because it imports Automerge
// which uses WebAssembly and requires special bundler configuration.
// For schema operations, import directly from '@freed/shared/schema' in Node.js/Tauri.
