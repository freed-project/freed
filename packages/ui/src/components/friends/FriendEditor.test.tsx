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
import type { BaseAppState, FeedItem } from "@freed/shared";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../../context/PlatformContext.js";
import {
  buildFriendSourceActivityEvidence,
  buildVisibleFriendsFallbackItems,
  friendSourceAccountProvenance,
} from "../../lib/friends-library-read-model.js";
import { friendActivitySourceKey } from "../../lib/friends-workspace.js";
import { FriendEditor } from "./FriendEditor.js";

function capturedItem({
  globalId,
  publishedAt,
  contentType,
}: {
  globalId: string;
  publishedAt: number;
  contentType: FeedItem["contentType"];
}): FeedItem {
  return {
    globalId,
    platform: "instagram",
    contentType,
    capturedAt: publishedAt,
    publishedAt,
    author: {
      id: "unregistered-author",
      handle: "unregistered",
      displayName: "Unregistered Author",
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
    root = null;
    container = null;
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
    const compatibilityItems = buildVisibleFriendsFallbackItems([
      newerPost,
      olderStory,
    ]);
    const evidence = buildFriendSourceActivityEvidence({
      accounts: {},
      nativeActivityBySourceKey: {},
      compatibilityItems,
    }).get(friendActivitySourceKey("instagram", "unregistered-author"));
    expect(friendSourceAccountProvenance(evidence ?? null, 999)).toEqual({
      firstSeenAt: 100,
      lastSeenAt: 300,
      discoveredFrom: "story_author",
    });

    await act(async () => root?.unmount());
    root = null;
    expect(release).toHaveBeenCalledOnce();
  });
});
