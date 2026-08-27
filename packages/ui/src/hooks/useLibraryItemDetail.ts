import { useEffect, useState } from "react";
import type { FeedItem } from "@freed/shared";

import {
  usePlatform,
  type PlatformConfig,
} from "../context/PlatformContext.js";

type ItemDetailReader = NonNullable<PlatformConfig["readLibraryItemDetail"]>;

export type LibraryItemDetailStatus =
  | "idle"
  | "loading"
  | "ready"
  | "failed";

export interface LibraryItemDetailResult {
  readonly item: FeedItem | null;
  readonly status: LibraryItemDetailStatus;
}

interface CachedItemDetail {
  readonly key: string;
  promise: Promise<FeedItem | null>;
  result: FeedItem | null | undefined;
}

interface ItemDetailState extends LibraryItemDetailResult {
  readonly key: string;
}

const itemDetailCache = new WeakMap<ItemDetailReader, CachedItemDetail>();

function prepareItemDetail(
  reader: ItemDetailReader,
  globalId: string,
  sourceVersion: number,
): CachedItemDetail {
  const key = `${sourceVersion}:${globalId}`;
  const cached = itemDetailCache.get(reader);
  if (cached?.key === key) return cached;

  const entry: CachedItemDetail = {
    key,
    promise: Promise.resolve(null as never),
    result: undefined,
  };
  entry.promise = reader(globalId).then((item) => {
    entry.result = item;
    return item;
  }).catch((error: unknown) => {
    if (itemDetailCache.get(reader) === entry) {
      itemDetailCache.delete(reader);
    }
    throw error;
  });
  itemDetailCache.set(reader, entry);
  return entry;
}

/** Retain at most one exact SQLite item-detail row for the active host reader. */
export function useLibraryItemDetail(
  globalId: string | null,
  sourceVersion: number,
  enabled = true,
): LibraryItemDetailResult {
  const { readLibraryItemDetail } = usePlatform();
  const key = `${sourceVersion}:${globalId ?? ""}`;
  const [state, setState] = useState<ItemDetailState>({
    item: null,
    key: "",
    status: "idle",
  });

  useEffect(() => {
    if (!enabled || !globalId) {
      setState({ item: null, key: "", status: "idle" });
      return;
    }
    if (!readLibraryItemDetail) {
      setState({ item: null, key, status: "failed" });
      return;
    }

    let cancelled = false;
    const prepared = prepareItemDetail(
      readLibraryItemDetail,
      globalId,
      sourceVersion,
    );
    if (prepared.result !== undefined) {
      setState({ item: prepared.result, key, status: "ready" });
    } else {
      setState({ item: null, key, status: "loading" });
    }
    void prepared.promise
      .then((item) => {
        if (!cancelled) setState({ item, key, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ item: null, key, status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, globalId, key, readLibraryItemDetail, sourceVersion]);

  if (!enabled || !globalId) return { item: null, status: "idle" };
  if (state.key !== key) return { item: null, status: "loading" };
  return { item: state.item, status: state.status };
}
