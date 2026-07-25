import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(LIB_DIRECTORY, "..", "..");

// The three control-plane suites are large enough to shard by test name rather
// than by file. Everything else in scripts/ shards by file under "general".
export const SHARDED_TEST_FILES = Object.freeze({
  "automation-control": "scripts/automation-control.test.mjs",
  "kernel-guard-cutover": "scripts/automation-kernel-guard-cutover.test.mjs",
  "outcome-ledger-repair": "scripts/outcome-ledger-repair.test.mjs",
});

export const GENERAL_SUITE = "general";

// These assert real launchd, Keychain, and signed-broker behavior. They skip
// themselves on Linux, so running them only on ubuntu means the assertions
// never execute. The macOS lane is where they actually prove anything.
export const NATIVE_ACCEPTANCE_TEST_FILES = Object.freeze([
  "scripts/automation-actor-native.test.mjs",
  "scripts/release-tag-publisher-native.test.mjs",
  "scripts/trusted-publisher-host.test.mjs",
  "scripts/worktree-publish.test.mjs",
]);

// A narrower set: these three gate every test behind one module-level
// `process.platform === "darwin"` check, so on Linux they contribute nothing but
// runtime. release-tag-publisher-native has been observed blocking indefinitely
// at 0% CPU, which is worse than useless in a blocking lane. They run on macOS
// only.
//
// worktree-publish.test.mjs is deliberately NOT here. It gates 7 of its 35 tests
// per-test, so the other 28 are real Linux coverage. It stays in the general
// suite and also runs on the macOS lane, where its darwin cases execute.
export const DARWIN_ONLY_TEST_FILES = Object.freeze([
  "scripts/automation-actor-native.test.mjs",
  "scripts/release-tag-publisher-native.test.mjs",
  "scripts/trusted-publisher-host.test.mjs",
]);

export const SUITE_NAMES = Object.freeze([
  GENERAL_SUITE,
  ...Object.keys(SHARDED_TEST_FILES),
]);

export function isKnownSuite(suite) {
  return suite === GENERAL_SUITE || Object.hasOwn(SHARDED_TEST_FILES, suite);
}

export function generalTestFiles(repoRoot = REPO_ROOT) {
  const specialFiles = new Set([
    ...Object.values(SHARDED_TEST_FILES),
    ...DARWIN_ONLY_TEST_FILES,
  ]);
  const visit = (relativeDirectory) =>
    readdirSync(path.join(repoRoot, relativeDirectory), {
      withFileTypes: true,
    }).flatMap((entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return visit(relativePath);
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".test.mjs") ||
        specialFiles.has(relativePath)
      ) {
        return [];
      }
      return [relativePath];
    });
  return visit("scripts").sort();
}

export function shellFiles(repoRoot = REPO_ROOT) {
  return ["scripts", path.join("scripts", "lib")]
    .flatMap((relativeDirectory) =>
      readdirSync(path.join(repoRoot, relativeDirectory), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
        .map((entry) =>
          path.posix.join(
            relativeDirectory.split(path.sep).join("/"),
            entry.name,
          ),
        ),
    )
    .sort();
}

export function suiteTestFiles(suite, repoRoot = REPO_ROOT) {
  if (suite === GENERAL_SUITE) return generalTestFiles(repoRoot);
  const testFile = SHARDED_TEST_FILES[suite];
  if (!testFile) throw new Error(`Unknown tooling smoke suite: ${suite}`);
  return [testFile];
}
