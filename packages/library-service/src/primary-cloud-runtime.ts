import type {
  LibraryServiceBoundPath,
  LibraryServiceClockPort,
  LibraryServiceFileSystemPort,
  LibraryServiceGoogleDriveConfig,
} from "./contracts.js";
import {
  createBoundGoogleDrivePublicationStatePortV1,
  createLibraryServiceGoogleDrivePublicationV1,
} from "./google-drive-publication.js";
import type { LibraryCoreNativeCommandClientV1 } from "./native-command.js";
import { createNodeGoogleDriveTokenPortV1 } from "./node-google-drive-token.js";
import {
  createLibraryServicePrimaryRuntimeV1,
  type LibraryServicePrimaryRuntimeV1,
} from "./primary-runtime.js";
import {
  createLibraryServiceNormalizedPrimaryOrchestrationV2,
  createLibraryServiceNormalizedPrimaryPublicationV2,
  type LibraryServiceNormalizedPrimaryTransportV2,
} from "./normalized-primary-orchestration.js";

export interface LibraryServicePrimaryCloudPortV1 {
  start(input: {
    readonly config: LibraryServiceGoogleDriveConfig;
    readonly stateFile: LibraryServiceBoundPath;
    readonly fileSystem: LibraryServiceFileSystemPort;
    readonly clock: LibraryServiceClockPort;
    readonly native: LibraryCoreNativeCommandClientV1;
  }): Promise<LibraryServicePrimaryRuntimeV1<{ readonly status: string }>>;
}

type PrimaryCloudStartInputV1 = Parameters<
  LibraryServicePrimaryCloudPortV1["start"]
>[0];

export interface NodeLibraryServicePrimaryCloudOptionsV2 {
  readonly normalizedPrimaryTransport?: LibraryServiceNormalizedPrimaryTransportV2;
}

/** Create the installed Node host for the shared Primary coordinator. */
export function createNodeLibraryServicePrimaryCloudPortV1(
  options: NodeLibraryServicePrimaryCloudOptionsV2 = {},
): LibraryServicePrimaryCloudPortV1 {
  return Object.freeze({
    async start(input: PrimaryCloudStartInputV1) {
      const publication = createLibraryServiceGoogleDrivePublicationV1({
        state: createBoundGoogleDrivePublicationStatePortV1(
          input.stateFile,
          input.fileSystem,
        ),
        token: createNodeGoogleDriveTokenPortV1(
          input.config.credentialRecordId,
        ),
      });
      const normalizedPrimary =
        options.normalizedPrimaryTransport === undefined
          ? null
          : createLibraryServiceNormalizedPrimaryOrchestrationV2({
              native: input.native,
              now: () => input.clock.nowMs(),
              subtle: crypto.subtle,
              transport: options.normalizedPrimaryTransport,
            });
      const coordinatedPublication =
        normalizedPrimary === null
          ? publication
          : createLibraryServiceNormalizedPrimaryPublicationV2(
              publication,
              normalizedPrimary,
            );
      const runtime = createLibraryServicePrimaryRuntimeV1({
        clock: { nowMs: () => input.clock.nowMs() },
        diagnostics: { record() {} },
        installationWitness: input.config.installationWitness,
        native: input.native,
        publication: coordinatedPublication,
        publicationState: publication,
        scheduler: {
          schedule(callback, delayMs) {
            return setTimeout(() => void callback(), delayMs);
          },
          cancel(handle) {
            clearTimeout(handle);
          },
        },
      });
      await runtime.start();
      return runtime;
    },
  });
}
