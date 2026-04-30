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

export function channelInitialForName(name: string): string {
  const normalized = name.trim().replace(/^@+/, "");
  const match = normalized.match(/[A-Za-z0-9]/);
  return match?.[0]?.toUpperCase() ?? "?";
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
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

export function personInitialsForName(name: string): string {
  return initialsForName(name);
}

export interface AvatarImageFailureStore {
  has(url: string | null | undefined): boolean;
  mark(url: string | null | undefined): void;
  reset(url: string | null | undefined): void;
}

export function createAvatarImageFailureStore(): AvatarImageFailureStore {
  const failedUrls = new Set<string>();
  return {
    has(url) {
      return !!url && failedUrls.has(url);
    },
    mark(url) {
      if (url) failedUrls.add(url);
    },
    reset(url) {
      if (url) failedUrls.delete(url);
    },
  };
}
