/** Closed cross-runtime contract for bounded Library Core text search. */

import type { FeedItem } from "../types.js";
import { CONTENT_SIGNAL_KEYS } from "../content-signals.js";

export const LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_BYTES = 1_024;
export const LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_TERMS = 32;
export const LIBRARY_CORE_SEARCH_DOCUMENT_MAXIMUM_TERMS = 384;
export const LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_BYTES = 1_024;
export const LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_SCALARS = 256;
export const LIBRARY_CORE_SEARCH_SCORE_WORK_LIMIT = 65_536;
export const LIBRARY_CORE_SEARCH_PRESERVED_TEXT_MAXIMUM_SCALARS = 1_200;
export const LIBRARY_CORE_SEARCH_SCAN_ROW_LIMIT = 256;
export const LIBRARY_CORE_SEARCH_RESULT_PAGE_LIMIT = 32;
export const LIBRARY_CORE_SEARCH_RETAINED_RESULT_LIMIT = 100;
export const LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_LIMIT = 512;
export const LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_BYTES = 1_024;
export const LIBRARY_CORE_SEARCH_ACCOUNT_IDENTITY_MAXIMUM_BYTES = 4_096;
export const LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_TERMS = 16;
export const LIBRARY_CORE_SEARCH_RESULT_MAXIMUM_BYTES = 131_072;
export const LIBRARY_CORE_SEARCH_RESULT_TEXT_MAXIMUM_SCALARS = 8_192;
export const LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS = 2_048;
export const LIBRARY_CORE_SEARCH_RESULT_TAG_MAXIMUM_SCALARS = 256;
export const LIBRARY_CORE_SEARCH_RESULT_MEDIA_LIMIT = 4;
export const LIBRARY_CORE_SEARCH_RESULT_TAG_LIMIT = 16;
export const LIBRARY_CORE_SEARCH_RESULT_HIGHLIGHT_LIMIT = 8;

export interface LibraryCoreSearchFieldV1 {
  readonly terms: readonly string[];
  readonly weight: number;
}

export interface LibraryCoreSearchAccountAliasV1 {
  readonly aliases: string;
  readonly authorId: string;
  readonly platform: string;
}

export function boundedLibraryCoreSearchUtf8LengthV1(
  value: string,
  maximum: number,
): number | null {
  if (!Number.isSafeInteger(maximum) || maximum < 0) return null;
  let length = 0;
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0) ?? 0;
    length +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    if (length > maximum) return null;
  }
  return length;
}

export function isLibraryCoreSearchQueryV1(value: unknown): value is string {
  return (
    typeof value === "string" &&
    boundedLibraryCoreSearchUtf8LengthV1(
      value,
      LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_BYTES,
    ) !== null
  );
}

export function isLibraryCoreSearchAccountAliasV1(
  value: unknown,
): value is LibraryCoreSearchAccountAliasV1 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LibraryCoreSearchAccountAliasV1>;
  return (
    typeof candidate.platform === "string" &&
    candidate.platform.length > 0 &&
    boundedLibraryCoreSearchUtf8LengthV1(
      candidate.platform,
      LIBRARY_CORE_SEARCH_ACCOUNT_IDENTITY_MAXIMUM_BYTES,
    ) !== null &&
    typeof candidate.authorId === "string" &&
    candidate.authorId.length > 0 &&
    boundedLibraryCoreSearchUtf8LengthV1(
      candidate.authorId,
      LIBRARY_CORE_SEARCH_ACCOUNT_IDENTITY_MAXIMUM_BYTES,
    ) !== null &&
    typeof candidate.aliases === "string" &&
    candidate.aliases.length > 0 &&
    boundedLibraryCoreSearchUtf8LengthV1(
      candidate.aliases,
      LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_BYTES,
    ) !== null
  );
}

/**
 * Normalize identically before tokenization in the browser and native fixture.
 * NFKD plus mark removal makes accented text comparable without locale state.
 */
