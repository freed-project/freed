/**
 * Mock for @tauri-apps/plugin-fs used when VITE_TEST_TAURI=1.
 *
 * content-cache.ts uses this to read/write cached article HTML. In tests all
 * reads miss (returning null/throwing) and writes are silently dropped, so
 * the app falls back to fetching live content — which is fine for smoke tests
 * and can be overridden via window.__TAURI_MOCK_FS__ for targeted tests.
 */

export enum BaseDirectory {
  Audio = 1,
  Cache = 2,
  Config = 3,
  Data = 4,
  LocalData = 5,
  Document = 6,
  Download = 7,
  Picture = 8,
  Public = 9,
  Video = 10,
  Resource = 11,
  AppConfig = 12,
  AppData = 13,
  AppLocalData = 14,
  AppCache = 15,
  AppLog = 16,
  Desktop = 17,
  Executable = 18,
  Font = 19,
  Home = 20,
  Runtime = 21,
  Template = 22,
}

// In-memory FS for tests that need to write/read files.
const memFs = new Map<string, Uint8Array>();

function fsKey(path: string, options?: { baseDir?: BaseDirectory }): string {
  return `${options?.baseDir ?? 0}:${path}`;
}

export async function readFile(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<Uint8Array> {
  const data = memFs.get(fsKey(path, options));
  if (!data) throw new Error(`[mock-fs] ENOENT: ${path}`);
  return data;
}

export async function writeFile(
  path: string,
  data: Uint8Array,
  options?: { baseDir?: BaseDirectory; append?: boolean; createNew?: boolean },
): Promise<void> {
  memFs.set(fsKey(path, options), data);
}

export async function readTextFile(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<string> {
  const bytes = await readFile(path, options);
  return new TextDecoder().decode(bytes);
}

export async function writeTextFile(
  path: string,
  contents: string,
  options?: { baseDir?: BaseDirectory; append?: boolean },
): Promise<void> {
  return writeFile(path, new TextEncoder().encode(contents), options);
}

export async function exists(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<boolean> {
  return memFs.has(fsKey(path, options));
}

export async function mkdir(
  _path: string,
  _options?: { baseDir?: BaseDirectory; recursive?: boolean },
): Promise<void> {}

export async function remove(
  path: string,
  options?: { baseDir?: BaseDirectory; recursive?: boolean },
): Promise<void> {
  memFs.delete(fsKey(path, options));
}

export async function rename(
  from: string,
  to: string,
  options?: { fromPathBaseDir?: BaseDirectory; toPathBaseDir?: BaseDirectory },
): Promise<void> {
  const data = memFs.get(fsKey(from, { baseDir: options?.fromPathBaseDir }));
  if (data) {
    memFs.set(fsKey(to, { baseDir: options?.toPathBaseDir }), data);
    memFs.delete(fsKey(from, { baseDir: options?.fromPathBaseDir }));
  }
}

export async function copyFile(
  from: string,
  to: string,
  options?: { fromPathBaseDir?: BaseDirectory; toPathBaseDir?: BaseDirectory },
): Promise<void> {
  const data = memFs.get(fsKey(from, { baseDir: options?.fromPathBaseDir }));
  if (data) {
    memFs.set(fsKey(to, { baseDir: options?.toPathBaseDir }), data);
  }
}

export async function readDir(
  _path: string,
  _options?: { baseDir?: BaseDirectory; recursive?: boolean },
): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
  return [];
}

export async function stat(
  path: string,
  options?: { baseDir?: BaseDirectory },
): Promise<{ size: number; isFile: boolean; isDirectory: boolean }> {
  const data = memFs.get(fsKey(path, options));
  if (!data) throw new Error(`[mock-fs] ENOENT: ${path}`);
  return { size: data.byteLength, isFile: true, isDirectory: false };
}
