import type { ContentSignal, FeedItem } from "../types.js";
import { CONTENT_SIGNAL_KEYS } from "../content-signals.js";
import type {
  FilterOptions,
  SocialContentFilter,
} from "../store-types.js";

export const LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION = 1 as const;

/**
 * The smallest structural view needed to reproduce the current product feed
 * filters. `FeedItem` satisfies this interface directly, so the legacy
 * renderer can use the same predicate without allocating one adapter object
 * per corpus row.
 */
export type LibraryCoreFeedBrowseFilterSourceV1 = Pick<
  FeedItem,
  "author" | "contentSignals" | "contentType" | "platform" | "rssSource" | "userState"
>;

export interface LibraryCoreFeedBrowseFilterV1 {
  readonly archivedOnly: boolean;
  readonly authorId: string | null;
  readonly feedUrl: string | null;
  readonly platform: string | null;
  readonly savedOnly: boolean;
  readonly schemaVersion: typeof LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION;
  readonly showHidden: boolean;
  readonly signals: readonly ContentSignal[];
  readonly socialContentFilter: SocialContentFilter;
  readonly tags: readonly string[];
}

export type LibraryCoreFeedBrowseFilterInputV1 = FilterOptions & {
  readonly showHidden?: boolean;
};

export type LibraryCoreFeedBrowseFilterParseResult =
  | Readonly<{ ok: true; value: LibraryCoreFeedBrowseFilterV1 }>
  | Readonly<{ ok: false; error: string }>;

const FILTER_KEYS = [
  "archivedOnly",
  "authorId",
  "feedUrl",
  "platform",
  "savedOnly",
  "schemaVersion",
  "showHidden",
  "signals",
  "socialContentFilter",
  "tags",
] as const;
const CONTENT_SIGNALS = new Set<string>(CONTENT_SIGNAL_KEYS);
const MAXIMUM_FILTER_SET_ITEMS = 32;
const MAXIMUM_FILTER_TEXT_SCALARS = 2_048;
const MAXIMUM_FILTER_TEXT_BYTES = 8_192;

function compareBinaryText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isBoundedFilterText(value: string): boolean {
  let byteCount = 0;
  let scalarCount = 0;
  for (const scalar of value) {
    scalarCount += 1;
    const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined) return false;
    byteCount += codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
          ? 3
          : 4;
    if (
      scalarCount > MAXIMUM_FILTER_TEXT_SCALARS ||
      byteCount > MAXIMUM_FILTER_TEXT_BYTES
    ) {
      return false;
    }
  }
  return true;
}

function normalizedSet<T extends string>(
  values: readonly T[] | undefined,
): readonly T[] {
  if (!values?.length) return Object.freeze([]);
  return Object.freeze([...new Set(values)].sort(compareBinaryText));
}

/**
 * Canonicalize the product filter for cursor binding and cross-runtime parity.
 *
 * Strings remain byte-for-byte exact because the current product does not
 * trim or case-fold them. Set-like arrays are deduplicated and binary-sorted
 * because their order and multiplicity do not affect the current any-match
 * predicate.
 */
export function normalizeLibraryCoreFeedBrowseFilterV1(
  input: LibraryCoreFeedBrowseFilterInputV1 = {},
): LibraryCoreFeedBrowseFilterV1 {
  return Object.freeze({
    archivedOnly: input.archivedOnly === true,
    authorId: input.authorId ?? null,
    feedUrl: input.feedUrl ?? null,
    platform: input.platform ?? null,
    savedOnly: input.savedOnly === true,
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION,
    showHidden: input.showHidden === true,
    signals: normalizedSet(input.signals),
    socialContentFilter: input.socialContentFilter ?? "all",
    tags: normalizedSet(input.tags),
  });
}

/**
 * Snapshot one closed normalized browse filter at a worker or storage boundary.
 */
