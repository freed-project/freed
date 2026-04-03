export const MAX_FEATURES = 3;
export const MAX_FIXES = 15;
export const MAX_FOLLOW_UPS = 15;
const MAX_DECK_PHRASES = 3;

const STOP_WORDS = new Set([
  "a",
  "add",
  "an",
  "and",
  "as",
  "at",
  "correct",
  "clarify",
  "for",
  "fix",
  "from",
  "improve",
  "in",
  "into",
  "make",
  "move",
  "of",
  "on",
  "or",
  "remove",
  "resolve",
  "restore",
  "set",
  "simplify",
  "switch",
  "the",
  "to",
  "update",
  "use",
  "with",
]);

const DECK_FILLER_WORDS = new Set([
  "actual",
  "better",
  "cleaner",
  "explicit",
  "formal",
  "improved",
  "professional",
  "proper",
  "real",
  "reviewed",
]);

const COMMON_ITEM_PREFIX =
  /^(feat|fix|perf|refactor|style|chore|docs|test|build|ci)(\([^)]+\))?!?:\s*/i;

const SECTION_CONSOLIDATIONS = {
  fix: {
    build: "Release build and type-safety cleanup",
    capture: "Capture and scraper reliability fixes",
    ui: "Reader, feed, and header polish",
    sync: "Sync and update reliability fixes",
    tests: "Test coverage and performance hardening",
    content: "Copy and documentation cleanup",
  },
  followUp: {
    build: "Release workflow and build-system work",
    capture: "Capture, login, and scraping platform work",
    ui: "Reader, sidebar, and settings UX work",
    sync: "Sync, cloud, and pairing infrastructure",
    tests: "Testing, diagnostics, and developer tooling",
    content: "Content and documentation work",
  },
};

export function compareTags(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function versionDayKey(version) {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return version;
  }

  const [yy, month, patch] = parts;
  const day = Math.floor(Number(patch) / 100);
  return `${yy}.${month}.${day}`;
}

