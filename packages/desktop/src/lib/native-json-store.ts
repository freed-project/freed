import { isTauri } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { scheduleSideEffect } from "./side-effect-scheduler";

const pathPromises = new Map<string, Promise<string>>();

function mockStoreStorageKey(file: string): string {
  return `__TAURI_MOCK_STORE__:${file}`;
}

function readMockStoreFile(file: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(mockStoreStorageKey(file));
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

function isMissingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ENOENT") || message.includes("No such file");
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

export async function readNativeJsonFile(file: string): Promise<Record<string, unknown> | null> {
  if (!isTauri()) return readMockStoreFile(file);
  try {
    const raw = await readTextFile(await nativeJsonPath(file));
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch (error) {
    if (isMissingFile(error)) return readMockStoreFile(file);
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
      let parsed: Record<string, unknown> = {};
      try {
        parsed = (await readNativeJsonFile(file)) ?? {};
      } catch {
        parsed = {};
      }
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
