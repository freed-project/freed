import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const FORBIDDEN_CLOUD_SQLITE_MARKERS = [
  "application/vnd.sqlite3",
  "freed-library-backup-sqlite",
  "library_core_sqlite_backup_manifest",
] as const;

function productionSources(directory: string): string[] {
  const sources: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (name !== "__mocks__") sources.push(...productionSources(path));
      continue;
    }
    if (!/\.[cm]?tsx?$/.test(name) || /\.test\.[cm]?tsx?$/.test(name)) {
      continue;
    }
    sources.push(path);
  }
  return sources;
}

describe("Library Core cloud storage boundary", () => {
  it("contains no production path that can upload a SQLite backup", () => {
    const violations = productionSources(SOURCE_ROOT).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return FORBIDDEN_CLOUD_SQLITE_MARKERS
        .filter((marker) => source.includes(marker))
        .map((marker) => ({ marker, path }));
    });

    expect(violations).toEqual([]);
  });
});
