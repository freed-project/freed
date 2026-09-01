import {
  syncLibraryCoreNormalizedPrimaryEnrollmentsV2,
  syncLibraryCoreNormalizedPrimaryIntentsV2,
  syncLibraryCoreNormalizedPrimaryResultsV2,
  type LibraryCoreNormalizedPrimaryEnrollmentReceiptV2,
  type LibraryCoreNormalizedPrimaryEnrollmentTransportV2,
  type LibraryCoreNormalizedPrimaryIntentTransportV2,
  type LibraryCoreNormalizedPrimaryResultTransportV2,
} from "@freed/sync/cloud";
import {
  isLibraryCoreLowercaseHex64,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import type { LibraryCorePrimaryPublicationResultV1 } from "@freed/sync/cloud/library-core-primary-coordinator";

import { LibraryServiceFailure } from "./contracts.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import { createLibraryServiceNormalizedPrimaryNativeRuntimeV2 } from "./normalized-primary-native-runtime.js";
import type { LibraryServicePrimaryPublicationPortV1 } from "./primary-runtime.js";

const ACTOR_PAGE_LIMIT = 16;

export interface LibraryServiceNormalizedPrimaryActorPageV2 {
  readonly actorIds: readonly LibraryCoreLowercaseHex64[];
  readonly done: boolean;
  readonly nextActorId: LibraryCoreLowercaseHex64 | null;
}

export interface LibraryServiceNormalizedPrimaryTransportV2
  extends LibraryCoreNormalizedPrimaryEnrollmentTransportV2,
    LibraryCoreNormalizedPrimaryIntentTransportV2,
    LibraryCoreNormalizedPrimaryResultTransportV2 {
  pageActors(input: Readonly<{
    afterActorId: LibraryCoreLowercaseHex64 | null;
    libraryId: LibraryCoreLowercaseHex64;
    limit: number;
    storageEpochId: LibraryCoreLowercaseHex64;
  }>): Promise<LibraryServiceNormalizedPrimaryActorPageV2>;
}

export interface LibraryServiceNormalizedPrimaryRefreshReceiptV2 {
  readonly actorPageDone: boolean;
  readonly enrollment: LibraryCoreNormalizedPrimaryEnrollmentReceiptV2;
  readonly importedIntentCount: number;
  readonly nextActorId: LibraryCoreLowercaseHex64 | null;
  readonly processedActorCount: number;
  readonly publishedResultCount: number;
}

export interface LibraryServiceNormalizedPrimaryOrchestrationV2 {
  refresh(
    signal: AbortSignal,
  ): Promise<LibraryServiceNormalizedPrimaryRefreshReceiptV2>;
}

export interface LibraryServiceNormalizedPrimaryOrchestrationOptionsV2 {
  readonly native: LibraryCoreNativeCommandClientV1;
  readonly now: () => number;
  readonly subtle: SubtleCrypto;
  readonly transport: LibraryServiceNormalizedPrimaryTransportV2;
}

/** Run normalized inbound work only on the scheduler's existing inbound pass. */
export function createLibraryServiceNormalizedPrimaryPublicationV2<
  Result extends LibraryCorePrimaryPublicationResultV1,
>(
  publication: LibraryServicePrimaryPublicationPortV1<Result>,
  normalizedPrimary: LibraryServiceNormalizedPrimaryOrchestrationV2,
): LibraryServicePrimaryPublicationPortV1<Result> {
  return Object.freeze({
    async publish(
      input: Parameters<
        LibraryServicePrimaryPublicationPortV1<Result>["publish"]
      >[0],
    ) {
      if (input.reason === "inbound_refresh") {
        await normalizedPrimary.refresh(input.signal);
      }
      return publication.publish(input);
    },
  });
}

function checkpointContext(value: unknown): Readonly<{
  libraryId: LibraryCoreLowercaseHex64;
  storageEpochId: LibraryCoreLowercaseHex64;
}> {
  try {
    const descriptor = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
      value,
    );
    return Object.freeze({
      libraryId: descriptor.libraryId,
      storageEpochId: descriptor.authorityEpoch,
    });
  } catch {
    throw new LibraryServiceFailure("command_response_invalid");
  }
}

