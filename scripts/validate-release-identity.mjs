#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectCargoLockReleaseChange } from "./lib/cargo-lock-release.mjs";
import {
  LIBRARY_CORE_ACTIVATION_DECISION_STATES,
  LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
  inspectLibraryCoreActivationManifest,
  inspectPreviousLibraryCoreActivationWitness,
  validateLibraryCoreReleaseActivation,
  validatePreviousLibraryCoreActivationContinuity,
} from "./lib/library-core-release-activation.mjs";
import { readGitPathAtRef } from "./lib/git-path-at-ref.mjs";
import { readGithubReleasePublications } from "./lib/github-release-publications.mjs";
import {
  compareTags,
  renderReleaseBody,
} from "./release-notes-shared.mjs";
import { listPromotionDiffFiles } from "./release-promotion-shared.mjs";
import {
  canonicalPublishedRelease,
  canonicalPreviousPublishedRelease,
  historicalPublishedTagReceipt,
  publishedReleaseInspectionSource,
  releaseInspectionRange,
} from "./release-receipt.mjs";
import { parseReleaseVersion } from "./release-version.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const HISTORICAL_BACKFILL_ARTIFACT_FIELDS = Object.freeze(
  new Set([
    "approved",
    "channel",
    "dayKey",
    "editorialNotes",
    "generatedAt",
    "model",
    "release",
    "releaseBody",
    "source",
    "tag",
    "version",
  ]),
);
const HISTORICAL_BACKFILL_SOURCE_FIELDS = Object.freeze(
  new Set([
    "channel",
    "commitSubjects",
    "compareRef",
    "isLatestOfDay",
    "previousPublishedDayTag",
    "previousPublishedTag",
    "productCommitSha",
    "promotedDevCommitSha",
    "prNumbers",
    "publishedTagCommitSha",
    "receiptMode",
    "relatedBuildTags",
    "sameDayTagsIncluded",
  ]),
);

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function releaseIdentityProjection(artifact) {
  const {
    release: _release,
    releaseBody: _releaseBody,
    ...identity
  } = artifact;
  return identity;
}

function unexpectedObjectFields(value, allowedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .sort();
}

function readTaggedReleaseArtifact(cwd, tag, ref = tag) {
  const relativePath = path.posix.join(
    "release-notes",
    "releases",
    `${tag}.json`,
  );
  const result = readGitPathAtRef({
    cwd,
    ref,
    filePath: relativePath,
  });
  if (result.state === "absent") {
    return null;
  }
  try {
    return JSON.parse(result.contents);
  } catch {
    throw new Error(
      `Previous published release ${tag} has an invalid immutable release artifact.`,
    );
  }
}

function readTaggedJson(cwd, tag, relativePath, label, ref = tag) {
  const result = readGitPathAtRef({
    cwd,
    ref,
    filePath: relativePath,
  });
  if (result.state !== "present") {
    throw new Error(`${label} is absent from immutable tag ${tag}.`);
  }
  try {
    return JSON.parse(result.contents);
  } catch {
    throw new Error(`${label} at immutable tag ${tag} is invalid JSON.`);
  }
}

function gitIsAncestor(cwd, fromRef, toRef) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", fromRef, toRef], {
      cwd,
      encoding: "utf8",
    }).status === 0
  );
}

