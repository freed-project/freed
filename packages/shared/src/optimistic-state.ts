import type {
  Account,
  FeedItem,
  Friend,
  Person,
  RssFeed,
  UserPreferences,
} from "./types.js";
import type { BaseAppState } from "./store-types.js";
import { stripDeviceLocalPreferenceUpdates } from "./preferences.js";
import { sanitizeAccountWrite, sanitizePersonWrite } from "./sync-write-policy.js";

export type OptimisticState = Pick<
  BaseAppState,
  "accounts" | "feeds" | "friends" | "items" | "persons" | "preferences"
>;

export type OptimisticPatch = Partial<OptimisticState>;

type UserStateRecord = Record<string, unknown>;

function hasPatch(patch: OptimisticPatch): boolean {
  return Object.keys(patch).length > 0;
}

function cloneItem(item: FeedItem): FeedItem {
  return {
    ...item,
    userState: { ...item.userState },
  };
}

function patchItems(
  state: Pick<OptimisticState, "items">,
  update: (item: FeedItem) => FeedItem | null,
): OptimisticPatch | null {
  let changed = false;
  const items = state.items.map((item) => {
    const next = update(item);
    if (!next) return item;
    changed = true;
    return next;
  });

  return changed ? { items } : null;
}

function patchItem(
  state: Pick<OptimisticState, "items">,
  id: string,
  update: (item: FeedItem) => FeedItem | null,
): OptimisticPatch | null {
  return patchItems(state, (item) => (item.globalId === id ? update(item) : null));
}

