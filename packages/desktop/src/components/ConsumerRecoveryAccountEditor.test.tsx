import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-recovery-account-upsert-editor", () => ({ loadRecoveryAccountDrafts: mocks.load }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoveryAccountTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
import { ConsumerRecoveryAccountEditor } from "./ConsumerRecoveryAccountEditor";
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
it("reviews all Account records before confirmation and retries exact signed bytes", async () => {
  const drafts = [0, 1].map(i => {
    const account = { id: `account:${i}`, displayName: `Current ${i}`, kind: "social", provider: "x", externalId: `external:${i}`, discoveredFrom: "manual_entry", firstSeenAt: 1, lastSeenAt: 2, createdAt: 1, updatedAt: 2 };
    return { current: i === 1 ? null : account, account, archived: { ...account, displayName: "Archived" } };
  });
  mocks.load.mockResolvedValue({ replacement: null, drafts });
  const frames = ["signed first", "signed second"];
  mocks.prepare.mockResolvedValue(frames);
  mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ transactionId: "replacement" });
  await act(async () => root.render(<ConsumerRecoveryAccountEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')!.value).toBe("Current 0");
  expect(container.textContent).toContain("Archived: Archived");
  await click("Store revised accounts"); expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Next account");
  expect(container.textContent).toContain("currently absent and may have been deleted");
  await click("Store revised accounts"); expect(mocks.prepare).not.toHaveBeenCalled();
  const confirmation = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).at(-1)!;
  await act(async () => confirmation.click());
  await click("Use archived details, including link and avatar URL");
  expect(confirmation.checked).toBe(false);
  await click("Use archived details, including link and avatar URL");
  await act(async () => confirmation.click());
  await click("Store revised accounts");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(drafts.map(({ account, archived }, index) => index === 1 ? archived : account), review, false);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')!.disabled).toBe(true);
  await click("Retry same Account edit");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames, false], [review, frames, false]]);
});
it("aborts pending review on close without signing", async () => {
  mocks.load.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<ConsumerRecoveryAccountEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  const signal = mocks.load.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true); expect(mocks.prepare).not.toHaveBeenCalled();
});