function actorPage(
  value: LibraryServiceNormalizedPrimaryActorPageV2,
  afterActorId: LibraryCoreLowercaseHex64 | null,
): LibraryServiceNormalizedPrimaryActorPageV2 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(value).sort().join(",") !== "actorIds,done,nextActorId" ||
    typeof value.done !== "boolean" ||
    !Array.isArray(value.actorIds) ||
    value.actorIds.length > ACTOR_PAGE_LIMIT ||
    (value.actorIds.length === 0 && !value.done) ||
    value.actorIds.some((candidate) => !isLibraryCoreLowercaseHex64(candidate)) ||
    value.actorIds.some(
      (candidate, index) =>
        (index === 0 && afterActorId !== null && candidate <= afterActorId) ||
        (index > 0 && candidate <= value.actorIds[index - 1]!),
    ) ||
    (value.nextActorId !== null &&
      !isLibraryCoreLowercaseHex64(value.nextActorId)) ||
    value.nextActorId !== (value.actorIds.at(-1) ?? null)
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return Object.freeze({
    actorIds: Object.freeze([...value.actorIds]),
    done: value.done,
    nextActorId: value.nextActorId,
  });
}

/**
 * Run one bounded provider-neutral inbound Primary pass.
 *
 * The transport owns discovery and immutable bytes. This orchestrator owns no
 * provider client, timer, credential, retry loop, or durable cursor. Native
 * SQLite remains the authority for actor counters and result sequences.
 */
export function createLibraryServiceNormalizedPrimaryOrchestrationV2(
  options: LibraryServiceNormalizedPrimaryOrchestrationOptionsV2,
): LibraryServiceNormalizedPrimaryOrchestrationV2 {
  const runtime = createLibraryServiceNormalizedPrimaryNativeRuntimeV2({
    native: options.native,
    now: options.now,
    subtle: options.subtle,
  });
  let afterActorId: LibraryCoreLowercaseHex64 | null = null;
  return Object.freeze({
    async refresh(
      signal: AbortSignal,
    ): Promise<LibraryServiceNormalizedPrimaryRefreshReceiptV2> {
      signal.throwIfAborted();
      const context = checkpointContext(
        await options.native.execute("describe_checkpoint_export_v2", {}),
      );
      signal.throwIfAborted();
      const enrollment =
        await syncLibraryCoreNormalizedPrimaryEnrollmentsV2(
          options.transport,
          runtime,
          context,
          { signal },
        );
      signal.throwIfAborted();
      const actors = actorPage(
        await options.transport.pageActors({
          afterActorId,
          ...context,
          limit: ACTOR_PAGE_LIMIT,
        }),
        afterActorId,
      );
      let importedIntentCount = 0;
      let publishedResultCount = 0;
      for (const actorId of actors.actorIds) {
        signal.throwIfAborted();
        const actorContext = Object.freeze({ ...context, actorId });
        const intents = await syncLibraryCoreNormalizedPrimaryIntentsV2(
          options.transport,
          runtime,
          actorContext,
          { signal },
        );
        importedIntentCount += intents.importedIntentCount;
        signal.throwIfAborted();
        const results = await syncLibraryCoreNormalizedPrimaryResultsV2(
          options.transport,
          runtime,
          actorContext,
          { signal },
        );
        publishedResultCount += results.publishedResultCount;
      }
      afterActorId = actors.done ? null : actors.nextActorId;
      return Object.freeze({
        actorPageDone: actors.done,
        enrollment,
        importedIntentCount,
        nextActorId: afterActorId,
        processedActorCount: actors.actorIds.length,
        publishedResultCount,
      });
    },
  });
}
