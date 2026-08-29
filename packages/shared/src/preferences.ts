import type { UserPreferences } from "./types.js";
import { sanitizeUserPreferenceWrite } from "./sync-write-policy.js";

/**
 * Admit only fields owned by synchronized preferences. Installation-local
 * settings use their dedicated stores and never enter this mutation API.
 */
export function assertSupportedUserPreferenceWrite(
  updates: Partial<UserPreferences>,
): Partial<UserPreferences> {
  const synchronized = sanitizeUserPreferenceWrite(updates);
  if (!hasSameObjectShape(updates, synchronized)) {
    throw new TypeError("Preference update contains unsupported fields");
  }
  return synchronized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSameObjectShape(source: unknown, admitted: unknown): boolean {
  if (!isRecord(source) || !isRecord(admitted)) return source === admitted;
  const sourceKeys = Object.keys(source).filter(
    (key) => source[key] !== undefined,
  );
  const admittedKeys = Object.keys(admitted).filter(
    (key) => admitted[key] !== undefined,
  );
  if (
    sourceKeys.length !== admittedKeys.length ||
    sourceKeys.some((key) => !Object.prototype.hasOwnProperty.call(admitted, key))
  ) {
    return false;
  }
  return sourceKeys.every((key) =>
    !isRecord(source[key]) || hasSameObjectShape(source[key], admitted[key]),
  );
}
