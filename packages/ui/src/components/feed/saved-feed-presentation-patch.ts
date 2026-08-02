import type {
  FeedItem,
  SavedFeedPresentationPatch,
  SavedFeedPresentationUserStatePatch,
} from "@freed/shared";

export interface PreparedSavedFeedPresentationPatch {
  readonly patch: SavedFeedPresentationPatch;
  readonly readItemIds: ReadonlySet<string>;
  readonly readPlatforms: ReadonlySet<string>;
  readonly userStates: ReadonlyMap<
    string,
    SavedFeedPresentationUserStatePatch
  >;
}

export interface SavedFeedSelectionPin {
  readonly item: FeedItem;
  readonly readerIdentity: string;
  readonly selectedItemId: string;
}

export function prepareSavedFeedPresentationPatch(
  patch: SavedFeedPresentationPatch,
): PreparedSavedFeedPresentationPatch {
  return {
    patch,
    readItemIds: new Set(patch.readItemIds),
    readPlatforms: new Set(patch.readPlatforms),
    userStates: new Map(
      patch.userStates.map((state) => [state.globalId, state]),
    ),
  };
}

function assignOptionalTimestamp(
  target: Record<string, unknown>,
  key: "likedAt" | "likedSyncedAt" | "seenSyncedAt",
  value: number | null,
): void {
  if (value === null) delete target[key];
  else target[key] = value;
}

/** Apply one compact Desktop signal without retaining or hydrating other rows. */
export function applySavedFeedPresentationPatch(
  item: FeedItem,
  prepared: PreparedSavedFeedPresentationPatch,
): FeedItem {
  const markRead =
    prepared.patch.readAt > 0 &&
    (prepared.readItemIds.has(item.globalId) ||
      prepared.readPlatforms.has(item.platform));
  const compactUserState = prepared.userStates.get(item.globalId);
  if (!markRead && !compactUserState) return item;

  const userState = { ...item.userState };
  if (markRead && !userState.readAt) {
    userState.readAt = prepared.patch.readAt;
  }
  if (compactUserState) {
    userState.liked = compactUserState.liked;
    const writable = userState as unknown as Record<string, unknown>;
    assignOptionalTimestamp(writable, "likedAt", compactUserState.likedAt);
    assignOptionalTimestamp(
      writable,
      "likedSyncedAt",
      compactUserState.likedSyncedAt,
    );
    assignOptionalTimestamp(
      writable,
      "seenSyncedAt",
      compactUserState.seenSyncedAt,
    );
  }
  return { ...item, userState };
}

/** Mirror the exact local like intent fields until the Desktop receipt arrives. */
export function projectSavedFeedLikePresentation(
  item: FeedItem,
  now: number,
): FeedItem {
  const userState = { ...item.userState };
  const writable = userState as unknown as Record<string, unknown>;
  if (userState.liked) {
    userState.liked = false;
    delete writable.likedAt;
  } else {
    userState.liked = true;
    userState.likedAt = now;
  }
  delete writable.likedSyncedAt;
  return { ...item, userState };
}

/**
 * Retain one selected Saved card only while its exact reader identity and
 * selection remain current. A new generation must re-prove membership.
 */
export function resolveSavedFeedSelectionPin(args: {
  readonly current: SavedFeedSelectionPin | null;
  readonly eligible: boolean;
  readonly readerIdentity: string;
  readonly residentSelectedItem: FeedItem | null;
  readonly selectedItemId: string | null;
}): SavedFeedSelectionPin | null {
  if (!args.eligible || !args.selectedItemId) return null;
  if (args.residentSelectedItem) {
    if (
      args.current?.item === args.residentSelectedItem &&
      args.current.readerIdentity === args.readerIdentity &&
      args.current.selectedItemId === args.selectedItemId
    ) {
      return args.current;
    }
    return {
      item: args.residentSelectedItem,
      readerIdentity: args.readerIdentity,
      selectedItemId: args.selectedItemId,
    };
  }
  return args.current?.readerIdentity === args.readerIdentity &&
    args.current.selectedItemId === args.selectedItemId
    ? args.current
    : null;
}
