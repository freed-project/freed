import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

test("run-workspace-fanout refuses root workspace dispatch", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-workspace-fanout.mjs", "build"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_workspace: "packages/pwa",
        npm_config_workspaces: "false",
      },
    },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Refusing to run root "build" with --workspace=packages\/pwa\./,
  );
  assert.match(result.stderr, /Run the script from the workspace directory instead\./);
});

test("run-workspace-fanout rejects a missing script name", () => {
  const result = spawnSync(process.execPath, ["scripts/run-workspace-fanout.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing script name for workspace fanout\./);
});
