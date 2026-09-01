import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const releaseWorkflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");
const isolatedDesktopConfigPath = path.join(
  repoRoot,
  "packages",
  "desktop",
  "src-tauri",
  "tauri.preview.conf.json",
);

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
      platform: "macos-15-intel",
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

test("dev releases publish a signed isolated Apple Silicon verifier without updater artifacts", () => {
  const workflow = readFileSync(releaseWorkflowPath, "utf8");
  const isolatedConfig = JSON.parse(
    readFileSync(isolatedDesktopConfigPath, "utf8"),
  );
  const isolatedJob = workflow.slice(
    workflow.indexOf("\n  isolated-dev-macos:"),
    workflow.indexOf("\n  updater-manifest:"),
  );
  const publishJob = workflow.slice(
    workflow.indexOf("\n  publish:"),
    workflow.indexOf("\n  # Redeploy the public marketing site"),
  );

  assert.equal(isolatedConfig.productName, "Freed Preview");
  assert.equal(
    isolatedConfig.identifier,
    "wtf.freed.desktop.sqlite-native-preview",
  );
  assert.equal(isolatedConfig.bundle.createUpdaterArtifacts, false);

  assert.match(isolatedJob, /release_channel == 'dev'/);
  assert.match(isolatedJob, /runs-on: macos-latest/);
  assert.match(isolatedJob, /--target aarch64-apple-darwin/);
  assert.match(isolatedJob, /--bundles app/);
  assert.match(isolatedJob, /--features isolated-preview-data-root/);
  assert.match(isolatedJob, /--config src-tauri\/tauri\.preview\.conf\.json/);
  assert.match(
    isolatedJob,
    /releaseAssetNamePattern: Freed_Preview_\[version\]_aarch64\[ext\]/,
  );
  assert.match(isolatedJob, /uploadUpdaterJson: false/);
  assert.match(isolatedJob, /uploadUpdaterSignatures: false/);
  assert.match(isolatedJob, /codesign --verify --deep --strict/);
  assert.match(isolatedJob, /xcrun stapler validate/);
  assert.match(
    isolatedJob,
    /Print:CFBundleIdentifier[\s\S]*wtf\.freed\.desktop\.sqlite-native-preview/,
  );

  assert.match(
    publishJob,
    /needs\.isolated-dev-macos\.result == 'success' \|\| needs\.isolated-dev-macos\.result == 'skipped'/,
  );
});
