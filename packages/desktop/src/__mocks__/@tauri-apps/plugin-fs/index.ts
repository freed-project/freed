/**
 * Mock for @tauri-apps/plugin-fs
 *
 * content-cache.ts uses exists(), readFile(), writeFile(), readTextFile(),
 * writeTextFile(), mkdir(), remove(), and readDir().
 * In test mode all FS operations are backed by an in-memory map.
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

export async function readTextFile(path: string): Promise<string> {
  return new TextDecoder().decode(await readFile(path));
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

export async function readDir(path: string): Promise<Array<{ name: string }>> {
  const prefix = `${path}/`;
  const names = new Set<string>();
  for (const filePath of memfs.keys()) {
    if (!filePath.startsWith(prefix)) continue;
    const relative = filePath.slice(prefix.length);
    if (!relative || relative.includes("/")) continue;
    names.add(relative);
  }
  return Array.from(names, (name) => ({ name }));
}
