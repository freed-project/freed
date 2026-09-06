/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FeedItem, Person } from "@freed/shared";
import {
  PlatformProvider,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { AuthorIdentityLink } from "./AuthorIdentityLink.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("author identity links", () => {
  it.each(["rss", "youtube", "instagram"] as const)(
    "lazily previews and selects the linked identity for %s",
    async (provider) => {
      const person = {
        id: "person-one",
        name: "Oona Rose",
        careLevel: 5,
        bio: "A rose with opinions.",
        relationshipStatus: "friend",
        createdAt: Date.now(),
        reachOutLog: [],
      } as unknown as Person;
      const query = vi.fn().mockResolvedValue({ accountId: "account-one" });
      const actions = {
        setSelectedItem: vi.fn(),
        setSelectedAccount: vi.fn(),
        setSelectedPerson: vi.fn(),
        setActiveView: vi.fn(),
      };
      const config = {
        queryLibraryCore: query,
        readLibraryAccountDetail: vi
          .fn()
          .mockResolvedValue({ personId: person.id }),
        readLibraryPersonDetail: vi.fn().mockResolvedValue(person),
        store: { getState: () => actions },
      } as unknown as PlatformConfig;
      const item = {
        platform: provider,
        author: { id: "oona", displayName: "Oona" },
      } as FeedItem;
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        await act(async () =>
          root.render(
            <PlatformProvider value={config}>
              <AuthorIdentityLink item={item} />
            </PlatformProvider>,
          ),
        );
        expect(query).not.toHaveBeenCalled();
        await act(async () =>
          container
            .querySelector("button")!
            .dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
        );
        expect(document.body.textContent).toContain("A rose with opinions.");
        expect(document.body.textContent).toContain("Fam");
        await act(async () => container.querySelector("button")!.click());
        expect(query).toHaveBeenCalledTimes(1);
        expect(actions.setSelectedPerson).toHaveBeenCalledWith("person-one");
        expect(actions.setSelectedAccount).toHaveBeenCalledWith(null);
        expect(actions.setActiveView).toHaveBeenCalledWith("friends");
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );

  it("opens an existing unlinked profile without creating an identity", async () => {
    const actions = {
      setSelectedItem: vi.fn(),
      setSelectedAccount: vi.fn(),
      setSelectedPerson: vi.fn(),
      setActiveView: vi.fn(),
    };
    const config = {
      queryLibraryCore: vi.fn().mockResolvedValue({ accountId: "unlinked" }),
      readLibraryAccountDetail: vi.fn().mockResolvedValue({ personId: null }),
      store: { getState: () => actions },
    } as unknown as PlatformConfig;
    const item = {
      platform: "youtube",
      author: { id: "author", displayName: "Author" },
    } as FeedItem;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <PlatformProvider value={config}>
            <AuthorIdentityLink item={item} />
          </PlatformProvider>,
        ),
      );
      await act(async () => container.querySelector("button")!.click());
      expect(actions.setSelectedPerson).toHaveBeenCalledWith(null);
      expect(actions.setSelectedAccount).toHaveBeenCalledWith("unlinked");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
