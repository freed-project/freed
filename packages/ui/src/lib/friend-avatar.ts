import type { Person } from "@freed/shared";

function firstDefinedAvatar(
  fallbacks?: Iterable<string | null | undefined> | string | null
): string | null {
  if (!fallbacks) return null;
  if (typeof fallbacks === "string") {
    return fallbacks || null;
  }

  for (const candidate of fallbacks) {
    if (candidate) return candidate;
  }

  return null;
}

export function resolveFriendAvatarUrl(
  friend: Pick<Person, "avatarUrl"> | null | undefined,
  fallbackAvatarUrls?: Iterable<string | null | undefined> | string | null
): string | null {
  return friend?.avatarUrl
    ?? firstDefinedAvatar(fallbackAvatarUrls)
    ?? null;
}

export function initialsForName(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
