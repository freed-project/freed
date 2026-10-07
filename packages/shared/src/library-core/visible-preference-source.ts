import type { LibraryCoreFeedPageParseResult } from "./feed-page-contracts.js";

/** Canonical identity plus the exact ready installation-local intent projection. */
export interface LibraryCoreVisiblePreferenceSourceV1 {
  readonly generationId: string;
  readonly sourceRevision: number;
  readonly localSequence: number;
  readonly actorId: string;
  readonly actorCounter: number;
}

export function parseLibraryCoreVisiblePreferenceSourceV1(input: unknown): LibraryCoreFeedPageParseResult<LibraryCoreVisiblePreferenceSourceV1> {
  const bad = { ok: false as const, error: "Visible preference source is invalid" };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) return bad;
  const keys = ["generationId", "sourceRevision", "localSequence", "actorId", "actorCounter"];
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key) ||
      Object.getOwnPropertyDescriptor(input,key)?.enumerable !== true || !Object.hasOwn(Object.getOwnPropertyDescriptor(input,key)!,"value"))) return bad;
  const value = input as Record<string,unknown>;
  for (const key of ["generationId", "actorId"]) if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key])) return bad;
  for (const key of ["sourceRevision", "localSequence", "actorCounter"]) if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) return bad;
  return { ok: true, value: Object.freeze({ generationId: value.generationId as string, sourceRevision: value.sourceRevision as number,
    localSequence: value.localSequence as number, actorId: value.actorId as string, actorCounter: value.actorCounter as number }) };
}
