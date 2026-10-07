import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildValidationPlan, describePlan } from "./validate-worktree.mjs";

// Actual script, temporary inert manifests, no dependency installation.
const guardSource = readFileSync(new URL("./check-installed-tree.mjs", import.meta.url), "utf8");
const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = (packages = {}) => ({ lockfileVersion: 3, packages: { "": { name: "fixture" }, ...packages } });

test("feature validation routes guard-only and mixed changes to the guard contracts", () => {
  const paths = ["scripts/check-installed-tree.mjs", "scripts/check-installed-tree.test.mjs"];
  assert.deepEqual(describePlan(buildValidationPlan("feature", paths)), ["installed dependency tree tests"]);
  const mixed = describePlan(buildValidationPlan("feature", [...paths, "packages/desktop/tsconfig.node.json"]));
  assert.ok(mixed.includes("installed dependency tree tests"));
  assert.ok(mixed.includes("root typecheck"));
});

async function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "freed-installed-tree-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("scripts/check-installed-tree.mjs", guardSource);
  const script = path.join(root, "scripts/check-installed-tree.mjs");
  const api = await import(pathToFileURL(script).href);
  const install = (name, version) => write(`${name}/package.json`, { name: path.basename(name), version });
  const cli = (args = []) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: "utf8", timeout: 5000, env: { ...process.env, FREED_AUTO_INSTALL: "0" },
  });
  return { root, write, install, api, cli };
}

test("matching root, nested, scoped and workspace-local packages pass", async (t) => {
  const f = await fixture(t);
  const packages = {
    "packages/app": { name: "app", version: "1.0.0" },
    "node_modules/parent": { version: "2.0.0" },
    "node_modules/parent/node_modules/@scope/child": { version: "3.0.0" },
    "packages/app/node_modules/local": { version: "4.0.0" },
  };
  for (const [name, entry] of Object.entries(packages)) f.install(name, entry.version);
  assert.deepEqual(f.api.findInstalledTreeDrift(lock(packages)), []);
});

test("a root version mismatch identifies the exact locked path", async (t) => {
  const f = await fixture(t); f.install("node_modules/parser", "4.5.3");
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({ "node_modules/parser": { version: "5.10.1" } })), [
    { entryPath: "node_modules/parser", expected: "5.10.1", actual: "4.5.3", kind: "mismatch" },
  ]);
});

test("a missing required workspace-local dependency blocks verification", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({ "packages/app/node_modules/local": { version: "1.2.3" } })), [
    { entryPath: "packages/app/node_modules/local", expected: "1.2.3", actual: null, kind: "missing" },
  ]);
});

test("a stale workspace-local version is checked rather than skipped", async (t) => {
  const f = await fixture(t); f.install("packages/app/node_modules/local", "1.0.0");
  const findings = f.api.findInstalledTreeDrift(lock({ "packages/app/node_modules/local": { version: "2.0.0" } }));
  assert.equal(findings.length, 1); assert.equal(findings[0].kind, "mismatch");
});

test("an installed bundled dependency must match its physical lock entry", async (t) => {
  const f = await fixture(t); f.install("node_modules/parent", "1.0.0");
  f.install("node_modules/parent/node_modules/bundled", "8.0.0");
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({
    "node_modules/parent": { version: "1.0.0", optional: true },
    "node_modules/parent/node_modules/bundled": { version: "9.0.0", inBundle: true },
  })), [{ entryPath: "node_modules/parent/node_modules/bundled", expected: "9.0.0", actual: "8.0.0", kind: "mismatch" }]);
});

test("bundled absence is permitted when the optional parent is absent", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({
    "node_modules/parent": { version: "1.0.0", optional: true },
    "node_modules/parent/node_modules/bundled": { version: "9.0.0", inBundle: true },
  })), []);
});

test("a required bundled child is checked when its parent is installed", async (t) => {
  const f = await fixture(t); f.install("node_modules/parent", "1.0.0");
  const findings = f.api.findInstalledTreeDrift(lock({
    "node_modules/parent": { version: "1.0.0" },
    "node_modules/parent/node_modules/bundled": { version: "9.0.0", inBundle: true },
  }));
  assert.equal(findings.length, 1); assert.equal(findings[0].kind, "missing");
});

test("absent optional and devOptional installs are permitted", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({
    "node_modules/other-platform": { version: "1.0.0", optional: true, os: ["aix"] },
    "packages/app/node_modules/optional": { version: "1.0.0", devOptional: true },
  })), []);
});

