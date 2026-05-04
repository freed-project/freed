import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Account, FeedItem } from "@freed/shared";
import { useSearchResults } from "../../../ui/src/hooks/useSearchResults";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "item-1",
    platform: "x",
    sourceUrl: "https://example.com/item",
    author: {
      id: "rob",
      displayName: "Source Name",
      handle: "@source",
    },
    content: {
      text: "Plain post text",
      linkPreview: {
        title: "Plain title",
        description: "Plain description",
        url: "https://example.com/item",
      },
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      readAt: undefined,
      liked: false,
      tags: [],
      highlights: [],
    },
    topics: [],
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    ...overrides,
  } as FeedItem;
}

function renderProbe(items: FeedItem[], accounts: Record<string, Account>, query: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  function Probe() {
    const result = useSearchResults(items, query, {}, 1, "all_content", {}, accounts, {});
    return createElement("div", null, result.filteredItems.map((item) => item.globalId).join(","));
  }

  act(() => {
    root.render(createElement(Probe));
  });
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

async function flushSearchIndex() {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  document.body.innerHTML = "";
});

describe("useSearchResults", () => {
  it("matches canonical social account names when item author text differs", async () => {
    const account: Account = {
      id: "social:x:rob",
      kind: "social",
      provider: "x",
      externalId: "rob",
      handle: "@beschizza",
      displayName: "Rob Beschizza",
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    };

    const host = renderProbe([makeItem()], { [account.id]: account }, "Beschizza");
    await flushSearchIndex();

    expect(host.textContent).toBe("item-1");
  });
});
