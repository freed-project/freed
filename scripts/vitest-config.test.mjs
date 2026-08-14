import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const vitestBin = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const configPath = path.join(repoRoot, "vitest.config.ts");

test("root Vitest discovery excludes compiled test copies", (t) => {
  const fixture = mkdtempSync(
    path.join(repoRoot, ".vitest-config-fixture-"),
  );
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  const sourceDir = path.join(fixture, "src");
  const distDir = path.join(fixture, "dist");
  mkdirSync(sourceDir);
  mkdirSync(distDir);
  const source = 'import { test } from "vitest"; test("contract", () => {});\n';
  writeFileSync(path.join(sourceDir, "contract.test.js"), source);
  writeFileSync(path.join(distDir, "contract.test.js"), source);

  const result = spawnSync(
    process.execPath,
    [
      vitestBin,
      "list",
      fixture,
      "--config",
      configPath,
      "--passWithNoTests",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /src\/contract\.test\.js/);
  assert.doesNotMatch(result.stdout, /dist\/contract\.test\.js/);
});