export function normalizeLibraryCoreSearchTextV1(value: unknown): string {
  if (typeof value !== "string") return "";
  let normalized = "";
  for (const scalar of value.normalize("NFKD")) {
    if (/\p{M}/u.test(scalar)) continue;
    normalized += scalar.toLowerCase().replace(/\p{M}/gu, "");
  }
  return normalized;
}

export function tokenizeLibraryCoreSearchTextV1(
  value: unknown,
  maximumTerms = LIBRARY_CORE_SEARCH_DOCUMENT_MAXIMUM_TERMS,
): readonly string[] {
  if (!Number.isSafeInteger(maximumTerms) || maximumTerms < 0) {
    throw new RangeError("Library Core search term limit is invalid");
  }
  if (maximumTerms === 0) return Object.freeze([]);
  const terms: string[] = [];
  const seen = new Set<string>();
  let current = "";
  let currentBytes = 0;
  let currentScalars = 0;
  let overflow = false;
  const flush = () => {
    if (!overflow && current.length > 0 && !seen.has(current)) {
      seen.add(current);
      terms.push(current);
    }
    current = "";
    currentBytes = 0;
    currentScalars = 0;
    overflow = false;
  };
  for (const scalar of normalizeLibraryCoreSearchTextV1(value)) {
    if (!/[\p{L}\p{N}_@#]/u.test(scalar)) {
      flush();
      if (terms.length === maximumTerms) break;
      continue;
    }
    if (overflow) continue;
    const scalarBytes = boundedLibraryCoreSearchUtf8LengthV1(scalar, 4) ?? 4;
    currentBytes += scalarBytes;
    currentScalars += 1;
    if (
      currentBytes > LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_BYTES ||
      currentScalars > LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_SCALARS
    ) {
      current = "";
      overflow = true;
      continue;
    }
    current += scalar;
  }
  if (terms.length < maximumTerms) flush();
  return Object.freeze(terms);
}

function boundedScalarCount(value: string): number | null {
  let count = 0;
  for (const _scalar of value) {
    count += 1;
    if (count > LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_SCALARS) return null;
  }
  return count;
}

function boundedEditDistance(
  leftInput: string,
  rightInput: string,
  maximum: number,
): number {
  if (
    boundedLibraryCoreSearchUtf8LengthV1(
      leftInput,
      LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_BYTES,
    ) === null ||
    boundedLibraryCoreSearchUtf8LengthV1(
      rightInput,
      LIBRARY_CORE_SEARCH_TOKEN_MAXIMUM_BYTES,
    ) === null
  ) {
    return maximum + 1;
  }
  const left = Array.from(leftInput);
  const right = Array.from(rightInput);
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const value = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length] ?? maximum + 1;
}

export function scoreLibraryCoreSearchTermV1(
  query: string,
  candidate: string,
  weight: number,
): number {
  if (candidate === query) return weight * 4;
  if (candidate.startsWith(query)) return weight * 3;
  const queryLength = boundedScalarCount(query);
  const candidateLength = boundedScalarCount(candidate);
  if (queryLength === null || candidateLength === null) return 0;
  if (queryLength < 4) return 0;
  const maximum = Math.max(1, Math.floor(queryLength * 0.2));
  const distance = boundedEditDistance(query, candidate, maximum);
  return distance <= maximum ? weight * 2 - distance / 10 : 0;
}

export function scoreLibraryCoreSearchFieldsV1(
  fields: readonly LibraryCoreSearchFieldV1[],
  queryTerms: readonly string[],
  maximumWork = LIBRARY_CORE_SEARCH_SCORE_WORK_LIMIT,
): number {
  return scoreLibraryCoreSearchFieldsWithBudgetV1(
    fields,
    queryTerms,
    maximumWork,
  ).score;
}

