import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const ciWorkflow = readFileSync(
  path.join(scriptsDir, "..", ".github", "workflows", "ci.yml"),
  "utf8",
);
const mainReleaseValidationWorkflow = readFileSync(
  path.join(
    scriptsDir,
    "..",
    ".github",
    "workflows",
    "main-release-validation.yml",
  ),
  "utf8",
);
const toolingNightlyWorkflow = readFileSync(
  path.join(scriptsDir, "..", ".github", "workflows", "tooling-nightly.yml"),
  "utf8",
);
const aptSourceSanitizer = readFileSync(
  path.join(scriptsDir, "ci-sanitize-apt-sources.sh"),
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
  assert.match(releasePublish, /TAG_ALREADY_PUBLISHED=false/);
  assert.match(
    releasePublish,
    /\$\{LOCAL_TAG_EXISTS\}" != "\$\{REMOTE_TAG_EXISTS\}"[\s\S]*local and remote state disagree for immutable tag/,
  );
  assert.match(
    releasePublish,
    /Recovered exact existing immutable tag \$\{TAG\}; publication was already committed/,
  );
  assert.match(
    releasePublish,
    /if \[\[ "\$\{TAG_ALREADY_PUBLISHED\}" != true \]\]; then[\s\S]*release-tag-publisher\.mjs publish/,
  );
  assert.match(
    releasePublish,
    /git fetch origin "refs\/tags\/\$\{TAG\}:refs\/tags\/\$\{TAG\}"/,
  );
  assert.match(releasePublish, /TAG_FETCH_MAX_ATTEMPTS=8/);
  assert.match(
    releasePublish,
    /for \(\(TAG_FETCH_ATTEMPT = 1; TAG_FETCH_ATTEMPT <= TAG_FETCH_MAX_ATTEMPTS; TAG_FETCH_ATTEMPT \+= 1\)\)/,
  );
  assert.match(releasePublish, /Waiting for GitHub to expose newly published tag/);
  assert.match(
    releasePublish,
    /published tag \$\{TAG\} did not become readable after \$\{TAG_FETCH_MAX_ATTEMPTS\} attempts/,
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
    releasePublish,
    /validate-dev-integration-receipt\.mjs[\s\S]*--sha="\$\{LOCAL_RELEASE_SHA\}"[\s\S]*--branch=dev[\s\S]*--workflow=ci\.yml/,
  );
  assert.match(
    releasePrep,
    /FREED_PROMOTED_DEV_COMMIT_SHA="\$\{PROMOTED_DEV_COMMIT_SHA\}"/,
  );
  assert.match(releaseWorkflow, /EXPECTED_BRANCH="main"/);
  assert.match(releaseWorkflow, /TAG" == \*-dev[\s\S]*EXPECTED_BRANCH="dev"/);
  assert.match(releaseWorkflow, /--branch-ref="origin\/\$\{EXPECTED_BRANCH\}"/);
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

test("release identity lanes receive authenticated pull request read access", () => {
  const promotionJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("\n  promotion:"),
    releaseWorkflow.indexOf("\n  notes:"),
  );
  const featureJob = ciWorkflow.slice(
    ciWorkflow.indexOf("\n  feature:"),
    ciWorkflow.indexOf("\n  dev:"),
  );

  assert.match(promotionJob, /pull-requests:\s*read/);
  assert.match(promotionJob, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);
  assert.match(featureJob, /pull-requests:\s*read/);
  assert.doesNotMatch(featureJob, /pull-requests:\s*write/);
  assert.match(featureJob, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);
  assert.doesNotMatch(featureJob, /post-perf-comment\.mjs/);
  assert.match(
    featureJob,
    /- name: Print perf comparison\s+if: always\(\) && hashFiles\('perf-comparison\.md'\) != ''\s+run: \|\s+cat perf-comparison\.md\s+cat perf-comparison\.md >> "\$GITHUB_STEP_SUMMARY"/,
  );
  assert.equal(
    existsSync(path.join(scriptsDir, "post-perf-comment.mjs")),
    false,
  );
  assert.equal(
    existsSync(path.join(scriptsDir, "post-perf-comment.test.mjs")),
    false,
  );
  assert.match(mainReleaseValidationWorkflow, /pull-requests:\s*read/);
  assert.match(
    mainReleaseValidationWorkflow,
    /GH_TOKEN:\s*\$\{\{ github\.token \}\}/,
  );
  for (const workflow of [
    ciWorkflow,
    mainReleaseValidationWorkflow,
    releaseWorkflow,
  ]) {
    assert.doesNotMatch(workflow, /--library-core-review-draft/);
    assert.doesNotMatch(workflow, /--historical-release-note-correction/);
  }
});

test("native dependency setup sanitizes unstable runner sources before apt update", () => {
  assert.match(
    aptSourceSanitizer,
    /\/etc\/apt\/sources\.list\.d\/azure-cli\.list/,
  );
  assert.match(aptSourceSanitizer, /\/etc\/apt\/apt-mirrors\.txt/);
  assert.ok(
    aptSourceSanitizer.includes("http://azure.archive.ubuntu.com/ubuntu"),
  );
  assert.ok(aptSourceSanitizer.includes("https://archive.ubuntu.com/ubuntu"));

  for (const [name, workflow, expectedCount] of [
    ["CI", ciWorkflow, 2],
    ["production validation", mainReleaseValidationWorkflow, 1],
    ["release", releaseWorkflow, 1],
  ]) {
    const blocks = workflow.match(
      /- name: Install native Linux dependencies[\s\S]*?(?=\n      - name:)/g,
    );
    assert.equal(blocks?.length, expectedCount, `${name} native setup count`);
    for (const block of blocks ?? []) {
      const sourceSanitizer = block.indexOf(
        "bash scripts/ci-sanitize-apt-sources.sh",
      );
      const aptUpdate = block.indexOf("sudo apt-get update");
      assert.ok(sourceSanitizer >= 0, `${name} sanitizes apt sources`);
      assert.ok(
        sourceSanitizer < aptUpdate,
        `${name} sanitizes apt sources before apt update`,
      );
    }
  }

  const releaseLinuxBlock = releaseWorkflow.match(
    /- name: Install Linux dependencies[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  assert.ok(releaseLinuxBlock, "release Linux setup exists");
  assert.ok(
    releaseLinuxBlock.indexOf("bash scripts/ci-sanitize-apt-sources.sh") <
      releaseLinuxBlock.indexOf("sudo apt-get update"),
    "release Linux packaging sanitizes apt sources before apt update",
  );

  const nightlyPlaywrightBlock = toolingNightlyWorkflow.match(
    /- name: Install Playwright browsers[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  assert.ok(nightlyPlaywrightBlock, "nightly Playwright setup exists");
  assert.ok(
    nightlyPlaywrightBlock.indexOf(
      "bash ../../scripts/ci-sanitize-apt-sources.sh",
    ) < nightlyPlaywrightBlock.indexOf("npx playwright install --with-deps"),
    "nightly Playwright setup sanitizes apt sources before package resolution",
  );
});

test("dev tag validation inherits the exact successful dev integration receipt", () => {
  const validationJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("\n  validation:"),
    releaseWorkflow.indexOf("\n  create-release:"),
  );

  assert.match(validationJob, /actions:\s*read/);
  assert.match(
    validationJob,
    /validate-dev-integration-receipt\.mjs[\s\S]*--sha="\$GITHUB_SHA"[\s\S]*--branch=dev[\s\S]*--workflow=ci\.yml/,
  );
  assert.doesNotMatch(
    validationJob,
    /release_channel \}\}" == "dev"[\s\S]*npm run validate:dev/,
  );
  assert.match(validationJob, /release_channel != 'dev'/);
  assert.match(validationJob, /npm run validate:production/);
});

test("draft release assets and publication use the exact release ID", () => {
  const updaterJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("\n  updater-manifest:"),
    releaseWorkflow.indexOf("\n  # After all platform builds succeed"),
  );
  const publishJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("\n  publish:"),
    releaseWorkflow.indexOf("\n  # Redeploy the public marketing site"),
  );

  assert.match(
    updaterJob,
    /releases\/\$\{RELEASE_ID\}/,
  );
  assert.match(
    updaterJob,
    /releases\/assets\/\$\{asset_id\}/,
  );
  assert.match(
    updaterJob,
    /uploads\.github\.com\/repos\/\$\{\{ github\.repository \}\}\/releases\/\$\{RELEASE_ID\}\/assets\?name=latest\.json/,
  );
  assert.doesNotMatch(updaterJob, /gh release download/);
  assert.doesNotMatch(updaterJob, /gh release upload/);
  assert.match(
    publishJob,
    /releases\/\$\{\{ needs\.create-release\.outputs\.release_id \}\}/,
  );
  assert.match(
    publishJob,
    /needs:\s*\[updater-manifest, create-release\]/,
    "publish must directly depend on create-release before reading its output",
  );
  assert.doesNotMatch(publishJob, /gh release edit/);
});

