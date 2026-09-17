import type { NormalizedLibraryFollowerRuntimeStatus } from "./sqlite-library";

/** Describe durable local progress without inferring that the Primary is online. */
export function describeLibraryFollowerProgress(
  status: NormalizedLibraryFollowerRuntimeStatus,
): { statusMessage: string; pendingReason: string } {
  if (status.state === "awaiting_checkpoint") {
    return {
      statusMessage: "Waiting for the Primary Library.",
      pendingReason: "A verified Library checkpoint is required before joining.",
    };
  }
  if (status.state !== "active") {
    return {
      statusMessage: "Waiting for Primary enrollment.",
      pendingReason: "Keep the Primary online to accept this Freed Desktop. Your Library is available to read.",
    };
  }
  const pending = [];
  if (status.pendingIntentCount > 0) {
    pending.push(`${status.pendingIntentCount.toLocaleString()} ${status.pendingIntentCount === 1 ? "edit waiting" : "edits waiting"} to upload`);
  }
  if (status.publishedIntentCount > 0) {
    pending.push(`${status.publishedIntentCount.toLocaleString()} ${status.publishedIntentCount === 1 ? "edit awaiting" : "edits awaiting"} Primary acceptance`);
  }
  if (status.awaitingCanonicalChanges) pending.push("Accepted changes waiting to apply");
  return pending.length > 0
    ? { statusMessage: "Library edits are still synchronizing.", pendingReason: `${pending.join(". ")}.` }
    : { statusMessage: "No local edits waiting to sync.", pendingReason: "Checking for Primary changes once a minute." };
}
