/**
 * FeedEmptyState -- unified dispatcher for platform-specific empty states.
 *
 * When the active filter targets X or Facebook, renders the appropriate
 * branded blank state. Otherwise falls back to a generic message.
 */

import { useAppStore } from "../lib/store";
import { XFeedEmptyState } from "./XFeedEmptyState";
import { FacebookFeedEmptyState } from "./FacebookFeedEmptyState";

export function FeedEmptyState() {
  const platform = useAppStore((s) => s.activeFilter.platform);

  if (platform === "facebook") return <FacebookFeedEmptyState />;

  // XFeedEmptyState already handles both "x" and non-x filters
  // (it has its own generic fallback for non-x filters)
  return <XFeedEmptyState />;
}
