import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-recovery-item-editor", () => ({ loadRecoveryAccountRemovalDrafts: mocks.load, loadRecoveryItemRemovalDrafts: mocks.load, loadRecoveryPersonRemovalDrafts: mocks.load }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoveryAccountRemovalTransaction: mocks.prepare, prepareDesktopRecoveryItemRemovalTransaction: mocks.prepare, prepareDesktopRecoveryPersonRemovalTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
import { ConsumerRecoveryItemRemovalEditor } from "./ConsumerRecoveryItemRemovalEditor";
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
it.each(["items", "people", "accounts"] as const)("requires every %s target and explicit confirmation, then retries exact signed deletion", async mode => {
  const store = mode === "accounts" ? "Store account deletion" : mode === "people" ? "Store people deletion" : "Store item deletion";
  const drafts = Array.from({ length: 9 }, (_, i) => ({ entityId: `rss:item:${i}`, label: `Current ${i}`, present: i !== 8 }));
  mocks.load.mockResolvedValue({ replacement: null, drafts });
  const frames = ["signed deletion"];
  mocks.prepare.mockResolvedValue(frames);
  const receipt = { transactionId: "replacement" };
  mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(receipt);
  await act(async () => root.render(<ConsumerRecoveryItemRemovalEditor mode={mode} review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.querySelectorAll("li")).toHaveLength(8);
  if (mode === "accounts") expect(container.textContent).toContain("does not delete the linked people or accounts at their providers");
  if (mode === "people") expect(container.textContent).toContain("including links added since this review");
  await click(store); expect(mocks.prepare).not.toHaveBeenCalled();
  const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => confirmation.click());
  await click(store); expect(mocks.prepare).not.toHaveBeenCalled();
  await click(mode === "accounts" ? "Next accounts" : mode === "people" ? "Next people" : "Next items");
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.textContent).toContain("Currently absent. This target remains in the deletion.");
  await click(store);
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(drafts.map((draft) => draft.entityId), true);
  expect(confirmation.disabled).toBe(true);
  await click(store);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames], [review, frames]]);
  expect(replacement).toHaveBeenCalledWith(receipt);
});
