import type {
  ContentSignal,
  ContentSignals,
  EventCandidate,
  FeedItem,
  MediaType,
} from "./types.js";

export const CONTENT_SIGNAL_VERSION = 3;
export const EVENT_CANDIDATE_VERSION = 1;
export const CONTENT_SIGNAL_THRESHOLD = 0.5;
export const EVENT_CANDIDATE_THRESHOLD = 0.7;

export const CONTENT_SIGNAL_KEYS: readonly ContentSignal[] = [
  "event",
  "deadline",
  "opportunity",
  "how_to",
  "reference",
  "transaction",
  "product_update",
  "alert",
  "deal",
  "place",
  "media",
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
  displayText: string;
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
    deadline: 0,
    opportunity: 0,
    how_to: 0,
    reference: 0,
    transaction: 0,
    product_update: 0,
    alert: 0,
    deal: 0,
    place: 0,
    media: 0,
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
    displayText: [title, description, text].filter(Boolean).join("\n"),
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
  /\b(?:this|next)\s+(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i,
  /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
];

const DEADLINE_PATTERNS = [
  /\b(?:deadline|due|due by|due date|apply by|register by|rsvp by|submissions? close)\b/i,
  /\b(?:last day|final day|closes|expires|expiration|renew by|cutoff|cut-off)\b/i,
  /\b(?:applications? close|nominations? close|early bird ends|sale ends)\b/i,
];

const OPPORTUNITY_PATTERNS = [
  /\b(?:hiring|job opening|we're hiring|we are hiring|join our team|open role)\b/i,
  /\b(?:grant|fellowship|scholarship|contest|competition|award|residency)\b/i,
  /\b(?:call for|cfp|call for proposals|call for speakers|submissions? open|apply now)\b/i,
];

const HOW_TO_PATTERNS = [
  /\b(?:how to|tutorial|walkthrough|step by step|step-by-step|guide to|setup guide)\b/i,
  /\b(?:recipe|troubleshooting|fixing|debugging|learn how|best practices)\b/i,
  /\b(?:tips for|primer|playbook|checklist|manual)\b/i,
];

const REFERENCE_PATTERNS = [
  /\b(?:reference|documentation|docs|spec|specification|api reference|manual)\b/i,
  /\b(?:resource list|resources|cheat sheet|glossary|faq|overview|explainer)\b/i,
  /\b(?:evergreen|database|directory|catalog|index of)\b/i,
];

const TRANSACTION_PATTERNS = [
  /\b(?:receipt|invoice|order confirmation|confirmation number|booking confirmed)\b/i,
  /\b(?:reservation|shipped|shipping update|delivered|tracking number|boarding pass)\b/i,
  /\b(?:payment received|payment due|subscription renewed|your order|purchase)\b/i,
];

const PRODUCT_UPDATE_PATTERNS = [
  /\b(?:release notes|changelog|product update|security update|patch notes)\b/i,
  /\b(?:version \d|v\d+(?:\.\d+)+|new feature|feature update|deprecation)\b/i,
  /\b(?:available now|rolled out|rolling out|bug fixes|improvements)\b/i,
];

const ALERT_PATTERNS = [
  /\b(?:alert|warning|urgent|outage|incident|service disruption|status update)\b/i,
  /\b(?:recall|safety notice|security advisory|breach|vulnerability|evacuation)\b/i,
  /\b(?:do not|avoid|closed today|delayed|cancelled|canceled)\b/i,
];

const DEAL_PATTERNS = [
  /\b(?:deal|discount|coupon|promo code|sale|clearance|limited time offer)\b/i,
  /\b(?:percent off|% off|free trial|early bird|save \$|save \d+)\b/i,
  /\b(?:black friday|cyber monday|special offer|bundle price)\b/i,
];

const PLACE_PATTERNS = [
  /\b(?:restaurant|cafe|bar|venue|hotel|museum|park|gallery|airport)\b/i,
  /\b(?:in [a-z][a-z .'-]+|at [a-z][a-z0-9 .&'-]+|near [a-z][a-z .'-]+)\b/i,
  /\b(?:visited|checking in|check-in|location|neighborhood|city guide)\b/i,
];

const MEDIA_PATTERNS = [
  /\b(?:podcast|episode|video|livestream|live stream|watch|listen|album|gallery)\b/i,
  /\b(?:trailer|interview|webcast|recording|short film|documentary)\b/i,
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

const LOCATION_PHRASES = [
  /\b(?:at|in|near)\s+([A-Z][\p{L}\p{N}&'.-]*(?:\s+[A-Z][\p{L}\p{N}&'.-]*){0,5})/u,
  /\b(?:venue|location):\s*([A-Z][^\n.,;]{2,80})/u,
  /\u{1F4CD}\s*([^\n.,;]{2,80})/u,
];

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function scoreSignals(item: FeedItem, evidence: SignalEvidence): ScoreMap {
  const scores = emptyScores();
  const combined = evidence.combined;

  if (item.timeRange?.kind === "event") add(scores, "event", 0.45);
  else if (evidence.hasTimeRange) add(scores, "event", 0.2);
  if (hasAny(combined, EVENT_PATTERNS)) add(scores, "event", 0.3);
  if (hasAny(combined, DATE_OR_TIME_PATTERNS)) add(scores, "event", 0.22);
  if (evidence.hasLocation) add(scores, "event", 0.12);

  if (hasAny(combined, DEADLINE_PATTERNS)) add(scores, "deadline", 0.42);
  if (scores.deadline > 0 && hasAny(combined, DATE_OR_TIME_PATTERNS)) add(scores, "deadline", 0.24);
  if (/\b(?:by|before|until|through)\s+(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(combined)) {
    add(scores, "deadline", 0.16);
  }
  if (scores.event >= 0.4 && /\b(?:rsvp by|register by|early bird ends)\b/i.test(combined)) {
    add(scores, "deadline", 0.18);
  }

  if (hasAny(combined, OPPORTUNITY_PATTERNS)) add(scores, "opportunity", 0.42);
  if (scores.opportunity > 0 && scores.deadline > 0) add(scores, "opportunity", 0.12);
  if (/\b(?:apply|submit|nominate|pitch)\b/i.test(combined) && hasAny(combined, DATE_OR_TIME_PATTERNS)) {
    add(scores, "opportunity", 0.14);
  }

  if (hasAny(combined, HOW_TO_PATTERNS)) add(scores, "how_to", 0.5);
  if (/^\s*(?:how to|why does|what is|when to|where to)\b/i.test(evidence.displayText)) {
    add(scores, "how_to", 0.16);
  }
  if (evidence.wordCount >= 600 && /\b(?:steps?|install|configure|build|make|fix)\b/i.test(combined)) {
    add(scores, "how_to", 0.12);
  }

  if (hasAny(combined, REFERENCE_PATTERNS)) add(scores, "reference", 0.5);
  if (evidence.wordCount >= 1_000 && /\b(?:overview|guide|reference|resources?)\b/i.test(combined)) {
    add(scores, "reference", 0.16);
  }
  if (evidence.sourceHost.includes("docs.") || evidence.sourceHost.includes("developer.")) {
    add(scores, "reference", 0.18);
  }

  if (hasAny(combined, TRANSACTION_PATTERNS)) add(scores, "transaction", 0.5);
  if (/\b(?:order|invoice|receipt|booking|reservation)\s+#?\d+/i.test(combined)) {
    add(scores, "transaction", 0.2);
  }

  if (hasAny(combined, PRODUCT_UPDATE_PATTERNS)) add(scores, "product_update", 0.5);
  if (evidence.sourceHost.includes("github.com") && /\b(?:release|version|changelog|tagged)\b/i.test(combined)) {
    add(scores, "product_update", 0.22);
  }
  if (scores.product_update > 0) add(scores, "announcement", 0.12);

  if (hasAny(combined, ALERT_PATTERNS)) add(scores, "alert", 0.5);
  if (/\b(?:urgent|critical|warning)\b/i.test(evidence.title)) add(scores, "alert", 0.18);

  if (hasAny(combined, DEAL_PATTERNS)) add(scores, "deal", 0.5);
  if (scores.deal > 0) add(scores, "promotion", 0.12);

  if (hasAny(combined, PLACE_PATTERNS)) add(scores, "place", 0.3);
  if (evidence.hasLocation) add(scores, "place", 0.24);
  if (scores.recommendation > 0 && /\b(?:restaurant|cafe|venue|hotel|museum|park)\b/i.test(combined)) {
    add(scores, "place", 0.12);
  }

  if (item.contentType === "video" || item.contentType === "podcast") add(scores, "media", 0.42);
  if (evidence.mediaTypes.includes("video")) add(scores, "media", 0.32);
  if (hasAny(combined, MEDIA_PATTERNS)) add(scores, "media", 0.32);

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
  if (scores.recommendation > 0 && /\b(?:restaurant|cafe|venue|hotel|museum|park)\b/i.test(combined)) {
    add(scores, "place", 0.12);
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

function startOfUtcDay(timestamp: number): Date {
  const date = new Date(timestamp);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function withTime(date: Date, text: string): number {
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i);
  if (!timeMatch) return date.getTime();
  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2] ?? 0);
  const meridiem = timeMatch[3].toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const next = new Date(date);
  next.setUTCHours(hours, minutes, 0, 0);
  return next.getTime();
}

function resolveMonthDate(text: string, anchor: number): number | null {
  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/i,
  );
  if (!match) return null;

  const month = MONTH_INDEX[match[1].toLowerCase().replace(".", "")];
  const day = Number(match[2]);
  if (month === undefined || day < 1 || day > 31) return null;

  const anchorDate = new Date(anchor);
  let year = match[3] ? Number(match[3]) : anchorDate.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day));
  if (!match[3] && date.getTime() < startOfUtcDay(anchor).getTime()) {
    year += 1;
    date = new Date(Date.UTC(year, month, day));
  }
  return withTime(date, text);
}

function resolveNumericDate(text: string, anchor: number): number | null {
  const match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (!match) return null;

  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;

  const anchorDate = new Date(anchor);
  let year = match[3] ? Number(match[3]) : anchorDate.getUTCFullYear();
  if (year < 100) year += 2000;
  let date = new Date(Date.UTC(year, month, day));
  if (!match[3] && date.getTime() < startOfUtcDay(anchor).getTime()) {
    date = new Date(Date.UTC(year + 1, month, day));
  }
  return withTime(date, text);
}

function resolveRelativeDate(text: string, anchor: number): number | null {
  const lower = text.toLowerCase();
  const base = startOfUtcDay(anchor);
  if (/\btoday\b/.test(lower) || /\btonight\b/.test(lower)) {
    return withTime(base, text);
  }
  if (/\btomorrow\b/.test(lower)) {
    const date = new Date(base);
    date.setUTCDate(date.getUTCDate() + 1);
    return withTime(date, text);
  }

  const weekdayMatch = lower.match(/\b(?:(this|next)\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/);
  if (!weekdayMatch) return null;

  const target = WEEKDAY_INDEX[weekdayMatch[2]];
  if (target === undefined) return null;

  const current = base.getUTCDay();
  let delta = (target - current + 7) % 7;
  if (weekdayMatch[1] === "next" || delta === 0) delta += 7;
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + delta);
  return withTime(date, text);
}

function resolveCandidateStart(text: string, anchor: number): number | null {
  return (
    resolveMonthDate(text, anchor) ??
    resolveNumericDate(text, anchor) ??
    resolveRelativeDate(text, anchor)
  );
}

function candidateTitle(item: FeedItem, evidence: SignalEvidence): string | undefined {
  const title = item.content.linkPreview?.title?.trim();
  if (title) return title.slice(0, 120);
  const text = evidence.displayText.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 120) : undefined;
}

function extractLocationName(item: FeedItem, evidence: SignalEvidence): string | undefined {
  if (item.location?.name) return item.location.name;
  for (const pattern of LOCATION_PHRASES) {
    const match = evidence.displayText.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    const cleaned = raw.replace(/\s+/g, " ").replace(/[)\]]+$/g, "").trim();
    if (cleaned.length >= 2 && cleaned.length <= 80) return cleaned;
  }
  return undefined;
}