function applyDefinedUpdate<T extends object>(current: T, updates: Partial<T>): T {
  const next: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

function isMergeablePreferenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePreferenceUpdate<T extends object>(current: T, update: Partial<T>): T {
  const next = { ...current };

  for (const key of Object.keys(update) as Array<keyof T>) {
    const currentValue = current[key];
    const updateValue = update[key];
    next[key] = (
      isMergeablePreferenceObject(currentValue) && isMergeablePreferenceObject(updateValue)
        ? mergePreferenceUpdate<Record<string, unknown>>(currentValue, updateValue)
        : updateValue
    ) as T[typeof key];
  }

  return next;
}

function itemMatchesScope(item: FeedItem, platform?: string, feedUrl?: string): boolean {
  if (platform && item.platform !== platform) return false;
  if (feedUrl && item.rssSource?.feedUrl !== feedUrl) return false;
  return true;
}

function isArchivable(item: FeedItem): boolean {
  return (
    !item.userState.hidden &&
    !item.userState.archived &&
    !item.userState.saved &&
    !!item.userState.readAt
  );
}

export function rollbackOptimisticPatch<T extends OptimisticState>(
  current: T,
  before: OptimisticPatch,
  projected: OptimisticPatch,
): OptimisticPatch | null {
  const rollback: OptimisticPatch = {};

  for (const key of Object.keys(projected) as Array<keyof OptimisticPatch>) {
    if (current[key] === projected[key]) {
      rollback[key] = before[key] as never;
    }
  }

  return hasPatch(rollback) ? rollback : null;
}

export function projectUpdateItem(
  state: Pick<OptimisticState, "items">,
  id: string,
  updates: Partial<FeedItem>,
): OptimisticPatch | null {
  return patchItem(state, id, (item) => {
    const next = applyDefinedUpdate(item, updates);
    if (updates.userState) {
      next.userState = applyDefinedUpdate(item.userState, updates.userState);
    }
    return next;
  });
}

export function projectMarkItemsAsRead(
  state: Pick<OptimisticState, "items">,
  ids: readonly string[],
  now: number = Date.now(),
): OptimisticPatch | null {
  const targets = new Set(ids.filter(Boolean));
  if (targets.size === 0) return null;

  return patchItems(state, (item) => {
    if (!targets.has(item.globalId) || item.userState.readAt) return null;
    const next = cloneItem(item);
    next.userState.readAt = now;
    return next;
  });
}

export function projectMarkAllAsRead(
  state: Pick<OptimisticState, "items">,
  platform?: string,
  now: number = Date.now(),
): OptimisticPatch | null {
  return patchItems(state, (item) => {
    if (item.userState.hidden || item.userState.archived || item.userState.readAt) return null;
    if (platform && item.platform !== platform) return null;
    const next = cloneItem(item);
    next.userState.readAt = now;
    return next;
  });
}

export function projectToggleSaved(
  state: Pick<OptimisticState, "items">,
  id: string,
  now: number = Date.now(),
): OptimisticPatch | null {
  return patchItem(state, id, (item) => {
    const next = cloneItem(item);
    const record = next.userState as unknown as UserStateRecord;
    next.userState.saved = !item.userState.saved;
    if (next.userState.saved) {
      next.userState.savedAt = now;
      next.userState.archived = false;
      delete record.archivedAt;
    } else {
      delete record.savedAt;
    }
    return next;
  });
}

export function projectToggleArchived(
  state: Pick<OptimisticState, "items">,
  id: string,
  now: number = Date.now(),
): OptimisticPatch | null {
  return patchItem(state, id, (item) => {
    if (item.userState.saved) return null;
    const next = cloneItem(item);
    const record = next.userState as unknown as UserStateRecord;
    next.userState.archived = !item.userState.archived;
    if (next.userState.archived) {
      next.userState.archivedAt = now;
    } else {
      delete record.archivedAt;
    }
    return next;
  });
}

export function projectArchiveItems(
  state: Pick<OptimisticState, "items">,
  ids: readonly string[],
  now: number = Date.now(),
): OptimisticPatch | null {
  const targets = new Set(ids.filter(Boolean));
  if (targets.size === 0) return null;

  return patchItems(state, (item) => {
    if (!targets.has(item.globalId) || !isArchivable(item)) return null;
    const next = cloneItem(item);
    next.userState.archived = true;
    next.userState.archivedAt = now;
    return next;
  });
}

export function projectArchiveAllReadUnsaved(
  state: Pick<OptimisticState, "items">,
  platform?: string,
  feedUrl?: string,
  now: number = Date.now(),
): OptimisticPatch | null {
  return patchItems(state, (item) => {
    if (!isArchivable(item) || !itemMatchesScope(item, platform, feedUrl)) return null;
    const next = cloneItem(item);
    next.userState.archived = true;
    next.userState.archivedAt = now;
    return next;
  });
}

export function projectToggleLiked(
  state: Pick<OptimisticState, "items">,
  id: string,
  now: number = Date.now(),
): OptimisticPatch | null {
  return patchItem(state, id, (item) => {
    const next = cloneItem(item);
    const record = next.userState as unknown as UserStateRecord;
    if (item.userState.liked) {
      next.userState.liked = false;
      delete record.likedAt;
      delete record.likedSyncedAt;
    } else {
      next.userState.liked = true;
      next.userState.likedAt = now;
      delete record.likedSyncedAt;
    }
    return next;
  });
}

export function projectRemoveItem(
  state: Pick<OptimisticState, "items">,
  id: string,
): OptimisticPatch | null {
  const items = state.items.filter((item) => item.globalId !== id);
  return items.length === state.items.length ? null : { items };
}

export function projectRenameFeed(
  state: Pick<OptimisticState, "feeds">,
  url: string,
  title: string,
): OptimisticPatch | null {
  const feed = state.feeds[url];
  if (!feed || feed.title === title) return null;
  return {
    feeds: {
      ...state.feeds,
      [url]: { ...feed, title } satisfies RssFeed,
    },
  };
}

export function projectUpdatePerson(
  state: Pick<OptimisticState, "friends" | "persons">,
  id: string,
  updates: Partial<Person>,
  now: number = Date.now(),
): OptimisticPatch | null {
  updates = sanitizePersonWrite(updates, { preserveUndefined: true });
  if (Object.keys(updates).length === 0) return null;
  const person = state.persons[id];
  if (!person) return null;

  const nextPerson = {
    ...applyDefinedUpdate(person, updates),
    updatedAt: now,
  } satisfies Person;
  const patch: OptimisticPatch = {
    persons: {
      ...state.persons,
      [id]: nextPerson,
    },
  };

  const friend = state.friends[id];
  if (friend) {
    patch.friends = {
      ...state.friends,
      [id]: {
        ...friend,
        ...updates,
      } as Friend,
    };
  }

  return patch;
}

export function projectUpdateAccount(
  state: Pick<OptimisticState, "accounts">,
  id: string,
  updates: Partial<Account>,
  now: number = Date.now(),
): OptimisticPatch | null {
  updates = sanitizeAccountWrite(updates, { preserveUndefined: true });
  if (Object.keys(updates).length === 0) return null;
  const account = state.accounts[id];
  if (!account) return null;
  return {
    accounts: {
      ...state.accounts,
      [id]: {
        ...applyDefinedUpdate(account, updates),
        updatedAt: now,
      } satisfies Account,
    },
  };
}

export function projectUpdatePreferences(
  state: Pick<OptimisticState, "preferences">,
  updates: Partial<UserPreferences>,
): OptimisticPatch | null {
  const syncedUpdates = stripDeviceLocalPreferenceUpdates(updates);
  if (Object.keys(syncedUpdates).length === 0) return null;
  return {
    preferences: mergePreferenceUpdate(state.preferences, syncedUpdates),
  };
}