export function dayDateFromVersion(version) {
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

export function normalizeReleaseText(text) {
  return String(text ?? "")
    .replace(/\bcodesigning\b/gi, "code signing")
    .replace(/[—–]/g, ", ")
    .replace(/→/g, " to ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeFallbackText(text) {
  const normalized = normalizeReleaseText(text).replace(/[.]$/, "");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : normalized;
}

function stripItemPrefix(text) {
  return normalizeReleaseText(text)
    .replace(COMMON_ITEM_PREFIX, "")
    .replace(/ \(#\d+\)$/, "")
    .trim();
}

function isExactDuplicate(a, b) {
  const left = normalizeReleaseText(a).toLowerCase();
  const right = normalizeReleaseText(b).toLowerCase();
  return Boolean(left) && left === right;
}

export function isLowSignalItem(text) {
  const normalized = normalizeReleaseText(text).toLowerCase();

  if (!normalized) {
    return true;
  }

  if (
    normalized === "bug fixes and improvements" ||
    normalized.startsWith("no behavior change") ||
    normalized.startsWith("prerequisite cleanup") ||
    normalized.startsWith("minor text fixes") ||
    normalized.startsWith("further ") ||
    normalized.startsWith("this was ") ||
    normalized.startsWith("this is ") ||
    normalized.startsWith("this change ") ||
    normalized.startsWith("the primary reason ")
  ) {
    return true;
  }

  return /\b(api returned errors|blocked the release|internal cleanup|package-lock\.json|tsconfig|App\.tsx|SettingsDialog|tsc\b|docaddfeeditem|followingentry\.content|fs caps|dedup index|chrome default "peanuts"|api to get|env vars|tauri-action|release note workflow|same-day changelog|website changelog|snapshot website changelog|worktree branches|agents\.md|contributing|writing tells|footer text formatting|cargo\.lock|node_modules symlinks|rdf\.channel|parsefeedxml|parsecookiestring|vite-plugin-wasm|tauri event mocks|state param)\b/i.test(
    normalized,
  );
}

function comparisonTokens(text) {
  return [...new Set(
    normalizeReleaseText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token))
  )];
}

export function areNearDuplicates(a, b) {
  const left = normalizeReleaseText(a).toLowerCase();
  const right = normalizeReleaseText(b).toLowerCase();

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;

  if (shorter.length >= 18 && longer.includes(shorter)) {
    return true;
  }

  const leftTokens = comparisonTokens(left);
  const rightTokens = comparisonTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const minSize = Math.min(leftTokens.length, rightTokens.length);
  const maxSize = Math.max(leftTokens.length, rightTokens.length);

  return intersection / minSize >= 0.6 || intersection / maxSize >= 0.6;
}

export function dedupeSimilarStrings(items) {
  const result = [];

  for (const rawItem of items ?? []) {
    const text = summarizeFallbackText(rawItem);
    if (!text || isLowSignalItem(text)) {
      continue;
    }
    if (result.some((existing) => areNearDuplicates(existing, text))) {
      continue;
    }
    result.push(text);
  }

  return result;
}

function lowerCaseFirst(text) {
  if (!text) {
    return text;
  }

  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperCaseFirst(text) {
  if (!text) {
    return text;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sentenceCaseDeckPhrase(text) {
  if (!text) {
    return text;
  }

  if (/^(?:CI|Instagram|Facebook|Friends|LinkedIn|Linux|Mac|PWA|QR|Windows|iOS|iPhone|macOS)\b/.test(text)) {
    return text;
  }

  return lowerCaseFirst(text);
}

function isLowSignalDeckPhrase(text) {
  const normalized = normalizeReleaseText(text).toLowerCase();

  if (isLowSignalItem(text)) {
    return true;
  }

  return /\b(ci test failures|release deployment|npm_package_version|package\.json|tauri event mocks|footer text formatting|website changelog|same-day changelog|release note workflow|snapshot website changelog)\b/i.test(
    normalized,
  );
}

function compactDeckPhrase(text) {
  let phrase = normalizeReleaseText(text);

  const directReplacements = [
    [/^native macos code signing for effortless installs$/i, "signed macOS installs"],
    [/^add macos code signing to release pipeline$/i, "signed macOS installs"],
    [/^ship shared map and friends workspace$/i, "map view"],
    [/^add legal consent gates across surfaces$/i, "consent gates"],
    [/^activate friends view and add google contacts sync$/i, "Friends view and contacts sync"],
    [/^add linkedin feed capture via webview scraper$/i, "LinkedIn capture"],
    [/^surface update download progress inside the settings card$/i, "update download progress"],
    [/^add structured file logging and overnight-freeze timeout guards$/i, "file logging and freeze guards"],
    [/^default reader view to dual-column mode$/i, "dual-column reader"],
    [/^add per-platform install warnings to download modal$/i, "install warnings"],
    [/^anti-detection hardening for social media capture$/i, "capture hardening"],
    [/^add ig\/fb story scraping interleaved with feed scrolling$/i, "Instagram and Facebook story capture"],
    [/^group changelog cards by calver day$/i, "daily changelog grouping"],
    [/^hide fb\/ig scraper windows instead of moving them off-screen$/i, "quieter scraper windows"],
    [/^finalize qr landing page experience$/i, "QR landing page"],
  ];

  for (const [pattern, replacement] of directReplacements) {
    if (pattern.test(phrase)) {
      return replacement;
    }
  }

  phrase = phrase
    .replace(/^(?:add|ship|activate|surface|default|finalize|group|repair|filter|adjust|reduce|recycle|share|stabilize|specify|recover|finish|clean|use|exclude|apply|wait|switch|overhaul|resolve|hide|remove|enable)\s+/i, "")
    .replace(/\bvia webview scraper\b/gi, "")
    .replace(/\binside the settings card\b/gi, "")
    .replace(/\bto release pipeline\b/gi, "")
    .replace(/\bacross surfaces\b/gi, "")
    .replace(/\bgoogle contacts\b/gi, "contacts")
    .replace(/\big\/fb\b/gi, "Instagram and Facebook")
    .replace(/\bmacos code signing\b/gi, "signed macOS installs")
    .replace(/\blegal consent gates?\b/gi, "consent gates")
    .replace(/\bshared map and friends workspace\b/gi, "map view")
    .replace(/\breader view to dual-column mode\b/gi, "dual-column reader")
    .replace(/\bper-platform install warnings to download modal\b/gi, "install warnings")
    .replace(/\banti-detection hardening for social media capture\b/gi, "capture hardening")
    .replace(/\bovernight-freeze timeout guards\b/gi, "freeze guards")
    .replace(/\bstructured file logging\b/gi, "file logging")
    .replace(/\bqr\b/g, "QR")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "");

  const words = phrase
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !DECK_FILLER_WORDS.has(word.toLowerCase()));

  if (words.length === 0) {
    return "";
  }

  return sentenceCaseDeckPhrase(words.join(" "));
}

function directItemReplacement(text, kind) {
  const normalized = stripItemPrefix(text);

  const replacements = [
    [/^ship shared map and friends workspace$/i, "New map and Friends views", "feature"],
    [/^native macos code signing for effortless installs$/i, "Signed macOS installs", "feature"],
    [/^add macos code signing to release pipeline$/i, "Signed macOS installs", "feature"],
    [/^add legal consent gates across surfaces$/i, "Refined consent gates", "feature"],
    [/^default reader view to dual-column mode$/i, "Dual column reader view", "feature"],
    [/^add per-platform install warnings to download modal$/i, "Platform-specific install cautions", "feature"],
    [/^anti-detection hardening for social media capture$/i, "Capture hardening", "feature"],
    [/^add structured file logging and overnight-freeze timeout guards$/i, "Structured file logging and freeze guards", "feature"],
    [/^activate friends view and add google contacts sync$/i, "Friends view and contacts sync", "feature"],
    [/^add linkedin feed capture via webview scraper$/i, "LinkedIn capture", "feature"],
    [/^overhaul feed card and reader actions$/i, "Feed card and reader actions", "feature"],
    [/^reduce desktop feed webview media pressure$/i, "Optimized desktop feed webview media usage", "fix"],
    [/^recycle social scraper webviews after each run$/i, "Social scraper webviews are now recycled after each run", "fix"],
    [/^share settings toggle across desktop and ui$/i, "Settings toggles now stay shared across Freed Desktop and UI", "fix"],
    [/^stabilize desktop startup and scraper window modes$/i, "Desktop startup and scraper window modes are now more stable", "fix"],
    [/^specify scraper restore url type$/i, "Scraper restore URL handling is now explicit", "fix"],
    [/^recover desktop startup when consent store fails$/i, "Desktop startup now recovers when the consent store fails", "fix"],
    [/^stabilize hidden scraper webviews$/i, "Hidden scraper webviews are now more stable", "fix"],
    [/^finish linkedin desktop integration$/i, "LinkedIn desktop integration is now complete", "fix"],
  ];

  for (const [pattern, replacement, section] of replacements) {
    if ((section === kind || section === "all") && pattern.test(normalized)) {
      return replacement;
    }
  }

  return "";
}

function polishFeatureText(text) {
  const direct = directItemReplacement(text, "feature");
  if (direct) {
    return direct;
  }

  let phrase = stripItemPrefix(text);

  phrase = phrase
    .replace(/^add\s+/i, "")
    .replace(/^ship\s+/i, "")
    .replace(/^default\s+/i, "")
    .replace(/^enable\s+/i, "")
    .replace(/^introduce\s+/i, "")
    .replace(/^activate\s+/i, "")
    .replace(/\bmacos code signing\b/gi, "signed macOS installs")
    .replace(/\blegal consent gates?\b/gi, "refined consent gates")
    .replace(/\bshared map and friends workspace\b/gi, "new map and Friends views")
    .replace(/\bper-platform install warnings to download modal\b/gi, "platform-specific install cautions")
    .replace(/\banti-detection hardening for social media capture\b/gi, "capture hardening")
    .replace(/\breader view to dual-column mode\b/gi, "dual column reader view")
    .replace(/\s+/g, " ")
    .trim();

  return summarizeFallbackText(phrase);
}

function polishFixText(text) {
  const direct = directItemReplacement(text, "fix");
  if (direct) {
    return direct;
  }

  let phrase = stripItemPrefix(text);

  const rewriteRules = [
    [/^reduce\s+(.+)$/i, (_, body) => `Optimized ${lowerCaseFirst(body)}`],
    [/^recycle\s+(.+)\s+after each run$/i, (_, body) => `${upperCaseFirst(body)} are now recycled after each run`],
    [/^share\s+(.+)\s+across\s+(.+)$/i, (_, body, target) => `${upperCaseFirst(body)} now stay shared across ${target}`],
    [/^stabilize\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} are now more stable`],
    [/^recover\s+(.+)\s+when\s+(.+)$/i, (_, body, condition) => `${upperCaseFirst(body)} now recover when ${condition}`],
    [/^finish\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} is now complete`],
    [/^resolve\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} resolved`],
    [/^eliminate\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} removed`],
    [/^wait for\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} now waits for the correct ready state`],
    [/^use\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} now uses the correct path`],
    [/^switch\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} now uses the updated transport`],
    [/^hide\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} now stays out of the way`],
    [/^restore\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} restored`],
    [/^remove\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} removed`],
    [/^center\s+(.+)$/i, (_, body) => `${upperCaseFirst(body)} now align correctly`],
  ];

  for (const [pattern, replacer] of rewriteRules) {
    if (pattern.test(phrase)) {
      phrase = phrase.replace(pattern, replacer);
      return summarizeFallbackText(phrase);
    }
  }

  return summarizeFallbackText(phrase);
}

