#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  areNearDuplicates,
  buildReleaseDeck,
  compareTags,
  dayDateFromVersion,
  MAX_FEATURES,
  normalizeReleaseText,
  renderReleaseBody,
  sanitizeReleaseShape,
  summarizeFallbackText,
  validateReleaseShape,
  versionDayKey,
} from "./release-notes-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const RELEASE_NOTES_DIR = path.join(REPO_ROOT, "release-notes");
const RELEASES_DIR = path.join(RELEASE_NOTES_DIR, "releases");
const DAILY_DIR = path.join(RELEASE_NOTES_DIR, "daily");

const GITHUB_API = "https://api.github.com";
const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_RELEASE_NOTES_MODEL || "gpt-5.4";

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
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || maybeGhToken();
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
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

function normalizeSubject(subject) {
  return subject.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim();
}

function isExactDuplicateText(a, b) {
  return normalizeReleaseText(a).toLowerCase() === normalizeReleaseText(b).toLowerCase();
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
      !["Includes", "Include", "Summary", "What changed", "Impact"].includes(text)
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

function dailyPath(dayKey) {
  return path.join(DAILY_DIR, `${dayKey}.json`);
}

function defaultDailyEditorial(dayKey, version) {
  return {
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

function defaultReleaseArtifact(tag, version, dayKey) {
  return {
    tag,
    version,
    dayKey,
    approved: false,
    editorialNotes: [],
    generatedAt: null,
    model: null,
    source: {
      previousPublishedTag: null,
      previousPublishedDayTag: null,
      compareRef: "HEAD",
      isLatestOfDay: true,
      sameDayTagsIncluded: [],
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

      if (!merged.followUps.some((followUp) => areNearDuplicates(followUp, item))) {
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
    previousPublishedTag: existingArtifact.source?.previousPublishedTag ?? null,
    previousPublishedDayTag: existingArtifact.source?.previousPublishedDayTag ?? null,
    compareRef: existingArtifact.source?.compareRef ?? "HEAD",
    isLatestOfDay: Boolean(existingArtifact.source?.isLatestOfDay),
    sameDayTagsIncluded: existingArtifact.source?.sameDayTagsIncluded ?? [],
    prNumbers: existingArtifact.source?.prNumbers ?? [],
    commitSubjects: existingArtifact.source?.commitSubjects ?? [],
  };

  return (
    JSON.stringify(existingRelease) === JSON.stringify(nextRelease) &&
    JSON.stringify(existingSource) === JSON.stringify(nextSource)
  );
}

function compareReleases(a, b) {
  return compareTags(a.tag_name, b.tag_name);
}

async function listPublishedReleases() {
  const headers = githubHeaders();
  const releases = await fetchJson(
    `${GITHUB_API}/repos/freed-project/freed/releases?per_page=100`,
    headers,
  );

  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .sort(compareReleases);
}

async function fetchPull(prNumber) {
  const headers = githubHeaders();
  return fetchJson(`${GITHUB_API}/repos/freed-project/freed/pulls/${prNumber}`, headers);
}

function parseArguments(argv) {
  const force = argv.includes("--force");
  const positional = argv.filter((arg) => arg !== "--force");

  if (positional.length !== 1) {
    die("Usage: node scripts/prepare-release-notes.mjs <version-or-tag> [--force]");
  }

  return {
    input: positional[0],
    force,
  };
}

function previousPublishedDayRelease(version, publishedReleases) {
  const dayKey = versionDayKey(version);

  return [...publishedReleases]
    .filter((release) => versionDayKey(release.tag_name.replace(/^v/, "")) < dayKey)
    .pop() ?? null;
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
  const candidates = [
    entry.title,
    ...(entry.details ?? []),
    entry.fallback,
  ]
    .map((candidate) => summarizeFallbackText(candidate))
    .filter(Boolean);

  return candidates[0] ?? summarizeFallbackText(entry.fallback || entry.title || "");
}

function collectPriorSameDayReleases(tag, dayKey, publishedReleases) {
  return publishedReleases.filter(
    (release) =>
      versionDayKey(release.tag_name.replace(/^v/, "")) === dayKey &&
      compareTags(release.tag_name, tag) < 0,
  );
}

async function collectReleaseContext(tag, version) {
  const publishedReleases = await listPublishedReleases();
  const dayKey = versionDayKey(version);
  const sameDayPublished = publishedReleases.filter(
    (release) => versionDayKey(release.tag_name.replace(/^v/, "")) === dayKey,
  );
  const previousPublished = [...publishedReleases]
    .filter((release) => compareTags(release.tag_name, tag) < 0)
    .pop() ?? null;
  const previousPublishedDay = previousPublishedDayRelease(version, publishedReleases);
  const isLatestOfDay =
    sameDayPublished.find((release) => compareTags(release.tag_name, tag) > 0) === undefined;
  const compareRef = hasGitRef(tag) ? tag : "HEAD";
  const rangeStart = isLatestOfDay ? previousPublishedDay?.tag_name : previousPublished?.tag_name;
  const range = rangeStart ? `${rangeStart}..${compareRef}` : compareRef;
  const subjects = git(["log", range, "--format=%s"])
    .split("\n")
    .map((subject) => subject.trim())
    .filter(Boolean);

  const entries = [];
  const prNumbers = new Set();

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

    if (prNumber) {
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
          details = parseDetails(normalizeBodyText(pull.body || "").split("\n"));
        }
      } catch {
        details = [];
      }
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
    dayKey,
    compareRef,
    isLatestOfDay,
    previousPublishedTag: previousPublished?.tag_name ?? null,
    previousPublishedDayTag: previousPublishedDay?.tag_name ?? null,
    sameDayPublishedTags: sameDayPublished.map((release) => release.tag_name),
    priorSameDayReleases: collectPriorSameDayReleases(tag, dayKey, publishedReleases),
    publishedReleases,
    commitSubjects: subjects,
    prNumbers: [...prNumbers].sort((a, b) => a - b),
    entries,
  };
}

function buildHeuristicRelease(context, existingDaily) {
  const pinnedTexts = (existingDaily?.pinnedHighlights ?? [])
    .map((item) => summarizeFallbackText(item?.text ?? ""))
    .filter(Boolean);

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

  return withComputedDeck({
    deck: pinnedTexts[0] ?? "",
    features,
    fixes,
    followUps,
  }, context, existingDaily);
}

function parseJsonContent(raw) {
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
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
    "Prefer installability, trust wins, and meaningful shipped behavior over internal implementation detail.",
    "Do not mention pull requests, commit hashes, internal tickets, or implementation trivia unless it materially changes the shipped product.",
  ].join(" ");

  const response = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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
    throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  return validateStructuredNotes(parseJsonContent(raw));
}

function loadPriorSameDayArtifact(release) {
  const artifact = readJsonIfExists(releasePaths(release.tag_name).json);
  if (artifact?.release) {
    return releaseFromArtifact(artifact);
  }

  return null;
}

async function main() {
  const { input, force } = parseArguments(process.argv.slice(2));

  mkdirp(RELEASES_DIR);
  mkdirp(DAILY_DIR);

  const version = input.replace(/^v/, "");
  const tag = `v${version}`;
  const dayKey = versionDayKey(version);
  const releaseFile = releasePaths(tag);
  const existingRelease = readJsonIfExists(releaseFile.json);

  if (existingRelease?.approved && !force) {
    console.log(`${tag} already has an approved release file. Leaving it untouched.`);
    return;
  }

  const existingDaily = readJsonIfExists(dailyPath(dayKey)) ?? defaultDailyEditorial(dayKey, version);
  const context = await collectReleaseContext(tag, version);
  const existingSeedRelease = releaseFromArtifact(existingRelease);
  const heuristicRelease = buildHeuristicRelease(context, existingDaily);
  const draftSeedRelease = releaseHasContent(heuristicRelease)
    ? heuristicRelease
    : existingSeedRelease;
  const earlierSameDayArtifacts = context.priorSameDayReleases
    .map((release) => loadPriorSameDayArtifact(release))
    .filter(Boolean);
  const cumulativeDraftRelease = context.isLatestOfDay
    ? withComputedDeck(
        mergePriorSameDayReleases(draftSeedRelease, earlierSameDayArtifacts),
        context,
        existingDaily,
      )
    : withComputedDeck(draftSeedRelease, context, existingDaily);

  const promptInput = {
    release: {
      tag,
      version,
      dayKey,
      isLatestOfDay: context.isLatestOfDay,
      previousPublishedTag: context.previousPublishedTag,
      previousPublishedDayTag: context.previousPublishedDayTag,
      sameDayTagsIncluded: context.isLatestOfDay
        ? [...context.sameDayPublishedTags.filter((sameDayTag) => compareTags(sameDayTag, tag) < 0), tag]
        : [tag],
      commitSubjects: context.commitSubjects,
      sourceItems: context.entries.map((entry) => ({
        kind: entry.kind,
        prNumber: entry.prNumber,
        title: entry.title,
        fallback: entry.fallback,
        details: entry.details.slice(0, 5),
      })),
      priorSameDayReleases: earlierSameDayArtifacts,
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
    console.warn(`[prepare-release-notes] OpenAI generation failed, using fallback. ${error}`);
  }

  const draftedRelease = sanitizeReleaseShape(structured?.release ?? cumulativeDraftRelease);
  const finalRelease = withComputedDeck(
    context.isLatestOfDay
      ? mergePriorSameDayReleases(draftedRelease, earlierSameDayArtifacts)
      : draftedRelease,
    context,
    existingDaily,
  );
  const validation = validateReleaseShape(finalRelease, {
    earlierReleases: context.isLatestOfDay ? earlierSameDayArtifacts : [],
  });

  if (validation.errors.length > 0) {
    console.error("[prepare-release-notes] Generated invalid release notes:");
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const nextSource = {
    previousPublishedTag: context.previousPublishedTag,
    previousPublishedDayTag: context.previousPublishedDayTag,
    compareRef: context.compareRef,
    isLatestOfDay: context.isLatestOfDay,
    sameDayTagsIncluded: context.isLatestOfDay
      ? [...context.sameDayPublishedTags.filter((sameDayTag) => compareTags(sameDayTag, tag) < 0), tag]
      : [tag],
    prNumbers: context.prNumbers,
    commitSubjects: context.commitSubjects,
  };
  const shouldKeepApproval = releaseArtifactsMatch(
    existingRelease,
    validation.normalizedRelease,
    nextSource,
  );

  const releaseArtifact = {
    ...(existingRelease ?? defaultReleaseArtifact(tag, version, dayKey)),
    tag,
    version,
    dayKey,
    approved: Boolean(existingRelease?.approved) && shouldKeepApproval,
    editorialNotes: existingRelease?.editorialNotes ?? [],
    generatedAt: new Date().toISOString(),
    model: structured ? OPENAI_MODEL : "heuristic",
    source: nextSource,
    release: validation.normalizedRelease,
    releaseBody: renderReleaseBody(tag, validation.normalizedRelease),
  };

  const dailyArtifact = {
    dayKey,
    date: existingDaily.date ?? dayDateFromVersion(version),
    preferredDeck: existingDaily.preferredDeck ?? null,
    editorialGuidance: existingDaily.editorialGuidance ?? defaultDailyEditorial(dayKey, version).editorialGuidance,
    pinnedHighlights: existingDaily.pinnedHighlights ?? [],
    editorialNotes: existingDaily.editorialNotes ?? [],
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(releaseFile.json, `${JSON.stringify(releaseArtifact, null, 2)}\n`);
  writeFileSync(releaseFile.markdown, releaseArtifact.releaseBody);
  writeFileSync(dailyPath(dayKey), `${JSON.stringify(dailyArtifact, null, 2)}\n`);

  console.log(`Prepared release notes for ${tag}`);
  console.log(`- ${path.relative(REPO_ROOT, releaseFile.json)}`);
  console.log(`- ${path.relative(REPO_ROOT, releaseFile.markdown)}`);
  console.log(`- ${path.relative(REPO_ROOT, dailyPath(dayKey))}`);
}

main().catch((error) => {
  console.error("[prepare-release-notes] Failed.");
  console.error(error);
  process.exit(1);
});
