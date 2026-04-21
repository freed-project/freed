/**
 * settings-sections — canonical section metadata shared between SettingsDialog
 * and the global command palette in Header.
 *
 * Pure TypeScript (no React). Consumers add their own icons on top.
 */

export type SectionId =
  | "legal"
  | "appearance"
  | "support"
  | "feeds"
  | "saved"
  | "ai"
  | "sync"
  | "updates"
  | "danger"
  | "googleContacts"
  | "x"
  | "facebook"
  | "instagram"
  | "linkedin";

export interface SectionMeta {
  id: SectionId;
  label: string;
  /** Lowercase keywords matched against search queries. */
  keywords: string[];
}

/** Sections always present, regardless of platform capabilities. */
export const BASE_SECTION_METAS: readonly SectionMeta[] = [
  {
    id: "appearance",
    label: "Appearance",
    keywords: [
      "theme", "appearance", "style", "midas", "neon", "ember", "scriptorium", "look",
      "engagement", "counts", "likes", "reposts", "views",
      "focus", "focus mode", "bionic", "bold", "reading speed",
      "intensity", "light", "normal", "strong", "mark read", "scroll",
      "grayscale", "read grayscale", "read appearance",
      "archive", "delete archived", "prune", "reading",
    ],
  },
  {
    id: "legal",
    label: "Legal",
    keywords: ["terms", "privacy", "eula", "consent", "agreement", "risk", "experimental"],
  },
  {
    id: "support",
    label: "Support",
    keywords: ["bug", "report", "problem", "issue", "diagnostics", "github", "logs", "crash"],
  },
  {
    id: "sync",
    label: "Sync",
    keywords: ["cloud", "dropbox", "google drive", "gdrive", "backup", "provider", "connect"],
  },
  {
    id: "saved",
    label: "Saved",
    keywords: ["bookmark", "save url", "reading list", "markdown", "import", "export", "manage", "articles", "sources"],
  },
  {
    id: "feeds",
    label: "Feeds",
    keywords: ["rss", "atom", "subscribe", "subscription", "add feed", "url", "opml", "import", "export", "manage", "sources"],
  },
];

/** Shown only when the platform supports update checks. */
export const UPDATES_SECTION_META: SectionMeta = {
  id: "updates",
  label: "Updates",
  keywords: ["update", "version", "upgrade", "check for updates", "install", "restart", "release", "production", "dev", "channel"],
};

/** Shown only when the platform provides an X/Twitter settings component (desktop). */
export const X_SECTION_META: SectionMeta = {
  id: "x",
  label: "X / Twitter",
  keywords: ["twitter", "x", "tweet", "timeline", "connect", "cookies", "auth", "token"],
};

/** Shown only when the platform provides a Facebook settings component (desktop). */
export const FB_SECTION_META: SectionMeta = {
  id: "facebook",
  label: "Facebook",
  keywords: ["facebook", "fb", "meta", "feed", "connect", "cookies", "auth", "mbasic"],
};

/** Shown only when the platform provides an Instagram settings component (desktop). */
export const IG_SECTION_META: SectionMeta = {
  id: "instagram",
  label: "Instagram",
  keywords: ["instagram", "ig", "meta", "feed", "connect", "photos", "reels", "stories"],
};

/** Shown only when the platform provides a LinkedIn settings component (desktop). */
export const LI_SECTION_META: SectionMeta = {
  id: "linkedin",
  label: "LinkedIn",
  keywords: ["linkedin", "li", "professional", "feed", "connect", "network", "jobs", "posts"],
};

/** Shown only when the platform provides a Google Contacts settings component. */
export const GOOGLE_CONTACTS_SECTION_META: SectionMeta = {
  id: "googleContacts",
  label: "Google Contacts",
  keywords: ["google contacts", "contacts", "people api", "friends", "address book", "connect", "sync"],
};

export const AI_SECTION_META: SectionMeta = {
  id: "ai",
  label: "AI",
  keywords: ["ai", "summary", "summarize", "topics", "ollama", "openai", "anthropic", "gemini"],
};

/** Shown only when the platform supports factory reset (desktop). */
export const DANGER_SECTION_META: SectionMeta = {
  id: "danger",
  label: "Danger Zone",
  keywords: [
    "debug", "panel", "diagnostics", "event log", "document inspector",
    "reset", "wipe", "factory reset", "delete", "restart", "developer",
    "sample", "populate", "seed", "test data", "regression",
  ],
};
