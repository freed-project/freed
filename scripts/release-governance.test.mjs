import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const releasePrep = readFileSync(path.join(scriptsDir, "release.sh"), "utf8");
const releaseVersion = readFileSync(
  path.join(scriptsDir, "release-version.mjs"),
  "utf8",
);
const releaseNotesPrep = readFileSync(
  path.join(scriptsDir, "prepare-release-notes.mjs"),
  "utf8",
);
const releaseNotesBackfill = readFileSync(
  path.join(scriptsDir, "backfill-release-notes.mjs"),
  "utf8",
);
const releasePublish = readFileSync(
  path.join(scriptsDir, "release-publish.sh"),
  "utf8",
);
const promotion = readFileSync(
  path.join(scriptsDir, "promote-dev-to-main.sh"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  path.join(scriptsDir, "..", ".github", "workflows", "release.yml"),
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
  assert.match(releasePrep, /\.\/scripts\/worktree-publish\.sh/);
  assert.match(releasePrep, /--base \$\{EXPECTED_BRANCH\} --ready/);
  assert.match(releasePrep, /npm run validate:release/);
  assert.match(releasePrep, /npm run validate:feature/);
  assert.doesNotMatch(releasePrep, /git push origin (?:dev|main)/);
});

test("release publication delegates one exact tag to the trusted App publisher", () => {
  assert.match(
    releasePublish,
    /HEAD must equal origin\/\$\{EXPECTED_BRANCH\} before tagging/,
  );
  assert.match(
    releasePublish,
    /release-tag-publisher\.mjs publish[\s\S]*--tag "\$\{TAG\}"[\s\S]*--commit "\$\{LOCAL_RELEASE_SHA\}"[\s\S]*--branch "\$\{EXPECTED_BRANCH\}"[\s\S]*--release-file-sha256 "\$\{RELEASE_FILE_SHA256\}"/,
  );
  assert.match(releasePublish, /git ls-remote --tags origin/);
  assert.match(
    releasePublish,
    /git fetch origin "refs\/tags\/\$\{TAG\}:refs\/tags\/\$\{TAG\}"/,
  );
  assert.match(releasePublish, /git cat-file -t "refs\/tags\/\$\{TAG\}"/);
  assert.match(releasePublish, /git rev-list -n 1 "refs\/tags\/\$\{TAG\}"/);
  assert.doesNotMatch(releasePublish, /git tag -a/);
  assert.doesNotMatch(releasePublish, /git push origin .*--follow-tags/);
  assert.doesNotMatch(releasePublish, /git push origin \$\{EXPECTED_BRANCH\}/);
  assert.match(
    promotion,
    /Create the production release-prep branch from that exact commit/,
  );
  assert.match(
    releasePublish,
    /validate-release-identity\.mjs --tag="\$\{TAG\}" --head-ref=HEAD/,
  );
  assert.match(
    releasePublish,
    /validate-release-tag-authority\.mjs --repo=freed-project\/freed/,
  );
  assert.match(
    releasePrep,
    /FREED_PROMOTED_DEV_COMMIT_SHA="\$\{PROMOTED_DEV_COMMIT_SHA\}"/,
  );
  assert.match(releaseWorkflow, /EXPECTED_BRANCH="main"/);
  assert.match(
    releaseWorkflow,
    /TAG" == \*-dev[\s\S]*EXPECTED_BRANCH="dev"/,
  );
  assert.match(
    releaseWorkflow,
    /--branch-ref="origin\/\$\{EXPECTED_BRANCH\}"/,
  );
  assert.doesNotMatch(releaseWorkflow, /GITHUB_SHA" != "\$EXPECTED_SHA"/);
  assert.match(
    releaseWorkflow,
    /validate-release-identity\.mjs[\s\S]*--tag="\$\{TAG\}"[\s\S]*--head-ref="\$GITHUB_SHA"[\s\S]*--branch-ref="origin\/\$\{EXPECTED_BRANCH\}"/,
  );
  assert.match(
    promotion,
    /PUBLISH_COMMAND=\("\$\{SCRIPT_DIR\}\/worktree-publish\.sh"\)/,
  );
  assert.match(promotion, /if \[\[ -n "\$\{FREED_TRUSTED_PUBLISHER:-\}" \]\]/);
  assert.doesNotMatch(promotion, /release-publish\.sh <version>/);
  assert.doesNotMatch(
    releaseWorkflow,
    /validate-release-promotion\.mjs --from-ref=origin\/dev/,
  );
});

test("release failure triage binds GitHub CLI to the triggering repository", () => {
  const triageJobStart = releaseWorkflow.indexOf("\n  triage-on-failure:");
  assert.ok(triageJobStart >= 0, "release workflow should define failure triage");
  const triageJob = releaseWorkflow.slice(triageJobStart);

  assert.match(triageJob, /GH_REPO:\s*\$\{\{ github\.repository \}\}/);
  assert.match(triageJob, /gh issue list/);
  assert.match(triageJob, /gh issue comment/);
  assert.match(triageJob, /gh issue create/);
  assert.doesNotMatch(triageJob, /uses:\s*actions\/checkout/);
});

test("release preparation validates canonical CalVer before mutating version files", () => {
  const validationIndex = releasePrep.indexOf("scripts/release-version.mjs");
  const firstMutationIndex = releasePrep.indexOf(
    "fs.writeFileSync('${TAURI_CONF}'",
  );
  assert.ok(validationIndex >= 0);
  assert.ok(firstMutationIndex > validationIndex);
  assert.match(releaseVersion, /no leading-zero segments/);
  assert.match(releaseVersion, /Windows installers require a major no greater than 255/);
  assert.doesNotMatch(releasePrep, /-\[a-zA-Z0-9\.\]\+/);
});

test("release preparation refreshes and stages the Rust lockfile", () => {
  const cargoTomlMutationIndex = releasePrep.indexOf(
    "' \"${CARGO_TOML}\" > \"${CARGO_TOML}.tmp\"",
  );
  const cargoLockRefreshIndex = releasePrep.indexOf(
    'cargo update -p freed-desktop --precise "${APP_VERSION}" --offline --manifest-path "${CARGO_TOML}"',
  );
  const releaseNotesIndex = releasePrep.indexOf(
    "scripts/prepare-release-notes.mjs",
  );

  assert.match(
    releasePrep,
    /CARGO_LOCK="\$\{DESKTOP_DIR\}\/src-tauri\/Cargo\.lock"/,
  );
  assert.ok(cargoTomlMutationIndex >= 0);
  assert.ok(cargoLockRefreshIndex > cargoTomlMutationIndex);
  assert.ok(releaseNotesIndex > cargoLockRefreshIndex);
  assert.match(
    releasePrep,
    /git add "\$\{TAURI_CONF\}" "\$\{CARGO_TOML\}" "\$\{CARGO_LOCK\}"/,
  );
});

test("historical backfill uses the explicit immutable published-tag receipt mode", () => {
  assert.match(releaseNotesBackfill, /--historical-published-tag/);
  assert.match(
    releaseNotesPrep,
    /--historical-published-tag requires --force/,
  );
  assert.match(releaseNotesPrep, /rev-parse", `\$\{tag\}\^\{commit\}`/);
});
