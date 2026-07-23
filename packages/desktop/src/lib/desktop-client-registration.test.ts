import { beforeEach, describe, expect, it, vi } from "vitest";

const WITNESS_A = "a".repeat(64);
const WITNESS_B = "b".repeat(64);

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  read: vi.fn(),
  write: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("./native-json-store", () => ({
  readNativeJsonValue: mocks.read,
  writeNativeJsonValue: mocks.write,
}));

import {
  getOrCreateDesktopClientRegistration,
  resetDesktopClientRegistrationForTests,
} from "./desktop-client-registration";

describe("desktop client registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetDesktopClientRegistrationForTests();
    mocks.invoke.mockResolvedValue(WITNESS_A);
    mocks.write.mockResolvedValue(undefined);
  });

  it("creates one stable installation identity and persists its device binding locally", async () => {
    mocks.read.mockResolvedValue(null);

    const first = await getOrCreateDesktopClientRegistration();
    const second = await getOrCreateDesktopClientRegistration();

    expect(first).toEqual(second);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.registeredAt).toEqual(expect.any(Number));
    const localRecord = { version: 1, ...first, installationWitness: WITNESS_A };
    expect(mocks.write).toHaveBeenCalledWith(
      "desktop-client.json",
      "registration",
      localRecord,
      "desktop-client-registration",
    );
    expect(JSON.parse(
      window.localStorage.getItem("freed-desktop-client-registration-v1") ?? "null",
    )).toEqual(localRecord);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("reuses a bound native installation identity without rewriting it", async () => {
    const stored = {
      version: 1 as const,
      id: "desktop-existing",
      registeredAt: 1234,
      installationWitness: WITNESS_A,
    };
    mocks.read.mockResolvedValue(stored);

    await expect(getOrCreateDesktopClientRegistration()).resolves.toEqual({
      id: stored.id,
      registeredAt: stored.registeredAt,
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("upgrades a legacy native identity with the current installation witness", async () => {
    const stored = { id: "desktop-legacy", registeredAt: 4321 };
    mocks.read.mockResolvedValue(stored);

    await expect(getOrCreateDesktopClientRegistration()).resolves.toEqual(stored);
    expect(mocks.write).toHaveBeenCalledWith(
      "desktop-client.json",
      "registration",
      { version: 1, ...stored, installationWitness: WITNESS_A },
      "desktop-client-registration",
    );
  });

  it("reuses a bound fallback after a confirmed missing native record", async () => {
    const fallback = {
      version: 1 as const,
      id: "desktop-fallback",
      registeredAt: 5678,
      installationWitness: WITNESS_A,
    };
    window.localStorage.setItem(
      "freed-desktop-client-registration-v1",
      JSON.stringify(fallback),
    );
    mocks.read.mockResolvedValue(null);

    await expect(getOrCreateDesktopClientRegistration()).resolves.toEqual({
      id: fallback.id,
      registeredAt: fallback.registeredAt,
    });
    expect(mocks.write).toHaveBeenCalledWith(
      "desktop-client.json",
      "registration",
      fallback,
      "desktop-client-registration",
    );
  });

  it("retries a transient native read before reusing the verified identity", async () => {
    const stored = {
      version: 1 as const,
      id: "desktop-after-retry",
      registeredAt: 6789,
      installationWitness: WITNESS_A,
    };
    mocks.read
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValue(stored);

    await expect(getOrCreateDesktopClientRegistration()).resolves.toEqual({
      id: stored.id,
      registeredAt: stored.registeredAt,
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("fails closed instead of minting a second identity after repeated native read failures", async () => {
    window.localStorage.setItem(
      "freed-desktop-client-registration-v1",
      JSON.stringify({
        version: 1,
        id: "desktop-fallback",
        registeredAt: 5678,
        installationWitness: WITNESS_A,
      }),
    );
    mocks.read.mockRejectedValue(new Error("native store unavailable"));

    await expect(getOrCreateDesktopClientRegistration()).rejects.toThrow(
      "Could not verify the existing Freed Desktop registration",
    );
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("mints a new identity when copied local data arrives on another installation", async () => {
    const copied = {
      version: 1 as const,
      id: "desktop-copied",
      registeredAt: 100,
      installationWitness: WITNESS_A,
    };
    mocks.invoke.mockResolvedValue(WITNESS_B);
    mocks.read.mockResolvedValue(copied);
    window.localStorage.setItem(
      "freed-desktop-client-registration-v1",
      JSON.stringify(copied),
    );

    const first = await getOrCreateDesktopClientRegistration();
    expect(first.id).not.toBe(copied.id);
    const rebound = JSON.parse(
      window.localStorage.getItem("freed-desktop-client-registration-v1") ?? "null",
    );
    expect(rebound).toEqual({ version: 1, ...first, installationWitness: WITNESS_B });

    resetDesktopClientRegistrationForTests();
    const second = await getOrCreateDesktopClientRegistration();
    expect(second).toEqual(first);
  });

  it("deduplicates concurrent registration reads", async () => {
    let resolveRead!: (value: unknown) => void;
    mocks.read.mockImplementation(() => new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const first = getOrCreateDesktopClientRegistration();
    const second = getOrCreateDesktopClientRegistration();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveRead(null);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ id: expect.any(String) }),
      expect.objectContaining({ id: expect.any(String) }),
    ]);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("refuses to downgrade a newer registration record", async () => {
    const future = {
      version: 2,
      id: "desktop-future",
      registeredAt: 9876,
      installationWitness: WITNESS_A,
    };
    mocks.read.mockResolvedValue({
      version: 1,
      id: "desktop-current",
      registeredAt: 8765,
      installationWitness: WITNESS_A,
    });
    window.localStorage.setItem(
      "freed-desktop-client-registration-v1",
      JSON.stringify(future),
    );

    await expect(getOrCreateDesktopClientRegistration()).rejects.toThrow(
      "A newer Freed Desktop registration format is present",
    );
    expect(mocks.write).not.toHaveBeenCalled();
    expect(JSON.parse(
      window.localStorage.getItem("freed-desktop-client-registration-v1") ?? "null",
    )).toEqual(future);
  });

  it("preserves a corrupt fallback before replacing it from the native record", async () => {
    const stored = {
      version: 1 as const,
      id: "desktop-native",
      registeredAt: 7654,
      installationWitness: WITNESS_A,
    };
    mocks.read.mockResolvedValue(stored);
    window.localStorage.setItem(
      "freed-desktop-client-registration-v1",
      "{not-json",
    );

    await expect(getOrCreateDesktopClientRegistration()).resolves.toEqual({
      id: stored.id,
      registeredAt: stored.registeredAt,
    });
    const recoveryKey = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    ).find((key) => (
      key?.startsWith("freed-desktop-client-registration-v1.recovery.")
    ));
    expect(recoveryKey).toBeDefined();
    expect(JSON.parse(window.localStorage.getItem(recoveryKey ?? "") ?? "null")).toEqual({
      capturedAt: expect.any(Number),
      raw: "{not-json",
      reason: "corrupt",
    });
    expect(JSON.parse(
      window.localStorage.getItem("freed-desktop-client-registration-v1") ?? "null",
    )).toEqual(stored);
  });
});
