import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const releasePrep = readFileSync(path.join(scriptsDir, "release.sh"), "utf8");
const releasePublish = readFileSync(
  path.join(scriptsDir, "release-publish.sh"),
  "utf8",
);
const promotion = readFileSync(
  path.join(scriptsDir, "promote-dev-to-main.sh"),
  "utf8",
);

test("release preparation uses the channel's protected branch as its exact base", () => {
  assert.match(releasePrep, /CHANNEL="production"/);
  assert.match(releasePrep, /CURRENT_BRANCH" != chore\/release-\*/);
  assert.match(releasePrep, /EXPECTED_BRANCH="main"/);
  assert.match(releasePrep, /CHANNEL" == "dev"[\s\S]*EXPECTED_BRANCH="dev"/);
  assert.match(
    releasePrep,
    /EXPECTED_BASE_REF="origin\/\$\{EXPECTED_BRANCH\}"/,
  );
  assert.match(releasePrep, /git rev-parse "\$\{EXPECTED_BASE_REF\}"/);
  assert.match(releasePrep, /FREED_TRUSTED_PUBLISHER/);
  assert.match(releasePrep, /--base \$\{EXPECTED_BRANCH\} --ready/);
  assert.match(releasePrep, /npm run validate:release/);
  assert.match(releasePrep, /npm run validate:feature/);
  assert.doesNotMatch(releasePrep, /git push origin (?:dev|main)/);
});

test("release publication tags only the exact merged remote commit", () => {
  assert.match(
    releasePublish,
    /HEAD must equal origin\/\$\{EXPECTED_BRANCH\} before tagging/,
  );
  assert.match(releasePublish, /git push origin refs\/tags\/\$\{TAG\}/);
  assert.doesNotMatch(releasePublish, /git push origin .*--follow-tags/);
  assert.doesNotMatch(releasePublish, /git push origin \$\{EXPECTED_BRANCH\}/);
  assert.match(
    promotion,
    /Create the production release-prep branch from that exact commit/,
  );
  assert.doesNotMatch(promotion, /release-publish\.sh <version>/);
});
