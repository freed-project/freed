import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("SQLite Library contract generated outputs are current", () => {
  assert.doesNotThrow(() => {
    execFileSync(
      process.execPath,
      ["scripts/generate-library-core-contract.mjs", "--check"],
      { cwd: root, stdio: "pipe" },
    );
  });
});
