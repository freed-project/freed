import type {
  LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2,
  LibraryCoreNormalizedPrimaryIntentRuntimeV2,
  LibraryCoreNormalizedPrimaryResultPageV1,
  LibraryCoreNormalizedPrimaryResultRuntimeV2,
} from "@freed/sync/cloud";

import { LibraryServiceFailure } from "./contracts.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";

const LOWERCASE_HEX_64 = /^[a-f0-9]{64}$/u;
const RESULT_RECORD_KEYS = [
  "actorId",
  "authoritativeSourceRevision",
  "authorityEpochId",
  "canonicalResultJson",
  "enqueuedAt",
  "intentEpochId",
  "originalResultDigest",
  "previousResultDigest",
  "rejectionReason",
  "resultDigest",
  "resultSequence",
  "status",
  "transactionDigest",
  "transactionId",
] as const;

type NormalizedPrimaryNativeRuntimeV2 =
  LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2 &
    LibraryCoreNormalizedPrimaryIntentRuntimeV2 &
    LibraryCoreNormalizedPrimaryResultRuntimeV2;

export interface LibraryServiceNormalizedPrimaryNativeRuntimeOptionsV2 {
  readonly native: LibraryCoreNativeCommandClientV1;
  readonly now: () => number;
  readonly subtle: SubtleCrypto;
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return value as Readonly<Record<string, unknown>>;
}

function safeInteger(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return value as number;
}

function hex64(value: unknown): string {
  if (typeof value !== "string" || !LOWERCASE_HEX_64.test(value)) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return value;
}

function optionalHex64(value: unknown): string | null {
  return value === null ? null : hex64(value);
}

function boundedString(value: unknown, maximumBytes: number): string {
  if (typeof value !== "string") {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  const length = new TextEncoder().encode(value).byteLength;
  if (length < 1 || length > maximumBytes) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return value;
}

function parseResultPage(
  value: unknown,
  input: Readonly<{
    actorId: string;
    firstResultSequence: number;
    maximumRecords: number;
    maximumResponseBytes: number;
  }>,
): LibraryCoreNormalizedPrimaryResultPageV1 {
  const page = closedRecord(value, [
    "canonicalRecordBytes",
    "done",
    "nextCursor",
    "records",
  ]);
  if (
    typeof page.done !== "boolean" ||
    !Array.isArray(page.records) ||
    page.records.length > input.maximumRecords ||
    (page.records.length === 0 && !page.done)
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  let expectedSequence = input.firstResultSequence;
  let previousResultDigest: string | null = null;
  let canonicalRecordBytes = 0;
  const canonicalResults = page.records.map((candidate) => {
    const record = closedRecord(candidate, RESULT_RECORD_KEYS);
    const actorId = hex64(record.actorId);
    const resultSequence = safeInteger(record.resultSequence, 1);
    const previousDigest = optionalHex64(record.previousResultDigest);
    const resultDigest = hex64(record.resultDigest);
    hex64(record.authorityEpochId);
    hex64(record.intentEpochId);
    hex64(record.transactionDigest);
    safeInteger(record.authoritativeSourceRevision);
    safeInteger(record.enqueuedAt);
    boundedString(record.status, 64);
    boundedString(record.transactionId, 255);
    if (record.originalResultDigest !== null) {
      hex64(record.originalResultDigest);
    }
    if (record.rejectionReason !== null) {
      boundedString(record.rejectionReason, 255);
    }
    if (
      actorId !== input.actorId ||
      resultSequence !== expectedSequence ||
      (previousResultDigest !== null &&
        previousDigest !== previousResultDigest) ||
      (resultSequence === 1 && previousDigest !== null)
    ) {
      throw new LibraryServiceFailure("command_response_invalid");
    }
    const canonicalResultJson = boundedString(
      record.canonicalResultJson,
      input.maximumResponseBytes,
    );
    const bytes = new TextEncoder().encode(canonicalResultJson);
    canonicalRecordBytes += bytes.byteLength;
    expectedSequence += 1;
    previousResultDigest = resultDigest;
    return bytes;
  });
  if (safeInteger(page.canonicalRecordBytes) !== canonicalRecordBytes) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  if (page.nextCursor === null) {
    if (input.firstResultSequence !== 1 || canonicalResults.length !== 0) {
      throw new LibraryServiceFailure("command_response_invalid");
    }
  } else {
    const cursor = closedRecord(page.nextCursor, [
      "actorId",
      "resultDigest",
      "resultSequence",
    ]);
    const expectedCursorSequence =
      canonicalResults.length === 0
        ? input.firstResultSequence - 1
        : input.firstResultSequence + canonicalResults.length - 1;
    const cursorDigest = hex64(cursor.resultDigest);
    if (
      hex64(cursor.actorId) !== input.actorId ||
      safeInteger(cursor.resultSequence, 1) !== expectedCursorSequence ||
      (canonicalResults.length > 0 && cursorDigest !== previousResultDigest)
    ) {
      throw new LibraryServiceFailure("command_response_invalid");
    }
  }
  return Object.freeze({
    canonicalResults: Object.freeze(canonicalResults),
    done: page.done,
  });
}

/**
 * Bind the transport-neutral Primary coordinators to the generated native
 * command channel. This adapter owns no provider client, timer, credential,
 * retry loop, or durable cursor. SQLite resolves result-chain predecessors.
 */
export function createLibraryServiceNormalizedPrimaryNativeRuntimeV2(
  options: LibraryServiceNormalizedPrimaryNativeRuntimeOptionsV2,
): NormalizedPrimaryNativeRuntimeV2 {
  return Object.freeze({
    async countersignEnrollment(
      input: Parameters<
        LibraryCoreNormalizedPrimaryEnrollmentRuntimeV2["countersignEnrollment"]
      >[0],
    ) {
      return options.native.execute(
        "countersign_follower_actor_request_v2",
        input,
      );
    },
    async ingestIntentPage(
      input: Parameters<
        LibraryCoreNormalizedPrimaryIntentRuntimeV2["ingestIntentPage"]
      >[0],
    ) {
      return options.native.execute("ingest_follower_intent_page_v1", input);
    },
    now: options.now,
    async readActorState(
      actorId: Parameters<
        LibraryCoreNormalizedPrimaryIntentRuntimeV2["readActorState"]
      >[0],
    ) {
      return options.native.execute(
        "primary_follower_actor_transport_state_v1",
        { actorId },
      );
    },
    async exportResultPage(
      input: Parameters<
        LibraryCoreNormalizedPrimaryResultRuntimeV2["exportResultPage"]
      >[0],
    ) {
      const value = await options.native.execute(
        "export_follower_result_page_v2",
        input,
      );
      return parseResultPage(value, input);
    },
    subtle: options.subtle,
  });
}