test("installed optional packages still fail for wrong or unreadable manifests", async (t) => {
  const f = await fixture(t); f.install("node_modules/optional", "0.0.0");
  f.write("node_modules/broken/package.json", "{bad json");
  const findings = f.api.findInstalledTreeDrift(lock({
    "node_modules/optional": { version: "1.0.0", optional: true },
    "node_modules/broken": { version: "1.0.0", optional: true },
  }));
  assert.deepEqual(findings.map(({ kind }) => kind), ["mismatch", "unreadable"]);
});

test("workspace links and non-install metadata pass without traversing the link", async (t) => {
  const f = await fixture(t); f.install("packages/app", "1.0.0");
  mkdirSync(path.join(f.root, "node_modules/@freed"), { recursive: true });
  symlinkSync(path.join(f.root, "packages/app"), path.join(f.root, "node_modules/@freed/app"), "junction");
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({
    "packages/app": { name: "@freed/app", version: "1.0.0" },
    "node_modules/@freed/app": { resolved: "packages/app", link: true },
    "node_modules/versionless": { resolved: "https://example.invalid/x.tgz" },
  })), []);
});

test("a same-version registry package symlink cannot hide a nested parser", async (t) => {
  const f = await fixture(t);
  f.install("node_modules/fast-xml-parser", "5.10.1");
  f.install("linked/registry", "1.0.0");
  f.install("linked/registry/node_modules/stable", "2.0.0");
  f.install("linked/registry/node_modules/fast-xml-parser", "4.5.3");
  symlinkSync(path.join(f.root, "linked/registry"), path.join(f.root, "node_modules/registry"), "junction");
  const manifest = createRequire(path.join(f.root, "source.js")).resolve("registry/package.json");
  assert.equal(createRequire(manifest).resolve("fast-xml-parser/package.json"),
    path.join(f.root, "linked/registry/node_modules/fast-xml-parser/package.json"));
  // Descendant-first lock order must not cause inspection through the link.
  const packages = {
    "node_modules/registry/node_modules/stable": { version: "2.0.0" },
    "node_modules/registry": { version: "1.0.0" },
    "node_modules/fast-xml-parser": { version: "5.10.1" },
  };
  assert.deepEqual(f.api.findInstalledTreeDrift(lock(packages)), [
    { entryPath: "node_modules/registry", expected: "1.0.0", actual: null, kind: "unexpected_link" },
  ]);
  f.write("package-lock.json", lock(packages));
  const result = f.cli();
  assert.equal(result.status, 1); assert.match(result.stderr, /unexpected.*link/i);
});

test("an unlisted stale workspace package shadowing a matching hoisted parser is refused", async (t) => {
  const f = await fixture(t); f.install("node_modules/fast-xml-parser", "5.10.1");
  f.install("packages/capture-rss/node_modules/fast-xml-parser", "4.5.3");
  const resolved = createRequire(path.join(f.root, "packages/capture-rss/source.js")).resolve("fast-xml-parser/package.json");
  assert.equal(resolved, path.join(f.root, "packages/capture-rss/node_modules/fast-xml-parser/package.json"));
  assert.deepEqual(f.api.findInstalledTreeDrift(lock({
    "packages/capture-rss": { name: "rss", dependencies: { "fast-xml-parser": "^5.10.1" } },
    "node_modules/fast-xml-parser": { version: "5.10.1" },
  })), [{ entryPath: "packages/capture-rss/node_modules/fast-xml-parser", expected: null, actual: "4.5.3", kind: "extraneous" }]);
});

test("unlisted nested scoped packages are refused", async (t) => {
  const f = await fixture(t); f.install("node_modules/parent", "1.0.0");
  f.install("node_modules/parent/node_modules/@scope/stale", "0.0.1");
  const findings = f.api.findInstalledTreeDrift(lock({ "node_modules/parent": { version: "1.0.0" } }));
  assert.equal(findings.length, 1); assert.equal(findings[0].entryPath, "node_modules/parent/node_modules/@scope/stale");
  assert.equal(findings[0].kind, "extraneous");
});

test("unsupported or structurally invalid locks cannot yield a clean receipt", async (t) => {
  const f = await fixture(t);
  for (const invalid of [null, {}, { lockfileVersion: 1, packages: {} }, { lockfileVersion: 3 }, { lockfileVersion: 3, packages: [] }, { lockfileVersion: 3, packages: {} }]) {
    assert.throws(() => f.api.findInstalledTreeDrift(invalid), /lockfile|packages/i);
  }
});

