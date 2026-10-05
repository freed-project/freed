import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), query: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-recovery-annotation-editor", () => ({ loadRecoveryAnnotationDrafts: mocks.load }));
vi.mock("../lib/library-core-normalized-query-client", () => ({ queryNormalizedLibrary: mocks.query }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoveryAnnotationTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
import { ConsumerRecoveryAnnotationEditor } from "./ConsumerRecoveryAnnotationEditor";
let root: Root, container: HTMLDivElement;
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 };
const review = { source } as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mocks.query.mockReset();
  mocks.load.mockResolvedValue({ replacement: null, drafts: [{ entityId: "rss:item", label: "An article", highlights: [], tags: [] }] });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("refuses a changed canonical comparison and never prepares a replacement", async () => {
  mocks.query.mockResolvedValue({ globalId: "rss:item", source: { ...source, projectionRevision: 8 }, highlights: [], tags: [] });
  await act(async () => root.render(<ConsumerRecoveryAnnotationEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.textContent).toContain("Library changed");
  const store = [...container.querySelectorAll("button")].find((b) => b.textContent === "Store revised annotations")!;
  expect(store.disabled).toBe(true); await act(async () => store.click());
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
});
it("cancels the selected annotation read on close and ignores its late result", async () => {
  let resolve!: (value: unknown) => void;
  mocks.query.mockImplementation(() => new Promise((done) => { resolve = done; }));
  await act(async () => root.render(<ConsumerRecoveryAnnotationEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  const signal = mocks.query.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ globalId: "rss:item", source, highlights: [], tags: [] }));
  expect(replacement).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});
