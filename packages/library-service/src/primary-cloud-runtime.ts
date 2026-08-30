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

/** Create the installed Node host for the shared Primary coordinator. */
export function createNodeLibraryServicePrimaryCloudPortV1(): LibraryServicePrimaryCloudPortV1 {
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
      const runtime = createLibraryServicePrimaryRuntimeV1({
        clock: { nowMs: () => input.clock.nowMs() },
        diagnostics: { record() {} },
        installationWitness: input.config.installationWitness,
        native: input.native,
        publication,
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
