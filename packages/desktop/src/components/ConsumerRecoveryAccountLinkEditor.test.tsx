import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn(), query: vi.fn() }));
vi.mock("../lib/library-core-recovery-account-editor", () => ({ loadRecoveryAccountLinkDrafts: mocks.load }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoveryAccountPersonTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
vi.mock("../lib/library-core-normalized-query-client", () => ({ queryNormalizedLibrary: mocks.query }));
import { ConsumerRecoveryAccountLinkEditor } from "./ConsumerRecoveryAccountLinkEditor";
let root: Root, container: HTMLDivElement;
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 1 };
const review = { source } as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click());
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ source, rows: [{ id: "person:new", name: "New person" }] });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("requires all accounts, resets confirmation after selection, and retries identical signed links", async () => {
  const drafts = [0, 1].map(i => ({ accountId: `account:${i}`, label: `Account ${i}`, current: { id: null, label: "Unlinked", present: true }, archived: { id: "person:old", label: "Old person", present: i === 0 } }));
  mocks.load.mockResolvedValue({ replacement: null, drafts });
  const frames = ["signed links"], receipt = { replacementTransactionId: "replacement" };
  mocks.prepare.mockResolvedValue(frames); mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(receipt);
  await act(async () => root.render(<ConsumerRecoveryAccountLinkEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  const confirmation = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => confirmation().click());
  await click("Store account links"); expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Next account");
  await click("Store account links"); expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Select New person (...rson:new)");
  expect(confirmation().checked).toBe(false);
  await act(async () => confirmation().click());
  await click("Store account links");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith([{ accountId: "account:0", personId: "person:old" }, { accountId: "account:1", personId: "person:new" }]);
  expect(confirmation().disabled).toBe(true);
  await click("Store account links");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames], [review, frames]]);
  expect(replacement).toHaveBeenCalledWith(receipt);
});
it("refuses a changed person search frontier before signing", async () => {
  mocks.load.mockResolvedValue({ replacement: null, drafts: [{ accountId: "account", label: "Account", current: { id: null, label: "Unlinked", present: true }, archived: { id: null, label: "Unlinked", present: true } }] });
  mocks.query.mockResolvedValue({ source: { ...source, projectionRevision: 8 }, rows: [] });
  await act(async () => root.render(<ConsumerRecoveryAccountLinkEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.textContent).toContain("The Library changed");
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("cancels a pending native person search when the editor closes", async () => {
  mocks.load.mockResolvedValue({ replacement: null, drafts: [{ accountId: "account", label: "Account", current: { id: null, label: "Unlinked", present: true }, archived: { id: null, label: "Unlinked", present: true } }] });
  mocks.query.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<ConsumerRecoveryAccountLinkEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  const signal = mocks.query.mock.calls[0]![1] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("keeps exact-retry access when a late search reports a changed frontier after signing", async () => {
  mocks.load.mockResolvedValue({ replacement: null, drafts: [{ accountId: "account", label: "Account", current: { id: null, label: "Unlinked", present: true }, archived: { id: null, label: "Unlinked", present: true } }] });
  let finish!: (value: unknown) => void;
  mocks.query.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const frames = ["signed once"];
  mocks.prepare.mockResolvedValue(frames);
  mocks.submit.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ replacementTransactionId: "stored" });
  await act(async () => root.render(<ConsumerRecoveryAccountLinkEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Store account links");
  await act(async () => finish({ source: { ...source, projectionRevision: 8 }, rows: [] }));
  expect(container.textContent).toContain("The Library changed");
  await click("Store account links");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames], [review, frames]]);
});
