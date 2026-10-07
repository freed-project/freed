import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCoreRecoveryIntentReviewResponseV1, RecoveryPreferenceDraft } from "@freed/shared/library-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), query: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("../lib/library-core-sqlite-runtime", () => ({ queryPwaNormalizedLibrary: mocks.query }));
vi.mock("../lib/library-core-pwa-recovery-editors", () => ({ loadPwaRecoveryPreferenceDrafts: mocks.load }));
vi.mock("../lib/library-core-pwa-follower-mutations", () => ({ createPwaRecoveryPreferenceAction: mocks.prepare }));
import { PwaRecoveryPreferenceEditor } from "./PwaRecoveryPreferenceEditor";
let root: Root, container: HTMLDivElement;
const review = { source: { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 9 } } as LibraryCoreRecoveryIntentReviewResponseV1;
const replacement = vi.fn(), mutating = vi.fn();
const drafts: RecoveryPreferenceDraft[] = [
 { updates: { weights: { topics: { alpha: { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" } } } }, fields: [{ path: ["weights", "topics", "alpha"], kind: "assignment", archived: 0.125 }] },
 { updates: { display: { showEngagementCounts: false } }, fields: [{ path: ["display", "showEngagementCounts"], kind: "assignment", archived: false }] },
];
function currentResponse(request: { path: readonly string[]; generationId: string; sourceRevision: number }, bits = "3fe0000000000000") {
 const node = (path: string, textValue: string | null = null) => ({ path, textValue, valueType: textValue === null ? "null" : "text", booleanValue: null, integerValue: null, realValue: null, updatedAt: 1 });
 return { queryId: "preference_value_v1", schemaVersion: 1, path: request.path, kind: request.path[0] === "weights" ? "value" : "absent",
   rows: request.path[0] === "weights" ? [node("o:$._"), node("v:$._.bits", bits), node("v:$._.codec", "ieee754_binary64_hex_v1")] : [],
   source: { generationId: request.generationId, projectionRevision: request.sourceRevision, transitionSequence: request.sourceRevision } };
}
async function click(label: string) {
 const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === label)!;
 expect(button).toBeDefined(); await act(async () => button.click());
}
beforeEach(() => {
 vi.clearAllMocks(); mocks.load.mockReset(); mocks.query.mockReset(); mocks.prepare.mockReset(); mocks.submit.mockReset();
 container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
 mocks.load.mockResolvedValue({ replacement: null, drafts });
 mocks.query.mockImplementation(async request => currentResponse(request));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("requires all settings and confirmation, preserves selected values and retries one prepared edit", async () => {
 mocks.prepare.mockReturnValue(mocks.submit);
 mocks.submit.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ transactionId: "replacement" });
 await act(async () => root.render(createElement(PwaRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 await click("Store revised preferences"); expect(mocks.prepare).not.toHaveBeenCalled();
 expect(container.querySelector<HTMLInputElement>('[aria-label="Confirm preference recovery"]')!.disabled).toBe(true);
 await click("Use current value");
 await click("Next setting");
 expect(container.textContent).toContain("Current default");
 const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Confirm preference recovery"]')!;
 await act(async () => checkbox.click()); await click("Use archived value"); expect(checkbox.checked).toBe(false);
 await act(async () => checkbox.click()); await click("Store revised preferences");
 expect(mocks.prepare).toHaveBeenCalledTimes(1);
 const selected = mocks.prepare.mock.calls[0]![1];
 expect(selected).toEqual([{ weights: { topics: { alpha: { bits: "3fe0000000000000", codec: "ieee754_binary64_hex_v1" } } } }, { display: { showEngagementCounts: false } }]);
 expect(container.querySelector<HTMLInputElement>('[aria-label="Value to apply"]')!.disabled).toBe(true);
 await click("Retry same preference edit");
 expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.submit).toHaveBeenCalledTimes(2);
 expect(mocks.query).toHaveBeenCalledTimes(2);
 expect(mocks.submit.mock.calls).toEqual([[], []]);
});
it("aborts the load on close and never offers signing after a failed verification", async () => {
 mocks.load.mockImplementationOnce(() => new Promise(() => {}));
 await act(async () => root.render(createElement(PwaRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 const signal = mocks.load.mock.calls[0][1] as AbortSignal;
 await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
 mocks.load.mockRejectedValueOnce(new Error("CURSOR_STALE"));
 await act(async () => root.render(createElement(PwaRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 expect(container.querySelector('[role="alert"]')?.textContent).toContain("archive is preserved");
 expect(container.querySelector("button")).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
});
it("discards a late selected value after the review changes", async () => {
 let finish!: () => void;
 mocks.query.mockImplementationOnce(request => new Promise(resolve => { finish = () => resolve(currentResponse(request, "3fe8000000000000")); }));
 await act(async () => root.render(createElement(PwaRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 expect(container.textContent).toContain("Loading this setting");
 expect(container.querySelector<HTMLInputElement>('[aria-label="Confirm preference recovery"]')!.disabled).toBe(true);
 const next = { ...review, source: { ...review.source, projectionRevision: 8, transitionSequence: 10 } };
 await act(async () => root.render(createElement(PwaRecoveryPreferenceEditor, { review: next, onReplacement: replacement, onMutating: mutating })));
 expect(mocks.query.mock.calls.map(([request]) => request.sourceRevision)).toEqual([7, 8]);
 await act(async () => finish());
 expect(container.textContent).toContain("0.5"); expect(container.textContent).not.toContain("0.75");
 expect(mocks.prepare).not.toHaveBeenCalled();
});
it("does not offer an object-group summary as a replacement value", async () => {
 mocks.query.mockImplementationOnce(async request => ({ ...currentResponse(request), kind: "object_group", rows: [{ path: "o:$._", valueType: "null", booleanValue: null, integerValue: null, realValue: null, textValue: null, updatedAt: 1 }] }));
 await act(async () => root.render(createElement(PwaRecoveryPreferenceEditor, { review, onReplacement: replacement, onMutating: mutating })));
 expect(container.textContent).toContain("Applying a value replaces that group");
 expect(container.textContent).not.toContain("Use current value");
 expect(mocks.prepare).not.toHaveBeenCalled();
});
