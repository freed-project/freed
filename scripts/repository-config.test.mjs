import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const dependabot = readFileSync(
  path.join(scriptsDir, "..", ".github", "dependabot.yml"),
  "utf8",
);
const pwaVercel = JSON.parse(
  readFileSync(
    path.join(scriptsDir, "..", "packages", "pwa", "vercel.json"),
    "utf8",
  ),
);

test("Dependabot configuration keeps the expected versioned update contracts", () => {
  assert.match(dependabot, /^version:\s*2\s*$/m);
  assert.match(dependabot, /^updates:\s*$/m);
  assert.match(dependabot, /package-ecosystem:\s*npm/);
  assert.match(dependabot, /package-ecosystem:\s*cargo/);
  assert.match(dependabot, /package-ecosystem:\s*github-actions/);
  assert.doesNotMatch(dependabot, /\t/);

  const ecosystems = dependabot.match(/^\s*-\s*package-ecosystem:/gm) ?? [];
  const directories = dependabot.match(/^\s*directory:\s*\S+\s*$/gm) ?? [];
  const schedules = dependabot.match(/^\s*schedule:\s*$/gm) ?? [];
  assert.equal(directories.length, ecosystems.length);
  assert.equal(schedules.length, ecosystems.length);
});

test("PWA deployments ignore commits outside their dependency surface", () => {
  assert.equal(
    pwaVercel.ignoreCommand,
    "git diff HEAD^ HEAD --quiet -- . ../../packages/shared ../../packages/sync ../../packages/ui ../../package.json ../../package-lock.json ../../tsconfig.json",
  );
});
