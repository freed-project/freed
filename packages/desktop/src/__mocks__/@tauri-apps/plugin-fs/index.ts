/**
 * Mock for @tauri-apps/plugin-fs
 *
 * content-cache.ts and local model tests use exists(), readFile(), writeFile(),
 * readTextFile(), writeTextFile(), mkdir(), remove(), rename(), open(), size(),
 * and readDir().
 * In test mode all FS operations are backed by an in-memory map.
 */

const memfs = new Map<string, Uint8Array>();
type DirEntry = { name?: string };

export function __resetMemfs(): void {
  memfs.clear();
}

export function __readMemfs(path: string): Uint8Array | undefined {
  return memfs.get(path);
}

export async function exists(path: string): Promise<boolean> {
  const prefix = path.endsWith("/") ? path : `${path}/`;
  return memfs.has(path) || Array.from(memfs.keys()).some((key) => key.startsWith(prefix));
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

export async function remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
  memfs.delete(path);
  if (opts?.recursive) {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const key of Array.from(memfs.keys())) {
      if (key.startsWith(prefix)) memfs.delete(key);
    }
  }
}

export async function rename(oldPath: string, newPath: string): Promise<void> {
  const data = memfs.get(oldPath);
  if (!data) throw new Error(`ENOENT: ${oldPath}`);
  memfs.set(newPath, data);
  memfs.delete(oldPath);
}

export async function size(path: string): Promise<number> {
  const file = memfs.get(path);
  if (file) return file.byteLength;

  const prefix = path.endsWith("/") ? path : `${path}/`;
  let total = 0;
  for (const [key, value] of memfs.entries()) {
    if (key.startsWith(prefix)) total += value.byteLength;
  }
  if (total > 0) return total;
  throw new Error(`ENOENT: ${path}`);
}

export async function open(
  path: string,
  opts: { append?: boolean; truncate?: boolean; create?: boolean } = {},
): Promise<{
  write(data: Uint8Array): Promise<number>;
  close(): Promise<void>;
}> {
  if (!opts.create && !memfs.has(path)) throw new Error(`ENOENT: ${path}`);
  let chunks: Uint8Array[] = [];
  if (opts.append && memfs.has(path)) {
    chunks = [memfs.get(path)!];
  }
  if (opts.truncate) {
    chunks = [];
  }

  return {
    async write(data: Uint8Array): Promise<number> {
      chunks.push(data);
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const next = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        next.set(chunk, offset);
        offset += chunk.byteLength;
      }
      memfs.set(path, next);
      return data.byteLength;
    },
    async close(): Promise<void> {},
  };
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
