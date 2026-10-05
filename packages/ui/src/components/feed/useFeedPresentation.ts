import { useLayoutEffect, useMemo, useRef } from "react";
import type { FeedItem } from "@freed/shared";
import { presentFeed, type FeedPresentation } from "./feed-presentation.js";

export function useFeedPresentation(
  items: FeedItem[],
  sessionKey: string,
  opening: boolean,
) {
  const committed = useRef<{
    key: string;
    presentation: FeedPresentation;
  } | null>(null);
  const presentation = useMemo(
    () =>
      presentFeed(
        items,
        committed.current?.key === sessionKey
          ? committed.current.presentation
          : undefined,
        true,
        opening,
      ),
    [items, sessionKey, opening],
  );
  useLayoutEffect(() => {
    committed.current = { key: sessionKey, presentation };
  }, [sessionKey, opening, presentation]);
  return presentation;
}
