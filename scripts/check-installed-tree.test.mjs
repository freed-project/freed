import assert from "node:assert/strict";
import test from "node:test";

import {
  findInstalledTreeDrift,
  formatFindings,
} from "./check-installed-tree.mjs";

test("the real repository tree matches its own lockfile", async () => {
  const { readFileSync } = await import("node:fs");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const findings = findInstalledTreeDrift(lock);
  assert.deepEqual(
    findings,
    [],
    `Installed tree drifted from package-lock.json:\n${formatFindings(findings)}`,
  );
});

test("a version mismatch is reported against the locked version", () => {
  // typescript is a real installed dependency, so the only thing that differs
  // from the live tree here is the version this synthetic lock claims.
  const findings = findInstalledTreeDrift({
    packages: {
      "node_modules/typescript": { version: "0.0.0-not-installed" },
    },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "mismatch");
  assert.equal(findings[0].expected, "0.0.0-not-installed");
  assert.notEqual(findings[0].actual, null);
});

test("an absent package is reported as missing rather than mismatched", () => {
  const findings = findInstalledTreeDrift({
    packages: {
      "node_modules/@freed/package-that-does-not-exist": { version: "1.2.3" },
    },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "missing");
  assert.equal(findings[0].actual, null);
});

test("an absent optional dependency is not drift", () => {
  // The lockfile carries every platform's prebuilt binary. npm installs only
  // the matching one, so the rest are legitimately absent on any given machine.
  const findings = findInstalledTreeDrift({
    packages: {
      "node_modules/@esbuild/some-other-platform": {
        version: "0.28.2",
        optional: true,
        os: ["aix"],
        cpu: ["ppc64"],
      },
      "node_modules/@freed/optional-in-dev": {
        version: "1.0.0",
        devOptional: true,
      },
    },
  });
  assert.deepEqual(findings, []);
});

test("an installed optional dependency at the wrong version is still drift", () => {
  const findings = findInstalledTreeDrift({
    packages: {
      "node_modules/typescript": { version: "0.0.0-wrong", optional: true },
    },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "mismatch");
});

test("workspace links and bundled entries are not install targets", () => {
  const findings = findInstalledTreeDrift({
    packages: {
      // The root project entry carries a version but no install path.
      "": { version: "26.9.1400" },
      // Workspace symlinks resolve to the repo, not to an installed copy.
      "node_modules/@freed/shared": { resolved: "packages/shared", link: true },
      // Bundled dependencies live inside their parent's tree.
      "node_modules/nope/node_modules/bundled": {
        version: "9.9.9",
        inBundle: true,
      },
      // Entries without a version cannot be compared.
      "node_modules/versionless": { resolved: "https://example.invalid/x.tgz" },
    },
  });
  assert.deepEqual(findings, []);
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

test("the fast-xml-parser drift that motivated this check is caught", () => {
  // The exact shape of the real failure: lockfile pins v5, tree holds v4, and
  // nothing else in the build notices.
  const findings = findInstalledTreeDrift({
    packages: {
      "node_modules/fast-xml-parser": { version: "4.5.3" },
    },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "mismatch");
  assert.match(formatFindings(findings), /fast-xml-parser: installed/);
});
