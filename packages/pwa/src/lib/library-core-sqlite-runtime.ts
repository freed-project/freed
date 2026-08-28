import type {
  LibraryCoreNormalizedQueryExecutor,
  LibraryCoreSqliteQueryRequest,
  LibraryCoreSqliteQueryResponseFor,
  LibraryCoreAnyScopeActionRequestV1,
  LibraryCoreScopeActionStagePageV1,
  LibraryCoreScopeActionStageStatusV1,
  LibraryCoreFollowerIntentCommitResultV1,
  LibraryCoreFollowerIntentCommitV1,
  LibraryCoreFollowerResultApplyReceiptV1,
  LibraryCoreFollowerResultApplyV1,
  LibraryCoreFollowerMutationContextV1,
  LibraryCoreFollowerTransportContextV2,
  LibraryCoreFollowerTransportPageRequestV2,
  LibraryCoreFollowerTransportPageResponseV2,
  LibraryCoreActivateNormalizedCheckpointStageV2,
  LibraryCoreBeginNormalizedCheckpointStageV2,
  LibraryCoreNormalizedCheckpointActivationReceiptV2,
  LibraryCoreNormalizedCheckpointSelectionV2,
  LibraryCoreNormalizedCheckpointStagePageV2,
  LibraryCoreNormalizedCheckpointStageStatusV2,
  LibraryCoreNormalizedIntentTransportPublicationReceiptV2,
  LibraryCoreNormalizedIntentTransportPublicationV2,
  LibraryCoreNormalizedResultTransportImportReceiptV2,
  LibraryCoreNormalizedResultTransportImportV2,
  LibraryCoreFollowerActorEnrollmentContextV2,
  LibraryCoreFollowerActorEnrollmentReceiptV2,
  LibraryCoreFollowerActorRequestReceiptV2,
  LibraryCoreInstallFollowerActorEnrollmentV2,
  LibraryCoreStoreFollowerActorRequestV2,
  LibraryCoreDeviceContactMutationReceiptV1,
  LibraryCoreDeviceContactQueryRequestV1,
  LibraryCoreDeviceContactQueryResponseFor,
  LibraryCoreDeviceContactSyncMutationV1,
  LibraryCoreDeviceGraphLayoutMutationResultV1,
  LibraryCoreDeviceGraphLayoutMutationV1,
  LibraryCoreContentPolicyMutationReceiptV1,
  LibraryCoreContentPolicyMutationV1,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteClient } from "./library-core-sqlite-client";
import { deletePwaLibraryCoreSqliteStorage } from "./library-core-sqlite-storage";

let client: PwaLibraryCoreSqliteClient | null = null;
let openTask: Promise<void> | null = null;

async function openClient(): Promise<PwaLibraryCoreSqliteClient> {
  const active = client ?? new PwaLibraryCoreSqliteClient();
  client = active;
  openTask ??= active
    .open()
    .then(() => undefined)
    .catch((error) => {
      active.dispose(
        error instanceof Error
          ? error
          : new Error("PWA Library SQLite failed to open"),
      );
      if (client === active) client = null;
      openTask = null;
      throw error;
    });
  await openTask;
  return active;
}

export const queryPwaNormalizedLibrary: LibraryCoreNormalizedQueryExecutor =
  async <T extends LibraryCoreSqliteQueryRequest>(
    request: T,
  ): Promise<LibraryCoreSqliteQueryResponseFor<T>> => {
    const active = await openClient();
    return active.query(request);
  };

export async function mutatePwaDeviceGraphLayout(
  mutation: LibraryCoreDeviceGraphLayoutMutationV1,
): Promise<LibraryCoreDeviceGraphLayoutMutationResultV1> {
  const active = await openClient();
  return active.mutateDeviceGraphLayout(mutation);
}

export async function mutatePwaDeviceContactSync(
  mutation: LibraryCoreDeviceContactSyncMutationV1,
): Promise<LibraryCoreDeviceContactMutationReceiptV1> {
  const active = await openClient();
  return active.mutateDeviceContactSync(mutation);
}

export async function queryPwaDeviceContacts<
  T extends LibraryCoreDeviceContactQueryRequestV1,
>(query: T): Promise<LibraryCoreDeviceContactQueryResponseFor<T>> {
  const active = await openClient();
  return active.queryDeviceContacts(query) as Promise<
    LibraryCoreDeviceContactQueryResponseFor<T>
  >;
}

export async function mutatePwaContentPolicy(
  mutation: LibraryCoreContentPolicyMutationV1,
): Promise<LibraryCoreContentPolicyMutationReceiptV1> {
  const active = await openClient();
  return active.mutateContentPolicy(mutation);
}

export async function beginPwaScopeActionStage(
  stageId: string,
  request: LibraryCoreAnyScopeActionRequestV1,
): Promise<LibraryCoreScopeActionStageStatusV1> {
  const active = await openClient();
  return active.beginScopeAction(stageId, request, Date.now());
}

