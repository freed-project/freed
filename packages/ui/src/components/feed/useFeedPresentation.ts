import { useLayoutEffect, useMemo, useRef } from "react";
import type { FeedItem } from "@freed/shared";
import { presentFeed, type FeedPresentation } from "./feed-presentation.js";

export function useFeedPresentation(
  items: FeedItem[],
  sessionKey: string,
  enabled: boolean,
) {
  const committed = useRef<{
    key: string;
    enabled: boolean;
    presentation: FeedPresentation;
  } | null>(null);
  const presentation = useMemo(
    () =>
      presentFeed(
        items,
        committed.current?.key === sessionKey &&
          committed.current.enabled === enabled
          ? committed.current.presentation
          : undefined,
        enabled,
      ),
    [items, sessionKey, enabled],
  );
  useLayoutEffect(() => {
    committed.current = { key: sessionKey, enabled, presentation };
  }, [sessionKey, enabled, presentation]);
  return presentation;
}
