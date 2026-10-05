import { isJevNative } from "./jev-client";
import { assertJevSourceCurrent } from "./jev-library";
import type { FeedItem } from "@freed/shared";
import {
  buildJevMatchRequest,
  JEV_CONTEXT_QUESTION_PACK_VERSION,
  JEV_MODEL,
} from "./jev-classification";
import {
  postJevPreviewRequest,
  runJevPreviewBatch,
  type JevPreviewBatchResult,
} from "./jev-preview-run";

export interface JevOpportunityResponse {
  explicitHelpRequest: number;
  collaborationInvitation: number;
  helpCapabilityScores: number[];
  collaborationCapabilityScores: number[];
  model: string;
  questionPackVersion: string;
  usage: { input_tokens: number; output_tokens: number };
  cached: boolean;
  estimatedCostUsd: number;
  elapsedMs: number;
}

export interface JevOpportunityResult extends JevPreviewBatchResult<JevOpportunityResponse> {
  profileKey: string;
  sourceKey: string;
}

export interface JevOpportunityRelationship {
  kind: "friend" | "connection" | "unknown";
  name?: string;
}

export interface JevOpportunity {
  item: FeedItem;
  relationship: JevOpportunityRelationship;
  matchingCapabilities: Array<{ capability: string; probability: number }>;
  intentProbability: number;
  /** Sorting heuristic, not an estimated joint probability or a measure of a person. */
  sortScore: number;
}

/** User declarations stay ordered because each answer refers to a specific row. */
export function parseJevCapabilities(text: string): string[] {
  const capabilities = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (!capabilities.length) throw new Error("Add at least one thing you can help with.");
  if (capabilities.length > 8) throw new Error("Use up to eight skills, one per line.");
  if (capabilities.some((capability) => capability.length > 120 || /[\u0000-\u001F\u007F]/u.test(capability))) {
    throw new Error("Keep each skill to 120 characters without control characters.");
  }
  if (new Set(capabilities.map((capability) => capability.toLocaleLowerCase())).size !== capabilities.length) {
    throw new Error("List each skill once.");
  }
  return capabilities;
}

function sourceKey(item: FeedItem, capabilities: readonly string[]): string {
  // Analysis scores and relationship names are excluded from Jev's evidence.
  // Local identity/provenance fences still prevent reusing a result for a replacement item.
  return JSON.stringify({
    state: buildJevMatchRequest(item, [...capabilities]).state,
    authorId: item.author.id,
    provenance: item.sampleDataFingerprint,
    pack: JEV_CONTEXT_QUESTION_PACK_VERSION,
  });
}

function isVisible(item: FeedItem): boolean {
  return !item.userState.hidden && !item.userState.archived &&
    !(item as FeedItem & { __deleted?: boolean }).__deleted;
}

/** Evaluates context without writing personal relevance into a post's intrinsic signals. */
export async function runJevOpportunities(
  items: readonly FeedItem[],
  capabilities: readonly string[],
  options: {
    signal: AbortSignal;
    reclassify?: boolean;
    onUpdate: (results: readonly JevOpportunityResult[]) => void;
  },
): Promise<readonly JevOpportunityResult[]> {
  if (items.length > 500) throw new Error("Load at most 500 sample items before finding matches.");
  const profile = parseJevCapabilities(capabilities.join("\n"));
  const profileKey = JSON.stringify(profile);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const stamps = new Map<string, string>();
  for (const item of items) {
    if ((!isJevNative && item.sampleDataFingerprint?.marker !== "freed.sample-data.v1") || !isVisible(item)) continue;
    try { stamps.set(item.globalId, sourceKey(item, profile)); } catch { /* The batch records ineligible sources as skipped. */ }
  }
  const stamp = (results: readonly JevPreviewBatchResult<JevOpportunityResponse>[]): JevOpportunityResult[] =>
    results.map((result) => ({ ...result, profileKey, sourceKey: stamps.get(result.item.globalId) ?? "" }));
  const completed = await runJevPreviewBatch<JevOpportunityResponse>(items, {
    signal: options.signal,
    reclassify: options.reclassify,
    validate: (item) => {
      if (!isVisible(item)) throw new Error("Hidden, archived, or removed items are excluded.");
      if (!isJevNative && item.sampleDataFingerprint?.marker !== "freed.sample-data.v1") {
        throw new Error("Opportunity matching accepts generated sample items only.");
      }
      return buildJevMatchRequest(item, profile);
    },
    classify: (item, signal, reclassify) => postJevPreviewRequest<JevOpportunityResponse>(
      "/api/jev-preview/match", { item, capabilities: profile, reclassify }, signal,
    ),
    apply: (item) => assertJevSourceCurrent(item),
    onUpdate: (results) => options.onUpdate(stamp(results)),
  });
  return stamp(completed);
}

