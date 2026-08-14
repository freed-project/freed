import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY =
  "library-core-v1:feedItems.{globalId}.userState.readAt";

export type LibraryCoreFieldAlgebraResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly code: "invalid";
      readonly reason: string;
    };

export interface LibraryCoreOperationFieldAlgebraContract<T> {
  readonly algebraId: string;
  readonly fieldRegistryKey: string;
  readonly merge: (
    current: unknown,
    incoming: unknown,
  ) => LibraryCoreFieldAlgebraResult<T>;
}

function mergeReadAt(
  current: unknown,
  incoming: unknown,
): LibraryCoreFieldAlgebraResult<number> {
  if (
    current !== undefined &&
    !isLibraryCoreNonnegativeSafeInteger(current)
  ) {
    return {
      ok: false,
      code: "invalid",
      reason: "current readAt must be absent or a nonnegative safe integer",
    };
  }
  if (!isLibraryCoreNonnegativeSafeInteger(incoming)) {
    return {
      ok: false,
      code: "invalid",
      reason: "incoming readAt must be a nonnegative safe integer",
    };
  }

  return {
    ok: true,
    value: current === undefined ? incoming : Math.min(current, incoming),
  };
}

/**
 * Reading is monotone. Absence means unread, and the earliest valid read time
 * survives duplicate, reordered, or concurrent assignment delivery.
 */
export const FEED_ITEM_READ_AT_FIELD_ALGEBRA = Object.freeze({
  algebraId: "minimum_present_nonnegative_safe_integer_v1",
  fieldRegistryKey: LIBRARY_CORE_FEED_ITEM_READ_AT_FIELD_REGISTRY_KEY,
  merge: mergeReadAt,
}) satisfies LibraryCoreOperationFieldAlgebraContract<number>;