export function scoreLibraryCoreSearchFieldsWithBudgetV1(
  fields: readonly LibraryCoreSearchFieldV1[],
  queryTerms: readonly string[],
  maximumWork: number,
): Readonly<{ exhausted: boolean; score: number; work: number }> {
  if (!Number.isSafeInteger(maximumWork) || maximumWork < 0) {
    return Object.freeze({ exhausted: true, score: 0, work: 0 });
  }
  let total = 0;
  let remainingWork = maximumWork;
  let exhausted = false;
  for (const query of queryTerms) {
    let best = 0;
    for (const field of fields) {
      for (const candidate of field.terms) {
        if (candidate === query || candidate.startsWith(query)) {
          best = Math.max(
            best,
            scoreLibraryCoreSearchTermV1(query, candidate, field.weight),
          );
          continue;
        }
        const queryLength = boundedScalarCount(query);
        const candidateLength = boundedScalarCount(candidate);
        if (queryLength === null || candidateLength === null) continue;
        const work = (queryLength + 1) * (candidateLength + 1);
        if (work > remainingWork) {
          exhausted = true;
          continue;
        }
        remainingWork -= work;
        best = Math.max(
          best,
          scoreLibraryCoreSearchTermV1(query, candidate, field.weight),
        );
      }
    }
    if (best === 0) {
      return Object.freeze({
        score: 0,
        exhausted,
        work: maximumWork - remainingWork,
      });
    }
    total += best;
  }
  return Object.freeze({
    exhausted,
    score: total,
    work: maximumWork - remainingWork,
  });
}

