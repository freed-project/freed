import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveLibrarySelectionRequiredError } from "@freed/sync/cloud/library-core";
import { DesktopLibrarySetup } from "./DesktopLibrarySetup";
import type { DesktopLibraryInstallationStatus } from "../lib/library-core-desktop-role";

const mocks = vi.hoisted(() => ({ discover: vi.fn(), select: vi.fn(), sync: vi.fn(), refresh: vi.fn(), stop: vi.fn(), oauth: vi.fn() }));
vi.mock("../lib/library-core-desktop-role", () => ({ refreshLibraryCoreDesktopRole: mocks.refresh, selectDesktopLibrarySetup: mocks.select }));
vi.mock("../lib/sync", () => ({
  discoverDesktopCloudLibrary: mocks.discover, getValidCloudToken: async () => "fixture-token",
  initiateDesktopOAuth: mocks.oauth, startCloudSync: mocks.sync, stopCloudSync: mocks.stop, storeCloudToken: vi.fn(),
}));
const libraryId = "a".repeat(64);
const unconfigured: DesktopLibraryInstallationStatus = { state: "unconfigured", role: null, libraryId: null, authorityEpochId: null, actorId: null };
const joining: DesktopLibraryInstallationStatus = { ...unconfigured, state: "joining", role: "follower", libraryId };
const active: DesktopLibraryInstallationStatus = { ...joining, state: "editable_consumer", authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) };

describe("Desktop Library setup", () => {
  let container: HTMLDivElement;
  let root: Root;
  const ready = vi.fn();
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mocks.discover.mockReset().mockResolvedValue({ libraryId });
    mocks.select.mockReset().mockResolvedValue(joining);
    mocks.sync.mockReset().mockResolvedValue(undefined);
    mocks.refresh.mockReset().mockResolvedValue(active);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function render(status = unconfigured) {
    await act(async () => root.render(<DesktopLibrarySetup status={status} initialError={null} onReady={ready} />));
  }
  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    expect(button).toBeDefined(); await act(async () => button!.click());
  }
  it("pins an explicit Library before syncing when Drive contains several Libraries", async () => {
    mocks.discover.mockRejectedValueOnce(new GoogleDriveLibrarySelectionRequiredError([libraryId, "d".repeat(64)]));
    await render(); await click("Join an existing Library");
    expect(mocks.select).not.toHaveBeenCalled();
    await click("Join Library ...aaaaaaaa");
    expect(mocks.discover).toHaveBeenLastCalledWith(libraryId, expect.any(AbortSignal));
    expect(mocks.select).toHaveBeenCalledWith({ role: "follower", libraryId });
    expect(mocks.select.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]!);
    expect(ready.mock.calls.map(([status]) => status.state)).toEqual(["joining", "editable_consumer"]);
    expect(mocks.oauth).not.toHaveBeenCalled();
  });
  it("keeps a failed join pinned and retries the same Library without creating authority", async () => {
    mocks.sync.mockRejectedValueOnce(new Error("Primary unavailable"));
    await render(joining); await click("Resume joining Library");
    expect(container.textContent).toContain("Primary unavailable");
    expect(container.textContent).not.toContain("Create a new Library");
    expect(ready).toHaveBeenLastCalledWith(joining);
    await click("Resume joining Library");
    expect(mocks.select.mock.calls.every(([choice]) => choice.role === "follower" && choice.libraryId === libraryId)).toBe(true);
    expect(ready).toHaveBeenLastCalledWith(active);
  });
  it("cancels discovery without accepting a late selection", async () => {
    let resolve!: (value: { libraryId: string }) => void;
    mocks.discover.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await render(); await click("Join an existing Library"); await click("Cancel");
    expect(mocks.discover.mock.calls[0]![1].aborted).toBe(true);
    await act(async () => resolve({ libraryId }));
    expect(mocks.select).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledWith("gdrive");
  });
});