function polishFollowUpText(text) {
  let phrase = stripItemPrefix(text);

  phrase = phrase
    .replace(/^add\s+/i, "")
    .replace(/^update\s+/i, "")
    .replace(/^replace\s+/i, "")
    .replace(/^complete\s+/i, "")
    .replace(/^unify\s+/i, "")
    .replace(/^convert\s+/i, "")
    .replace(/^establish\s+/i, "")
    .replace(/^mark\s+/i, "")
    .replace(/^polish\s+/i, "")
    .replace(/^merge:\s*/i, "")
    .replace(/\bui\b/g, "UI")
    .replace(/\bx\/twitter\b/gi, "X")
    .replace(/\big\b/g, "Instagram")
    .replace(/\bfb\b/g, "Facebook")
    .replace(/\s+/g, " ")
    .trim();

  return summarizeFallbackText(phrase);
}

function sectionItemPriority(text, kind) {
  const normalized = normalizeReleaseText(text).toLowerCase();
  let score = 0;

  if (/\b(map|view|reader|friends|consent|signed|install|capture|scraper|oauth|sync|pairing|download|privacy|policy)\b/.test(normalized)) {
    score += 6;
  }
  if (/\b(build|workflow|lockfile|worktree|cargo|typescript|compile|tree-shaking|import|export|node_modules|contributing|agents\.md|copy|manifesto)\b/.test(normalized)) {
    score -= 4;
  }
  if (/\b(test|e2e|benchmark|diagnostic|debug|instrumentation)\b/.test(normalized)) {
    score -= 2;
  }
  if (kind === "fix") {
    score += 1;
  }

  return score;
}

