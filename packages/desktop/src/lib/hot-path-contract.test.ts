import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const LIB_DIR = join(process.cwd(), "src/lib");
const DESKTOP_SRC_DIR = join(process.cwd(), "src");
const UI_SRC_DIR = join(process.cwd(), "../../packages/ui/src");
const ALLOWED_PLUGIN_STORE_IMPORTS = new Set(["secure-storage.ts"]);
const HOT_TIME_FORMAT_PATHS = [
  join(DESKTOP_SRC_DIR, "components/ProviderActivityLog.tsx"),
  join(DESKTOP_SRC_DIR, "lib/fb-capture.ts"),
  join(DESKTOP_SRC_DIR, "lib/instagram-capture.ts"),
  join(DESKTOP_SRC_DIR, "lib/li-capture.ts"),
  join(UI_SRC_DIR, "components/DebugPanel.tsx"),
  join(UI_SRC_DIR, "components/ProviderHealthSummary.tsx"),
  join(UI_SRC_DIR, "components/settings/AISection.tsx"),
  join(UI_SRC_DIR, "lib/build-info.ts"),
];

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

  it("keeps hot diagnostics time formatting on cached formatters", () => {
    const offenders = HOT_TIME_FORMAT_PATHS.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const relativePath = relative(process.cwd(), path);
      const matches: string[] = [];
      if (source.includes(".toLocaleTimeString(")) matches.push(`${relativePath}:toLocaleTimeString`);
      if (source.includes("new Intl.DateTimeFormat(")) matches.push(`${relativePath}:Intl.DateTimeFormat`);
      return matches;
    });

    expect(offenders).toEqual([]);
  });

  it("keeps provider settings from duplicating active health messages", () => {
    const summarySource = readFileSync(
      join(DESKTOP_SRC_DIR, "components/ProviderHealthSectionSummary.tsx"),
      "utf8",
    );

    expect(summarySource).toContain("showMessages = false");
  });
});