test("release failure triage binds GitHub CLI to the triggering repository", () => {
  const triageJobStart = releaseWorkflow.indexOf("\n  triage-on-failure:");
  assert.ok(
    triageJobStart >= 0,
    "release workflow should define failure triage",
  );
  const triageJob = releaseWorkflow.slice(triageJobStart);

  assert.match(triageJob, /GH_REPO:\s*\$\{\{ github\.repository \}\}/);
  assert.match(triageJob, /gh issue list/);
  assert.match(triageJob, /gh issue comment/);
  assert.match(triageJob, /gh issue create/);
  assert.doesNotMatch(triageJob, /uses:\s*actions\/checkout/);
});

test("feature validation installs Playwright for every desktop e2e plan", () => {
  assert.match(ciWorkflow, /grep -q '\^desktop \.\*e2e'/);
  assert.doesNotMatch(ciWorkflow, /grep -q '\^desktop e2e '/);
});

test("main PR validation inspects the actual PR head instead of the synthetic merge", () => {
  assert.match(
    ciWorkflow,
    /--head-ref="\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/,
  );
  assert.doesNotMatch(
    ciWorkflow,
    /validate-main-pr\.mjs[\s\S]*--head-ref=HEAD/,
  );
});

test("release preparation validates canonical CalVer before mutating version files", () => {
  const validationIndex = releasePrep.indexOf("scripts/release-version.mjs");
  const firstMutationIndex = releasePrep.indexOf(
    "fs.writeFileSync('${TAURI_CONF}'",
  );
  assert.ok(validationIndex >= 0);
  assert.ok(firstMutationIndex > validationIndex);
  assert.match(releaseVersion, /no leading-zero segments/);
  assert.match(
    releaseVersion,
    /Windows installers require a major no greater than 255/,
  );
  assert.doesNotMatch(releasePrep, /-\[a-zA-Z0-9\.\]\+/);
});

test("release preparation refreshes and stages the Rust lockfile", () => {
  const cargoTomlMutationIndex = releasePrep.indexOf(
    '\' "${CARGO_TOML}" > "${CARGO_TOML}.tmp"',
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
  assert.match(releaseNotesPrep, /--historical-published-tag requires --force/);
  assert.match(releaseNotesPrep, /rev-parse", `\$\{tag\}\^\{commit\}`/);
  assert.match(
    releaseNotesPrep,
    /withReleaseArtifactWriteLock\(releaseFile\.json/,
  );
});
