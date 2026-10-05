import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), query: vi.fn(), prepare: vi.fn() }));
vi.mock("../lib/library-core-pwa-recovery-editors", () => ({ loadPwaRecoveryAnnotationDrafts: mocks.load }));
vi.mock("../lib/library-core-sqlite-runtime", () => ({ queryPwaNormalizedLibrary: mocks.query }));
vi.mock("../lib/library-core-pwa-follower-mutations", () => ({ createPwaRecoveryAnnotationAction: mocks.prepare }));
import { PwaRecoveryAnnotationEditor } from "./PwaRecoveryAnnotationEditor";
let root: Root, container: HTMLDivElement;
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
const review = { source } as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mocks.query.mockReset();
  mocks.load.mockResolvedValue({ replacement: null, drafts: [{ entityId: "rss:item", label: "Article", highlights: [{ text: null, textBlobDigest: "b".repeat(64), note: "Preserved note", createdAt: 1 }], tags: ["preserved"] }] });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(createElement(PwaRecoveryAnnotationEditor, { review, onReplacement: replacement, onMutating: mutating })));
const click = (text: string) => act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === text)!.click());
it("refuses changed canonical comparisons before creating an action", async () => {
  mocks.query.mockResolvedValue({ globalId: "rss:item", source: { ...source, projectionRevision: 8 }, highlights: [], tags: [] });
  await render();
  expect(container.textContent).toContain("Library changed");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "Store revised annotations")!.disabled).toBe(true);
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("keeps unloaded quotes visible and locks the whole set across ambiguous retry", async () => {
  mocks.query.mockResolvedValue({ globalId: "rss:item", source, highlights: [], tags: [] });
  const submit = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
  mocks.prepare.mockReturnValue(submit);
  await render();
  expect(container.textContent).toContain("reference will be preserved");
  expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Store revised annotations");
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  expect(container.querySelector("input")!.disabled).toBe(true);
  await click("Retry same annotations");
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(submit).toHaveBeenCalledTimes(2); expect(replacement).toHaveBeenCalledOnce();
});
it("discards a late comparison after close without preparing an edit", async () => {
  let finish!: (value: unknown) => void;
  mocks.query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await act(async () => root.render(null));
  await act(async () => finish({ globalId: "rss:item", source, highlights: [], tags: [] }));
  expect(replacement).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});
