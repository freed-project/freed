import {
  LIBRARY_CORE_CAPABILITY_OPERATION_IDS,
  LIBRARY_CORE_OPERATION_IDS,
  type LibraryCoreCapabilityOperationId,
  type LibraryCoreOperationId,
} from "./sqlite-contract.generated.js";

export {
  LIBRARY_CORE_CAPABILITY_OPERATION_IDS,
  LIBRARY_CORE_OPERATION_IDS,
  type LibraryCoreCapabilityOperationId,
  type LibraryCoreOperationId,
};

const LIBRARY_CORE_EXECUTABLE_MUTATION_ID_SET: ReadonlySet<string> = new Set(
  LIBRARY_CORE_CAPABILITY_OPERATION_IDS,
);

export function isLibraryCoreExecutableMutationId(
  value: unknown,
): value is LibraryCoreCapabilityOperationId {
  return (
    typeof value === "string" &&
    LIBRARY_CORE_EXECUTABLE_MUTATION_ID_SET.has(value)
  );
}
