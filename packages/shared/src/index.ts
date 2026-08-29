/**
 * @freed/shared - Shared types and utilities for Freed
 *
 * "Their algorithms optimize for profit. Optimize yours for life."
 */

// Re-export all types
export * from "./types";

// Re-export ranking algorithm.
export * from "./ranking";
export * from "./library-core/feed-browse-filter-contract";

// Re-export local content signal inference (browser-safe, no deps)
export * from "./content-signals";
export * from "./feed-signal-filters";
export * from "./preferences";
export * from "./sync-write-policy";
export * from "./local-ai";

// Re-export OPML utilities.
export * from "./opml";

// Re-export focus text utilities (browser-safe, no deps)
export * from "./focus-text";

// Re-export store types (browser-safe, no deps)
export * from "./store-types";
export * from "./navigation-state";

// Re-export friends identity resolution and CRM utilities (browser-safe, no deps)
export * from "./friends";
export * from "./friend-suggestions";
export * from "./connection-person-draft";
export * from "./contact-sync-state";
export * from "./social-account-validity";
export * from "./essay-identity";

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
export * from "./redact-sensitive";
export * from "./story-wall";
export * from "./youtube";
