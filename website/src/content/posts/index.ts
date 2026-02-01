import type { Post } from "../types";

// Import all posts - add new imports here
import post001 from "./001-introducing-freed";

// Export posts sorted by date (newest first)
export const posts: Post[] = [post001].sort(
  (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
);

// Helper to find post by slug
export function getPostBySlug(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}
