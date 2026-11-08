import test from "node:test";
import { load } from "js-yaml";
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

test("desktop releases force Google token exchange through the server proxy", () => {
  const workflow = readFileSync(releaseWorkflowPath, "utf8");

  assert.match(
    workflow,
    /VITE_GDRIVE_DESKTOP_CLIENT_ID:\s*304530272769-fkbpan1l071vdvum1j6kufvo8rbq6sm1\.apps\.googleusercontent\.com/,
    "release workflow should build with the desktop Google OAuth client",
  );
  assert.match(
    workflow,
    /VITE_GDRIVE_TOKEN_PROXY_URL:\s*https:\/\/app\.freed\.wtf\/api\/oauth\/google/,
    "release workflow should point Google token exchange at the server proxy",
  );
  assert.match(
    workflow,
    /VITE_GDRIVE_FORCE_TOKEN_PROXY:\s*"1"/,
    "release workflow should not fall back to direct Google token exchange",
  );
  assert.doesNotMatch(
    workflow,
    /VITE_GDRIVE_CLIENT_SECRET:/,
    "release workflow should not embed a Google client secret in the desktop app bundle",
  );
});

test("desktop releases pass the reviewed channel into build metadata", () => {
  const workflow = readFileSync(releaseWorkflowPath, "utf8");

  assert.match(
    workflow,
    /FREED_BUILD_CHANNEL:\s*\$\{\{ needs\.notes\.outputs\.release_channel \}\}/,
    "release builds should stamp the reviewed release channel into runtime identity",
  );
});

// A pin bump invalidates this changed-path release admission contract.
test("all CI and release Rust steps install the exact repository pin", () => {
  const toolchain = readFileSync(path.join(repoRoot, "rust-toolchain.toml"), "utf8");
  const channel = toolchain.match(/^channel\s*=\s*"([^"\n]+)"\s*$/m)?.[1];
  assert.match(channel ?? "", /^\d+\.\d+\.\d+$/, "Rust channel must be an exact version");
  let count = 0;
  for (const filename of ["ci.yml", "release.yml"]) {
    const workflow = load(readFileSync(path.join(repoRoot, ".github", "workflows", filename), "utf8"));
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith("dtolnay/rust-toolchain@")) continue;
        count += 1;
        const selected = step.with?.toolchain;
        const context = `${filename}: ${jobName}: ${step.name}`;
        assert.equal(typeof selected, "string", `${context} must explicitly select a toolchain`);
        assert.doesNotMatch(selected, /^(?:stable|beta|nightly|1\.\d+)$/, context);
        assert.equal(selected, channel, `${context} must match the repository pin`);
      }
    }
  }
  assert.equal(count, 5, "review every Rust setup step when adding or removing a job");
});
