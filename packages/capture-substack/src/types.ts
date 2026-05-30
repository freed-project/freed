export type RawSubstackEntryKind =
  | "essay"
  | "note"
  | "restack"
  | "like"
  | "comment"
  | "subscription"
  | "follower"
  | "following";

export interface RawSubstackProfile {
  id?: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  role?: "follower" | "following" | "subscription" | "author";
  firstSeenAt?: number;
  lastSeenAt?: number;
}

export interface RawSubstackEntry {
  id?: string;
  kind: RawSubstackEntryKind;
  url?: string;
  title?: string;
  text?: string;
  author?: RawSubstackProfile;
  publishedAt?: string | number;
  capturedAt?: number;
  mediaUrls?: string[];
  publicationTitle?: string;
  publicationUrl?: string;
  likeCount?: number;
  commentCount?: number;
  restackCount?: number;
}
