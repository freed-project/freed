#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
    return execFileSync("gh", ["auth", "token"], {
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

function versionDayKey(version) {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return version;
  }

  const [yy, month, patch] = parts;
  const day = Math.floor(Number(patch) / 100);
  return `${yy}.${month}.${day}`;
}

function dayDateFromVersion(version) {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [yy, month, patch] = parts;
  const day = Math.floor(Number(patch) / 100);
  const year = 2000 + Number(yy);
  const date = new Date(Date.UTC(year, Number(month) - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeSubject(subject) {
  return subject.replace(/^(?:\[[^\]]+\]\s*)+/, "").trim();
}

function commitKind(subject) {
  const normalized = normalizeSubject(subject);
  const match = normalized.match(
    /^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:/,
  );
  return match?.[1] ?? "";
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

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
  return body.replace(/\r\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
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
      const normalized = text.charAt(0).toUpperCase() + text.slice(1);
      if (!details.includes(normalized)) {
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
        const normalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        if (!details.includes(normalized)) {
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

function dedupeStrings(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item.trim());
  }

  return result;
}

function limitSectionItems(
  sections,
  limits = { whatsNew: 5, fixes: 6, performance: 3 },
) {
  return {
    ...sections,
    whatsNew: sections.whatsNew.slice(0, limits.whatsNew),
    fixes: sections.fixes.slice(0, limits.fixes),
    performance: sections.performance.slice(0, limits.performance),
  };
}

function summarizeFallbackText(text) {
  const trimmed = text.trim().replace(/[.]$/, "");
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

function parseReleaseBody(body) {
  const features = [];
  const fixes = [];
  const performance = [];
  const prNumbers = [];

  const normalizedBody = normalizeBodyText(body);
  const sectionRegex = /###\s+(.+?)\n([\s\S]*?)(?=\n###|\n##|$)/g;
  let match;

  while ((match = sectionRegex.exec(normalizedBody)) !== null) {
    const heading = match[1].trim().toLowerCase();
    const content = match[2];
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));

    const items = lines.map((line) => {
      const text = line
        .replace(/^- /, "")
        .replace(/\[#(\d+)\]\([^)]+\)/g, (_, num) => {
          prNumbers.push(Number(num));
          return `#${num}`;
        })
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();

      return summarizeFallbackText(
        text.replace(/\s*\(#\d+\)$/, "").replace(/\s*#\d+$/, "").trim(),
      );
    });

    if (heading.includes("new") || heading.includes("feat")) {
      features.push(...items);
      continue;
    }

    if (heading.includes("fix")) {
      fixes.push(...items);
      continue;
    }

    if (heading.includes("perf")) {
      performance.push(...items);
    }
  }

  return {
    features: dedupeStrings(features),
    fixes: dedupeStrings(fixes.filter((item) => item.toLowerCase() !== "bug fixes and improvements")),
    performance: dedupeStrings(performance),
    prNumbers: [...new Set(prNumbers)].sort((a, b) => a - b),
  };
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

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

function defaultDailyEditorial(dayKey, version) {
  return {
    dayKey,
    date: dayDateFromVersion(version),
    editorialGuidance: [
      "Keep the tone concise, professional, and specific.",
      "Lead with user-facing outcomes, shipping milestones, trust wins, and installability improvements.",
      "Demote internal cleanup unless it clearly changes the shipped product.",
    ],
    pinnedHighlights: [],
    editorialNotes: [],
    rollup: {
      summary: "",
      whatsNew: [],
      fixes: [],
      performance: [],
    },
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
      compareRef: "HEAD",
      prNumbers: [],
      commitSubjects: [],
    },
    release: {
      summary: "",
      whatsNew: [],
      fixes: [],
      performance: [],
    },
    releaseBody: "",
  };
}

function renderReleaseBody(tag, release) {
  const lines = ["(AI Generated).", "", `## Freed ${tag}`, ""];

  if (release.summary) {
    lines.push(release.summary, "");
  }

  if (release.whatsNew.length > 0) {
    lines.push("### What's New", "");
    for (const item of release.whatsNew) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (release.performance.length > 0) {
    lines.push("### Performance", "");
    for (const item of release.performance) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (release.fixes.length > 0) {
    lines.push("### Fixes", "");
    for (const item of release.fixes) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (
    release.whatsNew.length === 0 &&
    release.performance.length === 0 &&
    release.fixes.length === 0
  ) {
    lines.push("### Fixes", "", "- Bug fixes and improvements", "");
  }

  lines.push("### Downloads", "");
  lines.push("**macOS:** `.dmg` (Apple Silicon or Intel, signed + notarized)  ");
  lines.push("**Windows:** `.exe` (NSIS installer)  ");
  lines.push("**Linux:** `.AppImage`  ");
  lines.push("");
  lines.push("> macOS downloads are signed and notarized for normal Gatekeeper installation.");

  return `${lines.join("\n").trim()}\n`;
}

async function listPublishedReleases() {
  const headers = githubHeaders();
  const releases = await fetchJson(
    `${GITHUB_API}/repos/freed-project/freed/releases?per_page=100`,
    headers,
  );

  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .sort((a, b) => a.tag_name.localeCompare(b.tag_name, undefined, { numeric: true }));
}

async function fetchPull(prNumber) {
  const headers = githubHeaders();
  return fetchJson(`${GITHUB_API}/repos/freed-project/freed/pulls/${prNumber}`, headers);
}

async function collectCurrentReleaseContext(tag, version) {
  const publishedReleases = await listPublishedReleases();
  const previousPublished = [...publishedReleases]
    .filter((release) => release.tag_name.localeCompare(tag, undefined, { numeric: true }) < 0)
    .pop();
  const compareRef = hasGitRef(tag) ? tag : "HEAD";
  const range = previousPublished ? `${previousPublished.tag_name}..${compareRef}` : compareRef;
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
    const fallback = summarizeFallbackText(stripPrefix(subject));
    const kind = commitKind(subject) === "feat"
      ? "whatsNew"
      : commitKind(subject) === "perf"
        ? "performance"
        : "fixes";

    let title = fallback;
    let details = [];

    if (prNumber) {
      prNumbers.add(prNumber);
      try {
        const pull = await fetchPull(prNumber);
        title = summarizeFallbackText(pull.title || fallback);
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
    dayKey: versionDayKey(version),
    previousPublishedTag: previousPublished?.tag_name ?? null,
    compareRef,
    commitSubjects: subjects,
    prNumbers: [...prNumbers].sort((a, b) => a - b),
    entries,
    publishedReleases,
  };
}

function releaseSectionsFromParsed(parsed, summary = "") {
  return {
    summary,
    whatsNew: parsed.features,
    fixes: parsed.fixes,
    performance: parsed.performance,
  };
}

function releaseItemsFromEntries(entries) {
  const sections = { summary: "", whatsNew: [], fixes: [], performance: [] };

  for (const entry of entries) {
    const text = entry.details[0] || entry.title || entry.fallback;
    sections[entry.kind].push(summarizeFallbackText(text));
  }

  sections.whatsNew = dedupeStrings(sections.whatsNew);
  sections.fixes = dedupeStrings(sections.fixes.filter((item) => item.toLowerCase() !== "bug fixes and improvements"));
  sections.performance = dedupeStrings(sections.performance);
  sections.summary = sections.whatsNew[0] || sections.fixes[0] || sections.performance[0] || "";
  return limitSectionItems(sections, { whatsNew: 4, fixes: 4, performance: 2 });
}

function pinHighlights(sections, pinnedHighlights) {
  if (!Array.isArray(pinnedHighlights) || pinnedHighlights.length === 0) {
    return sections;
  }

  const pinnedTexts = dedupeStrings(
    pinnedHighlights
      .map((item) => typeof item?.text === "string" ? item.text.trim() : "")
      .filter(Boolean),
  );

  if (pinnedTexts.length === 0) {
    return sections;
  }

  const existing = [...sections.whatsNew];
  const pinned = [];

  for (const text of pinnedTexts) {
    const idx = existing.findIndex((item) => item.toLowerCase() === text.toLowerCase());
    if (idx >= 0) {
      pinned.push(existing.splice(idx, 1)[0]);
    } else {
      pinned.push(text);
    }
  }

  return {
    ...sections,
    summary: pinned[0] || sections.summary,
    whatsNew: dedupeStrings([...pinned, ...existing]),
  };
}

function buildDailyFallback(context, currentReleaseSections, existingDaily, publishedReleases) {
  const sameDayReleases = publishedReleases.filter(
    (release) => versionDayKey(release.tag_name.replace(/^v/, "")) === context.dayKey,
  );

  const combined = {
    summary: existingDaily?.rollup?.summary || currentReleaseSections.summary,
    whatsNew: [...currentReleaseSections.whatsNew],
    fixes: [...currentReleaseSections.fixes],
    performance: [...currentReleaseSections.performance],
  };

  for (const release of sameDayReleases) {
    const parsed = parseReleaseBody(release.body || "");
    combined.whatsNew.push(...parsed.features);
    combined.fixes.push(...parsed.fixes);
    combined.performance.push(...parsed.performance);
  }

  combined.whatsNew = dedupeStrings(combined.whatsNew);
  combined.fixes = dedupeStrings(combined.fixes.filter((item) => item.toLowerCase() !== "bug fixes and improvements"));
  combined.performance = dedupeStrings(combined.performance);
  combined.summary =
    existingDaily?.rollup?.summary ||
    combined.whatsNew[0] ||
    combined.fixes[0] ||
    combined.performance[0] ||
    "";

  return limitSectionItems(
    pinHighlights(combined, existingDaily?.pinnedHighlights ?? []),
  );
}

function parseJsonContent(raw) {
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned);
}

function validateStructuredNotes(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const ensureArray = (items) =>
    Array.isArray(items) ? dedupeStrings(items.filter((item) => typeof item === "string")) : [];

  const release = value.release && typeof value.release === "object"
    ? {
        summary: typeof value.release.summary === "string" ? value.release.summary.trim() : "",
        whatsNew: ensureArray(value.release.whatsNew),
        fixes: ensureArray(value.release.fixes),
        performance: ensureArray(value.release.performance),
      }
    : null;

  const dailyRollup = value.dailyRollup && typeof value.dailyRollup === "object"
    ? {
        summary: typeof value.dailyRollup.summary === "string" ? value.dailyRollup.summary.trim() : "",
        whatsNew: ensureArray(value.dailyRollup.whatsNew),
        fixes: ensureArray(value.dailyRollup.fixes),
        performance: ensureArray(value.dailyRollup.performance),
      }
    : null;

  if (!release || !dailyRollup) {
    return null;
  }

  return {
    release: limitSectionItems(release, { whatsNew: 4, fixes: 4, performance: 2 }),
    dailyRollup: limitSectionItems(dailyRollup),
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
            summary: { type: "string" },
            whatsNew: { type: "array", items: { type: "string" } },
            fixes: { type: "array", items: { type: "string" } },
            performance: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "whatsNew", "fixes", "performance"],
        },
        dailyRollup: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string" },
            whatsNew: { type: "array", items: { type: "string" } },
            fixes: { type: "array", items: { type: "string" } },
            performance: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "whatsNew", "fixes", "performance"],
        },
      },
      required: ["release", "dailyRollup"],
    },
  };

  const system = [
    "You write polished release notes for Freed.",
    "Return concise, professional release-note copy.",
    "Prefer user-facing outcomes, trust wins, installability improvements, and shipping milestones over internal implementation detail.",
    "If the daily editorial guidance or pinned highlights call out an important theme, keep that theme prominent in the daily rollup even if later builds are smaller.",
    "Each bullet should be one sentence fragment, not a paragraph.",
    "Do not mention pull requests, commit hashes, internal tickets, or implementation trivia unless it materially changes the shipped product.",
    "Avoid marketing fluff and avoid sounding robotic.",
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

async function main() {
  const input = process.argv[2];
  if (!input) {
    die("Usage: node scripts/prepare-release-notes.mjs <version-or-tag>");
  }

  mkdirp(RELEASES_DIR);
  mkdirp(DAILY_DIR);

  const version = input.replace(/^v/, "");
  const tag = `v${version}`;
  const dayKey = versionDayKey(version);
  const releaseFile = releasePaths(tag);
  const existingRelease = readJsonIfExists(releaseFile.json);
  if (existingRelease?.approved) {
    console.log(`${tag} already has an approved release file. Leaving it untouched.`);
    return;
  }

  const existingDaily = readJsonIfExists(dailyPath(dayKey)) ?? defaultDailyEditorial(dayKey, version);
  const context = await collectCurrentReleaseContext(tag, version);
  const fallbackRelease = releaseItemsFromEntries(context.entries);
  const fallbackDaily = buildDailyFallback(
    context,
    fallbackRelease,
    existingDaily,
    context.publishedReleases,
  );

  const promptInput = {
    release: {
      tag,
      version,
      dayKey,
      previousPublishedTag: context.previousPublishedTag,
      commitSubjects: context.commitSubjects,
      sourceItems: context.entries.map((entry) => ({
        kind: entry.kind,
        prNumber: entry.prNumber,
        title: entry.title,
        fallback: entry.fallback,
        details: entry.details.slice(0, 5),
      })),
      currentHeuristicDraft: fallbackRelease,
    },
    daily: {
      dayKey,
      editorialGuidance: existingDaily.editorialGuidance,
      pinnedHighlights: existingDaily.pinnedHighlights,
      editorialNotes: existingDaily.editorialNotes,
      previousRollup: existingDaily.rollup,
      publishedReleasesForDay: context.publishedReleases
        .filter((release) => versionDayKey(release.tag_name.replace(/^v/, "")) === dayKey)
        .map((release) => ({
          tag: release.tag_name,
          bodySections: releaseSectionsFromParsed(parseReleaseBody(release.body || "")),
        })),
      fallbackRollup: fallbackDaily,
    },
  };

  let structured = null;
  try {
    structured = await generateWithOpenAI(promptInput);
  } catch (error) {
    console.warn(`[prepare-release-notes] OpenAI generation failed, using fallback. ${error}`);
  }

  const releaseSections = pinHighlights(
    structured?.release ?? fallbackRelease,
    [],
  );
  const dailyRollup = pinHighlights(
    structured?.dailyRollup ?? fallbackDaily,
    existingDaily.pinnedHighlights ?? [],
  );

  const releaseArtifact = {
    ...(existingRelease ?? defaultReleaseArtifact(tag, version, dayKey)),
    tag,
    version,
    dayKey,
    approved: existingRelease?.approved ?? false,
    editorialNotes: existingRelease?.editorialNotes ?? [],
    generatedAt: new Date().toISOString(),
    model: structured ? OPENAI_MODEL : "heuristic",
    source: {
      previousPublishedTag: context.previousPublishedTag,
      compareRef: context.compareRef,
      prNumbers: context.prNumbers,
      commitSubjects: context.commitSubjects,
    },
    release: releaseSections,
    releaseBody: renderReleaseBody(tag, releaseSections),
  };

  const dailyArtifact = {
    ...existingDaily,
    dayKey,
    date: existingDaily.date ?? dayDateFromVersion(version),
    updatedAt: new Date().toISOString(),
    rollup: dailyRollup,
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