export async function appendPwaScopeActionStage(
  stageId: string,
  expectedOrdinal: number,
  entityIds: readonly string[],
): Promise<void> {
  const active = await openClient();
  await active.appendScopeAction(stageId, expectedOrdinal, entityIds);
}

export async function finalizePwaScopeActionStage(
  stageId: string,
  expectedMemberCount: number,
): Promise<number> {
  const active = await openClient();
  return (await active.finalizeScopeAction(stageId, expectedMemberCount))
    .memberCount;
}

export async function pagePwaScopeActionStage(
  stageId: string,
  afterOrdinal: number,
): Promise<LibraryCoreScopeActionStagePageV1> {
  const active = await openClient();
  return active.pageScopeAction(stageId, afterOrdinal);
}

export async function closePwaScopeActionStage(stageId: string): Promise<void> {
  const active = await openClient();
  await active.closeScopeAction(stageId);
}

export async function readPwaFollowerMutationContext(): Promise<LibraryCoreFollowerMutationContextV1> {
  const active = await openClient();
  return active.followerMutationContext();
}

export async function readPwaFollowerTransportContext(): Promise<LibraryCoreFollowerTransportContextV2> {
  const active = await openClient();
  return active.followerTransportContext();
}

export async function pagePwaFollowerTransport(
  page: LibraryCoreFollowerTransportPageRequestV2,
): Promise<LibraryCoreFollowerTransportPageResponseV2> {
  const active = await openClient();
  return active.pageFollowerTransport(page);
}

export async function commitPwaFollowerIntent(
  commit: LibraryCoreFollowerIntentCommitV1,
): Promise<LibraryCoreFollowerIntentCommitResultV1> {
  const active = await openClient();
  return active.commitFollowerIntent(commit);
}

export async function applyPwaFollowerResult(
  apply: LibraryCoreFollowerResultApplyV1,
): Promise<LibraryCoreFollowerResultApplyReceiptV1> {
  const active = await openClient();
  return active.applyFollowerResult(apply);
}

export async function readPwaNormalizedCheckpointReceipt(): Promise<LibraryCoreNormalizedCheckpointSelectionV2> {
  const active = await openClient();
  return active.readNormalizedCheckpointReceipt();
}

export async function beginPwaNormalizedCheckpointStage(
  stage: LibraryCoreBeginNormalizedCheckpointStageV2,
): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
  const active = await openClient();
  return active.beginNormalizedCheckpointStage(stage);
}

export async function appendPwaNormalizedCheckpointStagePage(
  page: LibraryCoreNormalizedCheckpointStagePageV2,
): Promise<LibraryCoreNormalizedCheckpointStageStatusV2> {
  const active = await openClient();
  return active.appendNormalizedCheckpointStagePage(page);
}

export async function activatePwaNormalizedCheckpointStage(
  activation: LibraryCoreActivateNormalizedCheckpointStageV2,
): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2> {
  const active = await openClient();
  return active.activateNormalizedCheckpointStage(activation);
}

export async function publishPwaNormalizedFollowerIntentTransport(
  publication: LibraryCoreNormalizedIntentTransportPublicationV2,
): Promise<LibraryCoreNormalizedIntentTransportPublicationReceiptV2> {
  const active = await openClient();
  return active.publishNormalizedFollowerIntentTransport(publication);
}

export async function importPwaNormalizedFollowerResultTransport(
  imported: LibraryCoreNormalizedResultTransportImportV2,
): Promise<LibraryCoreNormalizedResultTransportImportReceiptV2> {
  const active = await openClient();
  return active.importNormalizedFollowerResultTransport(imported);
}

export async function readPwaFollowerActorEnrollmentContext(): Promise<LibraryCoreFollowerActorEnrollmentContextV2> {
  const active = await openClient();
  return active.followerActorEnrollmentContext();
}

export async function storePwaFollowerActorRequest(
  store: LibraryCoreStoreFollowerActorRequestV2,
): Promise<LibraryCoreFollowerActorRequestReceiptV2> {
  const active = await openClient();
  return active.storeFollowerActorRequest(store);
}

export async function installPwaFollowerActorEnrollment(
  install: LibraryCoreInstallFollowerActorEnrollmentV2,
): Promise<LibraryCoreFollowerActorEnrollmentReceiptV2> {
  const active = await openClient();
  return active.installFollowerActorEnrollment(install);
}

export async function closePwaNormalizedLibrary(): Promise<void> {
  const active = client;
  client = null;
  openTask = null;
  if (!active) return;
  try {
    await active.close();
  } catch (error) {
    active.dispose(
      error instanceof Error
        ? error
        : new Error("PWA Library SQLite failed to close"),
    );
    throw error;
  }
}

export async function resetPwaNormalizedLibrary(): Promise<void> {
  await closePwaNormalizedLibrary();
  await deletePwaLibraryCoreSqliteStorage();
}
