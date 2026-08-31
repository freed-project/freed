import type {
  LibraryCoreAccountGraphPageResponseV1,
  LibraryCoreLowercaseHex64,
  LibraryCorePersonGraphPageResponseV1,
  LibraryCoreRssFeedPageResponseV1,
} from "@freed/shared/library-core";
import {
  decodeLibraryCoreIdentityPageCursorV1,
  encodeLibraryCoreIdentityPageCursorV1,
} from "@freed/shared/library-core";
import {
  FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
  type FriendsGalaxyProductWorkerSourceResponse,
} from "../../src/lib/friends-galaxy-product-worker-protocol.js";
import type {
  FriendsGalaxyProductWorkerNormalizedSourceInput,
  FriendsGalaxySqliteGraphPageRequest,
  FriendsGalaxySqliteGraphQuery,
} from "../../src/lib/friends-galaxy-product-worker-client.js";
import { FriendsGalaxyProductWorkerService } from "../../src/lib/friends-galaxy-product-worker-service.js";
import type { FriendsGalaxySqliteSourcePage } from "../../src/lib/friends-galaxy-sqlite-source.js";
import { createFriendsGalaxyProductSource } from "./product-source-fixture.js";

const QUERY_IDS = [
  "person_graph_page_v1",
  "account_graph_page_v1",
  "rss_feed_page_v1",
] as const;

interface ProductSqliteSourceFixture {
  readonly accountRows: LibraryCoreAccountGraphPageResponseV1["rows"];
  readonly personRows: LibraryCorePersonGraphPageResponseV1["rows"];
  readonly source: LibraryCorePersonGraphPageResponseV1["source"];
}

export interface ProductSqliteSourceOptions {
  readonly accountCount: number;
  readonly personCount: number;
  readonly sourceRevision?: number;
  readonly viewport?: FriendsGalaxyProductWorkerNormalizedSourceInput["viewport"];
  readonly backgroundStarCount?: number;
  readonly backgroundSeed?: string;
}