export function compareLibraryCoreSearchIdentityV1(
  left: string,
  right: string,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedScalars(value: string, maximum: number): string {
  let result = "";
  let count = 0;
  for (const scalar of value) {
    if (count === maximum) break;
    result += scalar;
    count += 1;
  }
  return result;
}

/**
 * Return the bounded FeedItem projection used only for transient search hits.
 * Opening a result still reads the complete item through the detail contract.
 */
export function projectLibraryCoreSearchResultItemV1(item: FeedItem): FeedItem {
  const bounded = (value: string | undefined, maximum: number) =>
    value === undefined ? undefined : boundedScalars(value, maximum);
  const boundedTags = <Text extends string>(
    values: readonly Text[] | undefined,
  ): Text[] | undefined =>
    values
      ?.slice(0, LIBRARY_CORE_SEARCH_RESULT_TAG_LIMIT)
      .map(
        (value) =>
          boundedScalars(
            value,
            LIBRARY_CORE_SEARCH_RESULT_TAG_MAXIMUM_SCALARS,
          ) as Text,
      );
  const mediaCount = Math.min(
    item.content.mediaUrls.length,
    item.content.mediaTypes.length,
    LIBRARY_CORE_SEARCH_RESULT_MEDIA_LIMIT,
  );
  const projected: FeedItem = {
    globalId: item.globalId,
    platform: item.platform,
    contentType: item.contentType,
    capturedAt: item.capturedAt,
    publishedAt: item.publishedAt,
    author: {
      id: boundedScalars(
        item.author.id,
        LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
      ),
      handle: boundedScalars(
        item.author.handle,
        LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
      ),
      displayName: boundedScalars(
        item.author.displayName,
        LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
      ),
      avatarUrl: bounded(
        item.author.avatarUrl,
        LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
      ),
    },
    content: {
      text: bounded(
        item.content.text,
        LIBRARY_CORE_SEARCH_RESULT_TEXT_MAXIMUM_SCALARS,
      ),
      mediaUrls: item.content.mediaUrls
        .slice(0, mediaCount)
        .map((value) =>
          boundedScalars(
            value,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
        ),
      mediaTypes: item.content.mediaTypes.slice(0, mediaCount),
      linkPreview: item.content.linkPreview
        ? {
            url: boundedScalars(
              item.content.linkPreview.url,
              LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
            ),
            title: bounded(
              item.content.linkPreview.title,
              LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
            ),
            description: bounded(
              item.content.linkPreview.description,
              LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
            ),
          }
        : undefined,
    },
    topics: boundedTags(item.topics) ?? [],
    userState: {
      hidden: item.userState.hidden,
      readAt: item.userState.readAt,
      saved: item.userState.saved,
      savedAt: item.userState.savedAt,
      archived: item.userState.archived,
      archivedAt: item.userState.archivedAt,
      liked: item.userState.liked,
      likedAt: item.userState.likedAt,
      likedSyncedAt: item.userState.likedSyncedAt,
      seenSyncedAt: item.userState.seenSyncedAt,
      tags: boundedTags(item.userState.tags) ?? [],
      highlights: item.userState.highlights
        ?.slice(0, LIBRARY_CORE_SEARCH_RESULT_HIGHLIGHT_LIMIT)
        .map((highlight) => ({
          text: boundedScalars(
            highlight.text,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          note: bounded(
            highlight.note,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          createdAt: highlight.createdAt,
        })),
    },
    engagement: item.engagement
      ? {
          likes: item.engagement.likes,
          reposts: item.engagement.reposts,
          comments: item.engagement.comments,
          views: item.engagement.views,
        }
      : undefined,
    timeRange: item.timeRange
      ? {
          startsAt: item.timeRange.startsAt,
          endsAt: item.timeRange.endsAt,
          kind: item.timeRange.kind,
        }
      : undefined,
    priority: item.priority,
    priorityComputedAt: item.priorityComputedAt,
    contentSignals: item.contentSignals
      ? {
          version: item.contentSignals.version,
          method: item.contentSignals.method,
          inferredAt: item.contentSignals.inferredAt,
          scores: Object.fromEntries(
            CONTENT_SIGNAL_KEYS.flatMap((signal) => {
              const score = item.contentSignals?.scores[signal];
              return typeof score === "number" && Number.isFinite(score)
                ? [[signal, score]]
                : [];
            }),
          ),
          tags: boundedTags(item.contentSignals.tags) ?? [],
        }
      : undefined,
    preservedContent: item.preservedContent
      ? {
          text: boundedScalars(
            item.preservedContent.text,
            LIBRARY_CORE_SEARCH_PRESERVED_TEXT_MAXIMUM_SCALARS,
          ),
          author: bounded(
            item.preservedContent.author,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          publishedAt: item.preservedContent.publishedAt,
          wordCount: item.preservedContent.wordCount,
          readingTime: item.preservedContent.readingTime,
          preservedAt: item.preservedContent.preservedAt,
        }
      : undefined,
    sourceUrl: bounded(
      item.sourceUrl,
      LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
    ),
    eventCandidate: item.eventCandidate
      ? {
          version: item.eventCandidate.version,
          method: item.eventCandidate.method,
          detectedAt: item.eventCandidate.detectedAt,
          confidence: item.eventCandidate.confidence,
          title: bounded(
            item.eventCandidate.title,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          timezone: bounded(
            item.eventCandidate.timezone,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          locationName: bounded(
            item.eventCandidate.locationName,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          locationUrl: bounded(
            item.eventCandidate.locationUrl,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          evidence: bounded(
            item.eventCandidate.evidence,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          startsAt: item.eventCandidate.startsAt,
          endsAt: item.eventCandidate.endsAt,
        }
      : undefined,
    location: item.location
      ? {
          name: boundedScalars(
            item.location.name,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          url: bounded(
            item.location.url,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          source: item.location.source,
          coordinates: item.location.coordinates
            ? {
                lat: item.location.coordinates.lat,
                lng: item.location.coordinates.lng,
              }
            : undefined,
        }
      : undefined,
    rssSource: item.rssSource
      ? {
          feedUrl: boundedScalars(
            item.rssSource.feedUrl,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          feedTitle: boundedScalars(
            item.rssSource.feedTitle,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          siteUrl: boundedScalars(
            item.rssSource.siteUrl,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
        }
      : undefined,
    fbGroup: item.fbGroup
      ? {
          id: boundedScalars(
            item.fbGroup.id,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          name: boundedScalars(
            item.fbGroup.name,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          url: boundedScalars(
            item.fbGroup.url,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
        }
      : undefined,
  };
  const encodedBytes = new TextEncoder().encode(
    JSON.stringify(projected),
  ).byteLength;
  if (encodedBytes > LIBRARY_CORE_SEARCH_RESULT_MAXIMUM_BYTES) {
    throw new Error(
      "Library Core search result projection exceeds its byte limit",
    );
  }
  return projected;
}
