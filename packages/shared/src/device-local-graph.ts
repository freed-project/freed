import type { Account, Person } from "./types.js";

export type GraphPositionFields = Pick<
  Person,
  "graphX" | "graphY" | "graphPinned" | "graphUpdatedAt"
>;

type GraphPositionUpdate = Partial<Person> | Partial<Account>;

/**
 * Extract graph placement fields that belong to one device's viewport.
 */
export function getDeviceLocalGraphPositionUpdates(
  updates: GraphPositionUpdate,
): Partial<GraphPositionFields> {
  const local: Partial<GraphPositionFields> = {};
  if ("graphX" in updates) local.graphX = updates.graphX;
  if ("graphY" in updates) local.graphY = updates.graphY;
  if ("graphPinned" in updates) local.graphPinned = updates.graphPinned;
  if ("graphUpdatedAt" in updates) local.graphUpdatedAt = updates.graphUpdatedAt;
  return local;
}

/**
 * Remove graph placement fields before a Person or Account update reaches
 * Automerge. Positions are device-local because their coordinate system is
 * derived from the current viewport.
 */
export function stripDeviceLocalGraphPositionUpdates<T extends GraphPositionUpdate>(
  updates: T,
): T {
  const {
    graphX: _graphX,
    graphY: _graphY,
    graphPinned: _graphPinned,
    graphUpdatedAt: _graphUpdatedAt,
    ...synced
  } = updates;
  return synced as T;
}
