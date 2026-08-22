import type { MapMode, Person } from "@freed/shared";
import {
  LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID,
  LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID,
  LIBRARY_CORE_RSS_FEED_PAGE_QUERY_ID,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedPageResponseV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreRssFeedPageResponseV1,
} from "@freed/shared/library-core";
import type {
  BuildIdentityGraphAtlasModelInput,
  IdentityGraphAccountSource,
  IdentityGraphPersonSource,
  IdentityGraphRssFeedSource,
} from "./identity-graph-atlas.js";

export const FRIENDS_GALAXY_SQLITE_SOURCE_ROW_CAP = 100_000;

export type FriendsGalaxySqliteSourcePage =
  | LibraryCorePersonGraphPageResponseV1
  | LibraryCoreAccountGraphPageResponseV1
  | LibraryCoreRssFeedPageResponseV1;

export interface FriendsGalaxySqliteSourcePageInput {
  readonly cursor: string | null;
  readonly page: unknown;
}

export interface FriendsGalaxySqliteSourceConfig {
  readonly height: number;
  readonly mode: MapMode;
  readonly width: number;
}

export interface FriendsGalaxySqliteSourceProgress {
  readonly acceptedRows: number;
  readonly complete: boolean;
  readonly queryId: FriendsGalaxySqliteSourcePage["queryId"];
  readonly totalRows: number;
}

interface FriendsGalaxySqliteSourceFence {
  readonly generationId: string;
  readonly layoutRevision: number;
  readonly projectionRevision: number;
  readonly transitionSequence: number;
}

type SourcePhase =
  | typeof LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID
  | typeof LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID
  | typeof LIBRARY_CORE_RSS_FEED_PAGE_QUERY_ID
  | "complete";

const EMPTY_ACTIVITY = Object.freeze({
  buildMs: 0,
  itemCount: 0,
  rss: Object.freeze({}),
  social: Object.freeze({}),
});

function sourceFence(
  source: LibraryCoreFeedPageSourceV1,
  layoutRevision: number,
): FriendsGalaxySqliteSourceFence {
  return Object.freeze({
    generationId: source.generationId,
    layoutRevision,
    projectionRevision: source.projectionRevision,
    transitionSequence: source.transitionSequence,
  });
}

function sameFence(
  left: FriendsGalaxySqliteSourceFence,
  right: FriendsGalaxySqliteSourceFence,
): boolean {
  return left.generationId === right.generationId &&
    left.layoutRevision === right.layoutRevision &&
    left.projectionRevision === right.projectionRevision &&
    left.transitionSequence === right.transitionSequence;
}

function nextPhase(phase: Exclude<SourcePhase, "complete">): SourcePhase {
  if (phase === LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID) {
    return LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID;
  }
  if (phase === LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID) {
    return LIBRARY_CORE_RSS_FEED_PAGE_QUERY_ID;
  }
  return "complete";
}

function graphPosition(
  row: Readonly<{
    graphPinned: boolean;
    graphX: number | null;
    graphY: number | null;
  }>,
): Readonly<{ graphPinned?: boolean; graphX?: number; graphY?: number }> {
  return row.graphPinned
    ? Object.freeze({
        graphPinned: true,
        graphX: row.graphX!,
        graphY: row.graphY!,
      })
    : Object.freeze({});
}

function requestFor(
  queryId: Exclude<SourcePhase, "complete">,
  cursor: string | null,
) {
  return Object.freeze({
    cancellationId: "friends-galaxy-sqlite-source",
    cursor,
    limit: LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_LIMIT,
    queryId,
    readerSessionId: "friends-galaxy-sqlite-source",
    schemaVersion: 1 as const,
  });
}

export class FriendsGalaxySqliteSourceAccumulator {
  readonly #config: FriendsGalaxySqliteSourceConfig;
  readonly #persons: IdentityGraphPersonSource[] = [];
  readonly #accounts: Record<string, IdentityGraphAccountSource> = {};
  readonly #feeds: Record<string, IdentityGraphRssFeedSource> = {};
  #phase: SourcePhase = LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID;
  #expectedCursor: string | null = null;
  #fence: FriendsGalaxySqliteSourceFence | null = null;
  #lastIdentity: string | null = null;
  #totalRows = 0;
  #taken = false;

  constructor(config: FriendsGalaxySqliteSourceConfig) {
    if (
      !Number.isFinite(config.width) ||
      config.width <= 0 ||
      !Number.isFinite(config.height) ||
      config.height <= 0
    ) {
      throw new Error("Friends Galaxy SQLite source dimensions are invalid.");
    }
    this.#config = Object.freeze({ ...config });
  }