function sectionItemBucket(text) {
  const normalized = normalizeReleaseText(text).toLowerCase();

  if (/\b(build|release|workflow|cargo|typescript|compile|rustls|lockfile|node_modules|tree-shaking|import|export|lambda|vercel|browser entry|subpath export|parsecookiestring|fast-xml-parser|vite-plugin-wasm|service worker|strict ts)\b/.test(normalized)) {
    return "build";
  }
  if (/\b(capture|scraper|webview|oauth|x |instagram|facebook|linkedin|browser|cookie|proxy)\b/.test(normalized)) {
    return "capture";
  }
  if (/\b(sync|automerge|cloud|pairing|offline|google drive|dropbox|update|download progress|restart toast)\b/.test(normalized)) {
    return "sync";
  }
  if (/\b(test|e2e|benchmark|perf|diagnostic|debug|instrumentation)\b/.test(normalized)) {
    return "tests";
  }
  if (/\b(copy|documentation|docs|manifesto|contributing|policy|roadmap)\b/.test(normalized)) {
    return "content";
  }
  return "ui";
}

function dedupeSectionItems(items) {
  const result = [];

  for (const item of items) {
    if (!item.text || isLowSignalItem(item.text)) {
      continue;
    }
    if (result.some((existing) => areNearDuplicates(existing.text, item.text))) {
      continue;
    }
    result.push(item);
  }

  return result;
}