export function parseLibraryCoreFeedBrowseFilterV1(
  value: unknown,
): LibraryCoreFeedBrowseFilterParseResult {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return Object.freeze({
      ok: false,
      error: "browse filter must be one plain record",
    });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== FILTER_KEYS.length ||
    keys.some((key) => typeof key !== "string" || !FILTER_KEYS.includes(
      key as (typeof FILTER_KEYS)[number],
    )) ||
    FILTER_KEYS.some((key) =>
      !descriptors[key]?.enumerable || !("value" in descriptors[key])
    )
  ) {
    return Object.freeze({
      ok: false,
      error: "browse filter fields do not match schema version 1",
    });
  }
  const input = value as Record<string, unknown>;
  const nullableStrings = ["authorId", "feedUrl", "platform"] as const;
  if (
    input.schemaVersion !== LIBRARY_CORE_FEED_BROWSE_FILTER_SCHEMA_VERSION ||
    ["archivedOnly", "savedOnly", "showHidden"].some(
      (key) => typeof input[key] !== "boolean",
    ) ||
    nullableStrings.some(
      (key) => input[key] !== null && typeof input[key] !== "string",
    ) ||
    !["all", "posts", "stories"].includes(
      input.socialContentFilter as string,
    )
  ) {
    return Object.freeze({
      ok: false,
      error: "browse filter contains an invalid scalar",
    });
  }
  if (
    nullableStrings.some((key) => {
      const candidate = input[key];
      return typeof candidate === "string" &&
        !isBoundedFilterText(candidate);
    })
  ) {
    return Object.freeze({
      ok: false,
      error: "browse filter text exceeds its byte or scalar bound",
    });
  }
  const parseStringSet = (
    candidate: unknown,
    label: string,
    allowed?: ReadonlySet<string>,
  ): readonly string[] | string => {
    if (
      !Array.isArray(candidate) ||
      candidate.length > MAXIMUM_FILTER_SET_ITEMS
    ) {
      return `${label} must be one bounded array`;
    }
    const values: string[] = [];
    for (let index = 0; index < candidate.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        candidate,
        String(index),
      );
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "string" ||
        !isBoundedFilterText(descriptor.value) ||
        (allowed && !allowed.has(descriptor.value))
      ) {
        return `${label} contains an invalid entry`;
      }
      values.push(descriptor.value);
    }
    if (
      Reflect.ownKeys(candidate).some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(0|[1-9][0-9]*)$/.test(key) ||
            Number(key) >= candidate.length),
      )
    ) {
      return `${label} must be one dense undecorated array`;
    }
    return values;
  };
  const tags = parseStringSet(input.tags, "browse filter tags");
  if (typeof tags === "string") {
    return Object.freeze({ ok: false, error: tags });
  }
  const signals = parseStringSet(
    input.signals,
    "browse filter signals",
    CONTENT_SIGNALS,
  );
  if (typeof signals === "string") {
    return Object.freeze({ ok: false, error: signals });
  }
  const normalized = normalizeLibraryCoreFeedBrowseFilterV1({
    archivedOnly: input.archivedOnly as boolean,
    authorId: (input.authorId as string | null) ?? undefined,
    feedUrl: (input.feedUrl as string | null) ?? undefined,
    platform: (input.platform as string | null) ?? undefined,
    savedOnly: input.savedOnly as boolean,
    showHidden: input.showHidden as boolean,
    signals: signals as ContentSignal[],
    socialContentFilter: input.socialContentFilter as SocialContentFilter,
    tags: [...tags],
  });
  if (
    normalized.tags.length !== tags.length ||
    normalized.signals.length !== signals.length ||
    normalized.tags.some((entry, index) => entry !== tags[index]) ||
    normalized.signals.some((entry, index) => entry !== signals[index])
  ) {
    return Object.freeze({
      ok: false,
      error: "browse filter arrays are not canonical",
    });
  }
  return Object.freeze({ ok: true, value: normalized });
}

/**
 * One exact predicate for the current renderer and future bounded adapters.
 *
 * A native or browser row query must prove that its pushed-down predicates
 * produce the same answer as this function before it may replace the current
 * in-memory filter.
 */
export function matchesLibraryCoreFeedBrowseFilterV1(
  item: LibraryCoreFeedBrowseFilterSourceV1,
  filter: LibraryCoreFeedBrowseFilterV1,
): boolean {
  if (!filter.showHidden && item.userState.hidden) return false;

  if (filter.archivedOnly) {
    if (!item.userState.archived) return false;
  } else if (item.userState.archived) {
    return false;
  }

  if (filter.platform) {
    const matchesPlatform = filter.platform === "rss"
      ? item.platform === "rss" || Boolean(item.rssSource)
      : item.platform === filter.platform;
    if (!matchesPlatform) return false;
  }
  if (filter.authorId && item.author.id !== filter.authorId) return false;
  if (filter.feedUrl && item.rssSource?.feedUrl !== filter.feedUrl) return false;

  if (filter.socialContentFilter === "stories") {
    if (item.contentType !== "story") return false;
  } else if (
    filter.socialContentFilter === "posts" &&
    item.contentType === "story"
  ) {
    return false;
  }

  if (filter.savedOnly && !item.userState.saved) return false;

  if (
    filter.tags.length > 0 &&
    !filter.tags.some((tag) => item.userState.tags.includes(tag))
  ) {
    return false;
  }

  const itemSignals = item.contentSignals?.tags ?? [];
  if (
    filter.signals.length > 0 &&
    !filter.signals.some((signal) => itemSignals.includes(signal))
  ) {
    return false;
  }

  return true;
}
