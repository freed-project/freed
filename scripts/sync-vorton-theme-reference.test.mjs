import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REFERENCE_FILE,
  REQUIRED_THEMES,
  SOURCE_FILE,
  parseArgs,
  sha256,
  syncReference,
} from "./sync-vorton-theme-reference.mjs";

function reference(themes = REQUIRED_THEMES) {
  return `${JSON.stringify({
    schema: 1,
    themes: Object.fromEntries(themes.map((theme) => [theme, { roles: {}, palette: {} }])),
  })}\n`;
}

function vortonCheckout(contents) {
  const root = mkdtempSync(path.join(tmpdir(), "vorton-reference-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  mkdirSync(path.join(root, "web/design"), { recursive: true });
  writeFileSync(path.join(root, "web/design/theme-reference.json"), contents);
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "reference");
  return { root, commit: git("rev-parse", "HEAD").toString().trim() };
}

test("vendors the committed reference with its commit and hash, ignoring the working tree", () => {
  const committed = reference();
  const { root, commit } = vortonCheckout(committed);
  const to = mkdtempSync(path.join(tmpdir(), "freed-reference-"));
  try {
    // An uncommitted edit in Vorton must not reach Freed.
    writeFileSync(path.join(root, "web/design/theme-reference.json"), "{}");
    const record = syncReference({ from: root, rev: "HEAD", to });
    assert.equal(readFileSync(path.join(to, REFERENCE_FILE), "utf8"), committed);
    assert.deepEqual(JSON.parse(readFileSync(path.join(to, SOURCE_FILE), "utf8")), record);
    assert.equal(record.commit, commit);
    assert.equal(record.sha256, sha256(committed));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(to, { recursive: true, force: true });
  }
});

test("refuses a reference missing a theme, and arguments without a checkout", () => {
  const { root } = vortonCheckout(reference(REQUIRED_THEMES.slice(1)));
  const to = mkdtempSync(path.join(tmpdir(), "freed-reference-"));
  try {
    assert.throws(() => syncReference({ from: root, rev: "HEAD", to }), /missing starship-light/);
    assert.throws(() => parseArgs(["--rev", "HEAD"]), /--from/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(to, { recursive: true, force: true });
  }
});

test("imports supplied bytes with explicit provenance and preserves outputs on rejection", () => {
  const root = mkdtempSync(path.join(tmpdir(), "supplied-reference-"));
  const file = path.join(root, "reference.json");
  const to = path.join(root, "output");
  const commit = "fbaca819157c9310666a72bed0325c01aae16dbb";
  const contents = reference();
  try {
    writeFileSync(file, contents);
    const options = parseArgs(["--file", file, "--commit", commit, "--sha256", sha256(contents), "--to", to]);
    const record = syncReference(options);
    assert.deepEqual(record, { source: "vorton", path: "web/design/theme-reference.json", commit, sha256: sha256(contents) });
    assert.equal(readFileSync(path.join(to, REFERENCE_FILE), "utf8"), contents);
    const source = readFileSync(path.join(to, SOURCE_FILE), "utf8");
    assert.deepEqual(JSON.parse(source), record);

    const rejected = [
      [{ sha256: "0".repeat(64) }, contents, /does not match/],
      [{ sha256: undefined }, contents, /--sha256/],
      [{ commit: "fbaca819" }, contents, /--commit/],
      [{ commit: undefined }, contents, /--commit/],
      [{ from: root }, contents, /exactly one/],
      [{ rev: "main" }, contents, /--rev/],
      [{}, "{broken", /not valid JSON/],
      [{}, '{"schema":2}', /Unsupported/],
      [{}, reference(REQUIRED_THEMES.slice(1)), /missing starship-light/],
    ];
    for (const [overrides, text, error] of rejected) {
      writeFileSync(file, text);
      assert.throws(() => syncReference({ ...options, sha256: sha256(text), ...overrides }), error);
      assert.equal(readFileSync(path.join(to, REFERENCE_FILE), "utf8"), contents);
      assert.equal(readFileSync(path.join(to, SOURCE_FILE), "utf8"), source);
    }
    assert.throws(() => parseArgs(["--file", file]), /--commit/);
    assert.throws(() => parseArgs(["--from", root, "--commit", commit]), /require --file/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
