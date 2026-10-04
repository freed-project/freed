/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBackupStatus } from "./UpdateBackupStatus.js";
describe("backup elapsed indicator", () => {
 let host: HTMLDivElement, root: Root, now: number;
 beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
 });
 afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
 const render = async (start = 10_000) => { await act(async () => root.render(<UpdateBackupStatus startedAtMonotonicMs={start} />)); };
 const tick = async (at: number) => { now = at; await act(async () => vi.advanceTimersByTime(1_000)); };
 it("counts monotonic seconds/minutes after delayed ticks and wall-clock changes without live announcements", async () => {
  await render(); expect(host.querySelector('[role="timer"]')?.textContent).toBe("00:00");
  await tick(11_000); expect(host.textContent).toContain("00:01");
  vi.setSystemTime(new Date("2000-01-01")); await tick(75_000); expect(host.textContent).toContain("01:05");
  expect(host.querySelector('[role="timer"]')?.getAttribute("aria-live")).toBe("off");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Saving Library backup before updating...");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
 });
 it("preserves attempt time on remount, resets retries and cleans intervals on error, phase exit and unmount", async () => {
  await render(); await tick(80_000); expect(host.textContent).toContain("01:10");
  await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
  await render(); expect(host.textContent).toContain("01:10");
  await render(80_000); expect(host.textContent).toContain("00:00"); expect(vi.getTimerCount()).toBe(1);
  await act(async () => root.render(<p>Update failed</p>)); expect(vi.getTimerCount()).toBe(0);
  now = 85_000; await render(85_000); expect(host.textContent).toContain("00:00");
  await act(async () => root.render(<p>Downloading</p>)); expect(vi.getTimerCount()).toBe(0);
 });
});
