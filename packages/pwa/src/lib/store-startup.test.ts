import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultPreferences, type Account, type ContentSignalBackfillSummary, type Person, type SampleLibraryData } from "@freed/shared";
import type { DocState } from "./automerge-types";
import {
  getDeviceDisplayPreferences,
  resetDeviceDisplayPreferencesForTests,
} from "@freed/ui/lib/device-display-preferences";
import {
  getDeviceAccountGraphLayout,
  getDevicePersonGraphLayout,
  resetDeviceGraphLayoutForTests,
  setDeviceAccountGraphPosition,
  setDevicePersonGraphPosition,
} from "@freed/ui/lib/device-graph-layout";

const automerge = vi.hoisted(() => {
  const resolved = () => vi.fn(() => Promise.resolve());
  return {
    initDoc: vi.fn(),
    subscribe: vi.fn(),
    docAddFeedItems: resolved(),
    docAddSampleLibraryData: resolved(),
    docAddRssFeed: resolved(),
    docRemoveRssFeed: resolved(),
    docRemoveAllFeeds: resolved(),
    docUpdateRssFeed: resolved(),
    docUpdateFeedItem: resolved(),
    docBackfillContentSignals: vi.fn(),
    docMarkAsRead: resolved(),
    docMarkItemsAsRead: resolved(),
    docMarkAllAsRead: resolved(),
    docToggleSaved: resolved(),
    docRemoveFeedItem: resolved(),
    docClearSampleData: vi.fn(() => Promise.resolve({ feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 })),
    docToggleArchived: resolved(),
    docToggleLiked: resolved(),
    docArchiveAllReadUnsaved: resolved(),
    docUnarchiveSavedItems: resolved(),
    docDeleteAllArchived: resolved(),
    docPruneArchivedItems: resolved(),
    docUpdatePreferences: resolved(),
    docAddAccount: resolved(),
    docAddAccounts: resolved(),
    docAddPerson: resolved(),
    docAddPersons: resolved(),
    docUpdateAccount: resolved(),
    docUpdatePerson: resolved(),
    docUpsertConnectionPersons: resolved(),
    docRemoveAccount: resolved(),
    docRemovePerson: resolved(),
    docLogReachOut: resolved(),
  };
});

vi.mock("./automerge", () => automerge);

vi.mock("./reader-cache", () => ({
  pinReaderItemInPwa: vi.fn(),
}));

vi.mock("@freed/ui/lib/bug-report", () => ({
  recordBugReportEvent: vi.fn(),
  recordRuntimeError: vi.fn(),
}));

import { quiescePwaStartupMigrations, useAppStore } from "./store";

function makeDocState(): DocState {
  return {
    items: [],
    searchCorpusVersion: 0,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    feedUnreadCounts: {},
    feedTotalCounts: {},
    totalUnreadCount: 0,
    unreadCountByPlatform: {},
    totalItemCount: 0,
    itemCountByPlatform: {},
    totalArchivableCount: 0,
    archivableCountByPlatform: {},
    archivableFeedCounts: {},
    mapFriendLocationCount: 0,
    mapAllContentLocationCount: 0,
  };
}

function makeBackfillSummary(
  updated: number,
  remaining: number,
): ContentSignalBackfillSummary {
  return {
    version: 3,
    total: updated + remaining,
    scanned: updated,
    updated,
    remaining,
    counts: {} as ContentSignalBackfillSummary["counts"],
    multiSignalCount: 0,
    untaggedCount: 0,
    samples: {},
  };
}

