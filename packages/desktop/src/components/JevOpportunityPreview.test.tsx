import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runMatches, loadRelationships } = vi.hoisted(() => ({
  runMatches: vi.fn(),
  loadRelationships: vi.fn(),
}));

vi.mock("../lib/jev-opportunities", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/jev-opportunities")>(),
  runJevOpportunities: runMatches,
}));
vi.mock("../lib/jev-preview-library", () => ({
  loadJevPreviewRelationships: loadRelationships,
}));
vi.mock("../lib/store", async () => ({
  useAppStore: (await import("zustand")).create(() => ({ libraryItemVersion: 0 })),
}));

import { createJevOpportunityDemo } from "../lib/jev-opportunities";
import { useAppStore } from "../lib/store";
import { JevOpportunityPreview } from "./JevOpportunityPreview";

// Tier 1: explicit cloud actions, honest result provenance, and profile invalidation.
// Invalidated by opportunity controls, matching projection, or capability contracts.
describe("Jev opportunity preview workflow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    runMatches.mockReset();
    loadRelationships.mockReset();
    useAppStore.setState({ libraryItemVersion: 0 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    expect(button, `Expected button: ${label}`).toBeDefined();
    await act(async () => button!.click());
  }

  it("keeps examples separate, handles unknown relationships, and clears matches when the profile changes", async () => {
    const props = {
      items: [], configured: false, disabled: false, visible: true,
      onBusyChange: vi.fn(), onLoadSample: vi.fn(), onOpenItem: vi.fn(),
    };
    await act(async () => root.render(<JevOpportunityPreview {...props} lens="help" />));
    await click("Preview example matches");
    expect(container.textContent).toContain("fictional people and manually authored scores");
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(4);
    expect(container.textContent).toContain("Relationship unknown");
    expect(container.textContent).not.toContain("Open in Freed");
    await click("Preview example matches");
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(4);

    const friendsOnly = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => friendsOnly.click());
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(2);
    expect([...container.querySelectorAll("article")].every((card) => card.textContent?.includes("Confirmed friend"))).toBe(true);
    await act(async () => friendsOnly.click());
    await act(async () => root.render(<JevOpportunityPreview {...props} lens="collaborate" />));
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(2);

    const input = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Bake sourdough");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(0);
    expect(container.textContent).toContain("Profile changed");
    expect(runMatches).not.toHaveBeenCalled();
    expect(props.onLoadSample).not.toHaveBeenCalled();
  });

  it("sends only the explicitly submitted profile and opens successful sample matches in Freed", async () => {
    const demo = createJevOpportunityDemo();
    const onBusyChange = vi.fn();
    const onOpenItem = vi.fn();
    loadRelationships.mockResolvedValue(demo.relationships);
    runMatches.mockImplementation(async (_items, _capabilities, options) => {
      options.onUpdate(demo.results);
      return demo.results;
    });
    const onLoadSample = vi.fn().mockResolvedValue(demo.items);
    await act(async () => root.render(<JevOpportunityPreview lens="help" visible items={demo.items}
      configured disabled={false} onBusyChange={onBusyChange}
      onLoadSample={onLoadSample} onOpenItem={onOpenItem} />));
    await click("Try example profile");
    expect(runMatches).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(0);
    await click("Find matches with Jev");

    expect(runMatches).toHaveBeenCalledTimes(1);
    expect(runMatches.mock.calls[0][1]).toEqual(demo.capabilities);
    expect(onLoadSample).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Jev matching run");
    expect(container.textContent).not.toContain("manually authored scores");
    expect(onBusyChange.mock.calls.map((call) => call[0])).toEqual([true, false]);
    await click("Open in Freed");
    expect(onOpenItem).toHaveBeenCalledWith(demo.items[1]);
  });

  it("reports a failed run as unevaluated rather than claiming there are no requests", async () => {
    const demo = createJevOpportunityDemo();
    loadRelationships.mockResolvedValue(demo.relationships);
    runMatches.mockRejectedValue(new Error("The Jev key was rejected."));
    await act(async () => root.render(<JevOpportunityPreview lens="help" visible items={demo.items}
      configured disabled={false} onBusyChange={vi.fn()} onLoadSample={vi.fn().mockResolvedValue(demo.items)} onOpenItem={vi.fn()} />));
    await click("Try example profile");
    await click("Find matches with Jev");
    expect(container.textContent).toContain("The Jev key was rejected");
    expect(container.textContent).toContain("No successful evaluations are available");
    expect(container.textContent).not.toContain("No explicit requests among the evaluated items");
  });

  it("rereads the sample before paid work and hides evidence that changed during the run", async () => {
    const demo = createJevOpportunityDemo();
    const before = [demo.items[0]];
    const after = [{ ...demo.items[0], content: { ...demo.items[0].content, text: "The request is resolved now." } }];
    const onLoadSample = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after);
    loadRelationships.mockResolvedValue(demo.relationships);
    runMatches.mockImplementation(async (_items, _capabilities, options) => {
      options.onUpdate([demo.results[0]]);
      return [demo.results[0]];
    });
    await act(async () => root.render(<JevOpportunityPreview lens="help" visible items={demo.items}
      configured disabled={false} onBusyChange={vi.fn()} onLoadSample={onLoadSample} onOpenItem={vi.fn()} />));
    await click("Try example profile");
    await click("Find matches with Jev");
    expect(runMatches.mock.calls[0][0]).toEqual(before);
    expect(onLoadSample).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(0);
  });

  it.each(["hidden", "archived", "deleted", "edited", "relationship"] as const)(
    "invalidates a %s match on library revision while the new source is being read", async (change) => {
      const demo = createJevOpportunityDemo();
      const item = demo.items[0];
      const onLoadSample = vi.fn().mockResolvedValue([item]);
      loadRelationships.mockResolvedValue(demo.relationships);
      runMatches.mockImplementation(async (_items, _capabilities, options) => {
        options.onUpdate([demo.results[0]]);
        return [demo.results[0]];
      });
      await act(async () => root.render(<JevOpportunityPreview lens="help" visible items={[item]}
        configured disabled={false} onBusyChange={vi.fn()} onLoadSample={onLoadSample} onOpenItem={vi.fn()} />));
      await click("Try example profile");
      await click("Find matches with Jev");
      expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(1);
      let finishRead!: (items: typeof demo.items) => void;
      onLoadSample.mockImplementationOnce(() => new Promise<typeof demo.items>((resolve) => { finishRead = resolve; }));
      await act(async () => useAppStore.setState({ libraryItemVersion: 1 }));
      expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(0);
      expect(container.textContent).toContain("Checking current posts and relationships");
      const fresh = change === "deleted" ? [] : [{
        ...item,
        ...(change === "hidden" || change === "archived" ? { userState: { ...item.userState, [change]: true } } : {}),
        ...(change === "edited" ? { content: { ...item.content, text: "This request is resolved." } } : {}),
      }];
      if (change === "relationship") loadRelationships.mockResolvedValue({});
      await act(async () => finishRead(fresh));
      expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(change === "relationship" ? 1 : 0);
      if (change === "relationship") {
        expect(container.textContent).toContain("Relationship unknown");
        await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
        expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(0);
      }
      expect(runMatches).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps cards hidden after a failed refresh and refuses an older overlapping read", async () => {
    const demo = createJevOpportunityDemo();
    const onLoadSample = vi.fn().mockResolvedValue(demo.items);
    loadRelationships.mockResolvedValue(demo.relationships);
    runMatches.mockImplementation(async (_items, _capabilities, options) => {
      options.onUpdate(demo.results);
      return demo.results;
    });
    await act(async () => root.render(<JevOpportunityPreview lens="help" visible items={demo.items}
      configured disabled={false} onBusyChange={vi.fn()} onLoadSample={onLoadSample} onOpenItem={vi.fn()} />));
    await click("Try example profile");
    await click("Find matches with Jev");
    let finishOlder!: (items: typeof demo.items) => void;
    onLoadSample.mockImplementationOnce(() => new Promise<typeof demo.items>((resolve) => { finishOlder = resolve; }));
    await act(async () => useAppStore.setState({ libraryItemVersion: 1 }));
    onLoadSample.mockRejectedValueOnce(new Error("Current posts could not be loaded."));
    await act(async () => useAppStore.setState({ libraryItemVersion: 2 }));
    await act(async () => finishOlder(demo.items));
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(0);
    expect(container.textContent).toContain("Matches are hidden until current posts and relationships can be checked");
    expect(container.textContent).toContain("Current posts could not be loaded");
    onLoadSample.mockResolvedValue(demo.items);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelectorAll("[data-jev-opportunity-id]")).toHaveLength(4);
    expect(runMatches).toHaveBeenCalledTimes(1);
  });
});