function expectedLibraryCoreActivationRange({
  cwd,
  artifact,
  expected,
  productCommitSha,
  publicationFacts,
}) {
  if (!Object.hasOwn(artifact.source ?? {}, "previousPublishedTag")) {
    throw new Error(
      "Release source must record previousPublishedTag, including explicit null.",
    );
  }
  const claimedPreviousPublishedTag = artifact.source.previousPublishedTag;
  const canonicalPreviousRelease = canonicalPreviousPublishedRelease({
    channel: expected.channel,
    currentTag: expected.tag,
    publicationFacts,
  });
  const previousPublishedTag = canonicalPreviousRelease?.tag ?? null;
  if (claimedPreviousPublishedTag !== previousPublishedTag) {
    throw new Error(
      `Release source previousPublishedTag is ${String(
        claimedPreviousPublishedTag,
      )}, but canonical publication history requires ${String(
        previousPublishedTag,
      )}.`,
    );
  }
  let previousSource = null;
  let previousArtifact = null;
  let previousTagCommitSha = null;

  if (previousPublishedTag !== null) {
    const parsedPrevious = parseReleaseTag(previousPublishedTag);
    if (parsedPrevious.channel !== expected.channel) {
      throw new Error(
        `Previous published release ${previousPublishedTag} belongs to ${parsedPrevious.channel}, expected ${expected.channel}.`,
      );
    }
    if (compareTags(previousPublishedTag, expected.tag) >= 0) {
      throw new Error(
        `Previous published release ${previousPublishedTag} must precede ${expected.tag}.`,
      );
    }
    previousTagCommitSha = runGit(
      ["rev-parse", `${previousPublishedTag}^{commit}`],
      cwd,
    );
    previousArtifact = readTaggedReleaseArtifact(cwd, previousPublishedTag);
    if (
      previousArtifact &&
      (previousArtifact.tag !== previousPublishedTag ||
        previousArtifact.channel !== expected.channel)
    ) {
      throw new Error(
        `Previous published release ${previousPublishedTag} has inconsistent immutable identity.`,
      );
    }
    previousSource = publishedReleaseInspectionSource({
      channel: expected.channel,
      immutableSource: previousArtifact?.source ?? null,
      tagCommitSha: previousTagCommitSha,
    });
  }

  return {
    range: releaseInspectionRange({
      channel: expected.channel,
      previousPublishedTag,
      previousSource,
      previousTagCommitSha,
      productCommitSha,
      isAncestor: (fromRef, toRef) => gitIsAncestor(cwd, fromRef, toRef),
    }),
    previousArtifact,
    previousTagCommitSha,
  };
}

function cargoPackageVersion(contents) {
  const packageBlock =
    contents.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
  return packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

function cargoLockReleaseChangeErrors({
  cwd,
  fromRef,
  toRef,
  expectedVersion = null,
  context = "Cargo.lock",
}) {
  const result = inspectCargoLockReleaseChange({
    cwd,
    fromRef,
    toRef,
    expectedVersion,
  });
  if (result.error) {
    return [`${context} validation failed: ${result.error}`];
  }

  const errors = [];
  if (!result.versionMatches) {
    errors.push(
      `${context} freed-desktop package version is ${String(result.afterVersion)}, expected ${expectedVersion}.`,
    );
  }
  if (!result.contentMatches) {
    errors.push(
      `${context} may only change the freed-desktop package version.`,
    );
  }
  return errors;
}

export function parseReleaseTag(tag) {
  const parsed = parseReleaseVersion(tag, { requireTagPrefix: true });
  return {
    tag: parsed.tag,
    version: parsed.version,
    appVersion: parsed.appVersion,
    channel: parsed.channel,
    dayKey: parsed.dayKey,
  };
}

function protectedBranchRefForRelease(expected) {
  return expected.channel === "dev" ? "origin/dev" : "origin/main";
}

function resolveProtectedBaseCommit({
  cwd,
  expected,
  baseRef,
  headRef = "HEAD",
}) {
  const protectedBranchRef = protectedBranchRefForRelease(expected);
  if (baseRef !== protectedBranchRef) {
    throw new Error(
      `Release history mode requires --branch-ref=${protectedBranchRef}.`,
    );
  }
  const baseCommitSha = runGit(["rev-parse", `${baseRef}^{commit}`], cwd);
  const ancestry = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", baseCommitSha, headRef],
    { cwd, encoding: "utf8" },
  );
  if (ancestry.status !== 0) {
    throw new Error(
      `${baseCommitSha} from ${baseRef} is not an ancestor of ${headRef}.`,
    );
  }
  return baseCommitSha;
}

