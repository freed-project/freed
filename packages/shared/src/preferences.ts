import type {
  AIPreferences,
  DisplayPreferences,
  ReadingEnhancements,
  UserPreferences,
} from "./types.js";
import { sanitizeUserPreferenceWrite } from "./sync-write-policy.js";

export interface DeviceLocalPreferenceUpdates {
  display?: Partial<{
    sidebarWidth: number;
    sidebarMode: DisplayPreferences["sidebarMode"];
    friendsSidebarWidth: number;
    friendsSidebarOpen: boolean;
    friendsMode: NonNullable<DisplayPreferences["friendsMode"]>;
    debugPanelWidth: number;
    mapMode: NonNullable<DisplayPreferences["mapMode"]>;
    mapTimeMode: NonNullable<DisplayPreferences["mapTimeMode"]>;
    feedSignalModes: NonNullable<DisplayPreferences["feedSignalModes"]>;
    savedContentSortMode: NonNullable<DisplayPreferences["savedContentSortMode"]>;
    dualColumnMode: boolean;
  }>;
  ai?: Pick<AIPreferences, "provider" | "model" | "ollamaUrl">;
}

/**
 * Extract legacy device-local fields so app stores can route them to local
 * persistence without ever forwarding them to Automerge.
 */
export function getDeviceLocalPreferenceUpdates(
  updates: Partial<UserPreferences>,
): DeviceLocalPreferenceUpdates {
  const display = updates.display as Partial<DisplayPreferences> | undefined;
  const reading = display?.reading as Partial<ReadingEnhancements> | undefined;
  const localDisplay = display ? {
    sidebarWidth: display.sidebarWidth,
    sidebarMode: display.sidebarMode,
    friendsSidebarWidth: display.friendsSidebarWidth,
    friendsSidebarOpen: display.friendsSidebarOpen,
    friendsMode: display.friendsMode,
    debugPanelWidth: display.debugPanelWidth,
    mapMode: display.mapMode,
    mapTimeMode: display.mapTimeMode,
    feedSignalModes: display.feedSignalModes ?? (
      display.feedSignalMode && display.feedSignalMode !== "all"
        ? [display.feedSignalMode]
        : display.feedSignalMode === "all"
          ? []
          : undefined
    ),
    savedContentSortMode: display.savedContentSortMode,
    dualColumnMode: reading?.dualColumnMode,
  } : {};
  const cleanDisplay = Object.fromEntries(
    Object.entries(localDisplay).filter(([, value]) => value !== undefined),
  ) as NonNullable<DeviceLocalPreferenceUpdates["display"]>;
  const ai = updates.ai;
  const localAI = ai ? {
    provider: ai.provider,
    model: ai.model,
    ollamaUrl: ai.ollamaUrl,
  } : {};
  const cleanAI = Object.fromEntries(
    Object.entries(localAI).filter(([, value]) => value !== undefined),
  ) as NonNullable<DeviceLocalPreferenceUpdates["ai"]>;

  return {
    ...(Object.keys(cleanDisplay).length > 0 ? { display: cleanDisplay } : {}),
    ...(Object.keys(cleanAI).length > 0 ? { ai: cleanAI } : {}),
  };
}

/**
 * Remove device-local and transient runtime fields before an Automerge mutation.
 * Existing documents retain legacy fields for schema compatibility.
 */
export function stripDeviceLocalPreferenceUpdates(
  updates: Partial<UserPreferences>,
): Partial<UserPreferences> {
  return sanitizeUserPreferenceWrite(updates);
}
