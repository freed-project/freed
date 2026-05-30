export type { RawSubstackEntry, RawSubstackEntryKind, RawSubstackProfile } from "./types.js";

export {
  substackEntryToFeedItem,
  substackEntriesToFeedItems,
  substackProfilesToAccounts,
  deduplicateAccounts,
  deduplicateFeedItems,
} from "./normalize.js";
