import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACT_SYNC_STORAGE_KEY } from "@freed/shared";

const {
  mockDocBinary,
  mockDocState,
  mockReplaceLocalDoc,
  subscribers,
} = vi.hoisted(() => ({
  mockDocBinary: vi.fn<() => Uint8Array | Promise<Uint8Array>>(),
  mockDocState: vi.fn(),
  mockReplaceLocalDoc: vi.fn<(binary: Uint8Array) => Promise<void>>(),
  subscribers: new Set<() => void>(),
}));

vi.mock("@tauri-apps/api/path", async () => {
  const actual = await import("../__mocks__/@tauri-apps/api/path");
  return actual;
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-fs", async () => {
  const actual = await import("../__mocks__/@tauri-apps/plugin-fs/index");
  return actual;
});

vi.mock("./automerge", () => ({
  getDocBinary: mockDocBinary,
  getDocState: mockDocState,
  replaceLocalDoc: mockReplaceLocalDoc,
  subscribe: (listener: () => void) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
}));

import { exists, readDir, remove, writeFile } from "@tauri-apps/plugin-fs";
import * as fs from "@tauri-apps/plugin-fs";
import {
  clearSnapshots,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  startSnapshotManager,
  stopSnapshotManager,
} from "./snapshots";

async function clearMockSnapshotDir() {
  const entries = await readDir("/mock/app-data/snapshots").catch(() => []);
  await Promise.all(
    entries
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name))
      .map((name) => remove(`/mock/app-data/snapshots/${name}`)),
  );
}

