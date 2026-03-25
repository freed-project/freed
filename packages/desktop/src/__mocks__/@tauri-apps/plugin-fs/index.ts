/**
 * Mock for @tauri-apps/plugin-fs
 *
 * content-cache.ts uses exists(), readFile(), writeFile(), and mkdir().
 * In test mode all FS operations are no-ops backed by an in-memory map.
 * This means getLocalContent() always returns null (cache miss), and
 * writeFile() silently discards data — perfectly acceptable for benchmarks.
 */

const memfs = new Map<string, Uint8Array>();
type DirEntry = { name?: string };

export async function exists(path: string): Promise<boolean> {
  return memfs.has(path);
}

export async function readFile(path: string): Promise<Uint8Array> {
  const data = memfs.get(path);
  if (!data) throw new Error(`ENOENT: ${path}`);
  return data;
}

export async function readTextFile(path: string): Promise<string> {
  const data = await readFile(path);
  return new TextDecoder().decode(data);
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

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
}

export async function mkdir(
  _path: string,
  _opts?: { recursive?: boolean },
): Promise<void> {}

export async function remove(_path: string): Promise<void> {
  memfs.delete(_path);
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const prefix = path.endsWith("/") ? path : `${path}/`;
  const names = new Set<string>();

  for (const key of memfs.keys()) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length);
    const name = remainder.split("/")[0];
    if (name) names.add(name);
  }

  return Array.from(names, (name) => ({ name }));
}
