import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-recovery-rss-editor", () => ({ loadRecoveryRssTitleDrafts: mocks.load, loadRecoveryRssRemovalDrafts: mocks.load }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoveryRssTitleTransaction: mocks.prepare, prepareDesktopRecoveryRssRemovalTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
import { ConsumerRecoveryRssEditor } from "./ConsumerRecoveryRssEditor";
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
it.each([false, true])("primary=%s requires every page and explicit submission, then retries identical signatures after response loss", async (primary) => {
  const drafts = Array.from({ length: 9 }, (_, i) => ({ url: `https://example.com/${i}`, title: `  Name ${i}  `, archivedTitle: `Old ${i}`, currentTitle: `Current ${i}` }));
  mocks.load.mockResolvedValue({ replacement: null, drafts });
  const frames = ["signed first", "signed second"];
  mocks.prepare.mockResolvedValue(frames);
  const receipt = { transactionId: "replacement" };
  mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(receipt);
  await act(async () => root.render(<ConsumerRecoveryRssEditor primary={primary} review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.querySelectorAll("input")).toHaveLength(8);
  await click("Store revised names"); expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Next names"); expect(container.querySelectorAll("input")).toHaveLength(1);
  expect(mocks.prepare).not.toHaveBeenCalled();
  await click("Store revised names");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(drafts.map((d) => ({ url: d.url, title: d.title.trim() })), primary);
  expect(container.querySelector("input")!.disabled).toBe(true);
  expect(replacement).not.toHaveBeenCalled();
  await click("Store revised names");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames, primary], [review, frames, primary]]);
  expect(replacement).toHaveBeenCalledWith(receipt);
  expect(mutating.mock.calls.map(([value]) => value)).toEqual([true, false, true, false]);
});
it("aborts a pending review when closed without signing", async () => {
  mocks.load.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<ConsumerRecoveryRssEditor review={review} onReplacement={replacement} onMutating={mutating} />));
  const signal = mocks.load.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("discards an aborted development remount error after the replacement load succeeds", async () => {
  mocks.load.mockRejectedValueOnce(new Error("QUERY_CANCELLED")).mockResolvedValueOnce({ replacement: null,
    drafts: [{ url: "https://example.com/feed", title: "Name", archivedTitle: "Name", currentTitle: "Current" }] });
  await act(async () => root.render(<StrictMode><ConsumerRecoveryRssEditor review={review} onReplacement={replacement} onMutating={mutating} /></StrictMode>));
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(container.querySelector("input")!.value).toBe("Name");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("requires explicit article deletion confirmation and retains exact unsubscribe bytes on retry", async () => {
  mocks.load.mockResolvedValue({ replacement: null, drafts: [{ url: "https://example.com/feed", title: "Feed", includeItems: true }] });
  const frames = ["signed unsubscribe"];
  mocks.prepare.mockResolvedValue(frames);
  mocks.submit.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ transactionId: "replacement" });
  await act(async () => root.render(<ConsumerRecoveryRssEditor mode="remove" review={review} onReplacement={replacement} onMutating={mutating} />));
  expect(container.textContent).toContain("including articles added after the original edit or before Primary acceptance");
  await click("Store unsubscribe");
  expect(mocks.prepare).not.toHaveBeenCalled();
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await click("Store unsubscribe");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(["https://example.com/feed"], true, true, false);
  expect(checkbox.disabled).toBe(true);
  await click("Store unsubscribe");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.submit.mock.calls).toEqual([[review, frames, false], [review, frames, false]]);
});