test("findings describe workspace paths, extraneous packages and capped output", async (t) => {
  const f = await fixture(t);
  const findings = [
    { entryPath: "packages/app/node_modules/a", expected: "5.0.0", actual: "4.0.0", kind: "mismatch" },
    { entryPath: "node_modules/b", expected: "1.0.0", actual: null, kind: "missing" },
    { entryPath: "node_modules/c", expected: null, actual: "2.0.0", kind: "extraneous" },
  ];
  assert.match(f.api.formatFindings(findings), /packages\/app\/node_modules\/a: installed 4\.0\.0/);
  assert.match(f.api.formatFindings(findings), /c:.*not.*lockfile/i);
  const capped = f.api.formatFindings(findings, { limit: 1 });
  assert.equal(capped.split("\n").length, 2); assert.match(capped, /and 2 more/);
});

test("default CLI blocks drift and never repairs; quiet clean CLI succeeds", async (t) => {
  const f = await fixture(t);
  f.write("package-lock.json", lock({ "node_modules/required": { version: "1.0.0" } }));
  const failed = f.cli(); assert.equal(failed.status, 1); assert.match(failed.stderr, /not installed/);
  assert.doesNotMatch(failed.stdout, /Running npm ci/);
  f.install("node_modules/required", "1.0.0");
  const clean = f.cli(["--quiet"]); assert.equal(clean.status, 0); assert.equal(clean.stdout, "");
});

