import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-recovery-saved-url-editor", () => ({ loadRecoverySavedUrlDrafts: mocks.load }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoverySavedUrlTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
import { ConsumerRecoverySavedUrlEditor } from "./ConsumerRecoverySavedUrlEditor";
let root: Root, container: HTMLDivElement;
const review = {} as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click());
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockReset(); mocks.prepare.mockReset(); mocks.submit.mockReset();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("requires every URL and confirmation, then retries exact signed bytes after response loss", async () => {
  const drafts = [0, 1].map(i => ({ entityId: `saved:${i}`, url: `https://example.org/${i}`, title: `Archived ${i}`, description: "Description", archivedItem: {}, currentState: i ? "absent" : "present", currentText: "Current source text" }));
  mocks.load.mockResolvedValue({ replacement: null, drafts });
  const frames = ["signed first", "signed second"];
  mocks.prepare.mockResolvedValue(frames);
  mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ transactionId: "replacement" });
  await act(async () => root.render(<ConsumerRecoverySavedUrlEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.textContent).toContain("Primary may fetch this URL");
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Title"]')!.value).toBe("Archived 0");
  await click("Store revised saved URLs"); expect(mocks.prepare).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  await click("Next URL");
  expect(container.textContent).toContain("Item is absent");
  await click("Store revised saved URLs"); expect(mocks.prepare).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Store revised saved URLs");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(review, drafts.map(({ entityId, title, description }) => ({ entityId, title, description })), false);
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Title"]')!.disabled).toBe(true);
  await click("Retry same replacement");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames, false], [review, frames, false]]);
});
it("aborts pending review on close without signing", async () => {
  mocks.load.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<ConsumerRecoverySavedUrlEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  const signal = mocks.load.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("explains a deleted saved item without offering a replacement", async () => {
  mocks.load.mockRejectedValue(new Error("This saved item was deleted. Recovery cannot recreate it."));
  await act(async () => root.render(<ConsumerRecoverySavedUrlEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("An item in this edit was deleted");
  expect(container.textContent).toContain("entire archived edit is preserved");
  expect(container.querySelector("button")).toBeNull();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
