#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  areNearDuplicates,
  applyPinnedHighlightsToRelease,
  buildReleaseDeck,
  compareTags,
  compareVersionDays,
  dedupeSimilarStrings,
  dayDateFromVersion,
  MAX_FEATURES,
  normalizeReleaseText,
  normalizePinnedHighlightTexts,
  removePreviousDayFeatureRepeats,
  renderReleaseBody,
  sanitizeReleaseShape,
  summarizeFallbackText,
  validateReleaseShape,
  versionDayKey,
} from "./release-notes-shared.mjs";
import { listPromotionDiffFiles } from "./release-promotion-shared.mjs";
import {
  historicalPublishedTagReceipt,
  publishedReleaseInspectionSource,
  releaseInspectionRange,
  releasePreparationReceipt,
} from "./release-receipt.mjs";
import {
  LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
  inspectLibraryCoreActivationManifest,
  inspectPreviousLibraryCoreActivationWitness,
  prepareLibraryCoreReleaseActivation,
  validatePreviousLibraryCoreActivationContinuity,
  withReleaseArtifactWriteLock,
} from "./lib/library-core-release-activation.mjs";
import { readGitPathAtRef } from "./lib/git-path-at-ref.mjs";
import { readGithubReleasePublications } from "./lib/github-release-publications.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const RELEASE_NOTES_DIR = path.join(REPO_ROOT, "release-notes");
const RELEASES_DIR = path.join(RELEASE_NOTES_DIR, "releases");
const DAILY_DIR = path.join(RELEASE_NOTES_DIR, "daily");
const DEV_SUFFIX = "-dev";

const GITHUB_API = "https://api.github.com";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_RELEASE_NOTES_MODEL || "gpt-5.4";
const OPENAI_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.OPENAI_RELEASE_NOTES_TIMEOUT_MS || "20000", 10) ||
    20_000,
);
const GITHUB_FETCH_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.RELEASE_NOTES_GITHUB_TIMEOUT_MS || "15000", 10) ||
    15_000,
);
const MAX_PR_DETAILS = Math.max(
  0,
  Number.parseInt(process.env.RELEASE_NOTES_MAX_PR_DETAILS || "60", 10) || 60,
);

