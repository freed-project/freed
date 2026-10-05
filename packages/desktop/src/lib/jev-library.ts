import { libraryCoreFeedCardToItemV1, normalizeLibraryCoreFeedBrowseFilterV1, createLibraryCoreOperationInstanceId, applyLibraryCoreVisibleOptimisticFieldsV1, LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION, LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION } from "@freed/shared/library-core";
import type { ContentSignals, FeedItem } from "@freed/shared";
import { isJevNative } from "./jev-client";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { readLibraryCoreAccountDetail, readLibraryCorePersonDetail } from "./library-core-item-detail-runtime";
import * as preview from "./jev-preview-library";
import { buildJevRequest } from "./jev-classification";

const sourceTokens = new WeakMap<FeedItem, string>();

/** Native evaluation reads one bounded visible window and at most 32 KiB per body. */
export async function loadJevPreviewSample(limit = 100): Promise<FeedItem[]> {
  if (!isJevNative) return preview.loadJevPreviewSample(Math.min(limit === 100 ? 500 : limit, 500));
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid Jev window size.");
  const maximum = Math.min(limit, 100);
  const items: FeedItem[] = [];
  let sourceToken: string | null = null;
  const platforms = ["facebook", "instagram", "linkedin", "mastodon", "reddit", "x"] as const;
  for (const platform of platforms) {
    if (items.length >= maximum) break;
    let retained = 0;
    // One source-fenced SQL page per platform bounds discovery without a corpus scan.
    const page = await queryNormalizedLibrary({ queryId: "feed_browse_page_v3", schemaVersion: 3,
      cursor: null, direction: "next", limit: 64, rankingClockMs: Date.now(),
      cancellationId: createLibraryCoreOperationInstanceId("jev-page", crypto.randomUUID()),
      readerSessionId: createLibraryCoreOperationInstanceId("jev-reader", crypto.randomUUID()),
      friendsPredicateSchemaVersion: LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      recommendationOrderSchemaVersion: LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
      identityMode: "all_content",
      filter: normalizeLibraryCoreFeedBrowseFilterV1({ platform }),
    });
    const pageToken = JSON.stringify(page.source);
    if (sourceToken !== null && sourceToken !== pageToken) throw new Error("The Library changed while loading Jev evidence. Load it again.");
    sourceToken = pageToken;
    const visible = await applyLibraryCoreVisibleOptimisticFieldsV1(queryNormalizedLibrary,
      page.rows.map(libraryCoreFeedCardToItemV1), page.source.projectionRevision);
    for (const row of visible) {
        if (row.userState.hidden || row.userState.archived) continue;
        if (row.contentType !== "post" && row.contentType !== "story") continue;
        const detail = await queryNormalizedLibrary({ queryId: "item_detail_v1", schemaVersion: 1, globalId: row.globalId });
        if (!detail.item) continue;
        const body = await queryNormalizedLibrary({ queryId: "item_reader_body_v1", schemaVersion: 1,
          globalId: row.globalId, bodyKind: "content", offsetBytes: 0, limitBytes: 32_004 });
        if (JSON.stringify(detail.source) !== sourceToken || JSON.stringify(body.source) !== sourceToken) throw new Error("The Library changed while loading Jev evidence. Load it again.");
        const text = body.body ? new TextDecoder().decode(Uint8Array.from(atob(body.body.bytesBase64), c => c.charCodeAt(0)), { stream: true }) : "";
        const current = libraryCoreFeedCardToItemV1(detail.item.card);
        const item = { ...current, userState: { ...current.userState, ...row.userState }, content: { ...current.content, text } };
        sourceTokens.set(item, sourceToken);
        items.push(item);
        retained += 1;
        if (items.length >= maximum || retained >= Math.ceil(maximum / platforms.length)) break;
    }
  }
  return items;
}

export async function loadJevPreviewRelationships(items: readonly FeedItem[]) {
  if (!isJevNative) return preview.loadJevPreviewRelationships(items);
  if (items.length > 100) throw new Error("Jev relationship window exceeded.");
  const relationships: Record<string, { kind: "friend" | "connection" | "unknown"; name?: string }> = Object.create(null);
  for (const item of items) {
    relationships[item.globalId] = { kind: "unknown" };
    const account = await readLibraryCoreAccountDetail(`social:${item.platform}:${item.author.id}`);
    if (!account || account.id !== `social:${item.platform}:${item.author.id}` || account.kind !== "social" || account.provider !== item.platform || account.externalId !== item.author.id || !account.personId) continue;
    const person = await readLibraryCorePersonDetail(account.personId);
    if (person && person.id === account.personId && (person.relationshipStatus === "friend" || person.relationshipStatus === "connection")) {
      relationships[item.globalId] = { kind: person.relationshipStatus, name: person.name };
    }
  }
  return relationships;
}

/** The native evaluation release does not replace durable analysis or event fields. */
export async function applyJevPreviewSignals(item: FeedItem, signals: ContentSignals): Promise<void> {
  if (!isJevNative) return preview.applyJevPreviewSignals(item, signals);
  buildJevRequest(item);
  await assertJevSourceCurrent(item);
}
export async function refreshJevPreviewLibrary(): Promise<void> {
  if (!isJevNative) await preview.refreshJevPreviewLibrary();
}

/** Recheck the native revision before any private text leaves this device. */
export async function assertJevSourceCurrent(item: FeedItem): Promise<void> {
  if (!isJevNative) return;
  const token = sourceTokens.get(item);
  const detail = await queryNormalizedLibrary({ queryId: "item_detail_v1", schemaVersion: 1, globalId: item.globalId });
  if (!token || !detail.item || JSON.stringify(detail.source) !== token) {
    throw new Error("The Library changed. Load posts again before sending them to Jev.");
  }
  const [current] = await applyLibraryCoreVisibleOptimisticFieldsV1(queryNormalizedLibrary,
    [libraryCoreFeedCardToItemV1(detail.item.card)], detail.source.projectionRevision);
  if (!current || current.userState.hidden || current.userState.archived) throw new Error("This post is no longer visible. Load posts again.");
}
