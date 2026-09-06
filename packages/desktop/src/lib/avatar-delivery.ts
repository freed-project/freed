import { convertFileSrc } from "@tauri-apps/api/core";

/** Route image reads through the native cache without replacing the canonical URL. */
export function resolveDesktopAvatarUrl(sourceUrl: string): string {
  if (!/^https:\/\//i.test(sourceUrl)) return sourceUrl;
  return `${convertFileSrc("avatar", "freed-avatar")}?source=${encodeURIComponent(sourceUrl)}`;
}
