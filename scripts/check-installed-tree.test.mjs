import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findInstalledTreeDrift,
  formatFindings,
  runNpmCi,
} from "./check-installed-tree.mjs";

function fixture(t, packages = {}) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "freed-installed-tree-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  for (const [entryPath, manifest] of Object.entries(packages)) {
    const directory = path.join(rootDir, entryPath);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
  }
  return (packages) => findInstalledTreeDrift({ packages }, { rootDir });
}

test("matching root, nested and workspace dependencies pass", (t) => {
  const packages = {
    "node_modules/typescript": { version: "5.9.3" },
    "node_modules/parent/node_modules/child": { version: "2.0.0" },
    "packages/desktop/node_modules/@vitejs/plugin-react": { version: "6.1.0" },
    "website/node_modules/tailwindcss": { version: "4.1.18" },
  };
  assert.deepEqual(fixture(t, packages)(packages), []);
});

test("the fast-xml-parser v4 install is rejected against the v5 lock", (t) => {
  const check = fixture(t, {
    "node_modules/fast-xml-parser": { version: "4.5.3" },
  });
  const findings = check({
    "node_modules/fast-xml-parser": { version: "5.10.1" },
  });
  assert.deepEqual(findings, [{
    entryPath: "node_modules/fast-xml-parser",
    expected: "5.10.1",
    actual: "4.5.3",
    kind: "mismatch",
  }]);
});

test("workspace-local version drift is reported", (t) => {
  const check = fixture(t, {
    "packages/pwa/node_modules/undici": { version: "7.0.0" },
  });
  assert.deepEqual(check({
    "packages/pwa/node_modules/undici": { version: "8.10.2" },
  }), [{
    entryPath: "packages/pwa/node_modules/undici",
    expected: "8.10.2",
    actual: "7.0.0",
    kind: "mismatch",
  }]);
});

test("absent root and workspace dependencies are reported as missing", (t) => {
  const check = fixture(t);
  const packages = {
    "node_modules/required": { version: "1.2.3" },
    "packages/desktop/node_modules/@vitejs/plugin-react": { version: "6.1.0" },
  };
  assert.deepEqual(check(packages), Object.entries(packages).map(([entryPath, entry]) => ({
    entryPath, expected: entry.version, actual: null, kind: "missing",
  })));
});

test("absent optional dependencies are not drift, including workspace installs", (t) => {
  const check = fixture(t);
  assert.deepEqual(check({
    "node_modules/@esbuild/some-other-platform": {
      version: "0.28.2", optional: true, os: ["aix"], cpu: ["ppc64"],
    },
    "packages/desktop/node_modules/@esbuild/some-other-platform": {
      version: "0.28.2", optional: true, os: ["aix"], cpu: ["ppc64"],
    },
    "node_modules/@freed/optional-in-dev": { version: "1.0.0", devOptional: true },
  }), []);
});

test("installed optional dependencies must match their locked versions", (t) => {
  const entryPath = "packages/desktop/node_modules/@esbuild/test-platform";
  const check = fixture(t, { [entryPath]: { version: "0.27.0" } });
  assert.deepEqual(check({ [entryPath]: { version: "0.28.2", optional: true } }), [{
    entryPath, expected: "0.28.2", actual: "0.27.0", kind: "mismatch",
  }]);
});

test("workspace metadata, links, bundled and versionless entries are excluded", (t) => {
  const check = fixture(t);
  assert.deepEqual(check({
    "": { version: "26.9.1400" },
    "packages/desktop": { version: "26.9.1400" },
    "node_modules/@freed/shared": { resolved: "packages/shared", link: true },
    "node_modules/nope/node_modules/bundled": { version: "9.9.9", inBundle: true },
    "node_modules/versionless": { resolved: "https://example.invalid/x.tgz" },
  }), []);
});

test("findings render one readable line per package and summarize the rest", () => {
  const findings = [
    { entryPath: "node_modules/a", expected: "5.0.0", actual: "4.0.0", kind: "mismatch" },
    { entryPath: "node_modules/b", expected: "1.0.0", actual: null, kind: "missing" },
    { entryPath: "node_modules/c", expected: "2.0.0", actual: null, kind: "unreadable" },
  ];
  const full = formatFindings(findings);
  assert.match(full, /^ {2}a: installed 4\.0\.0, lockfile pins 5\.0\.0$/m);
  assert.match(full, /^ {2}b: not installed, lockfile pins 1\.0\.0$/m);
  assert.match(full, /^ {2}c: manifest unreadable, lockfile pins 2\.0\.0$/m);
  const capped = formatFindings(findings, { limit: 1 });
  assert.equal(capped.split("\n").length, 2);
  assert.match(capped, /and 2 more/);
});

test("repair launches npm through a shell only on Windows", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    const calls = [];
    runNpmCi({ platform, spawn: (...args) => { calls.push(args); return { status: 0 }; } });
    assert.equal(calls.length, 1);
    const [command, args, options] = calls[0];
    assert.equal(command, "npm");
    assert.deepEqual(args, ["ci"]);
    assert.equal(options.shell, platform === "win32");
    assert.equal(options.stdio, "inherit");
    assert.ok(path.isAbsolute(options.cwd));
  }
});

test("repair propagates launch and install failures", () => {
  const error = new Error("npm unavailable");
  assert.throws(() => runNpmCi({ spawn: () => ({ error }) }), (actual) => actual === error);
  assert.throws(() => runNpmCi({ spawn: () => ({ status: 1 }) }), /npm ci exited with status 1/);
});
