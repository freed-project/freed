import { LibraryCoreAnnotationHydrationError, type LibraryCoreHydratedAnnotations } from "@freed/shared/library-core";
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
  readonly annotations?: LibraryCoreHydratedAnnotations | null;
  readonly annotationFailure?: LibraryCoreHydratedAnnotations["state"];
  readonly item: FeedItem | null;
  readonly status: LibraryItemDetailStatus;
}

interface CachedItemDetail {
  readonly key: string;
  promise: ReturnType<ItemDetailReader>;
  result: Awaited<ReturnType<ItemDetailReader>> | undefined;
}

interface ItemDetailState extends LibraryItemDetailResult {
  readonly key: string;
  readonly reader?: ItemDetailReader;
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

function detailFields(detail: Awaited<ReturnType<ItemDetailReader>>) {
  return detail && "item" in detail ? { item: detail.item, annotations: detail.annotations } : { item: detail };
}

export function annotationFailureLabel(state: LibraryCoreHydratedAnnotations["state"]): string {
  const labels = {
    missing: "Saved annotation text is missing.", corrupt: "Saved annotation text is corrupt.",
    oversized: "Saved annotation text exceeds the supported size.", stale: "Annotations changed. Reopen the item before editing.",
    unavailable: "Saved annotation text is temporarily unavailable.", excluded: "Saved annotation text is unavailable on this device.",
    invalid_text: "Saved annotation text is not valid UTF-8.", ready: "",
  };
  return `${labels[state]} Saved annotations have not changed.`;
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
      setState({ ...detailFields(prepared.result), key, reader: readLibraryItemDetail, status: "ready" });
    } else {
      setState((previous) => ({
        item: previous.reader === readLibraryItemDetail && previous.item?.globalId === globalId
          ? previous.item : null,
        key,
        reader: readLibraryItemDetail,
        status: "loading",
      }));
    }
    void prepared.promise
      .then((item) => {
        if (!cancelled) setState({ ...detailFields(item), key, reader: readLibraryItemDetail, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ item: null, key, reader: readLibraryItemDetail, status: "failed", ...(error instanceof LibraryCoreAnnotationHydrationError ? { annotations: error.snapshot, annotationFailure: error.snapshot.state } : {}) });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, globalId, key, readLibraryItemDetail, sourceVersion]);

  if (!enabled || !globalId) return { item: null, status: "idle" };
  if (state.key !== key || state.reader !== readLibraryItemDetail) {
    // Refreshing the same row must not dismiss reader controls. Never reuse
    // presentation from another selection or another Library reader.
    return {
      item: state.reader === readLibraryItemDetail && state.item?.globalId === globalId
        ? state.item : null,
      status: "loading",
    };
  }
  return { item: state.item, status: state.status, ...(state.annotations !== undefined ? { annotations: state.annotations } : {}), ...(state.annotationFailure ? { annotationFailure: state.annotationFailure } : {}) };
}
