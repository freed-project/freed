import type { ReactNode } from "react";

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO 8601 format: YYYY-MM-DD
  author?: string;
  tags?: string[];
}

export interface Post extends PostMeta {
  content: ReactNode;
}

// Helper to create type-safe posts
export function definePost(meta: PostMeta, content: ReactNode): Post {
  return { ...meta, content };
}