function budgetSectionItems(items, kind, maxItems) {
  let working = dedupeSectionItems(items);
  const desiredCount = working.length > maxItems ? Math.min(maxItems, 10) : maxItems;

  if (working.length <= desiredCount) {
    return working.map((item) => item.text);
  }

  while (working.length > desiredCount) {
    const buckets = new Map();
    working.forEach((item, index) => {
      const bucket = item.bucket;
      const entry = buckets.get(bucket) ?? { items: [], firstIndex: index, score: 0 };
      entry.items.push(item);
      entry.firstIndex = Math.min(entry.firstIndex, index);
      entry.score += item.priority;
      buckets.set(bucket, entry);
    });

    const collapseCandidate = [...buckets.entries()]
      .filter(([, entry]) => entry.items.length > 1)
      .sort((left, right) => {
        const leftAvg = left[1].score / left[1].items.length;
        const rightAvg = right[1].score / right[1].items.length;
        if (leftAvg !== rightAvg) {
          return leftAvg - rightAvg;
        }
        return right[1].items.length - left[1].items.length;
      })[0];

    if (!collapseCandidate) {
      working = working
        .sort((left, right) => right.priority - left.priority)
        .slice(0, desiredCount);
      break;
    }

    const [bucket, entry] = collapseCandidate;
    const consolidatedText =
      SECTION_CONSOLIDATIONS[kind]?.[bucket] ??
      "Additional reliability and polish updates";

    const collapsed = {
      text: consolidatedText,
      bucket,
      priority: entry.score / entry.items.length,
      originalIndex: entry.firstIndex,
    };

    working = working.filter((item) => item.bucket !== bucket);
    working.splice(Math.min(entry.firstIndex, working.length), 0, collapsed);
    working = dedupeSectionItems(working);
  }

  return working.slice(0, maxItems).map((item) => item.text);
}

function deckCategory(text, kind) {
  const normalized = normalizeReleaseText(text).toLowerCase();

  if (
    /\b(consent|legal|signed|signing|notarized|install|warning|permission|guardrail)\b/.test(
      normalized,
    )
  ) {
    return "trust";
  }

  if (
    kind === "fix" ||
    /\b(freeze|guard|logging|window|startup|restore|recover|stabilize|quiet|pressure|webview)\b/.test(
      normalized,
    )
  ) {
    return "stability";
  }

  return "capability";
}

function deckPriority(text, phrase, kind, category) {
  let score = 0;

  if (category === "capability") score += 12;
  if (category === "trust") score += 11;
  if (category === "stability") score += 9;
  if (kind === "feature") score += 4;
  if (kind === "fix") score += 2;
  if (phrase.length >= 6 && phrase.length <= 48) score += 4;
  if (/\b(signed|install|notarized)\b/i.test(phrase)) score += 3;
  if (/\b(capture hardening|map|view|workspace|contacts|capture|reader|consent|signed|install|logging|freeze)\b/i.test(phrase)) {
    score += 3;
  }
  if (/\b(platform-specific install cautions)\b/i.test(phrase)) score -= 1;
  if (/\b(capture hardening)\b/i.test(phrase)) score += 2;
  if (phrase.length > 64) score -= 3;
  if (phrase.split(/\s+/).length > 6) score -= 2;
  if (isLowSignalItem(text)) score -= 10;

  return score;
}

function joinDeckPhrases(phrases) {
  if (phrases.length === 0) {
    return "";
  }

  if (phrases.length === 1) {
    return summarizeFallbackText(phrases[0]);
  }

  if (phrases.length === 2) {
    return summarizeFallbackText(`${phrases[0]} and ${phrases[1]}`);
  }

  return summarizeFallbackText(`${phrases[0]}, ${phrases[1]}, and ${phrases[2]}`);
}

function isSimpleDeckSeed(text) {
  const normalized = normalizeReleaseText(text);
  if (!normalized) {
    return false;
  }

  if (normalized.includes(",")) {
    return false;
  }

  return (normalized.match(/\band\b/gi) ?? []).length <= 1;
}

