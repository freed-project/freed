import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const helperPath = path.join(scriptsDir, "lib/node-tooling.sh");
const pinnedVersion = "24.14.1";

function writeExecutable(filePath, output) {
  writeFileSync(filePath, `#!/usr/bin/env sh\nprintf '%s\\n' '${output}'\n`);
  chmodSync(filePath, 0o755);
}

function createToolchainFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-node-tooling-"));
  const home = path.join(root, "home");
  const pinnedBin = path.join(home, ".nvm", "versions", "node", `v${pinnedVersion}`, "bin");
  const staleBin = path.join(root, "stale-bin");

  mkdirSync(pinnedBin, { recursive: true });
  mkdirSync(staleBin, { recursive: true });
  writeExecutable(path.join(pinnedBin, "node"), `v${pinnedVersion}`);
  writeExecutable(path.join(pinnedBin, "npm"), "11.11.0");
  writeExecutable(path.join(pinnedBin, "npx"), "11.11.0");
  writeExecutable(path.join(staleBin, "node"), "v26.4.0");
  writeExecutable(path.join(staleBin, "npm"), "12.0.0");
  writeExecutable(path.join(staleBin, "npx"), "12.0.0");

  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, pinnedBin, staleBin };
}

const probe = [
  'source "$NODE_TOOLING_HELPER"',
  'printf "repo=%s\\n" "$(node_tooling_repo_root)"',
  'printf "version=%s\\n" "$(node_tooling_nvm_version)"',
  'printf "node=%s\\n" "$(resolve_node_bin)"',
  'printf "npm=%s\\n" "$(resolve_npm_bin)"',
  'printf "npx=%s\\n" "$(resolve_npx_bin)"',
  "use_resolved_node_path",
  'printf "node-bin=%s\\n" "$NODE_BIN"',
  'printf "path-node=%s\\n" "$(command -v node)"',
  'printf "path-npm=%s\\n" "$(command -v npm)"',
  'printf "path-npx=%s\\n" "$(command -v npx)"',
].join("\n");

for (const shell of ["bash", "zsh"]) {
  test(`node tooling resolves the pinned toolchain when sourced by ${shell}`, (t) => {
    const availability = spawnSync(shell, ["--version"], { encoding: "utf8" });
    if (availability.error?.code === "ENOENT") {
      t.skip(`${shell} is not installed in this environment`);
      return;
    }
    assert.equal(availability.status, 0, availability.stderr);

    const { root, home, pinnedBin, staleBin } = createToolchainFixture(t);
    const result = spawnSync(shell, ["-c", probe], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        NODE_BIN: "",
        NODE_TOOLING_HELPER: helperPath,
        PATH: `${staleBin}:/usr/bin:/bin`,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdout.trim().split("\n"), [
      `repo=${repoRoot}`,
      `version=v${pinnedVersion}`,
      `node=${path.join(pinnedBin, "node")}`,
      `npm=${path.join(pinnedBin, "npm")}`,
      `npx=${path.join(pinnedBin, "npx")}`,
      `node-bin=${path.join(pinnedBin, "node")}`,
      `path-node=${path.join(pinnedBin, "node")}`,
      `path-npm=${path.join(pinnedBin, "npm")}`,
      `path-npx=${path.join(pinnedBin, "npx")}`,
    ]);
  });
}