  get complete(): boolean {
    return this.#phase === "complete";
  }

  get fence(): FriendsGalaxySqliteSourceFence | null {
    return this.#fence;
  }

  append(input: FriendsGalaxySqliteSourcePageInput): FriendsGalaxySqliteSourceProgress {
    if (this.#taken || this.#phase === "complete") {
      throw new Error("Friends Galaxy SQLite source is already complete.");
    }
    if (input.cursor !== this.#expectedCursor) {
      throw new Error("Friends Galaxy SQLite source page cursor is not contiguous.");
    }
    const request = requestFor(this.#phase, input.cursor);
    const parsed = this.#phase === LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID
      ? parseLibraryCorePersonGraphPageResponseV1(input.page, request)
      : this.#phase === LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID
        ? parseLibraryCoreAccountGraphPageResponseV1(input.page, request)
        : parseLibraryCoreRssFeedPageResponseV1(input.page, request);
    if (!parsed.ok) throw new Error(parsed.error);
    const page = parsed.value;
    const fence = sourceFence(page.source, page.layoutRevision);
    if (this.#fence && !sameFence(this.#fence, fence)) {
      throw new Error("Friends Galaxy SQLite source page moved to a different source fence.");
    }
    this.#fence ??= fence;
    for (const row of page.rows) {
      const identity = "id" in row ? row.id : row.url;
      if (this.#lastIdentity !== null && identity <= this.#lastIdentity) {
        throw new Error("Friends Galaxy SQLite source identities are not strictly increasing.");
      }
      this.#lastIdentity = identity;
      this.#totalRows += 1;
      if (this.#totalRows > FRIENDS_GALAXY_SQLITE_SOURCE_ROW_CAP) {
        throw new Error("Friends Galaxy SQLite source exceeded its semantic row cap.");
      }
      if (page.queryId === LIBRARY_CORE_PERSON_GRAPH_PAGE_QUERY_ID) {
        const person = row as LibraryCorePersonGraphPageResponseV1["rows"][number];
        this.#persons.push(Object.freeze({
          avatarUrl: person.avatarUrl ?? undefined,
          careLevel: person.careLevel as Person["careLevel"],
          id: person.id,
          name: person.name,
          relationshipStatus: person.relationshipStatus,
          ...graphPosition(person),
        }));
      } else if (page.queryId === LIBRARY_CORE_ACCOUNT_GRAPH_PAGE_QUERY_ID) {
        const account = row as LibraryCoreAccountGraphPageResponseV1["rows"][number];
        if (account.kind !== "social") continue;
        this.#accounts[account.id] = Object.freeze({
          activityCount: account.activityCount,
          avatarUrl: account.avatarUrl ?? undefined,
          displayName: account.displayName ?? undefined,
          externalId: account.externalId,
          handle: account.handle ?? undefined,
          id: account.id,
          kind: account.kind,
          latestActivityAt: account.latestActivityAt ?? undefined,
          personId: account.personId ?? undefined,
          provider: account.provider,
          ...graphPosition(account),
        });
      } else {
        const feed = row as LibraryCoreRssFeedPageResponseV1["rows"][number];
        this.#feeds[feed.url] = Object.freeze({
          activityCount: feed.activityCount,
          enabled: feed.enabled,
          imageUrl: feed.imageUrl ?? undefined,
          latestActivityAt: feed.latestActivityAt ?? undefined,
          title: feed.title,
          url: feed.url,
        });
      }
    }
    const acceptedRows = page.rows.length;
    this.#expectedCursor = page.nextCursor;
    if (page.nextCursor === null) {
      this.#phase = nextPhase(this.#phase);
      this.#expectedCursor = null;
      this.#lastIdentity = null;
    }
    return Object.freeze({
      acceptedRows,
      complete: this.complete,
      queryId: page.queryId,
      totalRows: this.#totalRows,
    });
  }

  take(): BuildIdentityGraphAtlasModelInput {
    if (this.#taken || !this.complete || !this.#fence) {
      throw new Error("Friends Galaxy SQLite source is not ready.");
    }
    this.#taken = true;
    return Object.freeze({
      accounts: Object.freeze(this.#accounts),
      activitySummaries: EMPTY_ACTIVITY,
      feeds: Object.freeze(this.#feeds),
      height: this.#config.height,
      mode: this.#config.mode,
      persons: Object.freeze(this.#persons),
      width: this.#config.width,
    });
  }
}
