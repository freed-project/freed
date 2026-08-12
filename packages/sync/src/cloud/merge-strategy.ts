import type { DestructiveMergeGuardOptions } from "@freed/shared/schema";

export type CloudMergeStrategy = (
  local: Uint8Array,
  remote: Uint8Array,
  options?: DestructiveMergeGuardOptions,
) => Promise<Uint8Array>;

/** Load the legacy CRDT merge runtime only when an Automerge upload uses it. */
export const lazyInProcessCloudMerge: CloudMergeStrategy = async (
  local,
  remote,
  options,
) => {
  const { mergeBinaries } = await import("./merge.js");
  return mergeBinaries(local, remote, options);
};

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