export function buildReleaseDeck(rawRelease = {}, options = {}) {
  const preferredDeck = summarizeFallbackText(options.preferredDeck ?? "");
  if (preferredDeck) {
    return preferredDeck;
  }

  const release = sanitizeReleaseShape({
    ...rawRelease,
    deck: "",
  });

  const candidates = [
    ...(isSimpleDeckSeed(rawRelease.deck ?? rawRelease.summary ?? "")
      ? [
          {
            text: summarizeFallbackText(rawRelease.deck ?? rawRelease.summary ?? ""),
            kind: "deck",
            index: -1,
          },
        ]
      : []),
    ...release.features.map((text, index) => ({ text, kind: "feature", index })),
    ...release.fixes.map((text, index) => ({ text, kind: "fix", index: index + 100 })),
    ...release.followUps.map((text, index) => ({ text, kind: "followUp", index: index + 200 })),
  ]
    .map((candidate) => {
      const phrase = compactDeckPhrase(candidate.text);
      const category = deckCategory(candidate.text, candidate.kind);
      const priority = deckPriority(candidate.text, phrase, candidate.kind, category);
      return {
        ...candidate,
        phrase,
        category,
        priority,
      };
    })
    .filter((candidate) => candidate.phrase && !isLowSignalDeckPhrase(candidate.phrase));

  const uniqueCandidates = [];
  for (const candidate of candidates) {
    if (
      uniqueCandidates.some(
        (existing) =>
          areNearDuplicates(existing.phrase, candidate.phrase) ||
          areNearDuplicates(existing.text, candidate.text),
      )
    ) {
      continue;
    }
    uniqueCandidates.push(candidate);
  }

  const rankedCandidates = [...uniqueCandidates].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    return left.index - right.index;
  });

  const selected = [];
  const leadingCapability = [...rankedCandidates]
    .filter((candidate) => candidate.category === "capability")
    .sort((left, right) => left.index - right.index)[0];
  if (leadingCapability) {
    selected.push(leadingCapability.phrase);
  }

  for (const candidate of rankedCandidates) {
    if (selected.length >= MAX_DECK_PHRASES) {
      break;
    }

    if (selected.some((existing) => areNearDuplicates(existing, candidate.phrase))) {
      continue;
    }

    selected.push(candidate.phrase);
  }

  if (selected.length === 0) {
    const fallbackCandidates = [
      rawRelease.deck,
      rawRelease.summary,
      ...(rawRelease.features ?? []),
      ...(rawRelease.whatsNew ?? []),
      ...(rawRelease.fixes ?? []),
      ...(rawRelease.followUps ?? []),
      ...(rawRelease.performance ?? []),
    ];

    for (const candidate of fallbackCandidates) {
      const phrase = compactDeckPhrase(candidate ?? "");
      if (phrase && !isLowSignalDeckPhrase(phrase)) {
        return summarizeFallbackText(phrase);
      }
    }
  }

  return joinDeckPhrases(selected.slice(0, MAX_DECK_PHRASES));
}

export function coerceReleaseShape(rawRelease = {}) {
  const deck = summarizeFallbackText(rawRelease.deck ?? rawRelease.summary ?? "");
  const features = dedupeSimilarStrings(
    (rawRelease.features ?? rawRelease.whatsNew ?? []).map((item) => polishFeatureText(item)),
  );
  const fixes = dedupeSimilarStrings(
    (rawRelease.fixes ?? []).map((item) => polishFixText(item)),
  );
  const followUps = dedupeSimilarStrings([
    ...(rawRelease.followUps ?? []),
    ...(rawRelease.performance ?? []),
  ].map((item) => polishFollowUpText(item)));

  return {
    deck,
    features,
    fixes,
    followUps,
  };
}

function rawComparableReleaseShape(rawRelease = {}) {
  return {
    deck: summarizeFallbackText(rawRelease.deck ?? rawRelease.summary ?? ""),
    features: (rawRelease.features ?? rawRelease.whatsNew ?? [])
      .map((item) => summarizeFallbackText(item))
      .filter(Boolean),
    fixes: (rawRelease.fixes ?? [])
      .map((item) => summarizeFallbackText(item))
      .filter(Boolean),
    followUps: [
      ...(rawRelease.followUps ?? []),
      ...(rawRelease.performance ?? []),
    ]
      .map((item) => summarizeFallbackText(item))
      .filter(Boolean),
  };
}

