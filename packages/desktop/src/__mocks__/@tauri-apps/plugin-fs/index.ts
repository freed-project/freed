/**
 * Mock for @tauri-apps/plugin-fs
 *
 * content-cache.ts uses exists(), readFile(), writeFile(), and mkdir().
 * In test mode all FS operations are no-ops backed by an in-memory map.
 * This means getLocalContent() always returns null (cache miss), and
 * writeFile() silently discards data — perfectly acceptable for benchmarks.
 */

const memfs = new Map<string, Uint8Array>();

export async function exists(path: string): Promise<boolean> {
  return memfs.has(path);
}

export async function readFile(path: string): Promise<Uint8Array> {
  const data = memfs.get(path);
  if (!data) throw new Error(`ENOENT: ${path}`);
  return data;
}

export async function writeFile(
  path: string,
  contents: Uint8Array | string,
): Promise<void> {
  const bytes =
    typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : contents;
  memfs.set(path, bytes);
}

export async function mkdir(
  _path: string,
  _opts?: { recursive?: boolean },
): Promise<void> {}

export async function remove(_path: string): Promise<void> {
  memfs.delete(_path);
}
