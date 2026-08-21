/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { create } from "zustand";
import type { BaseAppState, FeedItem, Friend } from "@freed/shared";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../../context/PlatformContext.js";
import { FriendEditor } from "./FriendEditor.js";

function capturedItem({
  globalId,
  publishedAt,
  contentType,
  authorId = "unregistered-author",
  displayName = "Unregistered Author",
}: {
  globalId: string;
  publishedAt: number;
  contentType: FeedItem["contentType"];
  authorId?: string;
  displayName?: string;
}): FeedItem {
  return {
    globalId,
    platform: "instagram",
    contentType,
    capturedAt: publishedAt,
    publishedAt,
    author: {
      id: authorId,
      handle: authorId,
      displayName,
    },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
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

describe("FriendEditor compatibility candidates", () => {
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
    localStorage.clear();
    vi.useRealTimers();
    root = null;
    container = null;
  });

  it("publishes only a final source-fenced set of the best 50 unlinked authors", async () => {
    const hiddenStory = capturedItem({
      globalId: "instagram:hidden-story-author-01",
      publishedAt: 0,
      contentType: "story",
      authorId: "author-01",
      displayName: "Candidate 01",
    });
    hiddenStory.userState.hidden = true;
    const items = [
      ...Array.from({ length: 55 }, (_, index) =>
        capturedItem({
          globalId: `instagram:item-${index}`,
          publishedAt: index + 100,
          contentType: "post",
          authorId: `author-${index.toString().padStart(2, "0")}`,
          displayName:
            index === 1
              ? "Zulu Candidate"
              : `Candidate ${index.toString().padStart(2, "0")}`,
        }),
      ).reverse(),
      capturedItem({
        globalId: "instagram:story-author-01",
        publishedAt: 1,
        contentType: "story",
        authorId: "author-01",
        displayName: "Candidate 01",
      }),
      hiddenStory,
    ];
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
          items: [],
          friends: { linked: linkedFriend },
          searchCorpusVersion: 1,
        }) as unknown as BaseAppState,
    );
    let closeFence: (() => void) | null = null;
    const finalFence = new Promise<void>((resolve) => {
      closeFence = resolve;
    });
    const scanLibraryItems = vi.fn(async (visit) => {
      await visit(items.slice(0, 32));
      await visit(items.slice(32));
      await finalFence;
    });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const onSave = vi.fn();
    const platform = {
      store: useStore,
      scanLibraryItems,
      acquireLegacyLibraryItems,
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
    } satisfies PlatformConfig;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
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
    await flush();

    expect(scanLibraryItems).toHaveBeenCalledOnce();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-testid="friend-author-candidate"]'),
    ).toHaveLength(0);
    expect(container.textContent).toContain("Loading captured profiles");

    await act(async () => {
      closeFence?.();
      await finalFence;
    });
    await flush();

    expect(
      container.querySelectorAll('[data-testid="friend-author-candidate"]'),
    ).toHaveLength(50);
    expect(buttonContaining(container, "Candidate 00")).toBeNull();
    expect(buttonContaining(container, "Candidate 01")).not.toBeNull();
    expect(buttonContaining(container, "Candidate 50")).not.toBeNull();
    expect(buttonContaining(container, "Candidate 51")).toBeNull();

    await act(async () => buttonContaining(container, "Candidate 01")?.click());
    await act(async () => buttonContaining(container, "Add friend")?.click());
    const activity = onSave.mock.calls[0]?.[2]?.get("instagram:author-01");
    expect(activity).toEqual({
      firstSeenAt: 1,
      lastSeenAt: 101,
      discoveredFrom: "story_author",
    });
  });

  it("does not publish a completed scan after the Library source changes", async () => {
    const staleItem = capturedItem({
      globalId: "instagram:stale",
      publishedAt: 1,
      contentType: "post",
      authorId: "stale-author",
      displayName: "Stale Author",
    });
    const currentItem = capturedItem({
      globalId: "instagram:current",
      publishedAt: 2,
      contentType: "post",
      authorId: "current-author",
      displayName: "Current Author",
    });
    const refreshedItem = capturedItem({
      globalId: "instagram:current-new",
      publishedAt: 4,
      contentType: "story",
      authorId: "current-author",
      displayName: "Current Author",
    });
    const useStore = create(
      () =>
        ({
          items: [],
          friends: {},
          searchCorpusVersion: 1,
        }) as unknown as BaseAppState,
    );
    let finishStaleScan: (() => void) | null = null;
    const staleFence = new Promise<void>((resolve) => {
      finishStaleScan = resolve;
    });
    let scanCount = 0;
    const scanLibraryItems = vi.fn(async (visit) => {
      scanCount += 1;
      if (scanCount === 1) {
        await visit([staleItem]);
        await staleFence;
        return;
      }
      await visit(
        scanCount === 2 ? [currentItem] : [currentItem, refreshedItem],
      );
    });
    const onSave = vi.fn();
    const platform = {
      store: useStore,
      scanLibraryItems,
      acquireLegacyLibraryItems: vi.fn(async () => vi.fn()),
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
    } satisfies PlatformConfig;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
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
    await flush();

    await act(async () => {
      useStore.setState({ searchCorpusVersion: 2 });
    });
    await flush();

    expect(scanLibraryItems).toHaveBeenCalledTimes(2);
    expect(buttonContaining(container, "Current Author")).not.toBeNull();

    await act(async () => {
      finishStaleScan?.();
      await staleFence;
    });
    await flush();

    expect(buttonContaining(container, "Stale Author")).toBeNull();
    expect(buttonContaining(container, "Current Author")).not.toBeNull();

    await act(async () =>
      buttonContaining(container, "Current Author")?.click(),
    );
    await act(async () => {
      useStore.setState({ searchCorpusVersion: 3 });
    });
    await flush();
    expect(scanLibraryItems).toHaveBeenCalledTimes(4);

    await act(async () => buttonContaining(container, "Add friend")?.click());
    await flush();
    expect(scanLibraryItems).toHaveBeenCalledTimes(5);
    expect(onSave.mock.calls[0]?.[2]?.get("instagram:current-author")).toEqual({
      firstSeenAt: 2,
      lastSeenAt: 4,
      discoveredFrom: "captured_item",
    });
  });

  it("debounces rapid Desktop candidate searches into one replacement scan", async () => {
    vi.useFakeTimers();
    const item = capturedItem({
      globalId: "instagram:debounced",
      publishedAt: 1,
      contentType: "post",
      authorId: "debounced-author",
      displayName: "Debounced Author",
    });
    const useStore = create(
      () =>
        ({
          items: [],
          friends: {},
          searchCorpusVersion: 1,
        }) as unknown as BaseAppState,
    );
    const scanLibraryItems = vi.fn(async (visit) => {
      await visit([item]);
    });
    const platform = {
      store: useStore,
      scanLibraryItems,
      acquireLegacyLibraryItems: vi.fn(async () => vi.fn()),
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
    } satisfies PlatformConfig;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <FriendEditor
            draft={{ name: "New Friend" }}
            onSave={() => undefined}
            onCancel={() => undefined}
          />
        </PlatformProvider>,
      );
    });
    await flush();
    expect(scanLibraryItems).toHaveBeenCalledOnce();

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search profiles in your feed"]',
    );
    expect(input).not.toBeNull();
    await setInputValue(input as HTMLInputElement, "D");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    await setInputValue(input as HTMLInputElement, "De");
    await act(async () => vi.advanceTimersByTimeAsync(149));
    expect(scanLibraryItems).toHaveBeenCalledOnce();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    await flush();
    expect(scanLibraryItems).toHaveBeenCalledTimes(2);
  });

  it("restores the legacy Desktop candidate lease only through the rollback key", async () => {
    localStorage.setItem(
      "freed.libraryCore.friendEditorReaderV1.disabled",
      "1",
    );
    const item = capturedItem({
      globalId: "instagram:rollback",
      publishedAt: 1,
      contentType: "post",
      authorId: "rollback-author".repeat(400),
      displayName: "Rollback Author",
    });
    const useStore = create(
      () =>
        ({
          items: [],
          friends: {},
          searchCorpusVersion: 1,
        }) as unknown as BaseAppState,
    );
    const release = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => {
      useStore.setState({ items: [item] });
      return release;
    });
    const scanLibraryItems = vi.fn();
    const platform = {
      store: useStore,
      scanLibraryItems,
      acquireLegacyLibraryItems,
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
    } satisfies PlatformConfig;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <PlatformProvider value={platform}>
          <FriendEditor
            draft={{ name: "New Friend" }}
            onSave={() => undefined}
            onCancel={() => undefined}
          />
        </PlatformProvider>,
      );
    });
    await flush();

    expect(scanLibraryItems).not.toHaveBeenCalled();
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();
    expect(buttonContaining(container, "Rollback Author")).not.toBeNull();

    await act(async () => root?.unmount());
    root = null;
    expect(release).toHaveBeenCalledOnce();
  });

  it("hydrates an evicted unregistered author and preserves historical provenance on save", async () => {
    const olderStory = capturedItem({
      globalId: "instagram:story-old",
      publishedAt: 100,
      contentType: "story",
    });
    const newerPost = capturedItem({
      globalId: "instagram:post-new",
      publishedAt: 300,
      contentType: "post",
    });
    const useStore = create(
      () =>
        ({
          items: [],
          friends: {},
          searchCorpusVersion: 1,
        }) as unknown as BaseAppState,
    );
    const release = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => {
      useStore.setState({ items: [newerPost, olderStory] });
      return release;
    });
    const platform = {
      store: useStore,
      acquireLegacyLibraryItems,
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
    } satisfies PlatformConfig;
    const onSave = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
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
    await flush();

    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();
    const candidate = buttonContaining(container, "Unregistered Author");
    expect(candidate).not.toBeNull();
    await act(async () => candidate?.click());
    await act(async () => buttonContaining(container, "Add friend")?.click());

    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved.sources).toEqual([
      expect.objectContaining({
        platform: "instagram",
        authorId: "unregistered-author",
      }),
    ]);
    await act(async () => root?.unmount());
    root = null;
    expect(release).toHaveBeenCalledOnce();
  });
});
