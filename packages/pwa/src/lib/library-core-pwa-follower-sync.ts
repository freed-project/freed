import {
  syncLibraryCoreNormalizedFollowerV2,
  type LibraryCoreNormalizedFollowerResultReferencePageV2,
  type LibraryCoreNormalizedFollowerSyncReceiptV2,
  type LibraryCoreNormalizedFollowerSyncRuntimeV2,
  type LibraryCoreNormalizedFollowerTransportV2,
} from "@freed/sync/cloud/library-core";
import {
  installPwaLibraryCoreFollowerEnrollment,
  preparePwaLibraryCoreFollowerEnrollment,
} from "./library-core-pwa-follower-enrollment";
import {
  importPwaNormalizedFollowerResultTransport,
  pagePwaFollowerTransport,
  publishPwaNormalizedFollowerIntentTransport,
  readPwaFollowerTransportContext,
} from "./library-core-sqlite-runtime";

export type PwaLibraryCoreFollowerResultReferencePageV2 =
  LibraryCoreNormalizedFollowerResultReferencePageV2;
export type PwaLibraryCoreFollowerTransportV2 =
  LibraryCoreNormalizedFollowerTransportV2;
export type PwaLibraryCoreFollowerSyncRuntime =
  LibraryCoreNormalizedFollowerSyncRuntimeV2;
export type PwaLibraryCoreFollowerSyncReceiptV2 =
  LibraryCoreNormalizedFollowerSyncReceiptV2;

function defaultRuntime(): PwaLibraryCoreFollowerSyncRuntime {
  return Object.freeze({
    importResult: importPwaNormalizedFollowerResultTransport,
    installEnrollment: installPwaLibraryCoreFollowerEnrollment,
    now: Date.now,
    pageIntents: pagePwaFollowerTransport,
    prepareEnrollment: preparePwaLibraryCoreFollowerEnrollment,
    publishIntent: publishPwaNormalizedFollowerIntentTransport,
    readContext: readPwaFollowerTransportContext,
    subtle: crypto.subtle,
  });
}

export async function syncPwaLibraryCoreFollowerV2(
  transport: PwaLibraryCoreFollowerTransportV2,
  options: Readonly<{ signal?: AbortSignal }> = {},
  runtime: PwaLibraryCoreFollowerSyncRuntime = defaultRuntime(),
): Promise<PwaLibraryCoreFollowerSyncReceiptV2> {
  return syncLibraryCoreNormalizedFollowerV2(transport, runtime, options);
}
