import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const LIB_DIR = join(process.cwd(), "src/lib");
const ALLOWED_PLUGIN_STORE_IMPORTS = new Set(["secure-storage.ts"]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

describe("desktop hot-path contract", () => {
  it("keeps Tauri plugin-store isolated to encrypted secret storage", () => {
    const offenders = sourceFiles(LIB_DIR)
      .filter((path) => !path.endsWith(".test.ts"))
      .filter((path) => readFileSync(path, "utf8").includes("@tauri-apps/plugin-store"))
      .map((path) => relative(LIB_DIR, path))
      .filter((path) => !ALLOWED_PLUGIN_STORE_IMPORTS.has(path));

    expect(offenders).toEqual([]);
  });

  it("keeps cloud uploads behind the side-effect scheduler", () => {
    const syncSource = readFileSync(join(LIB_DIR, "sync.ts"), "utf8");
    expect(syncSource).toContain("scheduleSideEffect");
    expect(syncSource).toContain('queue: "sync"');
  });

  it("keeps outbox drains wired to Automerge change metadata", () => {
    const storeSource = readFileSync(join(LIB_DIR, "store.ts"), "utf8");
    const outboxSource = readFileSync(join(LIB_DIR, "outbox.ts"), "utf8");
    expect(storeSource).toContain("subscribe((_state, event) => cb(event))");
    expect(outboxSource).toContain("DocChangeEvent");
    expect(outboxSource).toContain("pendingChangedItems");
  });
});