function die(message) {
  console.error(message);
  process.exit(1);
}

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
}

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ghBinary() {
  const candidates = [
    process.env.GH_BIN,
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "gh";
}

function hasGitRef(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitIsAncestor(fromRef, toRef) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", fromRef, toRef], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function readTaggedReleaseArtifact(tag) {
  const relativePath = path.posix.join(
    "release-notes",
    "releases",
    `${tag}.json`,
  );
  const artifactRead = readGitPathAtRef({
    cwd: REPO_ROOT,
    ref: tag,
    filePath: relativePath,
  });
  if (artifactRead.state === "absent") {
    return null;
  }
  try {
    return JSON.parse(artifactRead.contents);
  } catch {
    throw new Error(
      `Previous published release ${tag} has an invalid immutable release artifact.`,
    );
  }
}

function previousReleaseInspection({ tag, channel }) {
  const immutableArtifact = readTaggedReleaseArtifact(tag);
  if (
    immutableArtifact &&
    (immutableArtifact.tag !== tag || immutableArtifact.channel !== channel)
  ) {
    throw new Error(
      `Previous published release ${tag} has inconsistent immutable identity.`,
    );
  }
  return {
    artifact: immutableArtifact,
    source: publishedReleaseInspectionSource({
      channel,
      immutableSource: immutableArtifact?.source ?? null,
      tagCommitSha: git(["rev-parse", `${tag}^{commit}`]),
    }),
  };
}

function maybeGhToken() {
  try {
    return execFileSync(ghBinary(), ["auth", "token"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function githubHeaders() {
  const token =
    process.env.GITHUB_TOKEN || process.env.GH_TOKEN || maybeGhToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    GITHUB_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${url}`);
    }
    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `GitHub request timed out after ${GITHUB_FETCH_TIMEOUT_MS.toLocaleString()}ms: ${url}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeSubject(subject) {
  return subject.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim();
}

function isExactDuplicateText(a, b) {
  return (
    normalizeReleaseText(a).toLowerCase() ===
    normalizeReleaseText(b).toLowerCase()
  );
}

function commitKind(subject) {
  const normalized = normalizeSubject(subject);
  const match = normalized.match(
    /^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:/,
  );
  return match?.[1] ?? "";
}

function releaseEntryKind(subject) {
  const kind = commitKind(subject);
  if (kind === "feat") {
    return "feature";
  }
  if (kind === "fix") {
    return "fix";
  }
  return "followUp";
}

function stripPrefix(subject) {
  const normalized = normalizeSubject(subject)
    .replace(/ \(#\d+\)$/, "")
    .replace(
      /^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:\s*/,
      "",
    )
    .trim();

  if (!normalized) {
    return "Bug fixes and improvements";
  }

  return summarizeFallbackText(normalized);
}

function cleanDetailLine(line) {
  return line
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*] /, "")
    .replace(/:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBodyText(body) {
  return String(body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n");
}

function extractSection(body, headings) {
  const lines = normalizeBodyText(body).split("\n");
  const sectionLines = [];
  let inSection = false;

  for (const line of lines) {
    const heading = line.trim().toLowerCase();
    if (headings.has(heading)) {
      inSection = true;
      continue;
    }

    if (inSection && /^##\s+/.test(line)) {
      break;
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines;
}

function parseDetails(lines) {
  const details = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const text = cleanDetailLine(paragraph.join(" "));
    paragraph = [];

    if (
      text &&
      !["Includes", "Include", "Summary", "What changed", "Impact"].includes(
        text,
      )
    ) {
      const normalized = summarizeFallbackText(text);
      if (!details.some((item) => areNearDuplicates(item, normalized))) {
        details.push(normalized);
      }
    }
  };

  for (const line of lines) {
    const stripped = line.trim();

    if (!stripped) {
      flushParagraph();
      continue;
    }

    if (stripped.startsWith("```")) {
      flushParagraph();
      continue;
    }

    if (stripped.startsWith("(AI Generated")) {
      continue;
    }

    if (/^[-*] /.test(stripped)) {
      flushParagraph();
      const cleaned = cleanDetailLine(stripped);
      if (cleaned) {
        const normalized = summarizeFallbackText(cleaned);
        if (!details.some((item) => areNearDuplicates(item, normalized))) {
          details.push(normalized);
        }
      }
      continue;
    }

    paragraph.push(stripped);
  }

  flushParagraph();
  return details;
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function releasePaths(tag) {
  return {
    json: path.join(RELEASES_DIR, `${tag}.json`),
    markdown: path.join(RELEASES_DIR, `${tag}.md`),
  };
}

function channelFromVersion(version) {
  return String(version ?? "").endsWith(DEV_SUFFIX) ? "dev" : "production";
}

function dailyPath(dayKey, channel) {
  return path.join(DAILY_DIR, channel, `${dayKey}.json`);
}

function legacyDailyPath(dayKey) {
  return path.join(DAILY_DIR, `${dayKey}.json`);
}

function readDailyArtifact(dayKey, channel) {
  return (
    readJsonIfExists(dailyPath(dayKey, channel)) ??
    (channel === "production"
      ? readJsonIfExists(legacyDailyPath(dayKey))
      : null)
  );
}

function defaultDailyEditorial(dayKey, version, channel) {
  return {
    channel,
    dayKey,
    date: dayDateFromVersion(version),
    preferredDeck: null,
    editorialGuidance: [
      "Keep the tone concise, professional, and specific.",
      "Lead with user-facing outcomes, shipping milestones, trust wins, and installability improvements.",
      "Demote internal cleanup unless it clearly changes the shipped product.",
    ],
    pinnedHighlights: [],
    editorialNotes: [],
    updatedAt: null,
  };
}

function defaultReleaseArtifact(tag, version, dayKey, channel) {
  return {
    tag,
    version,
    channel,
    dayKey,
    approved: false,
    editorialNotes: [],
    generatedAt: null,
    model: null,
    source: {
      channel,
      previousPublishedTag: null,
      previousPublishedDayTag: null,
      compareRef: "HEAD",
      productCommitSha: null,
      promotedDevCommitSha: null,
      isLatestOfDay: true,
      sameDayTagsIncluded: [],
      relatedBuildTags: [],
      prNumbers: [],
      commitSubjects: [],
    },
    release: {
      deck: "",
      features: [],
      fixes: [],
      followUps: [],
    },
    releaseBody: "",
  };
}

function releaseFromArtifact(artifact) {
  return sanitizeReleaseShape(artifact?.release ?? {});
}

function preferredDeckForContext(existingDaily, context) {
  if (!context.isLatestOfDay) {
    return "";
  }

  return existingDaily?.preferredDeck ?? "";
}

function withComputedDeck(release, context, existingDaily) {
  const normalizedWithoutDeck = sanitizeReleaseShape({
    ...release,
    deck: "",
  });
  const normalized = {
    ...normalizedWithoutDeck,
    deck: summarizeFallbackText(release?.deck ?? ""),
  };

  const deck = buildReleaseDeck(normalized, {
    preferredDeck: preferredDeckForContext(existingDaily, context),
  });

  return sanitizeReleaseShape({
    ...normalized,
    deck,
  });
}

function releaseHasContent(release) {
  return Boolean(
    release?.deck ||
    (release?.features ?? []).length > 0 ||
    (release?.fixes ?? []).length > 0 ||
    (release?.followUps ?? []).length > 0,
  );
}

function mergePriorSameDayReleases(baseRelease, earlierReleases) {
  const merged = sanitizeReleaseShape(baseRelease);

  for (const priorRelease of earlierReleases) {
    const prior = sanitizeReleaseShape(priorRelease);

    if (!merged.deck && prior.deck) {
      merged.deck = prior.deck;
    }

    const carryForwardItems = [
      ...prior.features,
      ...prior.fixes,
      prior.deck,
      ...prior.followUps,
    ].filter(Boolean);

    for (const item of carryForwardItems) {
      if (isExactDuplicateText(item, merged.deck)) {
        continue;
      }

      if (
        prior.features.some((feature) => areNearDuplicates(feature, item)) &&
        merged.features.length < MAX_FEATURES &&
        !merged.features.some((feature) => areNearDuplicates(feature, item))
      ) {
        merged.features.push(item);
        continue;
      }

      if (merged.features.some((feature) => areNearDuplicates(feature, item))) {
        continue;
      }

      if (
        prior.features.some((feature) => areNearDuplicates(feature, item)) &&
        !merged.followUps.some((followUp) => areNearDuplicates(followUp, item))
      ) {
        merged.followUps.push(item);
        continue;
      }

      if (
        prior.fixes.some((fix) => areNearDuplicates(fix, item)) &&
        !merged.fixes.some((fix) => areNearDuplicates(fix, item))
      ) {
        merged.fixes.push(item);
        continue;
      }

      if (
        !merged.followUps.some((followUp) => areNearDuplicates(followUp, item))
      ) {
        merged.followUps.push(item);
      }
    }
  }

  const deduped = sanitizeReleaseShape({
    ...merged,
    deck: "",
  });

  return {
    deck: merged.deck,
    features: deduped.features,
    fixes: deduped.fixes,
    followUps: deduped.followUps,
  };
}

function releaseArtifactsMatch(existingArtifact, nextRelease, nextSource) {
  if (!existingArtifact) {
    return false;
  }

  const existingRelease = sanitizeReleaseShape(existingArtifact.release ?? {});
  const existingSource = {
    channel:
      existingArtifact.source?.channel ??
      existingArtifact.channel ??
      "production",
    previousPublishedTag: existingArtifact.source?.previousPublishedTag ?? null,
    previousPublishedDayTag:
      existingArtifact.source?.previousPublishedDayTag ?? null,
    compareRef: existingArtifact.source?.compareRef ?? "HEAD",
    productCommitSha: existingArtifact.source?.productCommitSha ?? null,
    promotedDevCommitSha: existingArtifact.source?.promotedDevCommitSha ?? null,
    ...(Object.hasOwn(existingArtifact.source ?? {}, "libraryCoreActivation")
      ? {
          libraryCoreActivation: existingArtifact.source.libraryCoreActivation,
        }
      : {}),
    isLatestOfDay: Boolean(existingArtifact.source?.isLatestOfDay),
    sameDayTagsIncluded: existingArtifact.source?.sameDayTagsIncluded ?? [],
    relatedBuildTags: existingArtifact.source?.relatedBuildTags ?? [],
    prNumbers: existingArtifact.source?.prNumbers ?? [],
    commitSubjects: existingArtifact.source?.commitSubjects ?? [],
  };
  if (Object.hasOwn(existingArtifact.source ?? {}, "receiptMode")) {
    existingSource.receiptMode = existingArtifact.source.receiptMode;
  }
  if (Object.hasOwn(existingArtifact.source ?? {}, "publishedTagCommitSha")) {
    existingSource.publishedTagCommitSha =
      existingArtifact.source.publishedTagCommitSha;
  }

  return (
    JSON.stringify(existingRelease) === JSON.stringify(nextRelease) &&
    JSON.stringify(existingSource) === JSON.stringify(nextSource)
  );
}

function compareReleases(a, b) {
  return compareTags(a.tag_name, b.tag_name);
}

let githubReleasePublicationCache = null;

async function listPublishedReleases(channel) {
  githubReleasePublicationCache ??= readGithubReleasePublications({
    projectRelease: (release) => ({
      id: release.id ?? null,
      tag_name: release.tag_name,
      draft: release.draft,
      prerelease: release.prerelease,
      published_at: release.published_at,
      body: release.body ?? "",
    }),
  });

  return githubReleasePublicationCache
    .filter((release) => {
      if (release.draft) {
        return false;
      }

      if (channel === "all") {
        return true;
      }

      if (channel === "dev") {
        return release.prerelease && release.tag_name.endsWith(DEV_SUFFIX);
      }

      return !release.prerelease && !release.tag_name.endsWith(DEV_SUFFIX);
    })
    .sort(compareReleases);
}

async function fetchPull(prNumber) {
  const headers = githubHeaders();
  return fetchJson(
    `${GITHUB_API}/repos/freed-project/freed/pulls/${prNumber}`,
    headers,
  );
}

function parseArguments(argv) {
  const force = argv.includes("--force");
  const historicalPublishedTag = argv.includes("--historical-published-tag");
  const positional = argv.filter(
    (arg) => arg !== "--force" && arg !== "--historical-published-tag",
  );

  if (positional.length !== 1) {
    die(
      "Usage: node scripts/prepare-release-notes.mjs <version-or-tag> [--force] [--historical-published-tag]",
    );
  }
  if (historicalPublishedTag && !force) {
    die("--historical-published-tag requires --force.");
  }

  return {
    input: positional[0],
    force,
    historicalPublishedTag,
  };
}

function previousPublishedDayRelease(version, publishedReleases) {
  return (
    [...publishedReleases]
      .filter((release) => compareVersionDays(release.tag_name, version) < 0)
      .pop() ?? null
  );
}

function releaseSummaryScore(text, kind, pinnedTexts) {
  let score = 0;
  const normalized = summarizeFallbackText(text);
  const words = normalized.split(/\s+/).length;

  if (kind === "feature") score += 8;
  if (kind === "fix") score += 4;
  if (kind === "followUp") score += 2;
  if (normalized.length >= 28 && normalized.length <= 96) score += 4;
  if (words >= 4 && words <= 15) score += 3;
  if (
    /\b(sign|signed|signing|notarized|install|desktop|reader|sync|friend|map|legal|workspace|download|capture)\b/i.test(
      normalized,
    )
  ) {
    score += 3;
  }
  if (pinnedTexts.some((item) => areNearDuplicates(item, normalized))) {
    score += 10;
  }
  if (normalized.length > 120) score -= 4;
  if (words < 3) score -= 4;

  return score;
}

function chooseBestSummary(entry) {
  const candidates = [entry.title, ...(entry.details ?? []), entry.fallback]
    .map((candidate) => summarizeFallbackText(candidate))
    .filter(Boolean);

  return (
    candidates[0] ?? summarizeFallbackText(entry.fallback || entry.title || "")
  );
}

function collectPriorSameDayReleases(tag, dayKey, publishedReleases) {
  return publishedReleases.filter(
    (release) =>
      versionDayKey(release.tag_name.replace(/^v/, "")) === dayKey &&
      compareTags(release.tag_name, tag) < 0,
  );
}

function dedupeNumericList(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function dedupeReleaseTags(tags) {
  return [...new Set(tags)].sort(compareTags);
}

function dedupePublishedReleases(releases) {
  const releaseMap = new Map();

  for (const release of releases) {
    releaseMap.set(release.tag_name, release);
  }

  return Array.from(releaseMap.values()).sort(compareReleases);
}

function extractPublishedReleaseDeck(body) {
  const lines = normalizeBodyText(body).split("\n");
  const deckLines = [];
  let sawHeading = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("(AI Generated")) {
      continue;
    }

    if (!sawHeading && /^##\s+/.test(trimmed)) {
      sawHeading = true;
      continue;
    }

    if (!sawHeading) {
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      break;
    }

    if (!trimmed) {
      if (deckLines.length > 0) {
        break;
      }
      continue;
    }

    deckLines.push(cleanDetailLine(trimmed));
  }

  return summarizeFallbackText(deckLines.join(" "));
}

function parsePublishedReleaseBody(body) {
  const normalizedBody = normalizeBodyText(body);
  const features = [];
  const fixes = [];
  const followUps = [];
  const sectionRegex = /###\s+(.+?)\n([\s\S]*?)(?=\n###|\n##|$)/g;
  let match;

  while ((match = sectionRegex.exec(normalizedBody)) !== null) {
    const heading = match[1].trim().toLowerCase();
    const items = dedupeSimilarStrings(
      match[2]
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) =>
          summarizeFallbackText(
            cleanDetailLine(
              line
                .replace(/^- /, "")
                .replace(/\[#(\d+)\]\([^)]+\)/g, "#$1")
                .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
            ),
          ),
        ),
    );

    if (
      heading.includes("feature") ||
      heading.includes("new") ||
      heading.includes("feat")
    ) {
      features.push(...items);
      continue;
    }

    if (heading.includes("fix")) {
      fixes.push(...items);
      continue;
    }

    if (heading.includes("follow") || heading.includes("perf")) {
      followUps.push(...items);
    }
  }

  return sanitizeReleaseShape({
    deck: extractPublishedReleaseDeck(normalizedBody),
    features,
    fixes,
    followUps,
  });
}

function loadPublishedReleaseSummary(release) {
  const artifact = readJsonIfExists(releasePaths(release.tag_name).json);

  if (artifact?.release) {
    return {
      release: releaseFromArtifact(artifact),
      prNumbers: dedupeNumericList(artifact.source?.prNumbers ?? []),
    };
  }

  return {
    release: parsePublishedReleaseBody(release.body || ""),
    prNumbers: [],
  };
}

function collectIntermediaryDevReleases(
  tag,
  previousPublishedTag,
  publishedReleases,
) {
  return publishedReleases.filter((release) => {
    if (!release.prerelease || !release.tag_name.endsWith(DEV_SUFFIX)) {
      return false;
    }

    if (compareTags(release.tag_name, tag) >= 0) {
      return false;
    }

    if (!previousPublishedTag) {
      return true;
    }

    return compareTags(release.tag_name, previousPublishedTag) > 0;
  });
}

async function collectReleaseContext(
  tag,
  version,
  channel,
  {
    historicalPublishedTag = false,
    existingSource = null,
    existingReleaseArtifact = null,
  } = {},
) {
  let releaseReceipt;
  if (historicalPublishedTag) {
    if (!hasGitRef(tag)) {
      throw new Error(
        `Historical release backfill requires the published tag ${tag} to exist locally.`,
      );
    }
    releaseReceipt = historicalPublishedTagReceipt({
      channel,
      tagCommitSha: git(["rev-parse", `${tag}^{commit}`]),
      existingSource,
    });
  } else {
    const productCommitSha = git(["rev-parse", "HEAD"]);
    let promotedDevCommitSha = null;
    if (channel === "production") {
      promotedDevCommitSha = String(
        process.env.FREED_PROMOTED_DEV_COMMIT_SHA ?? "",
      ).trim();
      if (!/^[0-9a-f]{40,64}$/.test(promotedDevCommitSha)) {
        throw new Error(
          "Production release preparation requires FREED_PROMOTED_DEV_COMMIT_SHA from the exact validated origin/dev snapshot.",
        );
      }
      git(["cat-file", "-e", `${promotedDevCommitSha}^{commit}`]);
      const mismatches = listPromotionDiffFiles({
        fromRef: promotedDevCommitSha,
        toRef: productCommitSha,
        cwd: REPO_ROOT,
      });
      if (mismatches.length > 0) {
        throw new Error(
          `Production product state does not match promoted dev snapshot ${promotedDevCommitSha}: ${mismatches.join(", ")}.`,
        );
      }
    }
    releaseReceipt = releasePreparationReceipt({
      channel,
      productCommitSha,
      promotedDevCommitSha,
    });
  }
  const publishedReleases = await listPublishedReleases(channel);
  const allPublishedReleases =
    channel === "production"
      ? await listPublishedReleases("all")
      : publishedReleases;
  const dayKey = versionDayKey(version);
  const sameDayPublished = publishedReleases.filter(
    (release) => versionDayKey(release.tag_name.replace(/^v/, "")) === dayKey,
  );
  const previousPublished =
    [...publishedReleases]
      .filter((release) => compareTags(release.tag_name, tag) < 0)
      .pop() ?? null;
  let libraryCoreActivation = existingSource?.libraryCoreActivation ?? null;
  if (!historicalPublishedTag) {
    const previousPublishedTag = previousPublished?.tag_name ?? null;
    let previousSource = null;
    let previousArtifact = null;
    let previousTagCommitSha = null;
    if (previousPublishedTag !== null) {
      if (!/^v\d+\.\d+\.\d+(?:-dev)?$/.test(previousPublishedTag)) {
        throw new Error(
          `Previous published release tag is invalid: ${previousPublishedTag}.`,
        );
      }
      previousTagCommitSha = git([
        "rev-parse",
        `${previousPublishedTag}^{commit}`,
      ]);
      const previousInspection = previousReleaseInspection({
        tag: previousPublishedTag,
        channel,
      });
      previousSource = previousInspection.source;
      previousArtifact = previousInspection.artifact;
    }
    const activationRange = releaseInspectionRange({
      channel,
      previousPublishedTag,
      previousSource,
      previousTagCommitSha,
      productCommitSha: releaseReceipt.productCommitSha,
      isAncestor: gitIsAncestor,
    });
    const previousTagManifestRead =
      previousTagCommitSha === null
        ? { state: "absent" }
        : readGitPathAtRef({
            cwd: REPO_ROOT,
            ref: previousTagCommitSha,
            filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
          });
    const previousActivationWitness =
      inspectPreviousLibraryCoreActivationWitness({
        releaseArtifact: previousArtifact,
        tag: previousPublishedTag,
        manifestRead: previousTagManifestRead,
      });
    const previousManifestRead =
      activationRange.fromExclusiveCommitSha === null
        ? { state: "absent" }
        : readGitPathAtRef({
            cwd: REPO_ROOT,
            ref: activationRange.fromExclusiveCommitSha,
            filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
          });
    const currentManifestRead = readGitPathAtRef({
      cwd: REPO_ROOT,
      ref: releaseReceipt.productCommitSha,
      filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
    });
    if (currentManifestRead.state !== "present") {
      throw new Error(
        `${LIBRARY_CORE_ACTIVATION_MANIFEST_PATH} is missing from exact release source ${releaseReceipt.productCommitSha}.`,
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
    libraryCoreActivation = prepareLibraryCoreReleaseActivation({
      range: activationRange,
      manifestInspection,
      existingValue: existingSource?.libraryCoreActivation ?? null,
      releaseArtifact: existingReleaseArtifact,
    });
  }
  const previousPublishedDay = previousPublishedDayRelease(
    version,
    publishedReleases,
  );
  const isLatestOfDay =
    sameDayPublished.find(
      (release) => compareTags(release.tag_name, tag) > 0,
    ) === undefined;
  const priorSameDayReleases = collectPriorSameDayReleases(
    tag,
    dayKey,
    publishedReleases,
  );
  const intermediaryDevReleases =
    channel === "production"
      ? collectIntermediaryDevReleases(
          tag,
          previousPublished?.tag_name ?? null,
          allPublishedReleases,
        )
      : [];
  const priorCumulativeReleases = isLatestOfDay
    ? dedupePublishedReleases([
        ...priorSameDayReleases,
        ...intermediaryDevReleases,
      ])
    : [];
  const compareRef = hasGitRef(tag) ? tag : "HEAD";
  const rangeStart = isLatestOfDay
    ? previousPublishedDay?.tag_name
    : previousPublished?.tag_name;
  const range = rangeStart ? `${rangeStart}..${compareRef}` : compareRef;
  const subjects = git(["log", range, "--format=%s"])
    .split("\n")
    .map((subject) => subject.trim())
    .filter(Boolean);

  const entries = [];
  const prNumbers = new Set();
  const prDetailCount = subjects.filter((subject) =>
    /\(#(\d+)\)$/.test(subject),
  ).length;
  const shouldFetchPrDetails = prDetailCount <= MAX_PR_DETAILS;

  if (!shouldFetchPrDetails) {
    console.warn(
      `[prepare-release-notes] Skipping PR body fetches for ${prDetailCount.toLocaleString()} PRs. Set RELEASE_NOTES_MAX_PR_DETAILS to raise the cap.`,
    );
  }

  for (const subject of subjects) {
    const normalizedSubject = normalizeSubject(subject);
    if (/^(release:|docs:|test:|build:|ci:|Merge )/.test(normalizedSubject)) {
      continue;
    }

    const prMatch = subject.match(/\(#(\d+)\)$/);
    const prNumber = prMatch ? Number(prMatch[1]) : undefined;
    const fallback = stripPrefix(subject);
    const kind = releaseEntryKind(subject);

    let title = fallback;
    let details = [];

    if (prNumber && shouldFetchPrDetails) {
      prNumbers.add(prNumber);
      try {
        const pull = await fetchPull(prNumber);
        title = stripPrefix(pull.title || fallback);
        const preferredSections = [
          new Set(["## what changed"]),
          new Set(["## summary"]),
          new Set(["## impact"]),
        ];

        for (const headings of preferredSections) {
          details = parseDetails(extractSection(pull.body || "", headings));
          if (details.length > 0) {
            break;
          }
        }

        if (details.length === 0) {
          details = parseDetails(
            normalizeBodyText(pull.body || "").split("\n"),
          );
        }
      } catch {
        details = [];
      }
    } else if (prNumber) {
      prNumbers.add(prNumber);
    }

    entries.push({
      kind,
      prNumber: prNumber ?? null,
      subject,
      title,
      fallback,
      details,
    });
  }

  return {
    tag,
    version,
    channel,
    dayKey,
    compareRef,
    releaseReceipt,
    libraryCoreActivation,
    isLatestOfDay,
    previousPublishedTag: previousPublished?.tag_name ?? null,
    previousPublishedDayTag: previousPublishedDay?.tag_name ?? null,
    sameDayPublishedTags: sameDayPublished.map((release) => release.tag_name),
    priorSameDayReleases,
    intermediaryDevReleases,
    priorCumulativeReleases,
    relatedBuildTags: isLatestOfDay
      ? dedupeReleaseTags([
          ...priorCumulativeReleases.map((release) => release.tag_name),
          tag,
        ])
      : [tag],
    publishedReleases,
    commitSubjects: subjects,
    prNumbers: [...prNumbers].sort((a, b) => a - b),
    entries,
  };
}

function buildHeuristicRelease(context, existingDaily) {
  const pinnedTexts = normalizePinnedHighlightTexts(
    existingDaily?.pinnedHighlights ?? [],
  );

  const candidates = context.entries
    .map((entry, index) => {
      const text = chooseBestSummary(entry);
      return {
        text,
        kind: entry.kind,
        index,
        priority: releaseSummaryScore(text, entry.kind, pinnedTexts),
      };
    })
    .filter((candidate) => candidate.text);

  const sortedCandidates = [...candidates].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    return left.index - right.index;
  });

  const features = [];
  for (const candidate of sortedCandidates) {
    if (features.length >= MAX_FEATURES) {
      break;
    }
    if (candidate.kind !== "feature") {
      continue;
    }
    if (features.some((item) => areNearDuplicates(item, candidate.text))) {
      continue;
    }
    features.push(candidate.text);
  }

  const fixes = [];
  const followUps = [];
  for (const candidate of candidates) {
    if (features.some((item) => areNearDuplicates(item, candidate.text))) {
      continue;
    }
    if (candidate.kind === "fix") {
      if (fixes.some((item) => areNearDuplicates(item, candidate.text))) {
        continue;
      }
      fixes.push(candidate.text);
      continue;
    }
    if (followUps.some((item) => areNearDuplicates(item, candidate.text))) {
      continue;
    }
    followUps.push(candidate.text);
  }

  return withComputedDeck(
    {
      deck: pinnedTexts[0] ?? "",
      features,
      fixes,
      followUps,
    },
    context,
    existingDaily,
  );
}

function parseJsonContent(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

function validateStructuredNotes(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!value.release || typeof value.release !== "object") {
    return null;
  }

  return {
    release: sanitizeReleaseShape(value.release),
  };
}

async function generateWithOpenAI(promptInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const schema = {
    name: "freed_release_notes",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        release: {
          type: "object",
          additionalProperties: false,
          properties: {
            deck: { type: "string" },
            features: { type: "array", items: { type: "string" } },
            fixes: { type: "array", items: { type: "string" } },
            followUps: { type: "array", items: { type: "string" } },
          },
          required: ["deck", "features", "fixes", "followUps"],
        },
      },
      required: ["release"],
    },
  };

  const system = [
    "You write polished release notes for Freed.",
    "Return concise, professional release-note copy.",
    "Features must be executive-level, user-facing headline copy.",
    "Fixes are concrete bug repairs and corrections.",
    "Follow-ups are supporting changes that matter but are not headline features or direct bug-fix callouts.",
    "Fixes and Follow-ups must be comprehensive for the release but must not repeat the deck or the features.",
    "The deck must be a distinct opener and must not duplicate any bullet.",
    `Features must contain at most ${MAX_FEATURES.toLocaleString()} items.`,
    "When isLatestOfDay is true, the release must cumulatively describe everything new since the previous day.",
    "When channel is production, carry forward relevant dev prereleases shipped after the previous production release.",
    "Prefer installability, trust wins, and meaningful shipped behavior over internal implementation detail.",
    "Do not mention pull requests, commit hashes, internal tickets, or implementation trivia unless it materially changes the shipped product.",
  ].join(" ");

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `Summarize this release context as strict JSON.\n${JSON.stringify(promptInput, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: schema,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error ${response.status}: ${await response.text()}`,
      );
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    return validateStructuredNotes(parseJsonContent(raw));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `OpenAI release-note generation timed out after ${OPENAI_TIMEOUT_MS.toLocaleString()}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function main() {
  const { input, force, historicalPublishedTag } = parseArguments(
    process.argv.slice(2),
  );

  mkdirp(RELEASES_DIR);
  mkdirp(path.join(DAILY_DIR, "production"));
  mkdirp(path.join(DAILY_DIR, "dev"));

  const version = input.replace(/^v/, "");
  const tag = `v${version}`;
  const channel = channelFromVersion(version);
  const dayKey = versionDayKey(version);
  const releaseFile = releasePaths(tag);
  const existingRelease = readJsonIfExists(releaseFile.json);

  if (existingRelease?.approved && !force) {
    console.log(
      `${tag} already has an approved release file. Leaving it untouched.`,
    );
    return;
  }

  const existingDaily =
    readDailyArtifact(dayKey, channel) ??
    defaultDailyEditorial(dayKey, version, channel);
  const context = await collectReleaseContext(tag, version, channel, {
    historicalPublishedTag,
    existingSource: existingRelease?.source ?? null,
    existingReleaseArtifact: existingRelease,
  });
  const existingSeedRelease = releaseFromArtifact(existingRelease);
  const heuristicRelease = buildHeuristicRelease(context, existingDaily);
  const draftSeedRelease = releaseHasContent(heuristicRelease)
    ? heuristicRelease
    : existingSeedRelease;
  const carriedForwardSummaries = context.priorCumulativeReleases
    .map((release) => loadPublishedReleaseSummary(release))
    .filter((summary) => releaseHasContent(summary.release));
  const carriedForwardReleases = carriedForwardSummaries.map(
    (summary) => summary.release,
  );
  const previousDayRelease =
    channel === "dev" && context.previousPublishedDayTag
      ? loadPublishedReleaseSummary({
          tag_name: context.previousPublishedDayTag,
        }).release
      : null;
  const cumulativePrNumbers = dedupeNumericList([
    ...context.prNumbers,
    ...carriedForwardSummaries.flatMap((summary) => summary.prNumbers),
  ]);
  const cumulativeDraftRelease = context.isLatestOfDay
    ? withComputedDeck(
        mergePriorSameDayReleases(draftSeedRelease, carriedForwardReleases),
        context,
        existingDaily,
      )
    : withComputedDeck(draftSeedRelease, context, existingDaily);

  const promptInput = {
    release: {
      tag,
      version,
      channel,
      dayKey,
      isLatestOfDay: context.isLatestOfDay,
      previousPublishedTag: context.previousPublishedTag,
      previousPublishedDayTag: context.previousPublishedDayTag,
      sameDayTagsIncluded: context.isLatestOfDay
        ? [
            ...context.sameDayPublishedTags.filter(
              (sameDayTag) => compareTags(sameDayTag, tag) < 0,
            ),
            tag,
          ]
        : [tag],
      relatedBuildTags: context.relatedBuildTags,
      commitSubjects: context.commitSubjects,
      sourceItems: context.entries.map((entry) => ({
        kind: entry.kind,
        prNumber: entry.prNumber,
        title: entry.title,
        fallback: entry.fallback,
        details: entry.details.slice(0, 5),
      })),
      priorSameDayReleases: carriedForwardReleases,
      intermediaryBuildTags: context.intermediaryDevReleases.map(
        (release) => release.tag_name,
      ),
      editorialGuidance: existingDaily.editorialGuidance,
      pinnedHighlights: existingDaily.pinnedHighlights,
      editorialNotes: existingDaily.editorialNotes,
      currentHeuristicDraft: cumulativeDraftRelease,
    },
  };

  let structured = null;
  try {
    structured = await generateWithOpenAI(promptInput);
  } catch (error) {
    console.warn(
      `[prepare-release-notes] OpenAI generation failed, using fallback. ${error}`,
    );
  }

  const draftedRelease = sanitizeReleaseShape(
    structured?.release ?? cumulativeDraftRelease,
  );
  const generatedRelease = withComputedDeck(
    context.isLatestOfDay
      ? mergePriorSameDayReleases(draftedRelease, carriedForwardReleases)
      : draftedRelease,
    context,
    existingDaily,
  );
  const finalRelease = previousDayRelease
    ? withComputedDeck(
        removePreviousDayFeatureRepeats(generatedRelease, previousDayRelease),
        context,
        existingDaily,
      )
    : generatedRelease;
  const releaseWithPinnedHighlights = applyPinnedHighlightsToRelease(
    finalRelease,
    existingDaily.pinnedHighlights ?? [],
  );
  const validation = validateReleaseShape(releaseWithPinnedHighlights, {
    earlierReleases: context.isLatestOfDay ? carriedForwardReleases : [],
    previousDayRelease,
    allowEarlierItemOmission: channel === "production",
  });

  if (validation.errors.length > 0) {
    console.error("[prepare-release-notes] Generated invalid release notes:");
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const nextSource = {
    channel,
    previousPublishedTag: context.previousPublishedTag,
    previousPublishedDayTag: context.previousPublishedDayTag,
    compareRef: context.compareRef,
    ...context.releaseReceipt,
    ...(context.libraryCoreActivation === null
      ? {}
      : { libraryCoreActivation: context.libraryCoreActivation }),
    isLatestOfDay: context.isLatestOfDay,
    sameDayTagsIncluded: context.isLatestOfDay
      ? [
          ...context.sameDayPublishedTags.filter(
            (sameDayTag) => compareTags(sameDayTag, tag) < 0,
          ),
          tag,
        ]
      : [tag],
    relatedBuildTags: context.relatedBuildTags,
    prNumbers: cumulativePrNumbers,
    commitSubjects: context.commitSubjects,
  };
  const shouldKeepApproval = releaseArtifactsMatch(
    existingRelease,
    validation.normalizedRelease,
    nextSource,
  );

  const releaseArtifact = {
    ...(existingRelease ??
      defaultReleaseArtifact(tag, version, dayKey, channel)),
    tag,
    version,
    channel,
    dayKey,
    approved:
      Boolean(existingRelease?.approved) &&
      (historicalPublishedTag || shouldKeepApproval),
    editorialNotes: existingRelease?.editorialNotes ?? [],
    generatedAt: new Date().toISOString(),
    model: structured ? OPENAI_MODEL : "heuristic",
    source: nextSource,
    release: validation.normalizedRelease,
    releaseBody: renderReleaseBody(tag, validation.normalizedRelease),
  };

  const dailyArtifact = {
    channel,
    dayKey,
    date: existingDaily.date ?? dayDateFromVersion(version),
    preferredDeck: existingDaily.preferredDeck ?? null,
    editorialGuidance:
      existingDaily.editorialGuidance ??
      defaultDailyEditorial(dayKey, version, channel).editorialGuidance,
    pinnedHighlights: existingDaily.pinnedHighlights ?? [],
    editorialNotes: existingDaily.editorialNotes ?? [],
    updatedAt: new Date().toISOString(),
  };

  withReleaseArtifactWriteLock(releaseFile.json, () => {
    writeFileSync(
      releaseFile.json,
      `${JSON.stringify(releaseArtifact, null, 2)}\n`,
    );
    writeFileSync(releaseFile.markdown, releaseArtifact.releaseBody);
    writeFileSync(
      dailyPath(dayKey, channel),
      `${JSON.stringify(dailyArtifact, null, 2)}\n`,
    );
  });

  console.log(`Prepared release notes for ${tag}`);
  console.log(`- ${path.relative(REPO_ROOT, releaseFile.json)}`);
  console.log(`- ${path.relative(REPO_ROOT, releaseFile.markdown)}`);
  console.log(`- ${path.relative(REPO_ROOT, dailyPath(dayKey, channel))}`);
}

main()
  .then(() => {
    // Node's fetch implementation can leave connection handles open long enough
    // to wedge release.sh after all files have already been written.
    process.exit(0);
  })
  .catch((error) => {
    console.error("[prepare-release-notes] Failed.");
    console.error(error);
    process.exit(1);
  });