export function sanitizeReleaseShape(rawRelease = {}) {
  const release = coerceReleaseShape(rawRelease);
  const featureItems = [];
  const fixItems = [];
  const followUpItems = [];

  for (const feature of release.features) {
    if (
      feature &&
      !isLowSignalItem(feature) &&
      !isExactDuplicate(feature, release.deck) &&
      !featureItems.some((existing) => areNearDuplicates(existing.text, feature))
    ) {
      featureItems.push({
        text: feature,
        bucket: sectionItemBucket(feature),
        priority: sectionItemPriority(feature, "feature"),
      });
    }
    if (featureItems.length >= MAX_FEATURES) {
      break;
    }
  }

  for (const fix of release.fixes) {
    if (
      fix &&
      !isLowSignalItem(fix) &&
      !areNearDuplicates(fix, release.deck) &&
      !featureItems.some((feature) => areNearDuplicates(feature.text, fix)) &&
      !fixItems.some((existing) => areNearDuplicates(existing.text, fix))
    ) {
      fixItems.push({
        text: fix,
        bucket: sectionItemBucket(fix),
        priority: sectionItemPriority(fix, "fix"),
      });
    }
  }

  for (const followUp of release.followUps) {
    if (
      followUp &&
      !isLowSignalItem(followUp) &&
      !areNearDuplicates(followUp, release.deck) &&
      !featureItems.some((feature) => areNearDuplicates(feature.text, followUp)) &&
      !fixItems.some((fix) => areNearDuplicates(fix.text, followUp)) &&
      !followUpItems.some((existing) => areNearDuplicates(existing.text, followUp))
    ) {
      followUpItems.push({
        text: followUp,
        bucket: sectionItemBucket(followUp),
        priority: sectionItemPriority(followUp, "followUp"),
      });
    }
  }

  return {
    deck: release.deck,
    features: featureItems.map((item) => item.text).slice(0, MAX_FEATURES),
    fixes: budgetSectionItems(fixItems, "fix", MAX_FIXES),
    followUps: budgetSectionItems(followUpItems, "followUp", MAX_FOLLOW_UPS),
  };
}

function releaseVisibleItems(release) {
  const normalized = sanitizeReleaseShape(release);
  const deckPhrases = normalizeReleaseText(normalized.deck)
    .split(/,\s+and\s+|,\s*|\s+and\s+/)
    .map((item) => summarizeFallbackText(item))
    .filter(Boolean);
  return [
    normalized.deck,
    ...deckPhrases,
    ...normalized.features,
    ...normalized.fixes,
    ...normalized.followUps,
  ].filter(Boolean);
}

function releaseVisibleEntries(release) {
  const normalized = sanitizeReleaseShape(release);
  return [
    { kind: "deck", text: normalized.deck },
    ...normalized.features.map((text) => ({ kind: "feature", text })),
    ...normalized.fixes.map((text) => ({ kind: "fix", text })),
    ...normalized.followUps.map((text) => ({ kind: "followUp", text })),
  ].filter((entry) => entry.text);
}

function isCoveredByConsolidation(priorEntry, normalizedRelease) {
  if (priorEntry.kind !== "fix" && priorEntry.kind !== "followUp") {
    return false;
  }

  const bucket = sectionItemBucket(priorEntry.text);
  const consolidatedText = SECTION_CONSOLIDATIONS[priorEntry.kind]?.[bucket];
  if (!consolidatedText) {
    return false;
  }

  const candidates =
    priorEntry.kind === "fix" ? normalizedRelease.fixes : normalizedRelease.followUps;

  return candidates.some((item) => areNearDuplicates(item, consolidatedText));
}

