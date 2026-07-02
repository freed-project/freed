import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseArgs } from "./record-outcome.mjs";
import { resolveStatePathWithLegacyFallback } from "./nightly-self-improve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "record-outcome.mjs");

test("resolveStatePathWithLegacyFallback prefers an existing new-location file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-state-fallback-"));
  const preferred = path.join(dir, "new", "outcomes.jsonl");
  const legacy = path.join(dir, "legacy", "outcomes.jsonl");
  writeFileSync(path.join(dir, "new-file"), "");
  const newPath = path.join(dir, "new-file");
  assert.equal(resolveStatePathWithLegacyFallback(newPath, legacy), newPath);
  assert.equal(resolveStatePathWithLegacyFallback(preferred, legacy), preferred);
});

test("resolveStatePathWithLegacyFallback migrates legacy state to the new location", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-state-migrate-"));
  const preferred = path.join(dir, "new", "outcomes.jsonl");
  const legacy = path.join(dir, "legacy-outcomes.jsonl");
  writeFileSync(legacy, '{"id":"old","kind":"task","outcome":"shipped"}\n');

  const resolved = resolveStatePathWithLegacyFallback(preferred, legacy);

  assert.equal(resolved, preferred);
  assert.ok(existsSync(preferred));
  assert.match(readFileSync(preferred, "utf8"), /"id":"old"/);
});

test("resolveStatePathWithLegacyFallback keeps the legacy path when migration fails", () => {
  const failingOps = {
    existsSync: (p) => p === "/legacy/outcomes.jsonl",
    mkdirSync: () => {
      throw new Error("read-only");
    },
    copyFileSync: () => {
      throw new Error("read-only");
    },
  };
  assert.equal(
    resolveStatePathWithLegacyFallback("/new/outcomes.jsonl", "/legacy/outcomes.jsonl", failingOps),
    "/legacy/outcomes.jsonl",
  );
});

test("record-outcome parseArgs requires an id and applies defaults", () => {
  assert.throws(() => parseArgs([]), /--id is required/);
  const args = parseArgs(["--id", "W1-01", "--pr", "897"]);
  assert.equal(args.kind, "task");
  assert.equal(args.status, "shipped");
  assert.equal(args.pr, "897");
  assert.ok(args.ledger.includes(".freed-automation"));
  assert.throws(() => parseArgs(["--id", "x", "--bogus"]), /Unknown argument/);
});

test("record-outcome CLI appends a ledger line at the given path", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-"));
  const ledger = path.join(dir, "state", "outcomes.jsonl");

  const stdout = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      "--id",
      "W1-01",
      "--kind",
      "task",
      "--status",
      "shipped",
      "--pr",
      "897",
      "--build",
      "v26.7.203-dev",
      "--notes",
      "test entry",
      "--ledger",
      ledger,
    ],
    { encoding: "utf8" },
  );

  assert.match(stdout, /Recorded shipped outcome for W1-01/);
  const lines = readFileSync(ledger, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.id, "W1-01");
  assert.equal(entry.kind, "task");
  assert.equal(entry.outcome, "shipped");
  assert.equal(entry.pr, "897");
  assert.equal(entry.build, "v26.7.203-dev");
  assert.ok(entry.ts);
});

test("record-outcome CLI rejects an invalid status", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-bad-"));
  const ledger = path.join(dir, "outcomes.jsonl");
  assert.throws(() =>
    execFileSync(process.execPath, [CLI_PATH, "--id", "x", "--status", "done", "--ledger", ledger], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.equal(existsSync(ledger), false);
});
