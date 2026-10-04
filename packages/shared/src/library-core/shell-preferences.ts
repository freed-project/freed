import { createDefaultPreferences, type UserPreferences } from "../types.js";
import type { LibraryCoreNormalizedReaderRuntime } from "./normalized-feed-readers.js";
import type { LibraryCoreFeedPageSourceV1 } from "./feed-page-contracts.js";
import type { LibraryCorePreferenceValueResponseV1 } from "./preference-value-contracts.js";
import { parseLibraryCorePreferenceScopeResponseV1 } from "./preference-scope-contracts.js";
import { libraryCorePreferenceNodesToValueV1 } from "./preferences-snapshot-contracts.js";
import { decodeLibraryCoreFractionalNumbersV1 } from "./fractional-number-codec.js";

/** Fixed shell settings only. Collections require explicit, separately loaded scopes. */
export interface LibraryCoreShellPreferencesV1 {
  readonly weights: Pick<UserPreferences["weights"], "recency">;
  readonly display: UserPreferences["display"];
  readonly ai: UserPreferences["ai"];
  readonly ulysses: Pick<UserPreferences["ulysses"], "enabled">;
  readonly xCapture: Pick<UserPreferences["xCapture"], "mode" | "includeRetweets" | "includeReplies">;
  readonly storyWall: Omit<UserPreferences["storyWall"], "selectedYears" | "includedPlatforms" | "includedAccountIds" | "featuredItemIds" | "hiddenItemIds">;
}

// Explicit paths prevent new schema fields or growing collections from silently joining startup.
export const LIBRARY_CORE_SHELL_PREFERENCE_PATHS = Object.freeze([
  ["weights", "recency"], ["ulysses", "enabled"],
  ["display", "showEngagementCounts"], ["display", "animationIntensity"], ["display", "archivePruneDays"],
  ["display", "reading", "focusMode"], ["display", "reading", "focusIntensity"],
  ["display", "reading", "markReadOnScroll"], ["display", "reading", "showReadInGrayscale"],
  ["ai", "autoSummarize"], ["ai", "extractTopics"],
  ["xCapture", "mode"], ["xCapture", "includeRetweets"], ["xCapture", "includeReplies"],
  ["storyWall", "enabled"], ["storyWall", "visibilityDefault"], ["storyWall", "layoutPreset"],
  ["storyWall", "embedModeEnabled"], ["storyWall", "lastReviewedAt"],
  ["storyWall", "style", "palette"], ["storyWall", "style", "typographyScale"],
  ["storyWall", "style", "mediaDensity"], ["storyWall", "style", "captionsEnabled"],
  ["storyWall", "style", "locationGroupingEnabled"], ["storyWall", "style", "dateGroupingEnabled"],
  ["storyWall", "style", "motionLevel"], ["storyWall", "publishTarget", "provider"],
  ["storyWall", "publishTarget", "repoName"], ["storyWall", "publishTarget", "branch"],
  ["storyWall", "publishTarget", "directory"], ["storyWall", "publishTarget", "pagesUrl"],
  ["storyWall", "publishTarget", "lastPublishedAt"],
].map(path=>Object.freeze(path)) as readonly (readonly string[])[]);

/** Load one complete finite projection, fenced to the caller's facet/source snapshot. */
export async function readLibraryCoreShellPreferencesV1(
  runtime: LibraryCoreNormalizedReaderRuntime,
  source: LibraryCoreFeedPageSourceV1,
): Promise<LibraryCoreShellPreferencesV1> {
  if (source.projectionRevision !== source.transitionSequence) throw new Error("CURSOR_STALE");
  const request = { queryId: "preference_scope_v1", schemaVersion: 1, paths: LIBRARY_CORE_SHELL_PREFERENCE_PATHS,
    generationId: source.generationId, sourceRevision: source.projectionRevision } as const;
  const parsed = parseLibraryCorePreferenceScopeResponseV1(await runtime.query(request), request);
  if (!parsed.ok) throw new Error(parsed.error);
  return createLibraryCoreShellPreferencesV1(parsed.value.results);
}

