import type { LocalAIHardwareProfile, LocalAIModelId } from "./types";

const GIB = 1024 ** 3;

export const LOCAL_AI_LIGHT_PACK_ID: LocalAIModelId = "integrated-light";
export const LOCAL_AI_BALANCED_PACK_ID: LocalAIModelId = "integrated-balanced";
export const LOCAL_AI_PRO_PACK_ID: LocalAIModelId = "integrated-pro";

export function recommendLocalAIModelId(
  profile: Pick<LocalAIHardwareProfile, "totalMemoryBytes" | "webGPUAvailable" | "availableAppDataBytes"> | null | undefined,
): LocalAIModelId {
  if (!profile?.webGPUAvailable) return LOCAL_AI_LIGHT_PACK_ID;

  const totalMemoryBytes = profile.totalMemoryBytes ?? 0;
  if (totalMemoryBytes < 12 * GIB) return LOCAL_AI_LIGHT_PACK_ID;

  const availableStorage = profile.availableAppDataBytes;
  if (totalMemoryBytes >= 24 * GIB && (availableStorage == null || availableStorage >= 6 * GIB)) {
    return LOCAL_AI_PRO_PACK_ID;
  }

  return LOCAL_AI_BALANCED_PACK_ID;
}