function evidenceSnippet(evidence: SignalEvidence): string | undefined {
  const source = evidence.displayText.replace(/\s+/g, " ").trim();
  if (!source) return undefined;
  return source.slice(0, 280);
}

export function inferEventCandidate(
  item: FeedItem,
  signals: ContentSignals = inferContentSignals(item),
  now: number = Date.now(),
): EventCandidate | null {
  const evidence = buildEvidence(item);
  const anchor = item.preservedContent?.publishedAt ?? item.publishedAt ?? now;
  const startsAt = item.timeRange?.startsAt ?? resolveCandidateStart(evidence.displayText, anchor);
  const eventScore = signals.scores.event ?? 0;
  const hasEventLanguage = hasAny(evidence.combined, EVENT_PATTERNS);
  const hasDateLanguage = hasAny(evidence.combined, DATE_OR_TIME_PATTERNS);

  if (!startsAt && eventScore < EVENT_CANDIDATE_THRESHOLD) return null;
  if (startsAt && startsAt < now - 24 * 60 * 60 * 1000 && !item.timeRange) return null;
  if (!hasEventLanguage && eventScore < EVENT_CANDIDATE_THRESHOLD) return null;
  if (!hasDateLanguage && !item.timeRange) return null;

  const confidence = clampScore(
    Math.max(eventScore, 0.3) +
      (startsAt ? 0.18 : 0) +
      (hasEventLanguage ? 0.12 : 0) +
      (evidence.hasLocation || extractLocationName(item, evidence) ? 0.08 : 0),
  );
  if (confidence < EVENT_CANDIDATE_THRESHOLD) return null;

  const locationName = extractLocationName(item, evidence);
  return {
    version: EVENT_CANDIDATE_VERSION,
    method: signals.method,
    detectedAt: now,
    confidence,
    title: candidateTitle(item, evidence),
    startsAt: startsAt ?? undefined,
    endsAt: item.timeRange?.endsAt,
    locationName,
    locationUrl: item.location?.url,
    evidence: evidenceSnippet(evidence),
  };
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
