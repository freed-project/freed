import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1, RecoveryPreferenceDraft } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-recovery-preference-editor", () => ({ loadRecoveryPreferenceDrafts: mocks.load }));
vi.mock("../lib/sqlite-library", () => ({ prepareDesktopRecoveryPreferenceTransaction: mocks.prepare }));
vi.mock("../lib/library-core-recovery-reissue", () => ({ reapplyArchivedEditorTransaction: mocks.submit }));
import { ConsumerRecoveryPreferenceEditor } from "./ConsumerRecoveryPreferenceEditor";
let root: Root, container: HTMLDivElement;
const review = {} as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
const drafts: RecoveryPreferenceDraft[] = [
 { updates: { weights: { topics: { alpha: { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" } } } }, fields: [{ path: ["weights", "topics", "alpha"], kind: "assignment", archived: 0.125, current: { origin: "stored", value: 0.5 } }] },
 { updates: { display: { showEngagementCounts: false } }, fields: [{ path: ["display", "showEngagementCounts"], kind: "assignment", archived: false, current: { origin: "default", value: true } }] },
];
async function click(label: string) {
 const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
 expect(button).toBeDefined(); await act(async () => button.click());
}
beforeEach(() => {
 vi.clearAllMocks(); mocks.load.mockReset(); mocks.prepare.mockReset(); mocks.submit.mockReset();
 container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
 mocks.load.mockResolvedValue({ replacement: null, drafts });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("requires all settings and confirmation, preserves selected values and retries one prepared edit", async () => {
 mocks.prepare.mockResolvedValue(["signed preferences"]);
 mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ transactionId: "replacement" });
 await act(async () => root.render(createElement(ConsumerRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 await click("Store revised preferences"); expect(mocks.prepare).not.toHaveBeenCalled();
 expect(container.querySelector<HTMLInputElement>('[aria-label="Confirm preference recovery"]')!.disabled).toBe(true);
 await click("Use current value");
 await click("Next setting");
 expect(container.textContent).toContain("Current default");
 const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Confirm preference recovery"]')!;
 await act(async () => checkbox.click()); await click("Use archived value"); expect(checkbox.checked).toBe(false);
 await act(async () => checkbox.click()); await click("Store revised preferences");
 expect(mocks.prepare).toHaveBeenCalledTimes(1);
 const selected = mocks.prepare.mock.calls[0]![0];
 expect(selected).toEqual([{ weights: { topics: { alpha: { bits: "3fe0000000000000", codec: "ieee754_binary64_hex_v1" } } } }, { display: { showEngagementCounts: false } }]);
 expect(container.querySelector<HTMLInputElement>('[aria-label="Value to apply"]')!.disabled).toBe(true);
 await click("Retry same preference edit");
 expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.submit).toHaveBeenCalledTimes(2);
 expect(mocks.submit.mock.calls).toEqual([[review, ["signed preferences"]], [review, ["signed preferences"]]]);
});
it("aborts the load on close and never offers signing after a failed verification", async () => {
 mocks.load.mockImplementationOnce(() => new Promise(() => {}));
 await act(async () => root.render(createElement(ConsumerRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 const signal = mocks.load.mock.calls[0][1] as AbortSignal;
 await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
 mocks.load.mockRejectedValueOnce(new Error("CURSOR_STALE"));
 await act(async () => root.render(createElement(ConsumerRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("archive is preserved");
 expect(container.querySelector("button")).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
});