test("CLI invocation through a directory symlink still blocks drift", async (t) => {
  const f = await fixture(t);
  f.write("package-lock.json", lock({ "node_modules/required": { version: "1.0.0" } }));
  const alias = `${f.root}-alias`;
  symlinkSync(f.root, alias, "junction");
  t.after(() => rmSync(alias, { force: true }));
  const result = spawnSync(process.execPath, [path.join(alias, "scripts/check-installed-tree.mjs")], {
    cwd: f.root, encoding: "utf8", timeout: 5000, env: { ...process.env, FREED_AUTO_INSTALL: "0" },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /not installed/);
});

for (const viaEnvironment of [false, true]) {
  test(`preserved main through ${viaEnvironment ? "NODE_OPTIONS" : "a Node argument"} checks drift and matching trees`, async (t) => {
    const f = await fixture(t);
    f.write("package-lock.json", lock({ "node_modules/required": { version: "1.0.0" } }));
    const alias = `${f.root}-preserved-alias`;
    symlinkSync(f.root, alias, "junction");
    t.after(() => rmSync(alias, { force: true }));
    const invoke = () => spawnSync(process.execPath, [
      ...(viaEnvironment ? [] : ["--preserve-symlinks-main"]),
      path.join(alias, "scripts/check-installed-tree.mjs"),
    ], {
      cwd: f.root, encoding: "utf8", timeout: 5000,
      env: { ...process.env, FREED_AUTO_INSTALL: "0", NODE_OPTIONS: viaEnvironment ? "--preserve-symlinks-main" : "" },
    });
    const drift = invoke();
    assert.equal(drift.status, 1); assert.match(drift.stderr, /not installed/);
    f.install("node_modules/required", "1.0.0");
    const clean = invoke();
    assert.equal(clean.status, 0); assert.match(clean.stdout, /Installed tree matches/);
  });
}

test("the repository build guard exits before workspace fanout on drift", async (t) => {
  const f = await fixture(t);
  f.write("package-lock.json", lock({ "node_modules/required": { version: "1.0.0" } }));
  f.write("package.json", { scripts: { build: rootPackage.scripts.build, "deps:check": rootPackage.scripts["deps:check"] }, workspaces: [] });
  f.write("fixture-user.npmrc", "");
  f.write("fixture-global.npmrc", "");
  f.write("scripts/run-workspace-fanout.mjs", "console.error('FANOUT_MUST_NOT_RUN'); process.exit(73);\n");
  const npm = f.api.resolveNpmCommand();
  const result = spawnSync(npm.command, [...npm.args.slice(0, -1), "run", "build"], {
    cwd: f.root, encoding: "utf8", timeout: 5000,
    env: { ...process.env, FREED_AUTO_INSTALL: "0", npm_config_offline: "true", npm_config_ignore_scripts: "false", npm_config_audit: "false", npm_config_fund: "false",
      npm_config_userconfig: path.join(f.root, "fixture-user.npmrc"), npm_config_globalconfig: path.join(f.root, "fixture-global.npmrc"), npm_config_cache: path.join(f.root, ".npm-cache") },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /not installed/);
  assert.doesNotMatch(result.stderr + result.stdout, /FANOUT_MUST_NOT_RUN/);
});

test("Windows repair launches node plus npm-cli.js rather than a command shim", async (t) => {
  const f = await fixture(t);
  const node = "C:\\Program Files\\nodejs\\node.exe";
  const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  assert.deepEqual(f.api.resolveNpmCommand({ nodePath: node, platform: "win32", npmExecPath: null, fileExists: (name) => name === cli }), { command: node, args: [cli, "ci"] });
  assert.throws(() => f.api.resolveNpmCommand({ nodePath: node, platform: "win32", npmExecPath: null, fileExists: () => false }), /npm.*CLI/i);
});

test("caller-provided npm CLI from a separate prefix drives repair without a shell", async (t) => {
  const f = await fixture(t);
  f.write("independent-prefix/npm/bin/npm-cli.js", "// Inert fixture; never executed.\n");
  const npmExecPath = path.join(f.root, "independent-prefix/npm/bin/npm-cli.js");
  assert.deepEqual(f.api.resolveNpmCommand({ npmExecPath }),
    { command: process.execPath, args: [npmExecPath, "ci"] });
  const calls = [];
  f.api.runNpmCi({ rootDir: f.root, npmExecPath, output: { log() {} },
    spawn: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath); assert.deepEqual(calls[0][1], [npmExecPath, "ci"]);
  assert.equal(calls[0][2].cwd, f.root); assert.notEqual(calls[0][2].shell, true);
});

test("invalid caller-provided npm CLI cannot silently select another installation", async (t) => {
  const f = await fixture(t);
  const nodePath = "/synthetic/node/bin/node";
  const adjacent = "/synthetic/node/bin/node_modules/npm/bin/npm-cli.js";
  for (const npmExecPath of ["relative/npm-cli.js", "/synthetic/npm.cmd", "/missing/npm-cli.js"]) {
    assert.throws(() => f.api.resolveNpmCommand({ nodePath, platform: "linux", npmExecPath,
      fileExists: (name) => name === adjacent }), /npm.*CLI/i);
  }
});

test("repair propagates spawn errors and nonzero npm status without a shell", async (t) => {
  const f = await fixture(t); const calls = [];
  const options = { rootDir: f.root, cliPath: "/synthetic/npm-cli.js", output: { log() {} } };
  assert.throws(() => f.api.runNpmCi({ ...options, spawn: (...args) => { calls.push(args); return { status: 29 }; } }), /status 29/);
  const [command, args, spawnOptions] = calls[0];
  assert.equal(command, process.execPath); assert.deepEqual(args, [options.cliPath, "ci"]);
  assert.equal(spawnOptions.cwd, f.root); assert.notEqual(spawnOptions.shell, true);
  const failure = new Error("fixture spawn failure");
  assert.throws(() => f.api.runNpmCi({ ...options, spawn: () => ({ error: failure, status: null }) }), (error) => error === failure);
});

test("opt-in flag and environment repair recheck the repaired tree", async (t) => {
  const f = await fixture(t); const output = { log() {}, error() {} };
  for (const requested of [{ argv: ["--fix"], env: {} }, { argv: [], env: { FREED_AUTO_INSTALL: "1" } }]) {
    f.write("package-lock.json", lock({ "node_modules/required": { version: "1.0.0" } }));
    rmSync(path.join(f.root, "node_modules"), { recursive: true, force: true });
    let installs = 0;
    assert.equal(f.api.main({ ...requested, rootDir: f.root, output, install: () => { installs++; f.install("node_modules/required", "1.0.0"); } }), 0);
    assert.equal(installs, 1);
  }
});

test("repair cannot turn persistent drift or failed install into success", async (t) => {
  const f = await fixture(t); const output = { log() {}, error() {} };
  f.write("package-lock.json", lock({ "node_modules/required": { version: "1.0.0" } }));
  const options = { argv: ["--fix"], env: {}, rootDir: f.root, output };
  assert.equal(f.api.main({ ...options, install: () => {} }), 1);
  const failure = new Error("npm ci fixture failed");
  assert.throws(() => f.api.main({ ...options, install: () => { throw failure; } }), (error) => error === failure);
});