function createFixture(options: ProductSqliteSourceOptions): ProductSqliteSourceFixture {
  const source = createFriendsGalaxyProductSource(options.personCount, options.accountCount);
  const personNameById = new Map(source.persons.map((person) => [person.id, person.name]));
  return {
    accountRows: Object.values(source.accounts)
      .map((account) => ({
        activityCount: 0,
        avatarUrl: account.avatarUrl ?? null,
        discoveredFrom: "capture" as const,
        displayName: account.displayName ?? null,
        externalId: account.externalId!,
        firstSeenAt: 1,
        followRosterActive: true,
        graphPinned: false,
        graphUpdatedAt: null,
        graphX: null,
        graphY: null,
        handle: account.handle ?? null,
        id: account.id,
        kind: "social" as const,
        lastSeenAt: 1,
        latestActivityAt: null,
        personId: account.personId ?? null,
        personName: account.personId ? personNameById.get(account.personId) ?? null : null,
        provider: account.provider!,
        updatedAt: 1,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    personRows: source.persons
      .map((person) => ({
        avatarUrl: person.avatarUrl ?? null,
        careLevel: person.careLevel,
        graphPinned: false,
        graphUpdatedAt: null,
        graphX: null,
        graphY: null,
        id: person.id,
        lastReachOutAt: null,
        name: person.name,
        reachOutIntervalDays: null,
        relationshipStatus: person.relationshipStatus,
        updatedAt: 1,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    source: {
      generationId: "f".repeat(64) as LibraryCoreLowercaseHex64,
      projectionRevision: options.sourceRevision ?? 1,
      transitionSequence: options.sourceRevision ?? 1,
    },
  };
}

function pageOffset<Row>(
  rows: readonly Row[],
  cursor: string | null,
  identity: (row: Row) => string,
): number {
  if (cursor === null) return 0;
  const decoded = decodeLibraryCoreIdentityPageCursorV1(cursor);
  if (!decoded.ok) {
    throw new Error("Invalid product SQLite fixture cursor.");
  }
  const rowIndex = rows.findIndex((row) => identity(row) === decoded.value.entityId);
  if (rowIndex < 0) throw new Error("Unknown product SQLite fixture cursor.");
  return rowIndex + 1;
}

function pageRows<Row>(
  rows: readonly Row[],
  cursor: string | null,
  limit: number,
  identity: (row: Row) => string,
  fixture: ProductSqliteSourceFixture,
) {
  const offset = pageOffset(rows, cursor, identity);
  const page = rows.slice(offset, offset + limit);
  return {
    nextCursor: offset + page.length < rows.length && page.length > 0
      ? encodeLibraryCoreIdentityPageCursorV1({
          entityId: identity(page.at(-1)!),
          generationId: fixture.source.generationId,
          layoutRevision: 1,
          projectionRevision: fixture.source.projectionRevision,
          transitionSequence: fixture.source.transitionSequence,
        })
      : null,
    rows: page,
  };
}

export function createFriendsGalaxyProductSqliteQuery(
  options: ProductSqliteSourceOptions,
): FriendsGalaxySqliteGraphQuery {
  const fixture = createFixture(options);
  return async (request: FriendsGalaxySqliteGraphPageRequest) => {
    const selected: { nextCursor: string | null; rows: readonly unknown[] } =
      request.queryId === "person_graph_page_v1"
      ? pageRows(fixture.personRows, request.cursor, request.limit, (row) => row.id, fixture)
      : request.queryId === "account_graph_page_v1"
        ? pageRows(fixture.accountRows, request.cursor, request.limit, (row) => row.id, fixture)
        : pageRows([], request.cursor, request.limit, () => "", fixture);
    return {
      layoutRevision: 1,
      nextCursor: selected.nextCursor,
      queryId: request.queryId,
      rows: selected.rows,
      schemaVersion: 1,
      source: fixture.source,
    } as unknown as FriendsGalaxySqliteSourcePage;
  };
}

export function productNormalizedSourceInput(
  options: ProductSqliteSourceOptions,
): FriendsGalaxyProductWorkerNormalizedSourceInput {
  return {
    backgroundSeed: options.backgroundSeed ?? "product-sqlite-source",
    backgroundStarCount: options.backgroundStarCount ?? 1_000,
    mode: "all_content",
    sourceRevision: options.sourceRevision ?? 1,
    viewport: options.viewport ?? { height: 844, width: 390 },
  };
}

export function buildFriendsGalaxyProductServiceSource(
  service: FriendsGalaxyProductWorkerService,
  options: ProductSqliteSourceOptions,
): FriendsGalaxyProductWorkerSourceResponse {
  const fixture = createFixture(options);
  const input = productNormalizedSourceInput(options);
  let requestId = 1;
  let response = service.handle({
    ...input,
    kind: "normalized-source-begin",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId: requestId++,
  });
  for (const queryId of QUERY_IDS) {
    let cursor: string | null = null;
    do {
      const selected: { nextCursor: string | null; rows: readonly unknown[] } =
        queryId === "person_graph_page_v1"
        ? pageRows(fixture.personRows, cursor, 128, (row) => row.id, fixture)
        : queryId === "account_graph_page_v1"
          ? pageRows(fixture.accountRows, cursor, 128, (row) => row.id, fixture)
          : pageRows([], cursor, 128, () => "", fixture);
      const page = {
        layoutRevision: 1,
        nextCursor: selected.nextCursor,
        queryId,
        rows: selected.rows,
        schemaVersion: 1,
        source: fixture.source,
      } as FriendsGalaxySqliteSourcePage;
      response = service.handle({
        cursor,
        kind: "normalized-source-page",
        page,
        protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
        requestId: requestId++,
        sourceRevision: input.sourceRevision,
      });
      if (response.kind === "error") {
        throw new Error(`Normalized ${queryId} fixture failed: ${response.message}`);
      }
      cursor = selected.nextCursor;
    } while (cursor !== null);
  }
  response = service.handle({
    kind: "normalized-source-commit",
    protocolVersion: FRIENDS_GALAXY_PRODUCT_WORKER_PROTOCOL_VERSION,
    requestId,
    sourceRevision: input.sourceRevision,
  });
  if (response.kind !== "source-ready") {
    throw new Error(
      response.kind === "error"
        ? `Expected normalized product source scene: ${response.message}`
        : "Expected normalized product source scene.",
    );
  }
  return response;
}