/** Matches require both explicit intent and a relevant declared capability. */
export function selectJevOpportunities(options: {
  items: readonly FeedItem[];
  results: readonly JevOpportunityResult[];
  capabilities: readonly string[];
  relationships?: Readonly<Record<string, JevOpportunityRelationship>>;
  lens: "help" | "collaborate";
  friendsOnly?: boolean;
  maxAgeDays?: number | null;
  minProbability?: number;
  dismissed?: ReadonlySet<string>;
  now?: number;
}): JevOpportunity[] {
  if (options.items.length > 500 || options.results.length > 500) return [];
  let profile: string[];
  try { profile = parseJevCapabilities(options.capabilities.join("\n")); } catch { return []; }
  const profileKey = JSON.stringify(profile);
  const threshold = options.minProbability ?? 0.7;
  const now = options.now ?? Date.now();
  const maxAgeDays = options.maxAgeDays === undefined ? 30 : options.maxAgeDays;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 || !Number.isFinite(now) ||
    (maxAgeDays !== null && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0))) return [];
  const results = new Map(options.results.map((result) => [result.item.globalId, result]));
  const matches: JevOpportunity[] = [];
  for (const item of options.items) {
    if (!isVisible(item) || options.dismissed?.has(item.globalId)) continue;
    const publishedAt = item.publishedAt;
    // Capture time does not prove when someone made the request.
    if (maxAgeDays !== null && (!Number.isFinite(publishedAt) || publishedAt > now ||
      now - publishedAt > maxAgeDays * 86_400_000)) continue;
    const result = results.get(item.globalId);
    const response = result?.response;
    if (result?.status !== "success" || !response || result.profileKey !== profileKey ||
      response.model !== JEV_MODEL || response.questionPackVersion !== JEV_CONTEXT_QUESTION_PACK_VERSION) continue;
    try { if (result.sourceKey !== sourceKey(item, profile)) continue; } catch { continue; }
    const relationship = options.relationships?.[item.globalId] ?? { kind: "unknown" as const };
    if (options.friendsOnly && relationship.kind !== "friend") continue;
    const intentProbability = options.lens === "help"
      ? response.explicitHelpRequest : response.collaborationInvitation;
    const scores = options.lens === "help"
      ? response.helpCapabilityScores : response.collaborationCapabilityScores;
    if (!Number.isFinite(intentProbability) || intentProbability < threshold || intentProbability > 1 ||
      !Array.isArray(scores) || scores.length !== profile.length ||
      scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) continue;
    const matchingCapabilities = profile.flatMap((capability, index) => scores[index] >= threshold
      ? [{ capability, probability: scores[index] }] : []);
    if (!matchingCapabilities.length) continue;
    matchingCapabilities.sort((a, b) => b.probability - a.probability);
    matches.push({ item, relationship, matchingCapabilities, intentProbability,
      sortScore: Math.min(intentProbability, matchingCapabilities[0].probability) });
  }
  return matches.sort((a, b) => b.sortScore - a.sortScore ||
    Number(b.relationship.kind === "friend") - Number(a.relationship.kind === "friend") ||
    b.item.publishedAt - a.item.publishedAt || a.item.globalId.localeCompare(b.item.globalId));
}

