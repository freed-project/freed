// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import { RecentActivityCard } from "./RecentActivityCard.js";

const { actions, opened } = vi.hoisted(() => ({
  actions: Object.fromEntries(["setSearchQuery", "setActiveView", "setSelectedPerson", "setSelectedItem", "setFilter", "markAsRead"].map(key => [key, vi.fn()])),
  opened: vi.fn(),
}));
vi.mock("../../context/PlatformContext.js", () => ({ usePlatform: () => ({
  store: { getState: () => actions }, interactionMode: "read-only", onReadOnlyItemOpened: opened,
}) }));

// Tier 1: catches inert activity rows, crossed hit targets, and lost reader scope.
it("opens the same post in unified or account-scoped reader without nested buttons", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const item = { globalId: "post-1", platform: "rss", author: { id: "author-1", displayName: "Romy" },
    publishedAt: Date.now(), content: { text: "Field notes", mediaUrls: [], mediaTypes: [] },
    userState: { tags: [] }, rssSource: { feedUrl: "https://example.test/feed" } } as FeedItem;
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<RecentActivityCard item={item} />));
  const buttons = host.querySelectorAll<HTMLElement>('button, [role="button"]');
  expect(buttons).toHaveLength(2);
  expect(host.querySelector("button button")).toBeNull();
  await act(async () => buttons[0]!.click());
  expect(actions.setActiveView).toHaveBeenLastCalledWith("feed");
  expect(actions.setFilter).toHaveBeenLastCalledWith({});
  expect(actions.setSelectedItem).toHaveBeenLastCalledWith("post-1");
  actions.setFilter!.mockClear();
  await act(async () => buttons[1]!.click());
  expect(actions.setFilter).toHaveBeenCalledExactlyOnceWith({ platform: "rss", authorId: "author-1", feedUrl: "https://example.test/feed" });
  expect(actions.setSelectedItem).toHaveBeenLastCalledWith("post-1");
  expect(actions.setSearchQuery).toHaveBeenLastCalledWith("");
  expect(opened).toHaveBeenCalledWith(item);
  expect(actions.markAsRead).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