describe("PWA store startup maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetDeviceDisplayPreferencesForTests();
    resetDeviceGraphLayoutForTests();
    useAppStore.setState(useAppStore.getInitialState(), true);
    automerge.initDoc.mockResolvedValue(makeDocState());
    automerge.docBackfillContentSignals.mockResolvedValue(makeBackfillSummary(0, 0));
  });

  it("keeps graph placement local to this PWA", async () => {
    const person: Person = {
      id: "person-local-pin",
      name: "Local Pin",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: 1,
      updatedAt: 1,
    };
    const account: Account = {
      id: "account-local-pin",
      kind: "social",
      provider: "instagram",
      externalId: "local-pin",
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    };
    useAppStore.setState({
      persons: { [person.id]: person },
      accounts: { [account.id]: account },
    });

    await useAppStore.getState().updatePerson(person.id, {
      graphX: 11,
      graphY: 22,
      graphPinned: true,
    });

    expect(getDevicePersonGraphLayout(person.id)).toMatchObject({ graphX: 11, graphY: 22 });
    expect(useAppStore.getState().persons[person.id]).not.toHaveProperty("graphX");
    expect(automerge.docUpdatePerson).not.toHaveBeenCalled();
  });

  it("prunes pins from successful document states across cascades and replacements", async () => {
    const cascadePerson: Person = {
      id: "person-cascade",
      name: "Cascade",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: 1,
      updatedAt: 1,
    };
    const samplePerson = { ...cascadePerson, id: "person-sample", name: "Sample" };
    const updatedPerson = { ...cascadePerson, id: "person-updated", name: "Updated" };
    const livePerson = { ...cascadePerson, id: "person-live", name: "Live" };
    const makeAccount = (id: string, personId: string): Account => ({
      id,
      personId,
      kind: "social",
      provider: "instagram",
      externalId: id,
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    });
    const linkedAccount = makeAccount("account-linked-cascade", cascadePerson.id);
    const sampleAccount = makeAccount("account-sample", samplePerson.id);
    const displacedAccount = makeAccount("account-displaced", updatedPerson.id);
    const liveAccount = makeAccount("account-live", livePerson.id);
    const initial = makeDocState();
    initial.persons = {
      [cascadePerson.id]: cascadePerson,
      [samplePerson.id]: samplePerson,
      [updatedPerson.id]: updatedPerson,
      [livePerson.id]: livePerson,
    };
    initial.accounts = {
      [linkedAccount.id]: linkedAccount,
      [sampleAccount.id]: sampleAccount,
      [displacedAccount.id]: displacedAccount,
      [liveAccount.id]: liveAccount,
    };
    automerge.initDoc.mockResolvedValueOnce(initial);
    automerge.subscribe.mockReturnValueOnce(() => {});

    await useAppStore.getState().initialize();
    for (const [index, person] of Object.values(initial.persons).entries()) {
      setDevicePersonGraphPosition(person.id, index + 1, index + 2, 100 + index);
    }
    for (const [index, account] of Object.values(initial.accounts).entries()) {
      setDeviceAccountGraphPosition(account.id, index + 10, index + 20, 200 + index);
    }

    const replacementAccount = makeAccount("account-replacement", updatedPerson.id);
    const afterSuccessfulMutations = makeDocState();
    afterSuccessfulMutations.persons = {
      [updatedPerson.id]: updatedPerson,
      [livePerson.id]: livePerson,
    };
    afterSuccessfulMutations.accounts = {
      [replacementAccount.id]: replacementAccount,
      [liveAccount.id]: liveAccount,
    };
    const subscriber = automerge.subscribe.mock.calls.at(-1)?.[0] as
      | ((state: DocState) => void)
      | undefined;
    expect(subscriber).toBeTypeOf("function");
    subscriber?.(afterSuccessfulMutations);

    expect(getDevicePersonGraphLayout(cascadePerson.id)).toBeNull();
    expect(getDeviceAccountGraphLayout(linkedAccount.id)).toBeNull();
    expect(getDevicePersonGraphLayout(samplePerson.id)).toBeNull();
    expect(getDeviceAccountGraphLayout(sampleAccount.id)).toBeNull();
    expect(getDeviceAccountGraphLayout(displacedAccount.id)).toBeNull();
    expect(getDevicePersonGraphLayout(updatedPerson.id)).not.toBeNull();
    expect(getDevicePersonGraphLayout(livePerson.id)).not.toBeNull();
    expect(getDeviceAccountGraphLayout(liveAccount.id)).not.toBeNull();

    subscriber?.(initial);
    expect(getDevicePersonGraphLayout(cascadePerson.id)).toBeNull();
    expect(getDeviceAccountGraphLayout(linkedAccount.id)).toBeNull();
    expect(getDevicePersonGraphLayout(samplePerson.id)).toBeNull();
    expect(getDeviceAccountGraphLayout(sampleAccount.id)).toBeNull();
    expect(getDeviceAccountGraphLayout(displacedAccount.id)).toBeNull();
  });

  it("backfills content signals after initialization until no stale items remain", async () => {
    automerge.docBackfillContentSignals
      .mockResolvedValueOnce(makeBackfillSummary(200, 5))
      .mockResolvedValueOnce(makeBackfillSummary(5, 0));

    await useAppStore.getState().initialize();

    await vi.waitFor(() => {
      expect(automerge.docPruneArchivedItems).toHaveBeenCalledWith(30 * 24 * 60 * 60 * 1000);
      expect(automerge.docBackfillContentSignals).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(automerge.docBackfillContentSignals).toHaveBeenCalledTimes(2);
    });
    expect(automerge.docBackfillContentSignals).toHaveBeenNthCalledWith(1, 200);
    expect(automerge.docBackfillContentSignals).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not mutate the local document before cloud sync catches up", async () => {
    localStorage.setItem("freed_cloud_provider", "gdrive");

    await useAppStore.getState().initialize();

    await vi.waitFor(() => {
      expect(automerge.initDoc).toHaveBeenCalledTimes(1);
    });
    expect(automerge.docPruneArchivedItems).not.toHaveBeenCalled();
    expect(automerge.docBackfillContentSignals).not.toHaveBeenCalled();
  });

  it("imports the legacy sidebar mode before initialization completes", async () => {
    const state = makeDocState();
    state.preferences.display.sidebarMode = "closed";
    automerge.initDoc.mockResolvedValue(state);

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().isInitialized).toBe(true);
    expect(getDeviceDisplayPreferences().sidebarMode).toBe("closed");
  });

  it("coalesces concurrent initialization into one worker subscription", async () => {
    let resolveInit!: (state: DocState) => void;
    automerge.initDoc.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveInit = resolve;
      }),
    );

    const initialize = useAppStore.getState().initialize;
    const first = initialize();
    const second = initialize();

    expect(second).toBe(first);
    expect(automerge.initDoc).toHaveBeenCalledTimes(1);
    resolveInit(makeDocState());
    await Promise.all([first, second]);

    expect(automerge.initDoc).toHaveBeenCalledTimes(1);
    expect(automerge.subscribe).toHaveBeenCalledTimes(1);
  });

  it("replaces the document subscription when initialization runs again", async () => {
    const unsubscribe = vi.fn();
    automerge.subscribe.mockReturnValue(unsubscribe);

    await useAppStore.getState().initialize();
    useAppStore.setState({ isInitialized: false });
    await useAppStore.getState().initialize();

    expect(automerge.subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("delegates sample data clearing to the worker", async () => {
    const summary = { feeds: 1, items: 2, persons: 3, accounts: 4, total: 10 };
    automerge.docClearSampleData.mockResolvedValueOnce(summary);

    await expect(useAppStore.getState().clearSampleData()).resolves.toEqual(summary);
    expect(automerge.docClearSampleData).toHaveBeenCalledTimes(1);
  });

  it("delegates sample library data to one worker mutation", async () => {
    const data: SampleLibraryData = {
      feeds: [
        {
          url: "https://sample.freed.wtf/feed.xml",
          title: "Sample Feed",
          enabled: true,
          trackUnread: true,
          lastFetched: 1,
        },
      ],
      items: [],
      friends: [
        {
          id: "friend-1",
          name: "Ada Lovelace",
          relationshipStatus: "friend",
          careLevel: 5,
          bio: "Sample friend",
          tags: ["sample"],
          sources: [
            {
              platform: "instagram",
              authorId: "ada",
              handle: "ada",
              displayName: "Ada Lovelace",
              profileUrl: "https://instagram.com/ada",
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };

    await useAppStore.getState().addSampleLibraryData(data);

    expect(automerge.docAddSampleLibraryData).toHaveBeenCalledTimes(1);
    expect(automerge.docAddRssFeed).not.toHaveBeenCalled();
    expect(automerge.docAddFeedItems).not.toHaveBeenCalled();
    expect(automerge.docAddPersons).not.toHaveBeenCalled();
    expect(automerge.docAddAccounts).not.toHaveBeenCalled();
    expect(automerge.docAddSampleLibraryData).toHaveBeenCalledWith(
      expect.objectContaining({
        feeds: data.feeds,
        items: data.items,
        persons: expect.arrayContaining([expect.objectContaining({ id: "friend-1" })]),
        accounts: expect.arrayContaining([expect.objectContaining({ provider: "instagram" })]),
      }),
    );
  });

  it("stops new startup migration writes and drains the mutation already running", async () => {
    let finishPrune!: () => void;
    automerge.docPruneArchivedItems.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishPrune = resolve;
      }),
    );

    await useAppStore.getState().initialize();
    await vi.waitFor(() => {
      expect(automerge.docPruneArchivedItems).toHaveBeenCalledOnce();
    });

    const quiesce = quiescePwaStartupMigrations();
    let quiesced = false;
    void quiesce.then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);

    finishPrune();
    await quiesce;
    expect(automerge.docBackfillContentSignals).not.toHaveBeenCalled();
  });
});
