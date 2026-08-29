import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertNoRetiredAutomergeArtifactDirectory,
  assertNoRetiredAutomergeRollupBundle,
  assertNoRetiredLibraryCorePublicExports,
  assertNoRetiredNativeWholeRecordProjection,
} from "./lib/retired-automerge-runtime.mjs";

function withTempDirectory(run) {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "freed-retired-runtime-"),
  );
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("artifact inspection permits historical verification and the loss fence", () => {
  withTempDirectory((directory) => {
    writeFileSync(
      path.join(directory, "main.js"),
      [
        'const legacyStore = "automerge";',
        'const domain = "automerge-heads";',
        'const engine = "automerge_legacy";',
        'const protocol = "automerge_blob_v1";',
      ].join("\n"),
    );

    const summary = assertNoRetiredAutomergeArtifactDirectory(
      directory,
      "desktop",
    );
    assert.equal(summary.files, 1);
    assert.ok(summary.bytes > 0);
  });
});

test("artifact inspection rejects the retired PWA relay route and cache", () => {
  withTempDirectory((directory) => {
    writeFileSync(
      path.join(directory, "sw.js"),
      'registerRoute(({url:e})=>"/sync"===e.pathname,new NetworkFirst({cacheName:"freed-sync-v1"}))',
    );

    assert.throws(
      () => assertNoRetiredAutomergeArtifactDirectory(directory, "pwa"),
      /pwa-legacy-sync-cache[\s\S]*pwa-legacy-sync-route/,
    );
  });
});

test("service-worker inspection rejects a renamed legacy sync route", () => {
  withTempDirectory((directory) => {
    writeFileSync(
      path.join(directory, "sw.js"),
      'registerRoute(({url})=>url.pathname.endsWith("/sync"),new NetworkFirst({cacheName:"renamed"}))',
    );

    assert.throws(
      () => assertNoRetiredAutomergeArtifactDirectory(directory, "pwa"),
      /pwa-legacy-sync-service-worker-path/,
    );
  });
});

test("artifact inspection rejects retired Library payloads and browser row stores", () => {
  withTempDirectory((directory) => {
    writeFileSync(
      path.join(directory, "main.js"),
      [
        'const authority = "legacy-automerge-document";',
        'const shellRecord = "00_library_shell";',
        'const shellType = "DesktopLibraryShell";',
        'const browserRows = "freed-library-core-portable-v1";',
      ].join("\n"),
    );

    assert.throws(
      () => assertNoRetiredAutomergeArtifactDirectory(directory, "pwa"),
      /pwa-indexeddb-checkpoint-database[\s\S]*retired-library-core-field-registry[\s\S]*retired-library-shell-record[\s\S]*retired-library-shell-type/,
    );
  });
});

test("Rollup inspection rejects retired module origins before minification", () => {
  assert.throws(
    () =>
      assertNoRetiredAutomergeRollupBundle(
        {
          "assets/main.js": {
            type: "chunk",
            code: "export{}",
            modules: {
              "/repo/node_modules/@automerge/automerge/dist/index.js": {},
            },
          },
        },
        "desktop",
      ),
    /automerge-package-module/,
  );
});

test("public entrypoint inspection rejects retired registry reexports", () => {
  withTempDirectory((directory) => {
    const entrypointDirectory = path.join(
      directory,
      "packages",
      "shared",
      "src",
      "library-core",
    );
    mkdirSync(entrypointDirectory, { recursive: true });
    writeFileSync(
      path.join(entrypointDirectory, "index.ts"),
      'export * from "./census.js";\nexport * from "./sha256.js";\n',
    );

    assert.throws(
      () => assertNoRetiredLibraryCorePublicExports(directory),
      /census/,
    );
  });
});

test("current Library Core public entrypoint excludes retired registries", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  assert.doesNotThrow(() => assertNoRetiredLibraryCorePublicExports(repoRoot));
});

test("native core inspection rejects the retired whole-record projector", () => {
  withTempDirectory((directory) => {
    const nativeSourceDirectory = path.join(
      directory,
      "packages",
      "library-core-native",
      "src",
    );
    mkdirSync(nativeSourceDirectory, { recursive: true });
    writeFileSync(
      path.join(nativeSourceDirectory, "lib.rs"),
      "mod product_projection;\npub use product_projection::upsert_item;\n",
    );
    writeFileSync(
      path.join(nativeSourceDirectory, "product_projection.rs"),
      "pub fn upsert_item() {}\n",
    );

    assert.throws(
      () => assertNoRetiredNativeWholeRecordProjection(directory),
      /product_projection\.rs[\s\S]*mod product_projection[\s\S]*upsert_item/,
    );
  });
});

test("current native core excludes the retired whole-record projector", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  assert.doesNotThrow(() =>
    assertNoRetiredNativeWholeRecordProjection(repoRoot),
  );
});

test("Vercel staging carries the current artifact guard without the retired patch", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  for (const fileName of [
    "vercel-deploy-preview.sh",
    "vercel-deploy-production.sh",
  ]) {
    const source = readFileSync(
      path.join(repoRoot, "scripts", fileName),
      "utf8",
    );
    assert.match(source, /retired-automerge-runtime\.mjs/);
    assert.match(source, /validate-retired-automerge-runtime\.mjs/);
    assert.doesNotMatch(source, /patch-automerge\.mjs/);
  }
});
