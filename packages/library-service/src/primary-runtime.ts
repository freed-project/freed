import {
  createLibraryCorePrimaryCoordinatorV1,
  type LibraryCorePrimaryClockPortV1,
  type LibraryCorePrimaryCoordinatorDiagnosticV1,
  type LibraryCorePrimaryDiagnosticsPortV1,
  type LibraryCorePrimaryPublicationResultV1,
  type LibraryCorePrimarySchedulerPortV1,
} from "@freed/sync/cloud/library-core-primary-coordinator";

import { LibraryServiceFailure } from "./contracts.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";

const LOWERCASE_HEX_64 = /^[a-f0-9]{64}$/u;
const CHECKPOINT_FORMAT = "freed_normalized_checkpoint_export_v2";
const CHECKPOINT_PROTOCOL_VERSION = 2;

interface PrimaryActorIdentityV1 {
  readonly actorId: string;
  readonly libraryId: string;
}

interface PrimaryCheckpointIdentityV2 {
  readonly authorityEpoch: string;
  readonly causalFrontierDigest: string;
  readonly libraryId: string;
  readonly sourceRevision: number;
  readonly writerId: string;
}

export interface LibraryServicePrimaryPublicationStatePortV1 {
  lastPublishedRevision(): Promise<number | null>;
}

export interface LibraryServicePrimaryPublicationPortV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
> {
  publish(input: {
    readonly native: LibraryCoreNativeCommandClientV1;
    readonly reason: "initial" | "local_revision" | "inbound_refresh";
    readonly signal: AbortSignal;
  }): Promise<Result>;
}

export interface LibraryServicePrimaryRuntimeOptionsV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
  TimerHandle,
> {
  readonly clock: LibraryCorePrimaryClockPortV1;
  readonly diagnostics: LibraryCorePrimaryDiagnosticsPortV1;
  readonly installationWitness: string;
  readonly native: LibraryCoreNativeCommandClientV1;
  readonly publication: LibraryServicePrimaryPublicationPortV1<Result>;
  readonly publicationState: LibraryServicePrimaryPublicationStatePortV1;
  readonly scheduler: LibraryCorePrimarySchedulerPortV1<TimerHandle>;
}

export interface LibraryServicePrimaryRuntimeV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
> {
  start(): Promise<Result>;
  stop(): void;
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
  const record = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return record;
}

function hex64(value: unknown): string {
  if (typeof value !== "string" || !LOWERCASE_HEX_64.test(value)) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return value as number;
}

function parsePrimaryActorIdentityV1(value: unknown): PrimaryActorIdentityV1 {
  const record = closedRecord(value, ["actorId", "libraryId"]);
  return Object.freeze({
    actorId: hex64(record.actorId),
    libraryId: hex64(record.libraryId),
  });
}

function parsePrimaryCheckpointIdentityV2(
  value: unknown,
): PrimaryCheckpointIdentityV2 {
  const record = closedRecord(value, [
    "authorityEpoch",
    "causalFrontierDigest",
    "format",
    "itemCount",
    "libraryId",
    "protocolVersion",
    "recordCount",
    "sourceRevision",
    "writerId",
  ]);
  if (
    record.format !== CHECKPOINT_FORMAT ||
    record.protocolVersion !== CHECKPOINT_PROTOCOL_VERSION
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  nonnegativeInteger(record.itemCount);
  nonnegativeInteger(record.recordCount);
  return Object.freeze({
    authorityEpoch: hex64(record.authorityEpoch),
    causalFrontierDigest: hex64(record.causalFrontierDigest),
    libraryId: hex64(record.libraryId),
    sourceRevision: nonnegativeInteger(record.sourceRevision),
    writerId: hex64(record.writerId),
  });
}

function assertSamePrimary(
  actor: PrimaryActorIdentityV1,
  checkpoint: PrimaryCheckpointIdentityV2,
): void {
  if (
    actor.libraryId !== checkpoint.libraryId ||
    actor.actorId !== checkpoint.writerId
  ) {
    throw new LibraryServiceFailure("authority_not_primary");
  }
}

export function createLibraryServicePrimaryRuntimeV1<
  Result extends LibraryCorePrimaryPublicationResultV1,
  TimerHandle,
>(
  options: LibraryServicePrimaryRuntimeOptionsV1<Result, TimerHandle>,
): LibraryServicePrimaryRuntimeV1<Result> {
  if (!LOWERCASE_HEX_64.test(options.installationWitness)) {
    throw new LibraryServiceFailure("config_invalid");
  }
  let primaryIdentity: PrimaryActorIdentityV1 | null = null;

  const readActorIdentity = async (): Promise<PrimaryActorIdentityV1> =>
    parsePrimaryActorIdentityV1(
      await options.native.execute("primary_actor_identity_v1", {
        installationWitness: options.installationWitness,
      }),
    );
  const readCheckpoint = async (): Promise<PrimaryCheckpointIdentityV2> =>
    parsePrimaryCheckpointIdentityV2(
      await options.native.execute("describe_checkpoint_export_v2", {}),
    );

  const coordinator = createLibraryCorePrimaryCoordinatorV1({
    authority: {
      async assertPrimary(): Promise<void> {
        const [actor, checkpoint] = await Promise.all([
          readActorIdentity(),
          readCheckpoint(),
        ]);
        assertSamePrimary(actor, checkpoint);
        primaryIdentity = actor;
      },
    },
    durableState: {
      async read() {
        const actor = primaryIdentity;
        if (actor === null) {
          throw new LibraryServiceFailure("authority_not_primary");
        }
        const [checkpoint, lastPublishedRevision] = await Promise.all([
          readCheckpoint(),
          options.publicationState.lastPublishedRevision(),
        ]);
        if (
          lastPublishedRevision !== null &&
          (!Number.isSafeInteger(lastPublishedRevision) ||
            lastPublishedRevision < 0)
        ) {
          throw new LibraryServiceFailure("command_response_invalid");
        }
        return Object.freeze({
          active:
            checkpoint.libraryId === actor.libraryId &&
            checkpoint.writerId === actor.actorId,
          localRevision: checkpoint.sourceRevision,
          lastPublishedRevision,
        });
      },
    },
    clock: options.clock,
    scheduler: options.scheduler,
    diagnostics: options.diagnostics,
    publication: {
      publish({ reason, signal }) {
        return options.publication.publish({
          native: options.native,
          reason,
          signal,
        });
      },
    },
  });

  return Object.freeze({
    start: () => coordinator.start(),
    stop: () => coordinator.stop(),
  });
}

export type { LibraryCorePrimaryCoordinatorDiagnosticV1 };
