import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1 } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), history: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-pwa-recovery-editors", () => ({ loadPwaRecoveryReachOutDrafts: mocks.load, readPwaRecoveryReachOutHistory: mocks.history }));
vi.mock("../lib/library-core-pwa-follower-mutations", () => ({ createPwaRecoveryReachOutAction: mocks.prepare }));
import { PwaRecoveryReachOutEditor } from "./PwaRecoveryReachOutEditor";
let root: Root, container: HTMLDivElement;
const review = {} as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
const drafts = [0, 1].map(i => { const event = { channel: null, logged_at_ms: 1000 + i, notes: `Historical ${i}` }; return { personId: `person:${i}`, originalOperationId: `old:${i}`, archived: event, event }; });
async function click(label: string) {
 const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
 expect(button).toBeDefined(); await act(async () => button.click());
}
beforeEach(() => {
 vi.clearAllMocks(); mocks.load.mockReset(); mocks.history.mockReset(); mocks.prepare.mockReset(); mocks.submit.mockReset();
 container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
 mocks.load.mockResolvedValue({ replacement: null, drafts });
 mocks.history.mockResolvedValue({ name: "Current Person", events: [] });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("requires every history read and confirmation, then retries one prepared action", async () => {
 mocks.prepare.mockReturnValue(mocks.submit);
 mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ transactionId: "replacement" });
 await act(async () => root.render(createElement(PwaRecoveryReachOutEditor, { review, onReplacement: replacement, onMutating: mutating })));
 expect(container.textContent).toContain("An absent event does not prove the original failed");
 await click("Store revised history"); expect(mocks.prepare).not.toHaveBeenCalled();
 const firstSignal = mocks.history.mock.calls[0][2] as AbortSignal;
 await click("Next event"); expect(firstSignal.aborted).toBe(true);
 await click("Store revised history"); expect(mocks.prepare).not.toHaveBeenCalled();
 const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
 await act(async () => checkbox.click()); await click("Use archived event"); expect(checkbox.checked).toBe(false);
 await act(async () => checkbox.click()); await click("Store revised history");
 expect(mocks.prepare).toHaveBeenCalledTimes(1);
 expect(container.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
 await click("Retry same reach-out edit");
 expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.submit).toHaveBeenCalledTimes(2);
});
it("does not advance past duplicate history and aborts on close", async () => {
 mocks.history.mockResolvedValueOnce({ name: "Current Person", events: [{ reachOutId: "old:0", loggedAt: 1000, channel: null, notes: null }] });
 await act(async () => root.render(createElement(PwaRecoveryReachOutEditor, { review, onReplacement: replacement, onMutating: mutating })));
 expect(container.textContent).toContain("original event is already in this history");
 await click("Next event"); expect(mocks.history).toHaveBeenCalledTimes(1);
 await click("Store revised history"); expect(mocks.prepare).not.toHaveBeenCalled();
 const signal = mocks.history.mock.calls[0][2] as AbortSignal;
 await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
});
