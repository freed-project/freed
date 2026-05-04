import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const releaseWorkflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");

function loadPrimaryReleaseMatrix() {
  const workflow = readFileSync(releaseWorkflowPath, "utf8");
  const match = workflow.match(/PRIMARY_RELEASE_MATRIX='([^']+)'/);
  assert.ok(match, "release workflow should define a shared primary release matrix");
  return JSON.parse(match[1]);
}

test("dev and production releases use the same primary platform matrix", () => {
  const workflow = readFileSync(releaseWorkflowPath, "utf8");
  const matrix = loadPrimaryReleaseMatrix();

  assert.equal(
    (workflow.match(/release_matrix=/g) ?? []).length,
    1,
    "workflow should define the matrix once and write it once",
  );
  assert.doesNotMatch(
    workflow,
    /release_matrix=\{"include":\[\{"platform":"macos-latest","args":"--target aarch64-apple-darwin","rust_target":"aarch64-apple-darwin"\}\]\}/,
  );
  assert.deepEqual(matrix.include, [
    {
      platform: "macos-latest",
      args: "--target aarch64-apple-darwin",
      rust_target: "aarch64-apple-darwin",
    },
    {
      platform: "macos-latest",
      args: "--target x86_64-apple-darwin",
      rust_target: "x86_64-apple-darwin",
    },
    {
      platform: "windows-latest",
      args: "--target x86_64-pc-windows-msvc",
      rust_target: "x86_64-pc-windows-msvc",
    },
    {
      platform: "ubuntu-22.04",
      args: "",
      rust_target: "x86_64-unknown-linux-gnu",
    },
  ]);
});