describe("snapshots", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    localStorage.clear();
    subscribers.clear();
    mockReplaceLocalDoc.mockReset();
    mockDocBinary.mockReset();
    mockDocState.mockReset();
    stopSnapshotManager();
    await clearSnapshots();
    await clearMockSnapshotDir();

    mockDocBinary.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    mockDocState.mockReturnValue({
      friends: {
        "friend-1": { id: "friend-1" },
      },
      docItemCount: 2,
    });
    localStorage.setItem(
      CONTACT_SYNC_STORAGE_KEY,
      JSON.stringify({
        syncToken: "sync-token",
        lastSyncedAt: 123,
        cachedContacts: [{ resourceName: "people/1" }],
        pendingMatches: [{ id: "match-1" }],
        dismissedMatches: [],
      }),
    );
  });

  it("creates snapshots with contact sync metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));

    const snapshot = await createSnapshot("manual");

    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      itemCount: 2,
      friendCount: 1,
      contactCount: 1,
      pendingMatchCount: 1,
      reason: "manual",
    });

    const listed = await listSnapshots();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(snapshot?.id);
  });

  it("restores the saved document and contact sync state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00Z"));
    const snapshot = await createSnapshot("manual");
    expect(snapshot).not.toBeNull();

    localStorage.setItem(
      CONTACT_SYNC_STORAGE_KEY,
      JSON.stringify({
        syncToken: null,
        lastSyncedAt: null,
        cachedContacts: [],
        pendingMatches: [],
        dismissedMatches: [],
      }),
    );

    await restoreSnapshot(snapshot!.id);

    expect(mockReplaceLocalDoc).toHaveBeenCalledTimes(1);
    expect(mockReplaceLocalDoc.mock.calls[0]?.[0]).toEqual(new Uint8Array([1, 2, 3, 4]));

    const restored = JSON.parse(localStorage.getItem(CONTACT_SYNC_STORAGE_KEY) ?? "{}");
    expect(restored.cachedContacts).toHaveLength(1);
    expect(restored.pendingMatches).toHaveLength(1);
  });

  it("waits for an in-flight snapshot before clearing local history", async () => {
    const originalWriteFile = fs.writeFile;
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const write = vi.spyOn(fs, "writeFile").mockImplementationOnce(
      async (...args: Parameters<typeof fs.writeFile>) => {
        await writeGate;
        await originalWriteFile(...args);
      },
    );

    const creating = createSnapshot("manual");
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const cleared = vi.fn();
    const clearing = clearSnapshots().then(cleared);
    await Promise.resolve();
    expect(cleared).not.toHaveBeenCalled();

    releaseWrite();
    await creating;
    await clearing;

    await expect(listSnapshots()).resolves.toEqual([]);
  });

  it("waits for an in-flight restore before clearing snapshot history", async () => {
    const snapshot = await createSnapshot("manual");
    expect(snapshot).not.toBeNull();
    let releaseRestore!: () => void;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    mockReplaceLocalDoc.mockImplementationOnce(async () => {
      await restoreGate;
    });

    const restoring = restoreSnapshot(snapshot!.id);
    await vi.waitFor(() => expect(mockReplaceLocalDoc).toHaveBeenCalledOnce());
    const cleared = vi.fn();
    const clearing = clearSnapshots().then(cleared);
    await Promise.resolve();
    expect(cleared).not.toHaveBeenCalled();

    releaseRestore();
    await restoring;
    await clearing;
    await expect(listSnapshots()).resolves.toEqual([]);
  });

  it("allows snapshot writes after a failed clear", async () => {
    await createSnapshot("manual");
    const error = new Error("snapshot directory is not writable");
    vi.spyOn(fs, "remove").mockRejectedValueOnce(error);

    await expect(clearSnapshots()).rejects.toBe(error);
    await expect(createSnapshot("manual")).resolves.toEqual(
      expect.objectContaining({ reason: "manual" }),
    );
  });

  it("times out a stuck snapshot operation and releases the reset gate", async () => {
    vi.useFakeTimers();
    let releaseSnapshot!: () => void;
    mockDocBinary.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => {
      releaseSnapshot = () => resolve(new Uint8Array([1, 2, 3, 4]));
    }));

    const creating = createSnapshot("manual");
    await vi.runAllTicks();
    const clearing = clearSnapshots();
    const rejection = expect(clearing).rejects.toThrow(
      "Snapshot operations did not stop within 180,000 ms.",
    );
    await vi.advanceTimersByTimeAsync(180_000);
    await rejection;

    releaseSnapshot();
    await creating;
    mockDocBinary.mockReturnValue(new Uint8Array([1, 2, 3, 4]));
    await expect(createSnapshot("manual")).resolves.toEqual(
      expect.objectContaining({ reason: "manual" }),
    );
  });

  it("prunes older snapshots beyond the retention window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));

    for (let index = 0; index < 26; index++) {
      vi.setSystemTime(new Date(Date.now() + 1_000));
      await createSnapshot("manual");
    }

    const snapshots = await listSnapshots();
    expect(snapshots).toHaveLength(24);
  });

  it("prunes orphaned snapshot files not tracked by the index", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
    await writeFile("/mock/app-data/snapshots/orphan.automerge", new Uint8Array([9]));
    await writeFile("/mock/app-data/snapshots/orphan.contacts.json", "{}");
    await writeFile("/mock/app-data/snapshots/notes.txt", "keep me");

    await createSnapshot("manual");

    expect(await exists("/mock/app-data/snapshots/orphan.automerge")).toBe(false);
    expect(await exists("/mock/app-data/snapshots/orphan.contacts.json")).toBe(false);
    expect(await exists("/mock/app-data/snapshots/notes.txt")).toBe(true);
  });

  it("prunes orphaned snapshot files when snapshots are listed", async () => {
    await writeFile("/mock/app-data/snapshots/orphan.automerge", new Uint8Array([9]));
    await writeFile("/mock/app-data/snapshots/orphan.contacts.json", "{}");
    await writeFile("/mock/app-data/snapshots/notes.txt", "keep me");

    await listSnapshots();

    expect(await exists("/mock/app-data/snapshots/orphan.automerge")).toBe(false);
    expect(await exists("/mock/app-data/snapshots/orphan.contacts.json")).toBe(false);
    expect(await exists("/mock/app-data/snapshots/notes.txt")).toBe(true);
  });

  it("creates an initial auto snapshot when the manager starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T15:00:00Z"));

    await startSnapshotManager();

    const snapshots = await listSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.reason).toBe("auto");
  });
});
