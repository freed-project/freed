/**
 * Browser-safe Library Core cloud surface.
 *
 * This entry point intentionally excludes the retired mutable Automerge file
 * adapters and their dynamic merge runtime. PWA production code must import
 * cloud primitives here so Rollup can prove that no CRDT worker or WASM asset
 * remains reachable.
 */
export type { CloudProvider } from "./types.js";
export * from "./library-core-checkpoint-import.js";
export * from "./library-core-checkpoint-publication.js";
export * from "./library-core-google-drive-adapter.js";
export * from "./library-core-immutable-publication.js";
export * from "./library-core-intent-publication.js";
export * from "./library-core-intent-segments.js";
export * from "./library-core-operation-segments.js";
export * from "./library-core-portable-checkpoint.js";
export * from "./library-core-primary-coordinator.js";
export * from "./library-core-result-publication.js";
export * from "./library-core-result-segments.js";
export * from "./library-core-wire-object.js";