export function validateReleaseShape(release, options = {}) {
  const errors = [];
  const normalized = sanitizeReleaseShape(release);
  const rawNormalized = coerceReleaseShape(release);
  const rawComparable = rawComparableReleaseShape(release);

  if (!normalized.deck) {
    errors.push("Deck is required.");
  }

  if (rawNormalized.features.length > MAX_FEATURES) {
    errors.push(`Features must contain at most ${MAX_FEATURES.toLocaleString()} items.`);
  }

  if (
    !normalized.deck &&
    normalized.features.length === 0 &&
    normalized.fixes.length === 0 &&
    normalized.followUps.length === 0
  ) {
    errors.push("Release needs at least one feature, fix, or follow-up.");
  }

  for (const feature of rawComparable.features) {
    if (isLowSignalItem(feature)) {
      errors.push(`Feature is too low-signal: ${feature}`);
    }
    if (isExactDuplicate(rawComparable.deck, feature)) {
      errors.push(`Deck duplicates feature: ${feature}`);
    }
  }

  for (let i = 0; i < rawComparable.features.length; i += 1) {
    for (let j = i + 1; j < rawComparable.features.length; j += 1) {
      if (areNearDuplicates(rawComparable.features[i], rawComparable.features[j])) {
        errors.push(`Feature bullets overlap: ${rawComparable.features[i]}`);
      }
    }
  }

  for (const followUp of rawComparable.followUps) {
    if (areNearDuplicates(rawComparable.deck, followUp)) {
      errors.push(`Deck duplicates follow-up: ${followUp}`);
    }
    if (rawComparable.features.some((feature) => areNearDuplicates(feature, followUp))) {
      errors.push(`Follow-up duplicates feature: ${followUp}`);
    }
    if (rawComparable.fixes.some((fix) => areNearDuplicates(fix, followUp))) {
      errors.push(`Follow-up duplicates fix: ${followUp}`);
    }
  }

  for (const fix of rawComparable.fixes) {
    if (areNearDuplicates(rawComparable.deck, fix)) {
      errors.push(`Deck duplicates fix: ${fix}`);
    }
    if (rawComparable.features.some((feature) => areNearDuplicates(feature, fix))) {
      errors.push(`Fix duplicates feature: ${fix}`);
    }
  }

  for (const feature of normalized.features) {
    if (isLowSignalItem(feature)) {
      errors.push(`Feature is too low-signal: ${feature}`);
    }
    if (isExactDuplicate(normalized.deck, feature)) {
      errors.push(`Deck duplicates feature: ${feature}`);
    }
  }

  for (let i = 0; i < normalized.features.length; i += 1) {
    for (let j = i + 1; j < normalized.features.length; j += 1) {
      if (areNearDuplicates(normalized.features[i], normalized.features[j])) {
        errors.push(`Feature bullets overlap: ${normalized.features[i]}`);
      }
    }
  }

  for (const followUp of normalized.followUps) {
    if (areNearDuplicates(normalized.deck, followUp)) {
      errors.push(`Deck duplicates follow-up: ${followUp}`);
    }
    if (normalized.features.some((feature) => areNearDuplicates(feature, followUp))) {
      errors.push(`Follow-up duplicates feature: ${followUp}`);
    }
    if (normalized.fixes.some((fix) => areNearDuplicates(fix, followUp))) {
      errors.push(`Follow-up duplicates fix: ${followUp}`);
    }
  }

  for (const fix of normalized.fixes) {
    if (areNearDuplicates(normalized.deck, fix)) {
      errors.push(`Deck duplicates fix: ${fix}`);
    }
    if (normalized.features.some((feature) => areNearDuplicates(feature, fix))) {
      errors.push(`Fix duplicates feature: ${fix}`);
    }
  }

  for (const priorRelease of options.earlierReleases ?? []) {
    for (const priorEntry of releaseVisibleEntries(priorRelease)) {
      const isPresent = releaseVisibleItems(normalized).some((item) =>
        areNearDuplicates(item, priorEntry.text),
      );

      if (!isPresent && !isCoveredByConsolidation(priorEntry, normalized)) {
        errors.push(`Latest-of-day release is missing earlier same-day item: ${priorEntry.text}`);
      }
    }
  }

  return {
    normalizedRelease: normalized,
    errors,
  };
}

export function renderReleaseBody(tag, rawRelease) {
  const release = sanitizeReleaseShape(rawRelease);
  const lines = ["(AI Generated).", "", `## Freed ${tag}`, ""];

  if (release.deck) {
    lines.push(release.deck, "");
  }

  if (release.features.length > 0) {
    lines.push("### Features", "");
    for (const item of release.features) {
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

  if (release.followUps.length > 0) {
    lines.push("### Follow-ups", "");
    for (const item of release.followUps) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (
    release.features.length === 0 &&
    release.fixes.length === 0 &&
    release.followUps.length === 0
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
