import {
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
  decodeLibraryCoreCanonicalValue,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointExportPageV2,
  type LibraryCoreControlPointerV1,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";
import {
  createGoogleDriveLibraryCoreAdapterV1,
  provisionGoogleDriveLibraryCoreControlV1,
  publishLibraryCoreNormalizedCheckpointV2,
  type GoogleDriveFetch,
  type LibraryCoreControlReadV1,
  type LibraryCoreImmutablePublicationAdapterV1,
} from "@freed/sync/cloud/library-core";

import { LibraryServiceFailure } from "./contracts.js";
import {
  LIBRARY_SERVICE_MAX_DESCRIPTOR_BYTES,
  type LibraryServiceBoundPath,
  type LibraryServiceFileSystemPort,
} from "./contracts.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import type { LibraryServicePrimaryPublicationPortV1 } from "./primary-runtime.js";

const LOWERCASE_HEX_64 = /^[a-f0-9]{64}$/u;
const MAX_CONTROL_REVISION_BYTES = 1_024;

export interface LibraryServiceGoogleDrivePublicationStateV1 {
  readonly schemaVersion: 1;
  readonly libraryId: string;
  readonly authorityEpoch: string;
  readonly writerId: string;
  readonly controlFileId: string;
  readonly controlRevision: string;
  readonly lastPublishedRevision: number;
}

export interface LibraryServiceGoogleDrivePublicationStatePortV1 {
  read(): Promise<LibraryServiceGoogleDrivePublicationStateV1 | null>;
  write(state: LibraryServiceGoogleDrivePublicationStateV1): Promise<void>;
}

export interface LibraryServiceGoogleDriveTokenPortV1 {
  accessToken(signal: AbortSignal): Promise<string>;
}

export type LibraryServiceGoogleDrivePublicationResultV1 =
  | { readonly status: "published"; readonly revision: number }
  | { readonly status: "current"; readonly revision: number }
  | {
      readonly status: "ownership_required";
      readonly currentWriterId: string;
      readonly localWriterId: string;
    };

interface ProvisionedControlV1 {
  readonly controlFileId: string;
}

interface GoogleDrivePublicationTransportV1 {
  provision(input: {
    readonly accessToken: string;
    readonly libraryId: string;
    readonly signal: AbortSignal;
  }): Promise<ProvisionedControlV1>;
  adapter(input: {
    readonly accessToken: string;
    readonly controlFileId: string;
    readonly libraryId: string;
    readonly signal: AbortSignal;
  }): LibraryCoreImmutablePublicationAdapterV1<Uint8Array>;
}

export interface LibraryServiceGoogleDrivePublicationOptionsV1 {
  readonly googleFetch?: GoogleDriveFetch;
  readonly state: LibraryServiceGoogleDrivePublicationStatePortV1;
  readonly token: LibraryServiceGoogleDriveTokenPortV1;
  readonly transport?: GoogleDrivePublicationTransportV1;
}

export function createBoundGoogleDrivePublicationStatePortV1(
  stateFile: LibraryServiceBoundPath,
  fileSystem: LibraryServiceFileSystemPort,
): LibraryServiceGoogleDrivePublicationStatePortV1 {
  return Object.freeze({
    async read(): Promise<LibraryServiceGoogleDrivePublicationStateV1 | null> {
      let bytes: Uint8Array;
      try {
        bytes = await stateFile.readBoundedBytes(
          LIBRARY_SERVICE_MAX_DESCRIPTOR_BYTES,
        );
      } catch {
        throw new LibraryServiceFailure("cloud_state_invalid");
      }
      if (bytes.byteLength === 0) return null;
      try {
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return closedState(JSON.parse(decoded));
      } catch (error) {
        if (error instanceof LibraryServiceFailure) throw error;
        throw new LibraryServiceFailure("cloud_state_invalid");
      }
    },
    async write(
      state: LibraryServiceGoogleDrivePublicationStateV1,
    ): Promise<void> {
      const parsed = closedState(state);
      if (parsed === null) {
        throw new LibraryServiceFailure("cloud_state_invalid");
      }
      try {
        await fileSystem.writePrivateStatusText(
          stateFile,
          `${JSON.stringify(parsed)}\n`,
        );
      } catch {
        throw new LibraryServiceFailure("cloud_state_invalid");
      }
    },
  });
}

function closedState(
  value: LibraryServiceGoogleDrivePublicationStateV1 | null,
): LibraryServiceGoogleDrivePublicationStateV1 | null {
  if (value === null) return null;
  if (
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(value).sort().join(",") !==
      "authorityEpoch,controlFileId,controlRevision,lastPublishedRevision,libraryId,schemaVersion,writerId" ||
    value.schemaVersion !== 1 ||
    !LOWERCASE_HEX_64.test(value.libraryId) ||
    !LOWERCASE_HEX_64.test(value.authorityEpoch) ||
    !LOWERCASE_HEX_64.test(value.writerId) ||
    typeof value.controlFileId !== "string" ||
    value.controlFileId.length === 0 ||
    value.controlFileId.length > MAX_CONTROL_REVISION_BYTES ||
    typeof value.controlRevision !== "string" ||
    value.controlRevision.length === 0 ||
    value.controlRevision.length > MAX_CONTROL_REVISION_BYTES ||
    !Number.isSafeInteger(value.lastPublishedRevision) ||
    value.lastPublishedRevision < 0
  ) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  return Object.freeze({ ...value });
}

function parseControl(
  read: LibraryCoreControlReadV1,
): LibraryCoreControlPointerV1 | null {
  if (read.bytes === null) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  let value: unknown;
  try {
    value = decodeLibraryCoreCanonicalValue(read.bytes.slice());
  } catch {
    throw new LibraryServiceFailure("command_response_invalid");
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return null;
  }
  try {
    return parseLibraryCoreControlPointerV1(value);
  } catch {
    throw new LibraryServiceFailure("command_response_invalid");
  }
}

function exactDescriptor(
  value: unknown,
): LibraryCoreNormalizedCheckpointExportDescriptorV2 {
  try {
    return parseLibraryCoreNormalizedCheckpointExportDescriptorV2(value);
  } catch {
    throw new LibraryServiceFailure("command_response_invalid");
  }
}

async function* checkpointRecords(
  native: LibraryCoreNativeCommandClientV1,
  snapshot: LibraryCoreNormalizedCheckpointExportDescriptorV2,
): AsyncIterable<LibraryCoreNormalizedCheckpointRecordV2> {
  let after: {
    readonly registryKey: string;
    readonly primaryKeyJson: string;
  } | null = null;
  let recordCount = 0;
  for (;;) {
    let page;
    try {
      page = parseLibraryCoreNormalizedCheckpointExportPageV2(
        await native.execute("export_checkpoint_page_v2", {
          snapshot,
          page: {
            after,
            maximumRecords: LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
            maximumResponseBytes:
              LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
          },
        }),
      );
    } catch (error) {
      if (error instanceof LibraryServiceFailure) throw error;
      throw new LibraryServiceFailure("command_response_invalid");
    }
    for (const record of page.records) {
      recordCount += 1;
      yield record;
    }
    if (page.done) break;
    if (
      page.nextCursor === null ||
      (after !== null &&
        after.registryKey === page.nextCursor.registryKey &&
        after.primaryKeyJson === page.nextCursor.primaryKeyJson)
    ) {
      throw new LibraryServiceFailure("command_response_invalid");
    }
    after = page.nextCursor;
  }
  if (recordCount !== snapshot.recordCount) {
    throw new LibraryServiceFailure("command_response_invalid");
  }
}

function sameAuthority(
  state: LibraryServiceGoogleDrivePublicationStateV1,
  descriptor: LibraryCoreNormalizedCheckpointExportDescriptorV2,
): boolean {
  return (
    state.libraryId === descriptor.libraryId &&
    state.authorityEpoch === descriptor.authorityEpoch &&
    state.writerId === descriptor.writerId
  );
}

function defaultTransport(
  googleFetch?: GoogleDriveFetch,
): GoogleDrivePublicationTransportV1 {
  return Object.freeze({
    provision: (input: {
      readonly accessToken: string;
      readonly libraryId: string;
      readonly signal: AbortSignal;
    }) => provisionGoogleDriveLibraryCoreControlV1({ ...input, googleFetch }),
    adapter: (input: {
      readonly accessToken: string;
      readonly controlFileId: string;
      readonly libraryId: string;
      readonly signal: AbortSignal;
    }) => createGoogleDriveLibraryCoreAdapterV1({ ...input, googleFetch }),
  });
}

/**
 * Bind the headless Primary to the existing immutable Google Drive protocol.
 *
 * This port owns no timer and no credential persistence. Each pass resolves one
 * access token, proves the current cloud writer, exports bounded native pages,
 * and records durable state only after the control compare and swap commits.
 */
export function createLibraryServiceGoogleDrivePublicationV1(
  options: LibraryServiceGoogleDrivePublicationOptionsV1,
): LibraryServicePrimaryPublicationPortV1<LibraryServiceGoogleDrivePublicationResultV1> & {
  lastPublishedRevision(): Promise<number | null>;
} {
  const transport = options.transport ?? defaultTransport(options.googleFetch);
  return Object.freeze({
    async lastPublishedRevision(): Promise<number | null> {
      return (
        closedState(await options.state.read())?.lastPublishedRevision ?? null
      );
    },
    async publish({
      native,
      signal,
    }: {
      readonly native: LibraryCoreNativeCommandClientV1;
      readonly reason: "initial" | "local_revision" | "inbound_refresh";
      readonly signal: AbortSignal;
    }): Promise<LibraryServiceGoogleDrivePublicationResultV1> {
      if (signal.aborted) throw new LibraryServiceFailure("startup_cancelled");
      const descriptor = exactDescriptor(
        await native.execute("describe_checkpoint_export_v2", {}),
      );
      const persisted = closedState(await options.state.read());
      if (persisted !== null && !sameAuthority(persisted, descriptor)) {
        throw new LibraryServiceFailure("authority_not_primary");
      }
      const accessToken = await options.token.accessToken(signal);
      if (
        typeof accessToken !== "string" ||
        accessToken.length === 0 ||
        accessToken.length > 16_384
      ) {
        throw new LibraryServiceFailure("credential_descriptor_invalid");
      }
      const provisioned = await transport.provision({
        accessToken,
        libraryId: descriptor.libraryId,
        signal,
      });
      const adapter = transport.adapter({
        accessToken,
        controlFileId: provisioned.controlFileId,
        libraryId: descriptor.libraryId,
        signal,
      });
      const controlRead = await adapter.readControl();
      const pointer = parseControl(controlRead);
      if (
        pointer !== null &&
        (String(pointer.writerId) !== String(descriptor.writerId) ||
          String(pointer.storageEpoch) !== String(descriptor.authorityEpoch))
      ) {
        return Object.freeze({
          status: "ownership_required" as const,
          currentWriterId: pointer.writerId,
          localWriterId: descriptor.writerId,
        });
      }
      if (
        pointer !== null &&
        pointer.causalFrontierDigest === descriptor.causalFrontierDigest &&
        persisted?.lastPublishedRevision === descriptor.sourceRevision &&
        persisted.controlFileId === provisioned.controlFileId &&
        persisted.controlRevision === controlRead.revision
      ) {
        return Object.freeze({
          status: "current" as const,
          revision: descriptor.sourceRevision,
        });
      }
      const exportDescriptor = exactDescriptor(
        await native.execute("begin_checkpoint_export_v2", {}),
      );
      if (
        exportDescriptor.libraryId !== descriptor.libraryId ||
        exportDescriptor.authorityEpoch !== descriptor.authorityEpoch ||
        exportDescriptor.writerId !== descriptor.writerId
      ) {
        throw new LibraryServiceFailure("authority_not_primary");
      }
      const result = await publishLibraryCoreNormalizedCheckpointV2({
        activeTransport: "google_drive_app_data_v1",
        adapter,
        descriptor: exportDescriptor,
        expectedControl: { revision: controlRead.revision, pointer },
        generation: pointer === null ? 0 : pointer.generation + 1,
        records: checkpointRecords(native, exportDescriptor),
        subtle: crypto.subtle,
      });
      if (result.status === "conflict") {
        if (
          result.currentControlPointer !== null &&
          String(result.currentControlPointer.writerId) !==
            String(exportDescriptor.writerId)
        ) {
          return Object.freeze({
            status: "ownership_required" as const,
            currentWriterId: result.currentControlPointer.writerId,
            localWriterId: exportDescriptor.writerId,
          });
        }
        throw new LibraryServiceFailure("command_channel_failed");
      }
      await options.state.write(
        Object.freeze({
          schemaVersion: 1 as const,
          libraryId: exportDescriptor.libraryId,
          authorityEpoch: exportDescriptor.authorityEpoch,
          writerId: exportDescriptor.writerId,
          controlFileId: provisioned.controlFileId,
          controlRevision: result.revision,
          lastPublishedRevision: exportDescriptor.sourceRevision,
        }),
      );
      return Object.freeze({
        status: "published" as const,
        revision: exportDescriptor.sourceRevision,
      });
    },
  });
}
