/** Closed cross-runtime contract for bounded Library Core text search. */

import type { FeedItem } from "../types.js";

export const LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_BYTES = 1_024;
export const LIBRARY_CORE_SEARCH_QUERY_MAXIMUM_TERMS = 32;
export const LIBRARY_CORE_SEARCH_DOCUMENT_MAXIMUM_TERMS = 384;
export const LIBRARY_CORE_SEARCH_PRESERVED_TEXT_MAXIMUM_SCALARS = 1_200;
export const LIBRARY_CORE_SEARCH_SCAN_ROW_LIMIT = 256;
export const LIBRARY_CORE_SEARCH_RESULT_PAGE_LIMIT = 32;
export const LIBRARY_CORE_SEARCH_RETAINED_RESULT_LIMIT = 100;
export const LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_LIMIT = 512;
export const LIBRARY_CORE_SEARCH_ACCOUNT_ALIAS_MAXIMUM_BYTES = 1_024;
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

/**
 * Normalize identically before tokenization in the browser and native fixture.
 * NFKD plus mark removal makes accented text comparable without locale state.
 */
export function normalizeLibraryCoreSearchTextV1(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKD").toLocaleLowerCase("en-US").replace(/\p{M}/gu, "")
    : "";
}

export function tokenizeLibraryCoreSearchTextV1(
  value: unknown,
  maximumTerms = LIBRARY_CORE_SEARCH_DOCUMENT_MAXIMUM_TERMS,
): readonly string[] {
  if (!Number.isSafeInteger(maximumTerms) || maximumTerms < 0) {
    throw new RangeError("Library Core search term limit is invalid");
  }
  const matches =
    normalizeLibraryCoreSearchTextV1(value).match(/[\p{L}\p{N}_@#]+/gu);
  if (!matches || maximumTerms === 0) return Object.freeze([]);
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of matches) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length === maximumTerms) break;
  }
  return Object.freeze(terms);
}

function boundedEditDistance(
  leftInput: string,
  rightInput: string,
  maximum: number,
): number {
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
  const queryLength = Array.from(query).length;
  if (queryLength < 4) return 0;
  const maximum = Math.max(1, Math.floor(queryLength * 0.2));
  const distance = boundedEditDistance(query, candidate, maximum);
  return distance <= maximum ? weight * 2 - distance / 10 : 0;
}

export function scoreLibraryCoreSearchFieldsV1(
  fields: readonly LibraryCoreSearchFieldV1[],
  queryTerms: readonly string[],
): number {
  let total = 0;
  for (const query of queryTerms) {
    let best = 0;
    for (const field of fields) {
      for (const candidate of field.terms) {
        best = Math.max(
          best,
          scoreLibraryCoreSearchTermV1(query, candidate, field.weight),
        );
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export function compareLibraryCoreSearchIdentityV1(
  left: string,
  right: string,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedScalars(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
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
    ...item,
    author: {
      ...item.author,
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
      ...item.content,
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
      ...item.userState,
      tags: boundedTags(item.userState.tags) ?? [],
      highlights: item.userState.highlights
        ?.slice(0, LIBRARY_CORE_SEARCH_RESULT_HIGHLIGHT_LIMIT)
        .map((highlight) => ({
          ...highlight,
          text: boundedScalars(
            highlight.text,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          note: bounded(
            highlight.note,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
        })),
    },
    contentSignals: item.contentSignals
      ? {
          ...item.contentSignals,
          tags: boundedTags(item.contentSignals.tags) ?? [],
        }
      : undefined,
    preservedContent: item.preservedContent
      ? {
          ...item.preservedContent,
          html: undefined,
          text: boundedScalars(
            item.preservedContent.text,
            LIBRARY_CORE_SEARCH_PRESERVED_TEXT_MAXIMUM_SCALARS,
          ),
          author: bounded(
            item.preservedContent.author,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
        }
      : undefined,
    sourceUrl: bounded(
      item.sourceUrl,
      LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
    ),
    eventCandidate: item.eventCandidate
      ? {
          ...item.eventCandidate,
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
        }
      : undefined,
    location: item.location
      ? {
          ...item.location,
          name: boundedScalars(
            item.location.name,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
          url: bounded(
            item.location.url,
            LIBRARY_CORE_SEARCH_RESULT_STRING_MAXIMUM_SCALARS,
          ),
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
