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
      const state = { ...actions, searchCorpusVersion: 0 };
      const store = Object.assign(
        (selector: (value: typeof state) => unknown) => selector(state),
        { getState: () => state },
      );
      const config = {
        queryLibraryCore: query,
        readLibraryAccountDetail: vi
          .fn()
          .mockResolvedValue({ personId: person.id }),
        readLibraryPersonDetail: vi.fn().mockResolvedValue(person),
        store,
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
        expect(actions.setSelectedAccount).not.toHaveBeenCalled();
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
      expect(actions.setSelectedPerson).not.toHaveBeenCalled();
      expect(actions.setSelectedAccount).toHaveBeenCalledWith("unlinked");
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("refreshes a cached identity when readers are replaced, without a relationship write", async () => {
    const actions = { setSelectedItem: vi.fn(), setSelectedAccount: vi.fn(), setSelectedPerson: vi.fn(), setActiveView: vi.fn() };
    const store = { getState: () => ({ ...actions, searchCorpusVersion: 1 }) };
    const mutations = { upsertLibraryPerson: vi.fn(), replaceLibraryFriend: vi.fn(), assignLibraryAccountToPerson: vi.fn() };
    const item = { platform: 'instagram', author: { id: 'synthetic', displayName: 'Synthetic' } } as FeedItem;
    const make = (id: string) => ({ ...mutations, store, queryLibraryCore: vi.fn(async () => ({ accountId: id })), readLibraryAccountDetail: vi.fn(async () => ({ personId: id })), readLibraryPersonDetail: vi.fn(async () => ({ id, name: 'Synthetic', relationshipStatus: 'friend' })) }) as unknown as PlatformConfig;
    const first = make('person-a'), next = make('person-b'); const host = document.createElement('div'); const root = createRoot(host);
    try {
      await act(async () => root.render(<PlatformProvider value={first}><AuthorIdentityLink item={item} showProfileTooltip={false} /></PlatformProvider>));
      await act(async () => host.querySelector('button')!.click()); expect(actions.setSelectedPerson).toHaveBeenLastCalledWith('person-a');
      await act(async () => root.render(<PlatformProvider value={next}><AuthorIdentityLink item={item} showProfileTooltip={false} /></PlatformProvider>));
      await act(async () => host.querySelector('button')!.click()); expect(actions.setSelectedPerson).toHaveBeenLastCalledWith('person-b');
      expect(next.queryLibraryCore).toHaveBeenCalledOnce(); for (const fn of Object.values(mutations)) expect(fn).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
  it("lets an explicit author click finish across ordinary revisions, while rejecting a changed author", async () => {
    const actions = { setSelectedItem: vi.fn(), setSelectedAccount: vi.fn(), setSelectedPerson: vi.fn(), setActiveView: vi.fn() }; let revision = 1;
    let finish!: (x: any) => void; const pending = new Promise<any>(resolve => { finish = resolve; });
    const config = { store: { getState: () => ({ ...actions, libraryItemVersion: revision }) }, queryLibraryCore: vi.fn(async (request: any) => request.authorId === 'a' ? pending : ({ accountId: 'b' })), readLibraryAccountDetail: vi.fn(async (id: string) => ({ personId: id })), readLibraryPersonDetail: vi.fn(async (id: string) => ({ id, name: 'Synthetic', relationshipStatus: 'friend' })) } as unknown as PlatformConfig;
    const item = (id: string) => ({ platform: 'x', author: { id, displayName: 'Synthetic' } }) as FeedItem;
    const host = document.createElement('div'); const root = createRoot(host);
    try {
      await act(async () => root.render(<PlatformProvider value={config}><AuthorIdentityLink item={item('a')} showProfileTooltip={false} /></PlatformProvider>));
      await act(async () => host.querySelector('button')!.click()); revision++;
      await act(async () => root.render(<PlatformProvider value={config}><AuthorIdentityLink item={item('a')} showProfileTooltip={false} /></PlatformProvider>));
      await act(async () => finish({ accountId: 'a' })); expect(actions.setSelectedPerson).toHaveBeenLastCalledWith('a');
      revision++; const old = config.queryLibraryCore as any; let late!: (x: any) => void;
      old.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
      await act(async () => host.querySelector('button')!.click());
      await act(async () => root.render(<PlatformProvider value={config}><AuthorIdentityLink item={item('b')} showProfileTooltip={false} /></PlatformProvider>));
      await act(async () => host.querySelector('button')!.click());
      await act(async () => late({ accountId: 'a' })); expect(actions.setSelectedPerson).toHaveBeenLastCalledWith('b');
    } finally { await act(async () => root.unmount()); }
  });

});