/** Hand-authored UI fixtures. No Jev request or model-quality claim is made here. */
export function createJevOpportunityDemo(now = Date.now()): {
  items: FeedItem[];
  capabilities: string[];
  results: JevOpportunityResult[];
  relationships: Record<string, JevOpportunityRelationship>;
} {
  const capabilities = ["Review a TypeScript prototype", "Repair a bicycle", "Design a community workshop"];
  const examples = [
    { id: "prototype", name: "Mira", text: "Could someone review the TypeScript data model for my tool library prototype? I need a second pair of eyes on how reservations work. A short review over a call would help.", help: .96, collaboration: .12, helpScores: [.94, .02, .08], collaborationScores: [.05, .01, .03], kind: "friend" as const },
    { id: "puncture", name: "Leon", text: "My bike tire keeps going flat. I have a patch kit but have never used one. Could someone explain how to find the leak and patch it? Instructions I can follow at home would be great.", help: .98, collaboration: .04, helpScores: [.01, .97, .03], collaborationScores: [.01, .02, .01], kind: "connection" as const },
    { id: "workshop", name: "Sana", text: "I'm putting together a neighborhood repair workshop and would love a co-organizer. Let's design the sessions together online, then ask the library about a venue. Anyone want to build this with me?", help: .88, collaboration: .98, helpScores: [.02, .34, .94], collaborationScores: [.03, .54, .97], kind: "unknown" as const },
    { id: "build-together", name: "Noor", text: "I have a rough TypeScript prototype for sharing garden tools. Looking for a collaborator to review the design and help shape the next version with me. Remote contributions are welcome.", help: .91, collaboration: .97, helpScores: [.94, .02, .05], collaborationScores: [.96, .01, .07], kind: "friend" as const },
    { id: "resolved", name: "Leon", text: "Update: the puncture is fixed. A neighbor showed me how to use the patch kit, and I don't need help now. Thanks for all the offers!", help: .03, collaboration: .01, helpScores: [.01, .03, .01], collaborationScores: [.01, .01, .01], kind: "connection" as const },
    { id: "progress", name: "Mira", text: "A small glimpse of my workshop prototype. I'm still experimenting with the layout and prefer to work on it privately for now. I'll ask for feedback when I'm ready.", help: .02, collaboration: .02, helpScores: [.04, .01, .04], collaborationScores: [.02, .01, .03], kind: "friend" as const },
  ];
  const relationships: Record<string, JevOpportunityRelationship> = {};
  const items: FeedItem[] = examples.map((example, index) => {
    const item: FeedItem = {
      globalId: `jev-opportunity-demo:${example.id}`,
      platform: index % 2 ? "facebook" : "linkedin",
      contentType: index === 1 ? "story" : "post",
      capturedAt: now - index * 60_000, publishedAt: now - index * 60_000,
      author: { id: example.id, handle: "fictional_example", displayName: `${example.name} (example)` },
      content: { text: example.text, mediaUrls: [], mediaTypes: [] },
      userState: { hidden: false, saved: false, archived: false, tags: [] }, topics: [],
      sampleDataFingerprint: { marker: "freed.sample-data.v1", batchId: "jev-opportunity-demo", generatorVersion: 1, generatedAt: now },
    };
    relationships[item.globalId] = { kind: example.kind, ...(example.kind === "unknown" ? {} : { name: `${example.name} (example)` }) };
    return item;
  });
  const results = items.map((item, index): JevOpportunityResult => ({
    item, status: "success", profileKey: JSON.stringify(capabilities), sourceKey: sourceKey(item, capabilities),
    response: {
      explicitHelpRequest: examples[index].help, collaborationInvitation: examples[index].collaboration,
      helpCapabilityScores: examples[index].helpScores, collaborationCapabilityScores: examples[index].collaborationScores,
      model: JEV_MODEL, questionPackVersion: JEV_CONTEXT_QUESTION_PACK_VERSION,
      usage: { input_tokens: 0, output_tokens: 0 }, cached: false, estimatedCostUsd: 0, elapsedMs: 0,
    },
  }));
  return { items, capabilities, results, relationships };
}
