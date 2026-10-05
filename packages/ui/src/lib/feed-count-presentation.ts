import type { VisibleFeedTotalCount } from "@freed/shared";

export interface KnownFeedCount {
  readonly selectionIdentity: string;
  readonly count: number;
}

/** Retain only a count proved for this selection, never a neighboring feed. */
export function resolveFeedCountPresentation(input: {
  readonly selectionIdentity: string;
  readonly current: boolean;
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly totalCount: number;
  readonly lastKnown: KnownFeedCount | null;
}): VisibleFeedTotalCount {
  if (input.current && input.status === "ready") return input.totalCount;
  return {
    status: input.current && input.status === "failed" ? "failed" : "loading",
    lastKnownCount: input.lastKnown?.selectionIdentity === input.selectionIdentity
      ? input.lastKnown.count : null,
  };
}

/** Loading and failures must not be presented as successful zero-row queries. */
export function formatFeedItemCount(value: VisibleFeedTotalCount): string {
  const count = typeof value === "number" ? value : value.lastKnownCount;
  const label = count === null ? null
    : `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;
  if (typeof value === "number") return label!;
  if (value.status === "failed") {
    return label ? `${label} • Could not refresh` : "Item count unavailable";
  }
  return label ? `${label} • Updating` : "Loading items";
}
