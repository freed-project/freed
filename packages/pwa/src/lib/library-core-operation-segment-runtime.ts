/**
 * Dormant browser-safe operation-segment bridge.
 *
 * This module exposes the shared wire pipeline to the future Library Core
 * worker. No product entry point imports it before the governed cutover.
 */
export {
  importLibraryCoreOperationSegmentV1,
  prepareLibraryCoreOperationSegmentV1,
} from "@freed/sync/cloud/library-core";
export { encodeLibraryCoreCanonicalValue } from "@freed/shared/library-core";
