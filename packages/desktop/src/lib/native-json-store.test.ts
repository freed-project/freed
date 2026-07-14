import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  remove: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  scheduleSideEffect: vi.fn(async (task: { run: () => Promise<unknown> }) => task.run()),
  writeTextFile: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "/mock/app-data"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mocks.readTextFile,
  remove: mocks.remove,
  rename: mocks.rename,
  writeTextFile: mocks.writeTextFile,
}));

vi.mock("./side-effect-scheduler", () => ({
  scheduleSideEffect: mocks.scheduleSideEffect,
}));

import { removeNativeJsonFile, writeNativeJsonValue } from "./native-json-store";

const file = "device-settings.json";
const path = `/mock/app-data/${file}`;
const tempPath = `${path}.tmp`;

function expectNoReplacement(): void {
  expect(mocks.writeTextFile).not.toHaveBeenCalled();
  expect(mocks.rename).not.toHaveBeenCalled();
}

describe("native JSON store writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("preserves sibling keys when updating an existing file", async () => {
    mocks.readTextFile.mockResolvedValue(JSON.stringify({
      registration: { id: "desktop-existing" },
      releaseChannel: "production",
    }));

    await writeNativeJsonValue(
      file,
      "registration",
      { id: "desktop-updated" },
      "native-json-store-test",
    );

    expect(mocks.writeTextFile).toHaveBeenCalledOnce();
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      tempPath,
      JSON.stringify({
        registration: { id: "desktop-updated" },
        releaseChannel: "production",
      }),
    );
    expect(mocks.rename).toHaveBeenCalledWith(tempPath, path);
  });

  it("creates an empty object only when the native file is missing", async () => {
    mocks.readTextFile.mockRejectedValue(
      Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
    );

    await writeNativeJsonValue(
      file,
      "registration",
      { id: "desktop-new" },
      "native-json-store-test",
    );

    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      tempPath,
      JSON.stringify({ registration: { id: "desktop-new" } }),
    );
    expect(mocks.rename).toHaveBeenCalledWith(tempPath, path);
  });

  it.each([
    Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" }),
    new Error("native store temporarily unavailable"),
  ])("rejects read failures without replacing the file", async (error) => {
    mocks.readTextFile.mockRejectedValue(error);

    await expect(
      writeNativeJsonValue(
        file,
        "registration",
        { id: "desktop-new" },
        "native-json-store-test",
      ),
    ).rejects.toBe(error);
    expectNoReplacement();
  });

  it.each([
    "{not valid JSON",
    "[]",
    "null",
  ])("rejects malformed native JSON without replacing the file", async (raw) => {
    mocks.readTextFile.mockResolvedValue(raw);

    await expect(
      writeNativeJsonValue(
        file,
        "registration",
        { id: "desktop-new" },
        "native-json-store-test",
      ),
    ).rejects.toThrow();
    expectNoReplacement();
  });

  it("removes a native JSON store through the serialized store queue", async () => {
    window.localStorage.setItem(
      `__TAURI_MOCK_STORE__:${file}`,
      JSON.stringify({ registration: { id: "desktop-existing" } }),
    );

    await removeNativeJsonFile(file, "native-json-store-test");

    expect(mocks.remove).toHaveBeenCalledWith(path);
    expect(mocks.remove).toHaveBeenCalledWith(tempPath);
    expect(window.localStorage.getItem(`__TAURI_MOCK_STORE__:${file}`)).toBeNull();
    expect(mocks.scheduleSideEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: "nativeStore",
        source: "native-json-store-test",
        kind: `remove:${file}`,
      }),
    );
  });

  it("propagates native JSON store removal failures", async () => {
    const error = Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
    mocks.remove.mockRejectedValueOnce(error);

    await expect(
      removeNativeJsonFile(file, "native-json-store-test"),
    ).rejects.toBe(error);
  });

  it("treats an already missing native JSON store as cleared", async () => {
    const missing = Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    mocks.remove.mockRejectedValueOnce(missing).mockRejectedValueOnce(missing);

    await expect(
      removeNativeJsonFile(file, "native-json-store-test"),
    ).resolves.toBeUndefined();
  });
});
