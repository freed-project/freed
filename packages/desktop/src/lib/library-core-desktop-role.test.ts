import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
import {
  readLibraryCoreDesktopRole, refreshLibraryCoreDesktopRole, selectDesktopLibrarySetup,
  requirePrimaryLibraryCoreDesktopRole, requireFollowerLibraryCoreDesktopRole,
} from "./library-core-desktop-role";
const primary = { state: "standalone_primary", role: "primary", libraryId: "a".repeat(64), authorityEpochId: "b".repeat(64), actorId: "c".repeat(64) };

describe("native Desktop installation role", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    native.invoke.mockReset().mockRejectedValue(new Error("native unavailable"));
    await refreshLibraryCoreDesktopRole().catch(() => {});
  });

  it("fails closed when native state is missing despite a saved Primary preference", () => {
    window.localStorage.setItem("freed.libraryCore.desktopRoleV1", "primary");
    expect(readLibraryCoreDesktopRole()).toBeNull();
    expect(requirePrimaryLibraryCoreDesktopRole).toThrow();
    expect(requireFollowerLibraryCoreDesktopRole).toThrow();
  });

  it("uses the native consumer role even if renderer storage requests Primary", async () => {
    native.invoke.mockResolvedValue({ ...primary, role: "follower", state: "editable_consumer" });
    await refreshLibraryCoreDesktopRole();
    window.localStorage.setItem("freed.libraryCore.desktopRoleV1", "primary");
    expect(readLibraryCoreDesktopRole()).toBe("follower");
    expect(requirePrimaryLibraryCoreDesktopRole).toThrow();
    expect(requireFollowerLibraryCoreDesktopRole).not.toThrow();
  });

  it("admits Primary only after native selection and clears stale admission on failure", async () => {
    native.invoke.mockResolvedValue(primary);
    await selectDesktopLibrarySetup({ role: "primary" });
    expect(native.invoke).toHaveBeenCalledWith("select_normalized_desktop_library_setup", { choice: { role: "primary" } });
    expect(requirePrimaryLibraryCoreDesktopRole).not.toThrow();
    native.invoke.mockRejectedValue(new Error("native unavailable"));
    await expect(refreshLibraryCoreDesktopRole()).rejects.toThrow("native unavailable");
    expect(requirePrimaryLibraryCoreDesktopRole).toThrow();
  });
  it("reconciles a legacy consumer preference only as native revocation", async () => {
    window.localStorage.setItem("freed.libraryCore.desktopRoleV1", "follower");
    native.invoke.mockResolvedValue({ state: "fenced", role: null, libraryId: null, authorityEpochId: null, actorId: null });
    await refreshLibraryCoreDesktopRole();
    expect(native.invoke).toHaveBeenLastCalledWith("normalized_desktop_installation_status", { legacyFollowerRequested: true });
    expect(window.localStorage.getItem("freed.libraryCore.desktopRoleV1")).toBeNull();
    expect(requirePrimaryLibraryCoreDesktopRole).toThrow();
  });

  it("coalesces native reads and rejects a response superseded by setup", async () => {
    let resolve!: (value: unknown) => void;
    native.invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue(primary);
    const pending = refreshLibraryCoreDesktopRole();
    expect(refreshLibraryCoreDesktopRole()).toBe(pending);
    await selectDesktopLibrarySetup({ role: "primary" });
    resolve({ ...primary, state: "editable_consumer", role: "follower" });
    await expect(pending).rejects.toThrow("superseded");
    expect(requirePrimaryLibraryCoreDesktopRole).not.toThrow();
  });

});
