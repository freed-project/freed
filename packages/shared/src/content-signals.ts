import type { ContentSignal, ContentSignals, FeedItem, MediaType } from "./types.js";

export const CONTENT_SIGNAL_VERSION = 2;
export const CONTENT_SIGNAL_THRESHOLD = 0.5;

export const CONTENT_SIGNAL_KEYS: readonly ContentSignal[] = [
  "event",
  "essay",
  "moment",
  "life_update",
  "announcement",
  "recommendation",
  "request",
  "discussion",
  "promotion",
  "news",
] as const;

type ScoreMap = Record<ContentSignal, number>;

interface SignalEvidence {
  text: string;
  title: string;
  description: string;
  combined: string;
  topics: string[];
  mediaTypes: MediaType[];
  textLength: number;
  wordCount: number;
  hasLocation: boolean;
  hasTimeRange: boolean;
  hasLink: boolean;
  isSocial: boolean;
  isRss: boolean;
  feedTitle: string;
  sourceHost: string;
}

function emptyScores(): ScoreMap {
  return {
    event: 0,
    essay: 0,
    moment: 0,
    life_update: 0,
    announcement: 0,
    recommendation: 0,
    request: 0,
    discussion: 0,
    promotion: 0,
    news: 0,
  };
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function add(scores: ScoreMap, signal: ContentSignal, amount: number): void {
  scores[signal] = clampScore(scores[signal] + amount);
}

function matches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) count += 1;
  }
  return count;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return matches(text, patterns) > 0;
}

