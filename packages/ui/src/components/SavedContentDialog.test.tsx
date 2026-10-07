/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import type { LibraryCoreHydratedAnnotations } from "@freed/shared/library-core";
import { PlatformProvider, type PlatformConfig } from "../context/PlatformContext.js";
import { SavedContentDialog } from "./SavedContentDialog.js";

const url = "https://example.invalid/article";
const item = { globalId: "saved:fixture", sourceUrl: url, content: {}, userState: { tags: [], highlights: [] } } as unknown as FeedItem;
const snapshot: LibraryCoreHydratedAnnotations = { state: "ready", editState: "ready", highlights: [], originals: {
  queryId: "item_annotations_v1", schemaVersion: 1, globalId: item.globalId,
  source: { generationId: "a".repeat(64) as never, projectionRevision: 2, transitionSequence: 2 }, tags: [], highlights: [],
} };
let root: Root;
let container: HTMLDivElement;
let preview: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let render: (editItem: FeedItem | null, initialUrl?: string) => void;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  preview = vi.fn().mockResolvedValue({ url, suggestedNote: "Preview note" });
  update = vi.fn().mockResolvedValue({ globalId: item.globalId });
  const state = { activeFilter: {}, activeView: "feed", setFilter: vi.fn(), setActiveView: vi.fn(),
    setSelectedItem: vi.fn(), setSelectedPerson: vi.fn(), setSelectedAccount: vi.fn() };
  const config = { store: (selector: (value: typeof state) => unknown) => selector(state),
    previewSaveUrl: preview, saveUrl: vi.fn(), updateSavedContent: update } as unknown as PlatformConfig;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  render = (editItem, initialUrl = url) => act(() => root.render(<PlatformProvider value={config}>
    <SavedContentDialog open initialUrl={initialUrl} editItem={editItem} annotationSnapshot={editItem ? snapshot : null} onClose={() => {}} />
  </PlatformProvider>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function changeUrl(value: string) {
  const input = document.querySelector<HTMLInputElement>("#save-url-input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it.each(["source", "fallback"])("does not preview unchanged %s URL and submits original local annotations", async mode => {
  const editItem = mode === "source" ? item : { ...item, sourceUrl: undefined, content: { linkPreview: { url } } } as FeedItem;
  render(editItem, ` ${url} `);
  await advance(1000);
  expect(preview).not.toHaveBeenCalled();
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(update).toHaveBeenCalledWith(editItem, { url, notes: "", annotationSnapshot: snapshot });
});
it("retains the 350ms preview delay for new saves and changed URLs", async () => {
  render(null);
  await advance(349); expect(preview).not.toHaveBeenCalled();
  await advance(1); expect(preview).toHaveBeenCalledTimes(1);
  render(item);
  changeUrl("https://example.invalid/changed");
  await advance(349); expect(preview).toHaveBeenCalledTimes(1);
  await advance(1); expect(preview).toHaveBeenLastCalledWith("https://example.invalid/changed", expect.any(AbortSignal));
});
it("cancels changed-URL timers and rejects late results after returning to the original", async () => {
  let resolvePreview: (value: { url: string; suggestedNote: string }) => void = () => {};
  preview.mockImplementation(() => new Promise(resolve => { resolvePreview = resolve; }));
  render(item);
  changeUrl("https://example.invalid/changed");
  await advance(349); changeUrl(url); await advance(1000);
  expect(preview).not.toHaveBeenCalled();
  changeUrl("https://example.invalid/changed"); await advance(350);
  const signal = preview.mock.calls[0]![1] as AbortSignal;
  changeUrl(url); expect(signal.aborted).toBe(true);
  await act(async () => { resolvePreview({ url: "https://example.invalid/changed", suggestedNote: "Stale remote note" }); });
  expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(update).toHaveBeenCalledWith(item, { url, notes: "", annotationSnapshot: snapshot });
  expect(preview).toHaveBeenCalledTimes(1);
});
