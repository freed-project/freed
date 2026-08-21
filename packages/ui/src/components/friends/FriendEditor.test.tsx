/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { BaseAppState, Friend } from "@freed/shared";
import type {
  LibraryCoreAccountDetailResponseV1,
  LibraryCoreAccountGraphPageResponseV1,
} from "@freed/shared/library-core";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../../context/PlatformContext.js";
import { FriendEditor } from "./FriendEditor.js";

const SOURCE = Object.freeze({
  generationId: "a".repeat(64),
  projectionRevision: 1,
  transitionSequence: 1,
});

function accountRow(index: number) {
  const suffix = index.toLocaleString("en-US", {
    minimumIntegerDigits: 2,
    useGrouping: false,
  });
  return {
    activityCount: 1,
    avatarUrl: null,
    discoveredFrom: index === 1 ? "story_author" : "captured_item",
    displayName: `Candidate ${suffix}`,
    externalId: `author-${suffix}`,
    firstSeenAt: index === 1 ? 1 : index + 10,
    followRosterActive: null,
    graphPinned: false,
    graphUpdatedAt: null,
    graphX: null,
    graphY: null,
    handle: `author-${suffix}`,
    id: `account-${suffix}`,
    kind: "social",
    lastSeenAt: index === 1 ? 101 : index + 100,
    latestActivityAt: index + 100,
    personId: null,
    provider: "instagram",
    updatedAt: index + 100,
  } as const;
}

function accountPage(
  rows: readonly ReturnType<typeof accountRow>[],
  nextCursor: string | null,
): LibraryCoreAccountGraphPageResponseV1 {
  return {
    layoutRevision: 0,
    nextCursor,
    queryId: "account_graph_page_v1",
    rows,
    schemaVersion: 1,
    source: SOURCE,
  };
}

function accountDetail(
  row: ReturnType<typeof accountRow>,
): LibraryCoreAccountDetailResponseV1 {
  return {
    account: {
      address: null,
      avatarUrl: row.avatarUrl,
      createdAt: row.firstSeenAt,
      discoveredFrom: row.discoveredFrom,
      displayName: row.displayName,
      email: null,
      externalId: row.externalId,
      firstSeenAt: row.firstSeenAt,
      followRosterActive: null,
      followRosterRoles: [],
      followRosterSyncedAt: null,
      handle: row.handle,
      id: row.id,
      importedAt: null,
      kind: row.kind,
      lastSeenAt: row.lastSeenAt,
      personId: null,
      phone: null,
      profileUrl: null,
      provider: row.provider,
      sampleBatchId: null,
      sampleGeneratedAt: null,
      sampleGeneratorVersion: null,
      updatedAt: row.updatedAt,
    },
    queryId: "account_detail_v1",
    schemaVersion: 1,
    source: SOURCE,
  };
}

