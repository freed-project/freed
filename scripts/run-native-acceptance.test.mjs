import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  nativeAcceptanceCommands,
  nativeAcceptanceIsMeaningful,
  WORKTREE_PUBLISH_NATIVE_TEST_NAMES,
} from "./run-native-acceptance.mjs";
import {
  DARWIN_ONLY_TEST_FILES,
  REPO_ROOT,
} from "./lib/tooling-smoke-suites.mjs";
import { extractTopLevelTestNames } from "./run-tooling-smoke-shard.mjs";

test("native acceptance runs only the tests that assert on macOS", async () => {
  const commands = nativeAcceptanceCommands();
  assert.deepEqual(commands[0].slice(2), [...DARWIN_ONLY_TEST_FILES]);

  const worktreeCommand = commands[1];
  assert.equal(worktreeCommand.at(-1), "scripts/worktree-publish.test.mjs");
  const pattern = new RegExp(
    worktreeCommand
      .find((argument) => argument.startsWith("--test-name-pattern="))
      .slice("--test-name-pattern=".length),
  );
  const source = await readFile(
    new URL("./worktree-publish.test.mjs", import.meta.url),
    "utf8",
  );
  const darwinNames = [
    ...source.matchAll(
      /test\(\s*"([^"]+)"\s*,\s*\{\s*skip:\s*process\.platform\s*!==\s*"darwin"/g,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(darwinNames, [...WORKTREE_PUBLISH_NATIVE_TEST_NAMES]);
  assert.deepEqual(
    extractTopLevelTestNames(
      source,
      `${REPO_ROOT}/scripts/worktree-publish.test.mjs`,
    ).filter((name) => pattern.test(name)),
    darwinNames,
  );
});

test("native acceptance rejects vacuous platforms", () => {
  assert.equal(nativeAcceptanceIsMeaningful("darwin"), true);
  assert.equal(nativeAcceptanceIsMeaningful("linux"), false);
});
