export type RawMediumEntryKind =
  | "story"
  | "response"
  | "clap"
  | "highlight"
  | "follower"
  | "following";

export interface RawMediumProfile {
  id?: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  role?: "follower" | "following" | "subscription" | "author";
  firstSeenAt?: number;
  lastSeenAt?: number;
}

export interface RawMediumEntry {
  id?: string;
  kind: RawMediumEntryKind;
  url?: string;
  title?: string;
  text?: string;
  activityLabel?: string;
  author?: RawMediumProfile;
  publishedAt?: string | number;
  capturedAt?: number;
  mediaUrls?: string[];
  clapCount?: number;
  responseCount?: number;
  highlightCount?: number;
}