function canonicalReleaseCopyErrors({ cwd, expected, artifact, context }) {
  const errors = [];
  const expectedBody = renderReleaseBody(
    expected.tag,
    artifact.release ?? {},
  );
  if (artifact.releaseBody !== expectedBody) {
    errors.push(
      `${context} releaseBody does not match the canonical rendered release copy.`,
    );
  }
  const markdownPath = path.join(
    cwd,
    "release-notes",
    "releases",
    `${expected.tag}.md`,
  );
  try {
    if (readFileSync(markdownPath, "utf8") !== artifact.releaseBody) {
      errors.push(`${context} Markdown does not match releaseBody.`);
    }
  } catch (error) {
    errors.push(
      `${context} Markdown is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
  return errors;
}

export function validateHistoricalReleaseNoteCorrectionIdentity({
  cwd = REPO_ROOT,
  tag,
  baseRef,
  publicationFacts,
}) {
  const expected = parseReleaseTag(tag);
  if (typeof baseRef !== "string" || baseRef.trim().length === 0) {
    throw new Error(
      "Historical release-note correction requires one exact base ref.",
    );
  }
  const baseCommitSha = resolveProtectedBaseCommit({
    cwd,
    expected,
    baseRef,
  });
  const relativePath = path.posix.join(
    "release-notes",
    "releases",
    `${expected.tag}.json`,
  );
  const currentArtifact = readJson(path.join(cwd, relativePath));
  const baseRead = readGitPathAtRef({
    cwd,
    ref: baseCommitSha,
    filePath: relativePath,
  });
  if (baseRead.state !== "present") {
    throw new Error(
      `Historical release-note correction requires ${relativePath} at ${baseCommitSha}.`,
    );
  }
  let baseArtifact;
  try {
    baseArtifact = JSON.parse(baseRead.contents);
  } catch {
    throw new Error(
      `Historical release-note correction base artifact at ${baseRef} is invalid JSON.`,
    );
  }

  const errors = [];
  if (
    canonicalJson(releaseIdentityProjection(currentArtifact)) !==
    canonicalJson(releaseIdentityProjection(baseArtifact))
  ) {
    errors.push(
      "historical release-note correction may change only release and releaseBody.",
    );
  }
  for (const [label, actual, wanted] of [
    ["release artifact tag", currentArtifact.tag, expected.tag],
    ["release artifact version", currentArtifact.version, expected.version],
    ["release artifact channel", currentArtifact.channel, expected.channel],
    ["release source channel", currentArtifact.source?.channel, expected.channel],
    ["release day key", currentArtifact.dayKey, expected.dayKey],
  ]) {
    if (actual !== wanted) {
      errors.push(`${label} is ${String(actual)}, expected ${String(wanted)}.`);
    }
  }
  errors.push(
    ...canonicalReleaseCopyErrors({
      cwd,
      expected,
      artifact: currentArtifact,
      context: "historical release-note correction",
    }),
  );
  const publication = canonicalPublishedRelease({
    channel: expected.channel,
    tag: expected.tag,
    publicationFacts,
  });
  if (publication === null) {
    errors.push(
      `${expected.tag} is not an exact successful published GitHub release.`,
    );
  }
  let tagCommitSha = null;
  try {
    tagCommitSha = runGit(["rev-parse", `${expected.tag}^{commit}`], cwd);
  } catch (error) {
    errors.push(
      `historical release-note correction tag is invalid: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Historical release-note correction validation failed:\n- ${errors.join("\n- ")}`,
    );
  }
  return {
    ...expected,
    baseRef,
    baseCommitSha,
    publication,
    tagCommitSha,
  };
}

export function validateHistoricalPublishedTagIdentity({
  cwd = REPO_ROOT,
  tag,
  baseRef,
  publicationFacts,
}) {
  const expected = parseReleaseTag(tag);
  const baseCommitSha = resolveProtectedBaseCommit({
    cwd,
    expected,
    baseRef,
  });
  const relativeArtifactPath = path.posix.join(
    "release-notes",
    "releases",
    `${expected.tag}.json`,
  );
  const artifact = readJson(
    path.join(cwd, relativeArtifactPath),
  );
  const errors = canonicalReleaseCopyErrors({
    cwd,
    expected,
    artifact,
    context: "historical published-tag backfill",
  });
  for (const [label, actual, wanted] of [
    ["release artifact tag", artifact.tag, expected.tag],
    ["release artifact version", artifact.version, expected.version],
    ["release artifact channel", artifact.channel, expected.channel],
    ["release source channel", artifact.source?.channel, expected.channel],
    ["release day key", artifact.dayKey, expected.dayKey],
  ]) {
    if (actual !== wanted) {
      errors.push(`${label} is ${String(actual)}, expected ${String(wanted)}.`);
    }
  }

  const publication = canonicalPublishedRelease({
    channel: expected.channel,
    tag: expected.tag,
    publicationFacts,
  });
  if (publication === null) {
    errors.push(
      `${expected.tag} is not an exact successful published GitHub release.`,
    );
  }

  let tagCommitSha = null;
  let taggedArtifact = null;
  try {
    tagCommitSha = runGit(["rev-parse", `${expected.tag}^{commit}`], cwd);
    taggedArtifact = readTaggedReleaseArtifact(
      cwd,
      expected.tag,
      tagCommitSha,
    );
    const expectedReceipt = historicalPublishedTagReceipt({
      channel: expected.channel,
      tagCommitSha,
      existingSource: taggedArtifact?.source ?? null,
    });
    for (const [field, wanted] of Object.entries(expectedReceipt)) {
      if (artifact.source?.[field] !== wanted) {
        errors.push(
          `historical release source ${field} is ${String(
            artifact.source?.[field],
          )}, expected ${String(wanted)}.`,
        );
      }
    }
    if (taggedArtifact !== null) {
      const expectedArtifact = {
        ...taggedArtifact,
        source: {
          ...(taggedArtifact.source ?? {}),
          ...expectedReceipt,
        },
      };
      if (canonicalJson(artifact) !== canonicalJson(expectedArtifact)) {
        errors.push(
          "historical published-tag backfill may add only the exact receipt to an immutable tagged release artifact.",
        );
      }
    } else {
      const baseArtifactRead = readGitPathAtRef({
        cwd,
        ref: baseCommitSha,
        filePath: relativeArtifactPath,
      });
      if (baseArtifactRead.state !== "absent") {
        errors.push(
          `historical published-tag receipt mode requires the first backfill; ${relativeArtifactPath} already exists at ${baseCommitSha}.`,
        );
      }
      const unexpectedArtifactFields = unexpectedObjectFields(
        artifact,
        HISTORICAL_BACKFILL_ARTIFACT_FIELDS,
      );
      const unexpectedSourceFields = unexpectedObjectFields(
        artifact.source,
        HISTORICAL_BACKFILL_SOURCE_FIELDS,
      );
      if (unexpectedArtifactFields.length > 0) {
        errors.push(
          `historical published-tag backfill has unsupported artifact fields: ${unexpectedArtifactFields.join(", ")}.`,
        );
      }
      if (unexpectedSourceFields.length > 0) {
        errors.push(
          `historical published-tag backfill has unsupported source fields: ${unexpectedSourceFields.join(", ")}.`,
        );
      }
    }
  } catch (error) {
    errors.push(
      `historical published-tag receipt is invalid: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }

  if (tagCommitSha !== null) {
    try {
      const taggedDesktop = readTaggedJson(
        cwd,
        expected.tag,
        "packages/desktop/package.json",
        "Desktop package",
        tagCommitSha,
      );
      const taggedPwa = readTaggedJson(
        cwd,
        expected.tag,
        "packages/pwa/package.json",
        "PWA package",
        tagCommitSha,
      );
      const taggedTauri = readTaggedJson(
        cwd,
        expected.tag,
        "packages/desktop/src-tauri/tauri.conf.json",
        "Tauri configuration",
        tagCommitSha,
      );
      const taggedCargo = readGitPathAtRef({
        cwd,
        ref: tagCommitSha,
        filePath: "packages/desktop/src-tauri/Cargo.toml",
      });
      if (taggedCargo.state !== "present") {
        throw new Error(
          `Cargo package is absent from immutable tag ${expected.tag}.`,
        );
      }
      for (const [label, actual] of [
        ["Desktop package version", taggedDesktop.version],
        ["PWA package version", taggedPwa.version],
        ["Tauri bundle version", taggedTauri.version],
        ["Cargo package version", cargoPackageVersion(taggedCargo.contents)],
      ]) {
        if (actual !== expected.appVersion) {
          errors.push(
            `${label} at ${expected.tag} is ${String(actual)}, expected ${expected.appVersion}.`,
          );
        }
      }
    } catch (error) {
      errors.push(
        `immutable tagged product identity is invalid: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Historical release identity validation failed:\n- ${errors.join("\n- ")}`,
    );
  }

  return {
    ...expected,
    baseCommitSha,
    publication,
    tagCommitSha,
  };
}

export function validateReleaseIdentity({
  cwd = REPO_ROOT,
  tag,
  headRef = "HEAD",
  branchRef = null,
  publicationFacts,
  requireReviewedLibraryCoreActivation = true,
}) {
  const expected = parseReleaseTag(tag);
  const releasePath = path.join(
    cwd,
    "release-notes",
    "releases",
    `${expected.tag}.json`,
  );
  const artifact = readJson(releasePath);
  const desktopPackage = readJson(
    path.join(cwd, "packages/desktop/package.json"),
  );
  const pwaPackage = readJson(path.join(cwd, "packages/pwa/package.json"));
  const tauriConfig = readJson(
    path.join(cwd, "packages/desktop/src-tauri/tauri.conf.json"),
  );
  const cargoVersion = cargoPackageVersion(
    readFileSync(
      path.join(cwd, "packages/desktop/src-tauri/Cargo.toml"),
      "utf8",
    ),
  );
  const errors = [];

  if (artifact.approved !== true) {
    errors.push("release artifact must be explicitly approved.");
  }

  if (branchRef) {
    const onProtectedBranch = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", headRef, branchRef],
      { cwd, encoding: "utf8" },
    );
    if (onProtectedBranch.status !== 0) {
      errors.push(`${headRef} is not in protected ${branchRef} history.`);
    }
  }

  const exactFields = [
    ["release artifact tag", artifact.tag, expected.tag],
    ["release artifact version", artifact.version, expected.version],
    ["release artifact channel", artifact.channel, expected.channel],
    ["release source channel", artifact.source?.channel, expected.channel],
    ["release day key", artifact.dayKey, expected.dayKey],
    ["Desktop package version", desktopPackage.version, expected.appVersion],
    ["PWA package version", pwaPackage.version, expected.appVersion],
    ["Tauri bundle version", tauriConfig.version, expected.appVersion],
    ["Cargo package version", cargoVersion, expected.appVersion],
  ];
  for (const [label, actual, wanted] of exactFields) {
    if (actual !== wanted) {
      errors.push(`${label} is ${String(actual)}, expected ${String(wanted)}.`);
    }
  }

  const productCommitSha = String(
    artifact.source?.productCommitSha ?? "",
  ).trim();
  if (!/^[0-9a-f]{40,64}$/.test(productCommitSha)) {
    errors.push(
      "release source productCommitSha must be a full Git commit SHA.",
    );
  } else {
    const ancestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", productCommitSha, headRef],
      { cwd, encoding: "utf8" },
    );
    if (ancestor.status !== 0) {
      errors.push(
        `release source productCommitSha ${productCommitSha} is not an ancestor of ${headRef}.`,
      );
    } else {
      errors.push(
        ...cargoLockReleaseChangeErrors({
          cwd,
          fromRef: productCommitSha,
          toRef: headRef,
          expectedVersion: expected.appVersion,
        }),
      );
      const driftFiles = listPromotionDiffFiles({
        fromRef: productCommitSha,
        toRef: headRef,
        cwd,
      });
      if (driftFiles.length > 0) {
        errors.push(
          `product files changed after release notes were prepared: ${driftFiles.join(", ")}.`,
        );
      }
    }
  }

  let promotedDevCommitSha = null;
  if (expected.channel === "production") {
    promotedDevCommitSha = String(
      artifact.source?.promotedDevCommitSha ?? "",
    ).trim();
    if (!/^[0-9a-f]{40,64}$/.test(promotedDevCommitSha)) {
      errors.push(
        "production release source promotedDevCommitSha must be a full Git commit SHA.",
      );
    } else {
      const promotedCommit = spawnSync(
        "git",
        ["cat-file", "-e", `${promotedDevCommitSha}^{commit}`],
        { cwd, encoding: "utf8" },
      );
      if (promotedCommit.status !== 0) {
        errors.push(
          `production release source promotedDevCommitSha ${promotedDevCommitSha} is not a local commit.`,
        );
      } else if (/^[0-9a-f]{40,64}$/.test(productCommitSha)) {
        errors.push(
          ...cargoLockReleaseChangeErrors({
            cwd,
            fromRef: promotedDevCommitSha,
            toRef: productCommitSha,
            context: "recorded promoted dev Cargo.lock",
          }),
        );
        const promotionDrift = listPromotionDiffFiles({
          fromRef: promotedDevCommitSha,
          toRef: productCommitSha,
          cwd,
        });
        if (promotionDrift.length > 0) {
          errors.push(
            `recorded promoted dev snapshot does not match the prepared product commit: ${promotionDrift.join(", ")}.`,
          );
        }
      }
    }
  }

  let libraryCoreActivation = null;
  if (/^[0-9a-f]{40,64}$/.test(productCommitSha)) {
    try {
      const {
        range: expectedRange,
        previousArtifact,
        previousTagCommitSha,
      } = expectedLibraryCoreActivationRange({
        cwd,
        artifact,
        expected,
        productCommitSha,
        publicationFacts,
      });
      const previousTagManifestRead =
        previousTagCommitSha === null
          ? { state: "absent" }
          : readGitPathAtRef({
              cwd,
              ref: previousTagCommitSha,
              filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
            });
      const previousActivationWitness =
        inspectPreviousLibraryCoreActivationWitness({
          releaseArtifact: previousArtifact,
          tag: expectedRange.previousPublishedTag,
          manifestRead: previousTagManifestRead,
        });
      const previousManifestRead =
        expectedRange.fromExclusiveCommitSha === null
          ? { state: "absent" }
          : readGitPathAtRef({
              cwd,
              ref: expectedRange.fromExclusiveCommitSha,
              filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
            });
      const currentManifestRead = readGitPathAtRef({
        cwd,
        ref: productCommitSha,
        filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
      });
      if (currentManifestRead.state !== "present") {
        throw new Error(
          `${LIBRARY_CORE_ACTIVATION_MANIFEST_PATH} is missing from exact release source ${productCommitSha}.`,
        );
      }
      const manifestInspection = inspectLibraryCoreActivationManifest({
        previousContents:
          previousManifestRead.state === "present"
            ? previousManifestRead.contents
            : null,
        currentContents: currentManifestRead.contents,
      });
      validatePreviousLibraryCoreActivationContinuity({
        witness: previousActivationWitness,
        manifestInspection,
      });
      libraryCoreActivation = validateLibraryCoreReleaseActivation({
        value: artifact.source?.libraryCoreActivation,
        expectedRange,
        expectedManifestInspection: manifestInspection,
        releaseArtifact: artifact,
        requireReviewed: requireReviewedLibraryCoreActivation,
      });
    } catch (error) {
      errors.push(
        `Library Core release activation validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Release identity validation failed:\n- ${errors.join("\n- ")}`,
    );
  }

  return {
    ...expected,
    productCommitSha,
    promotedDevCommitSha,
    libraryCoreActivation,
    headCommitSha: runGit(["rev-parse", headRef], cwd),
  };
}

export function validateLibraryCoreReviewDraftIdentity(options) {
  const result = validateReleaseIdentity({
    ...options,
    requireReviewedLibraryCoreActivation: false,
  });
  if (
    result.libraryCoreActivation?.decision?.state !==
      LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED ||
    result.libraryCoreActivation.transitions.length === 0
  ) {
    throw new Error(
      "Library Core draft review preflight requires one unreviewed nonempty activation delta.",
    );
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    cwd: REPO_ROOT,
    tag: "",
    headRef: "HEAD",
    branchRef: null,
    historicalPublishedTag: false,
    historicalReleaseNoteCorrection: false,
    libraryCoreReviewDraft: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--cwd="))
      options.cwd = path.resolve(arg.slice("--cwd=".length));
    else if (arg.startsWith("--tag=")) options.tag = arg.slice("--tag=".length);
    else if (arg.startsWith("--head-ref="))
      options.headRef = arg.slice("--head-ref=".length);
    else if (arg.startsWith("--branch-ref="))
      options.branchRef = arg.slice("--branch-ref=".length);
    else if (arg === "--historical-published-tag")
      options.historicalPublishedTag = true;
    else if (arg === "--historical-release-note-correction")
      options.historicalReleaseNoteCorrection = true;
    else if (arg === "--library-core-review-draft")
      options.libraryCoreReviewDraft = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/validate-release-identity.mjs --tag=vYY.M.DDBUILD[-dev] [--head-ref=HEAD] [--branch-ref=origin/dev|origin/main] [--historical-published-tag|--historical-release-note-correction|--library-core-review-draft] [--cwd=path]\n",
    );
    return;
  }
  if (!options.tag) {
    throw new Error("--tag is required.");
  }
  const alternateModeCount = [
    options.historicalPublishedTag,
    options.historicalReleaseNoteCorrection,
    options.libraryCoreReviewDraft,
  ].filter(Boolean).length;
  if (alternateModeCount > 1) {
    throw new Error(
      "Historical published-tag, historical release-note correction, and Library Core review-draft modes are mutually exclusive.",
    );
  }
  if (
    (options.historicalPublishedTag ||
      options.historicalReleaseNoteCorrection) &&
    !options.branchRef
  ) {
    throw new Error(
      "Historical release modes require --branch-ref.",
    );
  }
  const publicationFacts = readGithubReleasePublications({
    projectRelease: (release) => ({
      id: release.id ?? null,
      tag_name: release.tag_name,
      draft: release.draft,
      prerelease: release.prerelease,
      published_at: release.published_at,
      publication_status:
        release.publication_status ??
        release.publicationStatus ??
        release.conclusion ??
        release.status ??
        release.state ??
        "",
    }),
  });
  const result = options.historicalPublishedTag
      ? validateHistoricalPublishedTagIdentity({
          cwd: options.cwd,
          tag: options.tag,
          baseRef: options.branchRef,
          publicationFacts,
        })
    : options.historicalReleaseNoteCorrection
      ? validateHistoricalReleaseNoteCorrectionIdentity({
          cwd: options.cwd,
          tag: options.tag,
          baseRef: options.branchRef,
          publicationFacts,
        })
    : options.libraryCoreReviewDraft
      ? validateLibraryCoreReviewDraftIdentity({
          ...options,
          publicationFacts,
        })
    : validateReleaseIdentity({
        ...options,
        publicationFacts,
      });
  process.stdout.write(
    options.historicalPublishedTag
      ? `Historical published release identity is valid for ${result.tag} at ${result.tagCommitSha}.\n`
      : options.historicalReleaseNoteCorrection
        ? `Historical release-note correction is valid for ${result.tag} against ${result.baseCommitSha}.\n`
      : options.libraryCoreReviewDraft
        ? `Library Core draft review identity is valid for ${result.tag} at ${result.headCommitSha}.\n`
      : `Release identity is valid for ${result.tag} at ${result.headCommitSha}.\n`,
  );
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