/** Only complete, validated selected values may supply the finite shell projection. */
export function createLibraryCoreShellPreferencesV1(
  results: readonly Pick<LibraryCorePreferenceValueResponseV1,"path"|"kind"|"rows">[],
): LibraryCoreShellPreferencesV1 {
  if (results.length!==LIBRARY_CORE_SHELL_PREFERENCE_PATHS.length || results.some((result,index)=>
      JSON.stringify(result.path)!==JSON.stringify(LIBRARY_CORE_SHELL_PREFERENCE_PATHS[index]))) {
    throw new Error("Shell preference scope is incomplete or reordered");
  }
  const selected = new Map<string, unknown>();
  for (const result of results) {
    if (result.kind === "absent") continue;
    if (result.kind !== "value") throw new Error("Shell preference is not a scalar");
    selected.set(JSON.stringify(result.path), decodeLibraryCoreFractionalNumbersV1(libraryCorePreferenceNodesToValueV1(result.rows)._));
  }
  const scalar = <T extends string | number | boolean>(path: readonly string[], fallback: T, choices?: readonly T[]): T => {
    const key = JSON.stringify(path);
    if (!selected.has(key)) return fallback;
    const value = selected.get(key);
    if (typeof value !== typeof fallback || typeof value === "number" && !Number.isFinite(value)
      || choices && !choices.includes(value as T)) throw new Error("Shell preference has an unsupported value");
    return value as T;
  };
  const optional = <T extends string | number>(path: readonly string[], sample: T): T | undefined =>
    selected.has(JSON.stringify(path)) ? scalar(path, sample) : undefined;
  const defaults = createDefaultPreferences();
  const style = defaults.storyWall.style;
  const target = defaults.storyWall.publishTarget;
  const pagesUrl = optional(["storyWall", "publishTarget", "pagesUrl"], "");
  const lastPublishedAt = optional(["storyWall", "publishTarget", "lastPublishedAt"], 0);
  const lastReviewedAt = optional(["storyWall", "lastReviewedAt"], 0);
  return Object.freeze({
    weights: Object.freeze({ recency: scalar(["weights", "recency"], defaults.weights.recency) }),
    ulysses: Object.freeze({ enabled: scalar(["ulysses", "enabled"], defaults.ulysses.enabled) }),
    display: Object.freeze({
      showEngagementCounts: scalar(["display", "showEngagementCounts"], defaults.display.showEngagementCounts),
      animationIntensity: scalar(["display", "animationIntensity"], defaults.display.animationIntensity, ["none", "light", "detailed"]),
      archivePruneDays: scalar(["display", "archivePruneDays"], defaults.display.archivePruneDays),
      reading: Object.freeze({
        focusMode: scalar(["display", "reading", "focusMode"], defaults.display.reading.focusMode),
        focusIntensity: scalar(["display", "reading", "focusIntensity"], defaults.display.reading.focusIntensity, ["light", "normal", "strong"]),
        markReadOnScroll: scalar(["display", "reading", "markReadOnScroll"], defaults.display.reading.markReadOnScroll),
        showReadInGrayscale: scalar(["display", "reading", "showReadInGrayscale"], defaults.display.reading.showReadInGrayscale),
      }),
    }),
    ai: Object.freeze({ autoSummarize: scalar(["ai", "autoSummarize"], defaults.ai.autoSummarize), extractTopics: scalar(["ai", "extractTopics"], defaults.ai.extractTopics) }),
    xCapture: Object.freeze({ mode: scalar(["xCapture", "mode"], defaults.xCapture.mode, ["mirror", "whitelist", "mirror_blacklist"]),
      includeRetweets: scalar(["xCapture", "includeRetweets"], defaults.xCapture.includeRetweets), includeReplies: scalar(["xCapture", "includeReplies"], defaults.xCapture.includeReplies) }),
    storyWall: Object.freeze({
      enabled: scalar(["storyWall", "enabled"], defaults.storyWall.enabled),
      visibilityDefault: scalar(["storyWall", "visibilityDefault"], defaults.storyWall.visibilityDefault, ["private_review", "public"]),
      layoutPreset: scalar(["storyWall", "layoutPreset"], defaults.storyWall.layoutPreset, ["mosaic", "timeline", "magazine", "map_year", "filmstrip"]),
      embedModeEnabled: scalar(["storyWall", "embedModeEnabled"], defaults.storyWall.embedModeEnabled),
      ...(lastReviewedAt === undefined ? {} : { lastReviewedAt }),
      style: Object.freeze({
        palette: scalar(["storyWall", "style", "palette"], style.palette), typographyScale: scalar(["storyWall", "style", "typographyScale"], style.typographyScale),
        mediaDensity: scalar(["storyWall", "style", "mediaDensity"], style.mediaDensity), captionsEnabled: scalar(["storyWall", "style", "captionsEnabled"], style.captionsEnabled),
        locationGroupingEnabled: scalar(["storyWall", "style", "locationGroupingEnabled"], style.locationGroupingEnabled), dateGroupingEnabled: scalar(["storyWall", "style", "dateGroupingEnabled"], style.dateGroupingEnabled),
        motionLevel: scalar(["storyWall", "style", "motionLevel"], style.motionLevel, ["none", "light", "full"]),
      }),
      publishTarget: Object.freeze({ provider: scalar(["storyWall", "publishTarget", "provider"], target.provider, ["none", "github_pages"]),
        repoName: scalar(["storyWall", "publishTarget", "repoName"], target.repoName), branch: scalar(["storyWall", "publishTarget", "branch"], target.branch), directory: scalar(["storyWall", "publishTarget", "directory"], target.directory),
        ...(pagesUrl === undefined ? {} : { pagesUrl }), ...(lastPublishedAt === undefined ? {} : { lastPublishedAt }),
      }),
    }),
  });
}
