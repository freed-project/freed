import { isTauri } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { scheduleSideEffect } from "./side-effect-scheduler";

const pathPromises = new Map<string, Promise<string>>();

function mockStoreStorageKey(file: string): string {
  return `__TAURI_MOCK_STORE__:${file}`;
}

function readMockStoreRaw(file: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(mockStoreStorageKey(file));
}

function readMockStoreFile(file: string): Record<string, unknown> | null {
  try {
    const raw = readMockStoreRaw(file);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function writeMockStoreFile(file: string, contents: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(mockStoreStorageKey(file), JSON.stringify(contents));
  } catch {
    // Browser test fallback only.
  }
}

function removeMockStoreFile(file: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(mockStoreStorageKey(file));
}

function isMissingFile(error: unknown): boolean {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /^ENOENT\b/.test(message) || message.includes("No such file or directory");
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

interface NativeJsonFileResult {
  contents: Record<string, unknown> | null;
  missing: boolean;
}

async function nativeJsonPath(file: string): Promise<string> {
  const existing = pathPromises.get(file);
  if (existing) return existing;
  const next = appDataDir().then((dir) => {
    const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
    return `${base}/${file}`;
  });
  pathPromises.set(file, next);
  return next;
}

async function readNativeJsonFileResult(file: string): Promise<NativeJsonFileResult> {
  let raw: string;
  try {
    raw = await readTextFile(await nativeJsonPath(file));
  } catch (error) {
    if (isMissingFile(error)) {
      return { contents: readMockStoreFile(file), missing: true };
    }
    throw error;
  }
  return { contents: parseJsonRecord(raw), missing: false };
}

export async function readNativeJsonFile(file: string): Promise<Record<string, unknown> | null> {
  if (!isTauri()) return readMockStoreFile(file);
  return (await readNativeJsonFileResult(file)).contents;
}

/** Read the exact persisted bytes so callers can preserve malformed evidence. */
export async function readNativeJsonFileRaw(file: string): Promise<string | null> {
  if (!isTauri()) return readMockStoreRaw(file);
  try {
    return await readTextFile(await nativeJsonPath(file));
  } catch (error) {
    if (isMissingFile(error)) return readMockStoreRaw(file);
    throw error;
  }
}

export async function readNativeJsonValue(file: string, key: string): Promise<unknown> {
  const parsed = await readNativeJsonFile(file);
  return parsed?.[key] ?? null;
}

export async function writeNativeJsonValue(
  file: string,
  key: string,
  value: unknown,
  source: string,
): Promise<void> {
  if (!isTauri()) {
    const parsed = readMockStoreFile(file) ?? {};
    parsed[key] = value;
    writeMockStoreFile(file, parsed);
    return;
  }
  await scheduleSideEffect({
    queue: "nativeStore",
    source,
    kind: `write:${file}`,
    run: async () => {
      const path = await nativeJsonPath(file);
      const existing = await readNativeJsonFileResult(file);
      if (!existing.missing && !existing.contents) {
        throw new TypeError(`Native JSON store ${file} must contain an object`);
      }
      const parsed = existing.contents ?? {};
      parsed[key] = value;
      const tempPath = `${path}.tmp`;
      await writeTextFile(tempPath, JSON.stringify(parsed));
      await rename(tempPath, path);
      writeMockStoreFile(file, parsed);
    },
  });
}

export async function writeNativeJsonFile(
  file: string,
  contents: Record<string, unknown>,
  source: string,
): Promise<void> {
  if (!isTauri()) {
    writeMockStoreFile(file, contents);
    return;
  }
  await scheduleSideEffect({
    queue: "nativeStore",
    source,
    kind: `write:${file}`,
    run: async () => {
      const path = await nativeJsonPath(file);
      const tempPath = `${path}.tmp`;
      await writeTextFile(tempPath, JSON.stringify(contents));
      await rename(tempPath, path);
      writeMockStoreFile(file, contents);
    },
  });
}

/** Remove a native JSON store after all earlier native-store work has settled. */
export async function removeNativeJsonFile(
  file: string,
  source: string,
): Promise<void> {
  if (!isTauri()) {
    removeMockStoreFile(file);
    return;
  }
  await scheduleSideEffect({
    queue: "nativeStore",
    source,
    kind: `remove:${file}`,
    run: async () => {
      const path = await nativeJsonPath(file);
      for (const candidate of [path, `${path}.tmp`]) {
        try {
          await remove(candidate);
        } catch (error) {
          if (!isMissingFile(error)) throw error;
        }
      }
      removeMockStoreFile(file);
    },
  });
}
