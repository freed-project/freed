import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { generateLatestManifest } from "./generate-tauri-latest-from-release.mjs";

function signatureDir(entries) {
  const dir = mkdtempSync(path.join(tmpdir(), "freed-updater-sigs-"));
  for (const [name, content] of Object.entries(entries)) {
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function updaterAssets(version = "26.4.2304") {
  return [
    {
      name: `Freed_${version}_aarch64.app.tar.gz`,
      browser_download_url: `https://example.test/Freed_${version}_aarch64.app.tar.gz`,
    },
    {
      name: `Freed_${version}_x64.app.tar.gz`,
      browser_download_url: `https://example.test/Freed_${version}_x64.app.tar.gz`,
    },
    {
      name: `Freed_${version}_x64_en-US.msi`,
      browser_download_url: `https://example.test/Freed_${version}_x64_en-US.msi`,
    },
    {
      name: `Freed_${version}_x64-setup.exe`,
      browser_download_url: `https://example.test/Freed_${version}_x64-setup.exe`,
    },
    {
      name: `Freed_${version}_amd64.AppImage`,
      browser_download_url: `https://example.test/Freed_${version}_amd64.AppImage`,
    },
  ];
}

function updaterSignatures(version = "26.4.2304") {
  return {
    [`Freed_${version}_aarch64.app.tar.gz.sig`]: "mac-arm-signature\n",
    [`Freed_${version}_x64.app.tar.gz.sig`]: "mac-intel-signature\n",
    [`Freed_${version}_x64_en-US.msi.sig`]: "msi-signature\n",
    [`Freed_${version}_x64-setup.exe.sig`]: "nsis-signature\n",
    [`Freed_${version}_amd64.AppImage.sig`]: "appimage-signature\n",
  };
}

test("generates updater platforms from Tauri release assets", () => {
  const release = {
    tag_name: "v26.4.2304-dev",
    created_at: "2026-04-24T01:08:00.000Z",
    assets: updaterAssets(),
  };

  const manifest = generateLatestManifest({
    release,
    notes: "Reviewed notes",
    signatureDir: signatureDir(updaterSignatures()),
  });

  assert.equal(manifest.version, "26.4.2304");
  assert.equal(manifest.notes, "Reviewed notes");
  assert.equal(
    manifest.platforms["darwin-aarch64"].signature,
    "mac-arm-signature",
  );
  assert.equal(
    manifest.platforms["darwin-aarch64-app"],
    manifest.platforms["darwin-aarch64"],
  );
  assert.equal(
    manifest.platforms["darwin-x86_64"].signature,
    "mac-intel-signature",
  );
  assert.equal(manifest.platforms["windows-x86_64"].signature, "msi-signature");
  assert.equal(manifest.platforms["windows-x86_64-nsis"].signature, "nsis-signature");
  assert.equal(
    manifest.platforms["linux-x86_64"].signature,
    "appimage-signature",
  );
});

test("throws when an updater artifact has no signature", () => {
  const signatures = updaterSignatures("26.4.2400");
  delete signatures["Freed_26.4.2400_x64.app.tar.gz.sig"];
  assert.throws(
    () =>
      generateLatestManifest({
        release: {
          tag_name: "v26.4.2400",
          assets: updaterAssets("26.4.2400"),
        },
        signatureDir: signatureDir(signatures),
      }),
    /Missing updater signature/,
  );
});

test("rejects a partial updater manifest", () => {
  assert.throws(
    () =>
      generateLatestManifest({
        release: {
          tag_name: "v26.4.2401",
          assets: updaterAssets("26.4.2401").filter(
            (asset) => !asset.name.includes("_x64.app.tar.gz"),
          ),
        },
        signatureDir: signatureDir(updaterSignatures("26.4.2401")),
      }),
    /Missing required updater platforms: darwin-x86_64/,
  );
});

test("normalizes draft asset URLs to the published release tag", () => {
  const assets = updaterAssets("26.4.2305");
  assets[0].browser_download_url =
    "https://github.com/freed-project/freed/releases/download/untagged-1cf3faa3e92222d94ef1/Freed_26.4.2305_aarch64.app.tar.gz";
  const manifest = generateLatestManifest({
    release: {
      tag_name: "v26.4.2305",
      assets,
    },
    signatureDir: signatureDir(updaterSignatures("26.4.2305")),
  });

  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://github.com/freed-project/freed/releases/download/v26.4.2305/Freed_26.4.2305_aarch64.app.tar.gz",
  );
});
