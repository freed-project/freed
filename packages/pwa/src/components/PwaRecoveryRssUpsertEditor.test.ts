import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-pwa-recovery-editors", () => ({ loadPwaRecoveryRssUpsertDrafts: mocks.load }));
vi.mock("../lib/library-core-pwa-follower-mutations", () => ({ createPwaRecoveryRssUpsertAction: mocks.prepare }));
import { PwaRecoveryRssUpsertEditor } from "./PwaRecoveryRssUpsertEditor";
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
it("requires all subscriptions and confirmation, then retries exact bytes with retained current history", async () => {
  const drafts = [0, 1].map((i) => {
    const current = { url: `https://example.com/${i}`, title: `Current ${i}`, enabled: false, trackUnread: true, lastFetched: 900, pollInterval: 60 };
    return { current: i === 1 ? null : current, feed: i === 1 ? { url: current.url, title: "Archived", enabled: false, trackUnread: true } : { ...current }, archived: { ...current, title: "Archived", enabled: true, lastFetched: 10, pollInterval: 5 } };
  });
  mocks.load.mockResolvedValue({ replacement: null, drafts });
  mocks.prepare.mockReturnValue(mocks.submit);
  mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ transactionId: "replacement" });
  await act(async () => root.render(createElement(PwaRecoveryRssUpsertEditor, { review, onReplacement: replacement, onMutating: mutating })));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')!.value).toBe("Current 0");
  expect(container.textContent).toContain("Archived: Archived");
  await click("Store revised subscriptions"); expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Next subscription");
  expect(container.textContent).toContain("has not been created");
  await click("Store revised subscriptions"); expect(mocks.prepare).not.toHaveBeenCalled();
  const confirmation = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).at(-1)!;
  await act(async () => confirmation.click());
  await click("Store revised subscriptions");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(review, drafts.map(({ feed }) => feed));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')!.disabled).toBe(true);
  await click("Store revised subscriptions");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit).toHaveBeenCalledTimes(2);
});
it("aborts pending review on close without signing", async () => {
  mocks.load.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(createElement(PwaRecoveryRssUpsertEditor, { review, onReplacement: replacement, onMutating: mutating })));
  const signal = mocks.load.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("explains a deleted subscription without offering a replacement", async () => {
  mocks.load.mockRejectedValue(new Error("This subscription was deleted. Recovery cannot restore it with an upsert."));
  await act(async () => root.render(createElement(PwaRecoveryRssUpsertEditor, { review, onReplacement: replacement, onMutating: mutating })));
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("A subscription in this edit was deleted");
  expect(container.textContent).toContain("entire archived edit is preserved");
  expect(container.querySelector("button")).toBeNull();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