function wordCount(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function sourceHost(item: FeedItem): string {
  const url = item.content.linkPreview?.url ?? item.sourceUrl ?? item.rssSource?.siteUrl ?? "";
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function buildEvidence(item: FeedItem): SignalEvidence {
  const title = item.content.linkPreview?.title ?? "";
  const description = item.content.linkPreview?.description ?? "";
  const preserved = item.preservedContent?.text ?? "";
  const text = [item.content.text ?? "", preserved].filter(Boolean).join("\n");
  const combined = [title, description, text, item.rssSource?.feedTitle ?? "", item.topics.join(" ")]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return {
    text: text.toLowerCase(),
    title: title.toLowerCase(),
    description: description.toLowerCase(),
    combined,
    topics: item.topics.map((topic) => topic.toLowerCase()),
    mediaTypes: item.content.mediaTypes ?? [],
    textLength: text.length,
    wordCount: item.preservedContent?.wordCount ?? wordCount(text),
    hasLocation: Boolean(item.location),
    hasTimeRange: Boolean(item.timeRange),
    hasLink: Boolean(item.content.linkPreview?.url || item.sourceUrl),
    isSocial: item.platform !== "rss" && item.platform !== "github" && item.platform !== "youtube",
    isRss: Boolean(item.rssSource) || item.platform === "rss",
    feedTitle: item.rssSource?.feedTitle?.toLowerCase() ?? "",
    sourceHost: sourceHost(item),
  };
}

const DATE_OR_TIME_PATTERNS = [
  /\b(?:today|tomorrow|tonight|this weekend|next week|next month)\b/i,
  /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
];

const EVENT_PATTERNS = [
  /\b(?:rsvp|tickets?|register|registration|meetup|webinar|conference|workshop)\b/i,
  /\b(?:doors open|show starts|join us|come to|see you at|live event)\b/i,
  /\b(?:concert|festival|screening|demo day|office hours|book signing|launch party)\b/i,
];

const ESSAY_PATTERNS = [
  /\b(?:essay|long read|deep dive|analysis|argument|thesis|manifesto)\b/i,
  /\b(?:why|because|the problem|the point is|in short|in conclusion)\b/i,
  /\b(?:i think|i believe|i argue|my view|my take)\b/i,
];

const LIFE_UPDATE_PATTERNS = [
  /\b(?:i moved|we moved|new job|started at|joined|graduated|got married|engaged)\b/i,
  /\b(?:birthday|anniversary|baby|born|pregnant|recovering|diagnosed|laid off|promotion)\b/i,
  /\b(?:big news|personal news|life update|proud to share|happy to share)\b/i,
];

const ANNOUNCEMENT_PATTERNS = [
  /\b(?:announcing|introducing|we launched|i launched|just launched|shipped|released)\b/i,
  /\b(?:now available|now open|is live|goes live|launching|new release|version \d)\b/i,
  /\b(?:we are excited|we're excited|coming soon|public beta|private beta)\b/i,
];

const RECOMMENDATION_PATTERNS = [
  /\b(?:recommend|recommendation|favorite|worth reading|worth watching|check out)\b/i,
  /\b(?:best|guide|tool|book|podcast|movie|restaurant|place|list of)\b/i,
  /\b(?:you should|must read|must watch|great thread|useful resource)\b/i,
];

const REQUEST_PATTERNS = [
  /\b(?:anyone know|looking for|need help|can someone|does anyone|help wanted)\b/i,
  /\b(?:recommendations?|suggestions?|what should|how do i|how can i|poll)\b/i,
  /\b(?:who knows|please share|send me|dm me if|reply with)\b/i,
];

const DISCUSSION_PATTERNS = [
  /\b(?:thread|hot take|agree|disagree|thoughts|debate|conversation|comments)\b/i,
  /\b(?:replying to|to be clear|counterpoint|my response|let's talk about)\b/i,
  /\b(?:what do you think|curious what|change my mind)\b/i,
];

const PROMOTION_PATTERNS = [
  /\b(?:buy|sale|discount|preorder|pre-order|order now|sponsor|sponsored)\b/i,
  /\b(?:donate|support us|fundraiser|patreon|subscribe|follow me|share this)\b/i,
  /\b(?:affiliate|coupon|free trial|limited time|early bird|back my)\b/i,
];

const NEWS_PATTERNS = [
  /\b(?:breaking|reported|reports|report says|according to|announces|said on|sources say)\b/i,
  /\b(?:lawsuit|election|court|government|market|war|policy|regulation|acquisition)\b/i,
  /\b(?:investigation|study finds|researchers found|new data|officials|lawmakers|regulators)\b/i,
  /\b(?:exclusive|developing story|live updates|press briefing|statement from)\b/i,
];

const NEWS_HOST_PATTERNS = [
  /\b(?:nytimes|washingtonpost|theguardian|bbc|reuters|apnews|bloomberg|politico)\b/i,
  /\b(?:cnn|nbcnews|cbsnews|abcnews|npr|axios|theverge|wired|wsj|ft\.com)\b/i,
];

function scoreSignals(item: FeedItem, evidence: SignalEvidence): ScoreMap {
  const scores = emptyScores();
  const combined = evidence.combined;

  if (item.timeRange?.kind === "event") add(scores, "event", 0.45);
  else if (evidence.hasTimeRange) add(scores, "event", 0.2);
  if (hasAny(combined, EVENT_PATTERNS)) add(scores, "event", 0.3);
  if (hasAny(combined, DATE_OR_TIME_PATTERNS)) add(scores, "event", 0.22);
  if (evidence.hasLocation) add(scores, "event", 0.12);

  if (item.contentType === "article") add(scores, "essay", 0.3);
  if (evidence.wordCount >= 800) add(scores, "essay", 0.3);
  else if (evidence.textLength >= 2_500) add(scores, "essay", 0.2);
  if (hasAny(combined, ESSAY_PATTERNS)) add(scores, "essay", 0.22);
  if (evidence.isRss && evidence.textLength >= 800) add(scores, "essay", 0.1);

  if (item.contentType === "story") add(scores, "moment", 0.32);
  if (evidence.mediaTypes.includes("image") && evidence.textLength <= 360) add(scores, "moment", 0.24);
  if (evidence.hasLocation && evidence.textLength <= 500) add(scores, "moment", 0.18);
  if (evidence.isSocial && /\b(?:today|this morning|this afternoon|this evening|here at|walking|visited)\b/i.test(combined)) {
    add(scores, "moment", 0.18);
  }
  if (evidence.isSocial && evidence.textLength > 0 && evidence.textLength <= 180) add(scores, "moment", 0.1);

  if (hasAny(combined, LIFE_UPDATE_PATTERNS)) add(scores, "life_update", 0.36);
  if (/\b(?:i|we|my|our)\b/i.test(evidence.text) && hasAny(combined, LIFE_UPDATE_PATTERNS)) {
    add(scores, "life_update", 0.12);
  }
  if (evidence.isSocial && scores.life_update > 0) add(scores, "life_update", 0.1);

  if (hasAny(combined, ANNOUNCEMENT_PATTERNS)) add(scores, "announcement", 0.5);
  if (/\b(?:launch|release|available|beta|new)\b/i.test(evidence.title)) add(scores, "announcement", 0.18);
  if (evidence.sourceHost.includes("github.com") && /\b(?:release|version|changelog)\b/i.test(combined)) {
    add(scores, "announcement", 0.2);
  }

  if (hasAny(combined, RECOMMENDATION_PATTERNS)) add(scores, "recommendation", 0.35);
  if (evidence.hasLink && /\b(?:read|watch|listen|try|visit)\b/i.test(combined)) {
    add(scores, "recommendation", 0.12);
  }
  if (evidence.topics.some((topic) => ["book", "books", "tools", "podcast", "restaurants"].includes(topic))) {
    add(scores, "recommendation", 0.12);
  }

  if (hasAny(combined, REQUEST_PATTERNS)) add(scores, "request", 0.38);
  if (combined.includes("?")) add(scores, "request", 0.16);
  if (/\b(?:please|pls)\b/i.test(combined) && /\b(?:help|share|send|reply|recommend)\b/i.test(combined)) {
    add(scores, "request", 0.14);
  }
  if (scores.request > 0 && scores.recommendation > 0) {
    add(scores, "recommendation", 0.15);
  }

  if (hasAny(combined, DISCUSSION_PATTERNS)) add(scores, "discussion", 0.32);
  if (evidence.isSocial && evidence.textLength >= 220 && combined.includes("?")) add(scores, "discussion", 0.12);
  if (/\b(?:agree|disagree|take|thread)\b/i.test(combined)) add(scores, "discussion", 0.1);

  if (hasAny(combined, PROMOTION_PATTERNS)) add(scores, "promotion", 0.38);
  if (scores.event >= 0.4 && /\b(?:ticket|register|early bird|sale)\b/i.test(combined)) {
    add(scores, "promotion", 0.18);
  }
  if (evidence.feedTitle.includes("product hunt") || evidence.sourceHost.includes("producthunt.com")) {
    add(scores, "promotion", 0.24);
    add(scores, "announcement", 0.12);
  }

  if (hasAny(combined, NEWS_PATTERNS)) add(scores, "news", 0.32);
  if (item.contentType === "article" && hasAny(combined, NEWS_PATTERNS)) add(scores, "news", 0.18);
  if (evidence.isRss && hasAny(`${evidence.feedTitle} ${evidence.sourceHost}`, NEWS_HOST_PATTERNS)) {
    add(scores, "news", 0.28);
  }
  if (item.contentType === "article" && /\b(?:news|daily|times|post|journal)\b/i.test(evidence.feedTitle)) {
    add(scores, "news", 0.18);
  }

  if (item.contentType === "podcast" || item.contentType === "video") {
    if (scores.essay > 0) add(scores, "essay", 0.05);
    if (scores.recommendation > 0) add(scores, "recommendation", 0.05);
  }

  return scores;
}

export function inferContentSignals(item: FeedItem, now: number = Date.now()): ContentSignals {
  const evidence = buildEvidence(item);
  const rawScores = scoreSignals(item, evidence);
  const scores: Partial<Record<ContentSignal, number>> = {};

  for (const signal of CONTENT_SIGNAL_KEYS) {
    const score = clampScore(rawScores[signal]);
    if (score > 0) scores[signal] = score;
  }

  const tags = CONTENT_SIGNAL_KEYS.filter((signal) => (scores[signal] ?? 0) >= CONTENT_SIGNAL_THRESHOLD);

  return {
    version: CONTENT_SIGNAL_VERSION,
    method: "rules",
    inferredAt: now,
    scores,
    tags,
  };
}

export function hasCurrentContentSignals(item: FeedItem): boolean {
  return item.contentSignals?.version === CONTENT_SIGNAL_VERSION;
}