function buttonContaining(
  container: HTMLElement | null,
  text: string,
): HTMLButtonElement | null {
  if (!container) return null;
  return (
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(text),
    ) ?? null
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setInputValue(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function platformConfig(
  store: PlatformConfig["store"],
  queryLibraryCore?: PlatformConfig["queryLibraryCore"],
): PlatformConfig {
  return {
    store,
    queryLibraryCore,
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: null,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    SubstackSettingsContent: null,
    MediumSettingsContent: null,
    GoogleContactsSettingsContent: null,
  };
}

describe("FriendEditor SQLite candidates", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    vi.useRealTimers();
    root = null;
    container = null;
  });

  function renderEditor(
    platform: PlatformConfig,
    onSave: ReturnType<typeof vi.fn> = vi.fn(),
  ): ReturnType<typeof vi.fn> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PlatformProvider value={platform}>
          <FriendEditor
            draft={{ name: "New Friend" }}
            onSave={onSave}
            onCancel={() => undefined}
          />
        </PlatformProvider>,
      );
    });
    return onSave;
  }

  it("retains the best 50 unlinked Account rows and revalidates a selection", async () => {
    const rows = Array.from({ length: 55 }, (_, index) => accountRow(index));
    const linkedFriend = {
      sources: [
        {
          platform: "instagram",
          authorId: "author-00",
          handle: "author-00",
          displayName: "Candidate 00",
        },
      ],
    } as unknown as Friend;
    const useStore = create(
      () =>
        ({
          friends: { linked: linkedFriend },
          searchCorpusVersion: 1,
        }) as unknown as BaseAppState,
    );
    const query = vi.fn(
      async (request: {
        queryId: string;
        cursor?: string | null;
        accountId?: string;
      }) => {
        if (request.queryId === "account_detail_v1") {
          const row = rows.find(
            (candidate) => candidate.id === request.accountId,
          )!;
          return accountDetail(row);
        }
        return request.cursor === null
          ? accountPage(rows.slice(0, 32), "page-2")
          : accountPage(rows.slice(32), null);
      },
    );
    const onSave = renderEditor(
      platformConfig(
        useStore,
        query as unknown as NonNullable<PlatformConfig["queryLibraryCore"]>,
      ),
    );

    await flush();
    await flush();

    expect(
      container?.querySelectorAll('[data-testid="friend-author-candidate"]'),
    ).toHaveLength(50);
    expect(buttonContaining(container, "Candidate 00")).toBeNull();
    expect(buttonContaining(container, "Candidate 01")).not.toBeNull();
    expect(buttonContaining(container, "Candidate 50")).not.toBeNull();
    expect(buttonContaining(container, "Candidate 51")).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);

    await act(async () => buttonContaining(container, "Candidate 01")?.click());
    await act(async () => buttonContaining(container, "Add friend")?.click());
    await flush();

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.at(-1)?.[0]).toMatchObject({
      accountId: "account-01",
      queryId: "account_detail_v1",
    });
    expect(onSave.mock.calls[0]?.[2]?.get("instagram:author-01")).toEqual({
      firstSeenAt: 1,
      lastSeenAt: 101,
      discoveredFrom: "story_author",
    });
  });

  it("ignores a completed Account page after the Library source changes", async () => {
    const useStore = create(
      () =>
        ({ friends: {}, searchCorpusVersion: 1 }) as unknown as BaseAppState,
    );
    let finishStale:
      | ((page: LibraryCoreAccountGraphPageResponseV1) => void)
      | null = null;
    const stale = new Promise<LibraryCoreAccountGraphPageResponseV1>(
      (resolve) => {
        finishStale = resolve;
      },
    );
    let graphCalls = 0;
    const query = vi.fn(async (request: { queryId: string }) => {
      if (request.queryId !== "account_graph_page_v1") {
        throw new Error("unexpected point query");
      }
      graphCalls += 1;
      return graphCalls === 1 ? stale : accountPage([accountRow(2)], null);
    });
    renderEditor(
      platformConfig(
        useStore,
        query as unknown as NonNullable<PlatformConfig["queryLibraryCore"]>,
      ),
    );
    await flush();

    await act(async () => {
      useStore.setState({ searchCorpusVersion: 2 });
    });
    await flush();
    expect(buttonContaining(container, "Candidate 02")).not.toBeNull();

    await act(async () => {
      finishStale?.(accountPage([accountRow(1)], null));
      await stale;
    });
    await flush();
    expect(buttonContaining(container, "Candidate 01")).toBeNull();
    expect(buttonContaining(container, "Candidate 02")).not.toBeNull();
  });

  it("debounces rapid candidate searches into one replacement query", async () => {
    vi.useFakeTimers();
    const useStore = create(
      () =>
        ({ friends: {}, searchCorpusVersion: 1 }) as unknown as BaseAppState,
    );
    const query = vi.fn(async () => accountPage([accountRow(1)], null));
    renderEditor(
      platformConfig(
        useStore,
        query as unknown as NonNullable<PlatformConfig["queryLibraryCore"]>,
      ),
    );
    await flush();
    expect(query).toHaveBeenCalledOnce();

    const input = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Search profiles in your feed"]',
    );
    expect(input).not.toBeNull();
    await setInputValue(input!, "D");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    await setInputValue(input!, "De");
    await act(async () => vi.advanceTimersByTimeAsync(149));
    expect(query).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    await flush();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the SQLite query boundary is unavailable", async () => {
    const useStore = create(
      () =>
        ({ friends: {}, searchCorpusVersion: 1 }) as unknown as BaseAppState,
    );
    renderEditor(platformConfig(useStore));
    await flush();
    expect(container?.textContent).toContain(
      "Captured profiles are temporarily unavailable.",
    );
  });
});
