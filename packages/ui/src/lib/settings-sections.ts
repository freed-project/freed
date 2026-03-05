/**
 * settings-sections — canonical section metadata shared between SettingsDialog
 * and the global command palette in Header.
 *
 * Pure TypeScript (no React). Consumers add their own icons on top.
 */

export type SectionId =
  | "reading"
  | "feeds"
  | "saved"
  | "ai"
  | "sync"
  | "updates"
  | "danger";

export interface SectionMeta {
  id: SectionId;
  label: string;
  /** Lowercase keywords matched against search queries. */
  keywords: string[];
}

/** Sections always present, regardless of platform capabilities. */
export const BASE_SECTION_METAS: readonly SectionMeta[] = [
  {
    id: "sync",
    label: "Sync",
    keywords: ["cloud", "dropbox", "google drive", "gdrive", "backup", "provider", "connect"],
  },
  {
    id: "reading",
    label: "Reading",
    keywords: [
      "engagement", "counts", "likes", "reposts", "views",
      "focus", "focus mode", "bionic", "bold", "reading speed",
      "intensity", "light", "normal", "strong", "display",
    ],
  },
  {
    id: "feeds",
    label: "Feeds",
    keywords: ["rss", "atom", "subscribe", "subscription", "add feed", "url", "opml", "import", "export", "manage", "sources"],
  },
  {
    id: "saved",
    label: "Saved",
    keywords: ["bookmark", "save url", "reading list", "markdown", "import", "export", "manage", "articles", "sources"],
  },
];

/** Shown only when the platform supports update checks. */
export const UPDATES_SECTION_META: SectionMeta = {
  id: "updates",
  label: "Updates",
  keywords: ["update", "version", "upgrade", "check for updates", "install", "restart", "release"],
};

/** Shown only when the platform supports factory reset (desktop). */
export const DANGER_SECTION_META: SectionMeta = {
  id: "danger",
  label: "Danger Zone",
  keywords: [
    "debug", "panel", "diagnostics", "event log", "document inspector",
    "reset", "wipe", "factory reset", "delete", "restart", "developer",
  ],
};
