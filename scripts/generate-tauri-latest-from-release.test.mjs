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

test("generates updater platforms from Tauri release assets", () => {
  const release = {
    tag_name: "v26.4.2304-dev",
    created_at: "2026-04-24T01:08:00.000Z",
    assets: [
      {
        name: "Freed_aarch64.app.tar.gz",
        browser_download_url: "https://example.test/Freed_aarch64.app.tar.gz",
      },
      {
        name: "Freed_26.4.2304_x64_en-US.msi",
        browser_download_url: "https://example.test/Freed_26.4.2304_x64_en-US.msi",
      },
      {
        name: "Freed_26.4.2304_x64-setup.exe",
        browser_download_url: "https://example.test/Freed_26.4.2304_x64-setup.exe",
      },
    ],
  };

  const manifest = generateLatestManifest({
    release,
    notes: "Reviewed notes",
    signatureDir: signatureDir({
      "Freed_aarch64.app.tar.gz.sig": "mac-signature\n",
      "Freed_26.4.2304_x64_en-US.msi.sig": "msi-signature\n",
      "Freed_26.4.2304_x64-setup.exe.sig": "nsis-signature\n",
    }),
  });

  assert.equal(manifest.version, "26.4.2304");
  assert.equal(manifest.notes, "Reviewed notes");
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "mac-signature");
  assert.equal(
    manifest.platforms["darwin-aarch64-app"],
    manifest.platforms["darwin-aarch64"],
  );
  assert.equal(manifest.platforms["windows-x86_64"].signature, "msi-signature");
  assert.equal(manifest.platforms["windows-x86_64-nsis"].signature, "nsis-signature");
});

test("throws when an updater artifact has no signature", () => {
  assert.throws(
    () =>
      generateLatestManifest({
        release: {
          tag_name: "v26.4.2400",
          assets: [
            {
              name: "Freed_x64.app.tar.gz",
              browser_download_url: "https://example.test/Freed_x64.app.tar.gz",
            },
          ],
        },
        signatureDir: signatureDir({}),
      }),
    /Missing updater signature/,
  );
});
