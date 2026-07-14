import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  writeVersionedLocalStorage,
  type VersionedLocalStorageCodec,
} from "@freed/ui/lib/versioned-local-storage";

interface TestState {
  value: string;
}

const codec: VersionedLocalStorageCodec<TestState> = {
  version: 1,
  decode(record) {
    return typeof record.value === "string" ? { value: record.value } : null;
  },
  encode(value) {
    return { value: value.value };
  },
};

const key = "freed-test-device-state-v1";

describe("versioned local storage reset", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("purges current and older recovery copies during destructive replacement", () => {
    window.localStorage.setItem(key, JSON.stringify({ version: 2, value: "future" }));
    window.localStorage.setItem(`${key}.recovery.1.0`, "older-copy");
    window.localStorage.setItem("unrelated.recovery.1.0", "keep-me");

    expect(writeVersionedLocalStorage(
      key,
      codec,
      { value: "cleared" },
      { replaceUnsupportedVersion: true, purgeRecoveryCopies: true },
    )).toBe(true);

    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({
      version: 1,
      value: "cleared",
    });
    const keys = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    );
    expect(keys.some((candidate) => candidate?.startsWith(`${key}.recovery.`))).toBe(false);
    expect(window.localStorage.getItem("unrelated.recovery.1.0")).toBe("keep-me");
  });

  it("reports a failed reset when a recovery copy cannot be removed", () => {
    window.localStorage.setItem(`${key}.recovery.1.0`, "sensitive-copy");
    const storage = window.localStorage;
    vi.spyOn(window, "localStorage", "get").mockReturnValue({
      get length() {
        return storage.length;
      },
      clear: storage.clear.bind(storage),
      getItem: storage.getItem.bind(storage),
      key: storage.key.bind(storage),
      setItem: storage.setItem.bind(storage),
      removeItem(candidate) {
        if (candidate.startsWith(`${key}.recovery.`)) {
          throw new Error("storage unavailable");
        }
        storage.removeItem(candidate);
      },
    });

    expect(writeVersionedLocalStorage(
      key,
      codec,
      { value: "cleared" },
      { replaceUnsupportedVersion: true, purgeRecoveryCopies: true },
    )).toBe(false);
  });
});
