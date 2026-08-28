import {
  parseLibraryCoreAccountDetailRequestV1,
  parseLibraryCoreAccountDetailResponseV1,
  type LibraryCoreAccountDetailRequestV1,
  type LibraryCoreAccountDetailResponseV1,
} from "./account-detail-contracts.js";
import {
  parseLibraryCoreAccountTimelineRequestV1,
  parseLibraryCoreAccountTimelineResponseV1,
  type LibraryCoreAccountTimelineRequestV1,
  type LibraryCoreAccountTimelineResponseV1,
} from "./account-timeline-contracts.js";
import {
  parseLibraryCoreContactMatchRequestV1,
  parseLibraryCoreContactMatchResponseV1,
  type LibraryCoreContactMatchRequestV1,
  type LibraryCoreContactMatchResponseV1,
} from "./contact-match-contracts.js";
import {
  parseLibraryCoreAccountGraphPageRequestV1,
  parseLibraryCoreAccountGraphPageResponseV1,
  parseLibraryCorePersonGraphPageRequestV1,
  parseLibraryCorePersonGraphPageResponseV1,
  parseLibraryCoreRssFeedPageRequestV1,
  parseLibraryCoreRssFeedPageResponseV1,
  type LibraryCoreAccountGraphPageRequestV1,
  type LibraryCoreAccountGraphPageResponseV1,
  type LibraryCorePersonGraphPageRequestV1,
  type LibraryCorePersonGraphPageResponseV1,
  type LibraryCoreRssFeedPageRequestV1,
  type LibraryCoreRssFeedPageResponseV1,
} from "./friends-identity-page-contracts.js";
import {
  parseLibraryCoreAccountLinkCandidatesRequestV1,
  parseLibraryCoreAccountLinkCandidatesResponseV1,
  parseLibraryCoreAccountPickerPageRequestV1,
  parseLibraryCoreAccountPickerPageResponseV1,
  parseLibraryCoreFriendsDirectoryPageRequestV1,
  parseLibraryCoreFriendsDirectoryPageResponseV1,
  parseLibraryCorePersonPickerPageRequestV1,
  parseLibraryCorePersonPickerPageResponseV1,
  type LibraryCoreAccountLinkCandidatesRequestV1,
  type LibraryCoreAccountLinkCandidatesResponseV1,
  type LibraryCoreAccountPickerPageRequestV1,
  type LibraryCoreAccountPickerPageResponseV1,
  type LibraryCoreFriendsDirectoryPageRequestV1,
  type LibraryCoreFriendsDirectoryPageResponseV1,
  type LibraryCorePersonPickerPageRequestV1,
  type LibraryCorePersonPickerPageResponseV1,
} from "./friends-directory-contracts.js";
import {
  parseLibraryCoreFriendCandidateReviewRequestV1,
  parseLibraryCoreFriendCandidateReviewResponseV1,
  type LibraryCoreFriendCandidateReviewRequestV1,
  type LibraryCoreFriendCandidateReviewResponseV1,
} from "./friend-candidate-review-contracts.js";
import {
  parseLibraryCoreChangeFeedRequestV1,
  parseLibraryCoreChangeFeedResponseV1,
  type LibraryCoreChangeFeedRequestV1,
  type LibraryCoreChangeFeedResponseV1,
} from "./change-feed-contracts.js";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_CONTRACT_VERSION,
  LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
} from "./sqlite-contract.generated.js";
import type {
  LibraryCoreFeedPageRequestV1,
  LibraryCoreFeedPageResponseV1,
} from "./feed-page-contracts.js";
import {
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
} from "./feed-page-contracts.js";
import {
  parseLibraryCoreFeedBrowsePageRequestV3,
  parseLibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreFeedBrowsePageRequestV3,
  type LibraryCoreFeedBrowsePageResponseV3,
} from "./feed-browse-page-contracts.js";
import {
  parseLibraryCoreFacetSummaryRequestV1,
  parseLibraryCoreFacetSummaryResponseV1,
  type LibraryCoreFacetSummaryRequestV1,
  type LibraryCoreFacetSummaryResponseV1,
} from "./facet-summary-contracts.js";
import {
  parseLibraryCoreFilterScopeSummaryRequestV1,
  parseLibraryCoreFilterScopeSummaryResponseV1,
  type LibraryCoreFilterScopeSummaryRequestV1,
  type LibraryCoreFilterScopeSummaryResponseV1,
} from "./filter-scope-summary-contracts.js";
import {
  parseLibraryCoreSavedAnalyticsRequestV2,
  parseLibraryCoreSavedAnalyticsResponseV2,
  type LibraryCoreSavedAnalyticsRequestV2,
  type LibraryCoreSavedAnalyticsResponseV2,
} from "./saved-analytics-v2-contracts.js";
import {
  parseLibraryCoreSavedFeedPageRequestV2,
  parseLibraryCoreSavedFeedPageResponseV2,
  type LibraryCoreSavedFeedPageRequestV2,
  type LibraryCoreSavedFeedPageResponseV2,
} from "./saved-feed-page-contracts.js";
import {
  parseLibraryCorePreferencesSnapshotRequestV1,
  parseLibraryCorePreferencesSnapshotResponseV1,
  type LibraryCorePreferencesSnapshotRequestV1,
  type LibraryCorePreferencesSnapshotResponseV1,
} from "./preferences-snapshot-contracts.js";
import {
  parseLibraryCoreItemDetailRequestV1,
  parseLibraryCoreItemDetailResponseV1,
  type LibraryCoreItemDetailRequestV1,
  type LibraryCoreItemDetailResponseV1,
} from "./item-detail-contracts.js";
import {
  parseLibraryCoreItemReaderBodyRequestV1,
  parseLibraryCoreItemReaderBodyResponseV1,
  type LibraryCoreItemReaderBodyRequestV1,
  type LibraryCoreItemReaderBodyResponseV1,
} from "./item-reader-body-contracts.js";
import {
  parseLibraryCoreItemScanRequestV1,
  parseLibraryCoreItemScanResponseV1,
  type LibraryCoreItemScanRequestV1,
  type LibraryCoreItemScanResponseV1,
} from "./item-scan-contracts.js";
import {
  parseLibraryCoreContentFetchPageRequestV1,
  parseLibraryCoreContentFetchPageResponseV1,
  type LibraryCoreContentFetchPageRequestV1,
  type LibraryCoreContentFetchPageResponseV1,
} from "./content-fetch-page-contracts.js";
import {
  parseLibraryCorePersonDetailRequestV1,
  parseLibraryCorePersonDetailResponseV1,
  type LibraryCorePersonDetailRequestV1,
  type LibraryCorePersonDetailResponseV1,
} from "./person-detail-contracts.js";
import {
  parseLibraryCoreRssFeedDetailRequestV1,
  parseLibraryCoreRssFeedDetailResponseV1,
  type LibraryCoreRssFeedDetailRequestV1,
  type LibraryCoreRssFeedDetailResponseV1,
} from "./rss-feed-detail-contracts.js";
import {
  parseLibraryCorePersonTimelineRequestV1,
  parseLibraryCorePersonTimelineResponseV1,
  type LibraryCorePersonTimelineRequestV1,
  type LibraryCorePersonTimelineResponseV1,
} from "./person-timeline-contracts.js";
import {
  parseLibraryCoreActivateNormalizedCheckpointStageV2,
  parseLibraryCoreBeginNormalizedCheckpointStageV2,
  parseLibraryCoreNormalizedCheckpointSelectionV2,
  parseLibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreActivateNormalizedCheckpointStageV2,
  type LibraryCoreBeginNormalizedCheckpointStageV2,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointSelectionV2,
  type LibraryCoreNormalizedCheckpointStagePageV2,
  type LibraryCoreNormalizedCheckpointStageStatusV2,
} from "./normalized-checkpoint-stage-contracts.js";
import {
  parseLibraryCorePinnedNormalizedCheckpointExportRequestV2,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointExportPageV2,
  type LibraryCorePinnedNormalizedCheckpointExportRequestV2,
} from "./normalized-checkpoint-contracts.js";
import {
  parseLibraryCoreDeviceGraphLayoutMutationV1,
  type LibraryCoreDeviceGraphLayoutMutationResultV1,
  type LibraryCoreDeviceGraphLayoutMutationV1,
} from "./device-graph-layout-mutation-contracts.js";
import {
  parseLibraryCoreDeviceContactQueryRequestV1,
  parseLibraryCoreDeviceContactSyncMutationV1,
  type LibraryCoreDeviceContactQueryRequestV1,
  type LibraryCoreDeviceContactQueryResponseV1,
  type LibraryCoreDeviceContactMutationReceiptV1,
  type LibraryCoreDeviceContactSyncMutationV1,
} from "./device-contact-sync-contracts.js";
import {
  parseLibraryCoreContentRangePublicationAbortV1,
  parseLibraryCoreContentRangePublicationAppendV1,
  parseLibraryCoreContentRangePublicationBeginV1,
  parseLibraryCoreContentRangePublicationFinalizeV1,
  parseLibraryCoreContentRangeReadRequestV1,
  parseLibraryCoreContentCompletionRequestV1,
  parseLibraryCoreContentEvictionRequestV1,
  parseLibraryCoreEvictionCandidatePageRequestV1,
  parseLibraryCoreHydrationCandidatePageRequestV1,
  parseLibraryCoreContentPolicyMutationV1,
  parseLibraryCoreContentStateRequestV1,
  type LibraryCoreContentRangePublicationAbortReceiptV1,
  type LibraryCoreContentRangePublicationAbortV1,
  type LibraryCoreContentRangePublicationAppendV1,
  type LibraryCoreContentRangePublicationBeginV1,
  type LibraryCoreContentRangePublicationFinalizeV1,
  type LibraryCoreContentRangePublicationStatusV1,
  type LibraryCoreContentRangeReadRequestV1,
  type LibraryCoreContentRangeReadResponseV1,
  type LibraryCoreContentCompletionReceiptV1,
  type LibraryCoreContentCompletionRequestV1,
  type LibraryCoreContentEvictionReceiptV1,
  type LibraryCoreContentEvictionRequestV1,
  type LibraryCoreEvictionCandidatePageRequestV1,
  type LibraryCoreEvictionCandidatePageV1,
  type LibraryCoreHydrationCandidatePageRequestV1,
  type LibraryCoreHydrationCandidatePageV1,
  type LibraryCoreContentPolicyMutationReceiptV1,
  type LibraryCoreContentPolicyMutationV1,
  type LibraryCoreContentStateRequestV1,
  type LibraryCoreContentStateV1,
  type LibraryCoreVerifiedContentRangeReceiptV1,
} from "./selective-content-contracts.js";
import {
  parseLibraryCoreFollowerIntentCommitV1,
  type LibraryCoreFollowerIntentCommitResultV1,
  type LibraryCoreFollowerIntentCommitV1,
  parseLibraryCoreFollowerIntentPageRequestV1,
  parseLibraryCoreFollowerIntentPublicationV1,
  type LibraryCoreFollowerIntentPageRequestV1,
  type LibraryCoreFollowerIntentPageResponseV1,
  type LibraryCoreFollowerIntentPublicationReceiptV1,
  type LibraryCoreFollowerIntentPublicationV1,
} from "./follower-intent-contracts.js";
import {
  parseLibraryCoreFollowerResultApplyV1,
  type LibraryCoreFollowerResultApplyReceiptV1,
  type LibraryCoreFollowerResultApplyV1,
} from "./follower-result-contracts.js";
import {
  parseLibraryCoreFollowerTransportPageRequestV2,
  type LibraryCoreFollowerTransportContextV2,
  type LibraryCoreFollowerTransportPageRequestV2,
  type LibraryCoreFollowerTransportPageResponseV2,
} from "./follower-transport-contracts.js";
import {
  parseLibraryCoreFollowerMutationContextV1,
  type LibraryCoreFollowerMutationContextV1,
} from "./follower-mutation-context-contracts.js";
import {
  parseLibraryCoreInstallFollowerActorEnrollmentV2,
  parseLibraryCoreStoreFollowerActorRequestV2,
  type LibraryCoreFollowerActorEnrollmentContextV2,
  type LibraryCoreFollowerActorEnrollmentReceiptV2,
  type LibraryCoreFollowerActorRequestReceiptV2,
  type LibraryCoreInstallFollowerActorEnrollmentV2,
  type LibraryCoreStoreFollowerActorRequestV2,
} from "./follower-actor-enrollment-contracts.js";
import {
  parseLibraryCoreNormalizedIntentTransportPublicationV2,
  type LibraryCoreNormalizedIntentTransportPublicationReceiptV2,
  type LibraryCoreNormalizedIntentTransportPublicationV2,
} from "./normalized-intent-segment-contracts.js";
import {
  parseLibraryCoreNormalizedResultTransportImportV2,
  type LibraryCoreNormalizedResultTransportImportReceiptV2,
  type LibraryCoreNormalizedResultTransportImportV2,
} from "./normalized-result-segment-contracts.js";
import {
  parseLibraryCoreNormalizedOperationImportPageV2,
  type LibraryCoreNormalizedOperationImportPageV2,
  type LibraryCoreNormalizedOperationImportReceiptV2,
} from "./normalized-operation-replication-contracts.js";
import {
  parseLibraryCoreMapMarkersRequestV1,
  parseLibraryCoreMapMarkersResponseV1,
  parseLibraryCoreStoryWallCandidatesRequestV1,
  parseLibraryCoreStoryWallCandidatesResponseV1,
  type LibraryCoreMapMarkersRequestV1,
  type LibraryCoreMapMarkersResponseV1,
  type LibraryCoreStoryWallCandidatesRequestV1,
  type LibraryCoreStoryWallCandidatesResponseV1,
} from "./secondary-surface-contracts.js";
import {
  parseLibraryCoreSearchPageRequestV1,
  parseLibraryCoreSearchPageResponseV1,
  type LibraryCoreSearchPageRequestV1,
  type LibraryCoreSearchPageResponseV1,
} from "./search-page-contracts.js";
import {
  parseLibraryCorePersonsGraphRequestV1,
  parseLibraryCorePersonsGraphResponseV1,
  type LibraryCorePersonsGraphRequestV1,
  type LibraryCorePersonsGraphResponseV1,
} from "./persons-graph-contracts.js";
import {
  parseLibraryCoreAnyScopeActionRequestV1,
  type LibraryCoreAnyScopeActionRequestV1,
  type LibraryCoreScopeActionStagePageV1,
  type LibraryCoreScopeActionStageStatusV1,
} from "./scope-action-contracts.js";
import {
  parseLibraryCoreProviderMediaPageRequestV1,
  parseLibraryCoreProviderMediaPageResponseV1,
  type LibraryCoreProviderMediaPageRequestV1,
  type LibraryCoreProviderMediaPageResponseV1,
} from "./provider-media-page-contracts.js";

export const LIBRARY_CORE_SQLITE_WORKER_MAXIMUM_PENDING_REQUESTS = 128 as const;

export type LibraryCoreSqliteQueryRequest =
  | LibraryCoreAccountDetailRequestV1
  | LibraryCoreAccountGraphPageRequestV1
  | LibraryCoreAccountLinkCandidatesRequestV1
  | LibraryCoreAccountPickerPageRequestV1
  | LibraryCoreAccountTimelineRequestV1
  | LibraryCoreChangeFeedRequestV1
  | LibraryCoreContactMatchRequestV1
  | LibraryCoreFacetSummaryRequestV1
  | LibraryCoreFeedBrowsePageRequestV3
  | LibraryCoreFeedPageRequestV1
  | LibraryCoreFilterScopeSummaryRequestV1
  | LibraryCoreFriendCandidateReviewRequestV1
  | LibraryCoreFriendsDirectoryPageRequestV1
  | LibraryCoreItemDetailRequestV1
  | LibraryCoreItemReaderBodyRequestV1
  | LibraryCoreItemScanRequestV1
  | LibraryCoreContentFetchPageRequestV1
  | LibraryCoreMapMarkersRequestV1
  | LibraryCorePersonDetailRequestV1
  | LibraryCorePersonGraphPageRequestV1
  | LibraryCorePersonPickerPageRequestV1
  | LibraryCorePersonTimelineRequestV1
  | LibraryCoreProviderMediaPageRequestV1
  | LibraryCorePersonsGraphRequestV1
  | LibraryCoreRssFeedDetailRequestV1
  | LibraryCoreRssFeedPageRequestV1
  | LibraryCoreSavedAnalyticsRequestV2
  | LibraryCoreSavedFeedPageRequestV2
  | LibraryCoreSearchPageRequestV1
  | LibraryCoreStoryWallCandidatesRequestV1
  | LibraryCorePreferencesSnapshotRequestV1;

export type LibraryCoreSqliteQueryResponseFor<
  T extends LibraryCoreSqliteQueryRequest,
> = T extends LibraryCoreFacetSummaryRequestV1
  ? LibraryCoreFacetSummaryResponseV1
  : T extends LibraryCoreAccountDetailRequestV1
    ? LibraryCoreAccountDetailResponseV1
    : T extends LibraryCoreContactMatchRequestV1
      ? LibraryCoreContactMatchResponseV1
      : T extends LibraryCoreAccountGraphPageRequestV1
        ? LibraryCoreAccountGraphPageResponseV1
        : T extends LibraryCoreAccountLinkCandidatesRequestV1
          ? LibraryCoreAccountLinkCandidatesResponseV1
          : T extends LibraryCoreAccountPickerPageRequestV1
            ? LibraryCoreAccountPickerPageResponseV1
            : T extends LibraryCoreAccountTimelineRequestV1
              ? LibraryCoreAccountTimelineResponseV1
              : T extends LibraryCoreChangeFeedRequestV1
                ? LibraryCoreChangeFeedResponseV1
                : T extends LibraryCoreFeedBrowsePageRequestV3
                  ? LibraryCoreFeedBrowsePageResponseV3
                  : T extends LibraryCoreFeedPageRequestV1
                    ? LibraryCoreFeedPageResponseV1
                    : T extends LibraryCoreFilterScopeSummaryRequestV1
                      ? LibraryCoreFilterScopeSummaryResponseV1
                      : T extends LibraryCoreFriendCandidateReviewRequestV1
                        ? LibraryCoreFriendCandidateReviewResponseV1
                        : T extends LibraryCoreFriendsDirectoryPageRequestV1
                          ? LibraryCoreFriendsDirectoryPageResponseV1
                          : T extends LibraryCoreItemDetailRequestV1
                            ? LibraryCoreItemDetailResponseV1
                            : T extends LibraryCoreItemReaderBodyRequestV1
                              ? LibraryCoreItemReaderBodyResponseV1
                              : T extends LibraryCoreItemScanRequestV1
                                ? LibraryCoreItemScanResponseV1
                                : T extends LibraryCoreContentFetchPageRequestV1
                                  ? LibraryCoreContentFetchPageResponseV1
                                  : T extends LibraryCoreMapMarkersRequestV1
                                    ? LibraryCoreMapMarkersResponseV1
                                    : T extends LibraryCorePersonDetailRequestV1
                                      ? LibraryCorePersonDetailResponseV1
                                      : T extends LibraryCorePersonGraphPageRequestV1
                                        ? LibraryCorePersonGraphPageResponseV1
                                        : T extends LibraryCorePersonPickerPageRequestV1
                                          ? LibraryCorePersonPickerPageResponseV1
                                          : T extends LibraryCorePersonTimelineRequestV1
                                            ? LibraryCorePersonTimelineResponseV1
                                            : T extends LibraryCorePersonsGraphRequestV1
                                              ? LibraryCorePersonsGraphResponseV1
                                              : T extends LibraryCoreProviderMediaPageRequestV1
                                                ? LibraryCoreProviderMediaPageResponseV1
                                                : T extends LibraryCoreRssFeedDetailRequestV1
                                                  ? LibraryCoreRssFeedDetailResponseV1
                                                  : T extends LibraryCoreRssFeedPageRequestV1
                                                    ? LibraryCoreRssFeedPageResponseV1
                                                    : T extends LibraryCoreSavedAnalyticsRequestV2
                                                      ? LibraryCoreSavedAnalyticsResponseV2
                                                      : T extends LibraryCoreSavedFeedPageRequestV2
                                                        ? LibraryCoreSavedFeedPageResponseV2
                                                        : T extends LibraryCoreSearchPageRequestV1
                                                          ? LibraryCoreSearchPageResponseV1
                                                          : T extends LibraryCoreStoryWallCandidatesRequestV1
                                                            ? LibraryCoreStoryWallCandidatesResponseV1
                                                            : T extends LibraryCorePreferencesSnapshotRequestV1
                                                              ? LibraryCorePreferencesSnapshotResponseV1
                                                              : never;

export type LibraryCoreSqliteQueryResponse =
  LibraryCoreSqliteQueryResponseFor<LibraryCoreSqliteQueryRequest>;

/** Validates one native or browser query response against its exact request. */
export function parseLibraryCoreSqliteQueryResponse<
  T extends LibraryCoreSqliteQueryRequest,
>(value: unknown, request: T): LibraryCoreSqliteQueryResponseFor<T> {
  const parsed =
    request.queryId === "account_detail_v1"
      ? parseLibraryCoreAccountDetailResponseV1(value, request)
      : request.queryId === "contact_match_v1"
        ? parseLibraryCoreContactMatchResponseV1(value, request)
        : request.queryId === "account_graph_page_v1"
          ? parseLibraryCoreAccountGraphPageResponseV1(value, request)
          : request.queryId === "account_link_candidates_v1"
            ? parseLibraryCoreAccountLinkCandidatesResponseV1(value, request)
            : request.queryId === "account_picker_page_v1"
              ? parseLibraryCoreAccountPickerPageResponseV1(value, request)
              : request.queryId === "account_timeline_v1"
                ? parseLibraryCoreAccountTimelineResponseV1(value, request)
                : request.queryId === "change_feed_v1"
                  ? parseLibraryCoreChangeFeedResponseV1(value, request)
                  : request.queryId === "library_facet_summary_v1"
                    ? parseLibraryCoreFacetSummaryResponseV1(value)
                    : request.queryId === "feed_browse_page_v3"
                      ? parseLibraryCoreFeedBrowsePageResponseV3(value, request)
                      : request.queryId === "feed_page_v1"
                        ? parseLibraryCoreFeedPageResponseV1(value, request)
                        : request.queryId === "filter_scope_summary_v1"
                          ? parseLibraryCoreFilterScopeSummaryResponseV1(
                              value,
                              request,
                            )
                          : request.queryId === "friend_candidate_review_v1"
                            ? parseLibraryCoreFriendCandidateReviewResponseV1(
                                value,
                                request,
                              )
                            : request.queryId === "friends_directory_page_v1"
                              ? parseLibraryCoreFriendsDirectoryPageResponseV1(
                                  value,
                                  request,
                                )
                              : request.queryId === "item_detail_v1"
                                ? parseLibraryCoreItemDetailResponseV1(
                                    value,
                                    request,
                                  )
                                : request.queryId === "item_reader_body_v1"
                                  ? parseLibraryCoreItemReaderBodyResponseV1(
                                      value,
                                      request,
                                    )
                                  : request.queryId ===
                                      "background_item_page_v1"
                                    ? parseLibraryCoreItemScanResponseV1(
                                        value,
                                        request,
                                      )
                                    : request.queryId ===
                                        "content_fetch_claim_v1"
                                      ? parseLibraryCoreContentFetchPageResponseV1(
                                          value,
                                          request,
                                        )
                                      : request.queryId ===
                                          "provider_media_page_v1"
                                        ? parseLibraryCoreProviderMediaPageResponseV1(
                                            value,
                                            request,
                                          )
                                        : request.queryId === "map_markers_v1"
                                          ? parseLibraryCoreMapMarkersResponseV1(
                                              value,
                                              request,
                                            )
                                          : request.queryId ===
                                              "person_detail_v1"
                                            ? parseLibraryCorePersonDetailResponseV1(
                                                value,
                                                request,
                                              )
                                            : request.queryId ===
                                                "person_graph_page_v1"
                                              ? parseLibraryCorePersonGraphPageResponseV1(
                                                  value,
                                                  request,
                                                )
                                              : request.queryId ===
                                                  "person_picker_page_v1"
                                                ? parseLibraryCorePersonPickerPageResponseV1(
                                                    value,
                                                    request,
                                                  )
                                                : request.queryId ===
                                                    "person_timeline_v1"
                                                  ? parseLibraryCorePersonTimelineResponseV1(
                                                      value,
                                                      request,
                                                    )
                                                  : request.queryId ===
                                                      "persons_graph_v1"
                                                    ? parseLibraryCorePersonsGraphResponseV1(
                                                        value,
                                                        request,
                                                      )
                                                    : request.queryId ===
                                                        "preferences_snapshot_v1"
                                                      ? parseLibraryCorePreferencesSnapshotResponseV1(
                                                          value,
                                                        )
                                                      : request.queryId ===
                                                          "rss_feed_detail_v1"
                                                        ? parseLibraryCoreRssFeedDetailResponseV1(
                                                            value,
                                                            request,
                                                          )
                                                        : request.queryId ===
                                                            "rss_feed_page_v1"
                                                          ? parseLibraryCoreRssFeedPageResponseV1(
                                                              value,
                                                              request,
                                                            )
                                                          : request.queryId ===
                                                              "saved_analytics_v2"
                                                            ? parseLibraryCoreSavedAnalyticsResponseV2(
                                                                value,
                                                              )
                                                            : request.queryId ===
                                                                "saved_feed_page_v2"
                                                              ? parseLibraryCoreSavedFeedPageResponseV2(
                                                                  value,
                                                                  request,
                                                                )
                                                              : request.queryId ===
                                                                  "search_page_v1"
                                                                ? parseLibraryCoreSearchPageResponseV1(
                                                                    value,
                                                                    request,
                                                                  )
                                                                : parseLibraryCoreStoryWallCandidatesResponseV1(
                                                                    value,
                                                                    request,
                                                                  );
  if (!parsed.ok) {
    throw new TypeError(parsed.error);
  }
  return parsed.value as LibraryCoreSqliteQueryResponseFor<T>;
}

export type LibraryCoreSqliteWorkerRequest =
  | Readonly<{
      kind: "open";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "status";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "close";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "query";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      query: LibraryCoreSqliteQueryRequest;
      requestId: string;
    }>
  | Readonly<{
      kind: "query_device_contacts";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      query: LibraryCoreDeviceContactQueryRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "mutate_device_graph_layout";
      mutation: LibraryCoreDeviceGraphLayoutMutationV1;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "mutate_device_contacts";
      mutation: LibraryCoreDeviceContactSyncMutationV1;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "mutate_content_policy";
      mutation: LibraryCoreContentPolicyMutationV1;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "read_content_state";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreContentStateRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "begin_content_range_publication";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreContentRangePublicationBeginV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "append_content_range_publication";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreContentRangePublicationAppendV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "finalize_content_range_publication";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreContentRangePublicationFinalizeV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "abort_content_range_publication";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreContentRangePublicationAbortV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "read_content_range";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreContentRangeReadRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "verify_content_complete";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreContentCompletionRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "evict_content";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreContentEvictionRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "page_hydration_candidates";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreHydrationCandidatePageRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "page_eviction_candidates";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreEvictionCandidatePageRequestV1;
      requestId: string;
    }>
  | Readonly<{
      kind: "follower_mutation_context";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      commit: LibraryCoreFollowerIntentCommitV1;
      kind: "commit_follower_intent";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "page_follower_intents";
      page: LibraryCoreFollowerIntentPageRequestV1;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "follower_transport_context";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "page_follower_transport";
      page: LibraryCoreFollowerTransportPageRequestV2;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "publish_follower_intent";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreFollowerIntentPublicationV1;
      requestId: string;
    }>
  | Readonly<{
      apply: LibraryCoreFollowerResultApplyV1;
      kind: "apply_follower_result";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "publish_normalized_follower_intent_transport";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      publication: LibraryCoreNormalizedIntentTransportPublicationV2;
      requestId: string;
    }>
  | Readonly<{
      import: LibraryCoreNormalizedResultTransportImportV2;
      kind: "import_normalized_follower_result_transport";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      import: LibraryCoreNormalizedOperationImportPageV2;
      kind: "import_normalized_operation_page";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "read_follower_actor_enrollment_context";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "store_follower_actor_request";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      store: LibraryCoreStoreFollowerActorRequestV2;
    }>
  | Readonly<{
      install: LibraryCoreInstallFollowerActorEnrollmentV2;
      kind: "install_follower_actor_enrollment";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "begin_normalized_checkpoint_stage";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stage: LibraryCoreBeginNormalizedCheckpointStageV2;
    }>
  | Readonly<{
      kind: "append_normalized_checkpoint_stage_page";
      page: LibraryCoreNormalizedCheckpointStagePageV2;
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      activation: LibraryCoreActivateNormalizedCheckpointStageV2;
      kind: "activate_normalized_checkpoint_stage";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "read_normalized_checkpoint_receipt";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      kind: "describe_normalized_checkpoint_export";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      export: LibraryCorePinnedNormalizedCheckpointExportRequestV2;
      kind: "read_normalized_checkpoint_export_page";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
    }>
  | Readonly<{
      createdAt: number;
      kind: "begin_scope_action";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      request: LibraryCoreAnyScopeActionRequestV1;
      requestId: string;
      stageId: string;
    }>
  | Readonly<{
      entityIds: readonly string[];
      expectedOrdinal: number;
      kind: "append_scope_action";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stageId: string;
    }>
  | Readonly<{
      expectedMemberCount: number;
      kind: "finalize_scope_action";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stageId: string;
    }>
  | Readonly<{
      afterOrdinal: number;
      kind: "page_scope_action";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stageId: string;
    }>
  | Readonly<{
      kind: "close_scope_action";
      protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
      requestId: string;
      stageId: string;
    }>;

export interface LibraryCoreSqliteWorkerStatus {
  readonly connectionGeneration: number;
  readonly contractVersion: typeof LIBRARY_CORE_SQLITE_CONTRACT_VERSION;
  readonly engine: "sqlite-wasm-opfs-sahpool";
  readonly protocolVersion: typeof LIBRARY_CORE_SQLITE_PROTOCOL_VERSION;
  readonly schemaSha256: typeof LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256;
  readonly schemaVersion: typeof LIBRARY_CORE_SQLITE_SCHEMA_VERSION;
  readonly sqliteVersion: string;
  readonly storage: "opfs";
}

export type LibraryCoreSqliteWorkerResult =
  | LibraryCoreSqliteQueryResponse
  | LibraryCoreNormalizedCheckpointExportDescriptorV2
  | LibraryCoreNormalizedCheckpointExportPageV2
  | LibraryCoreNormalizedCheckpointStageStatusV2
  | LibraryCoreNormalizedCheckpointActivationReceiptV2
  | LibraryCoreNormalizedCheckpointSelectionV2
  | LibraryCoreDeviceGraphLayoutMutationResultV1
  | LibraryCoreDeviceContactMutationReceiptV1
  | LibraryCoreDeviceContactQueryResponseV1
  | LibraryCoreContentPolicyMutationReceiptV1
  | LibraryCoreContentStateV1
  | LibraryCoreContentRangePublicationStatusV1
  | LibraryCoreContentRangePublicationAbortReceiptV1
  | LibraryCoreContentRangeReadResponseV1
  | LibraryCoreContentCompletionReceiptV1
  | LibraryCoreContentEvictionReceiptV1
  | LibraryCoreHydrationCandidatePageV1
  | LibraryCoreEvictionCandidatePageV1
  | LibraryCoreVerifiedContentRangeReceiptV1
  | LibraryCoreFollowerMutationContextV1
  | LibraryCoreFollowerIntentCommitResultV1
  | LibraryCoreFollowerIntentPageResponseV1
  | LibraryCoreFollowerTransportContextV2
  | LibraryCoreFollowerTransportPageResponseV2
  | LibraryCoreFollowerIntentPublicationReceiptV1
  | LibraryCoreFollowerResultApplyReceiptV1
  | LibraryCoreNormalizedIntentTransportPublicationReceiptV2
  | LibraryCoreNormalizedResultTransportImportReceiptV2
  | LibraryCoreNormalizedOperationImportReceiptV2
  | LibraryCoreFollowerActorEnrollmentContextV2
  | LibraryCoreFollowerActorRequestReceiptV2
  | LibraryCoreFollowerActorEnrollmentReceiptV2
  | LibraryCoreScopeActionStagePageV1
  | LibraryCoreScopeActionStageStatusV1;

export type LibraryCoreSqliteWorkerResponse =
  | Readonly<{
      ok: true;
      requestId: string;
      status: LibraryCoreSqliteWorkerStatus;
    }>
  | Readonly<{
      ok: true;
      requestId: string;
      result: LibraryCoreSqliteWorkerResult;
    }>
  | Readonly<{
      code:
        | "invalid_request"
        | "library_busy"
        | "sqlite_initialization_failed"
        | "sqlite_integrity_failed";
      message: string;
      ok: false;
      requestId: string;
    }>;

function isClosedRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isBoundedWorkerIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255;
}

function isBoundedScopeEntityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 4_096
  );
}

export function parseLibraryCoreSqliteWorkerRequest(
  value: unknown,
): LibraryCoreSqliteWorkerRequest {
  if (!isClosedRecord(value)) {
    throw new TypeError("SQLite worker request must be a closed record");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys =
    value.kind === "query" || value.kind === "query_device_contacts"
      ? ["kind", "protocolVersion", "query", "requestId"]
      : value.kind === "mutate_device_graph_layout" ||
          value.kind === "mutate_device_contacts" ||
          value.kind === "mutate_content_policy"
        ? ["kind", "mutation", "protocolVersion", "requestId"]
        : value.kind === "read_content_state" ||
            value.kind === "read_content_range" ||
            value.kind === "verify_content_complete" ||
            value.kind === "evict_content" ||
            value.kind === "page_hydration_candidates" ||
            value.kind === "page_eviction_candidates"
          ? ["kind", "protocolVersion", "request", "requestId"]
          : value.kind === "begin_content_range_publication" ||
              value.kind === "append_content_range_publication" ||
              value.kind === "finalize_content_range_publication" ||
              value.kind === "abort_content_range_publication"
            ? ["kind", "protocolVersion", "publication", "requestId"]
            : value.kind === "commit_follower_intent"
              ? ["commit", "kind", "protocolVersion", "requestId"]
              : value.kind === "page_follower_intents" ||
                  value.kind === "page_follower_transport"
                ? ["kind", "page", "protocolVersion", "requestId"]
                : value.kind === "publish_follower_intent"
                  ? ["kind", "protocolVersion", "publication", "requestId"]
                  : value.kind === "apply_follower_result"
                    ? ["apply", "kind", "protocolVersion", "requestId"]
                    : value.kind ===
                        "publish_normalized_follower_intent_transport"
                      ? ["kind", "protocolVersion", "publication", "requestId"]
                      : value.kind ===
                            "import_normalized_follower_result_transport" ||
                          value.kind === "import_normalized_operation_page"
                        ? ["import", "kind", "protocolVersion", "requestId"]
                        : value.kind === "store_follower_actor_request"
                          ? ["kind", "protocolVersion", "requestId", "store"]
                          : value.kind === "install_follower_actor_enrollment"
                            ? [
                                "install",
                                "kind",
                                "protocolVersion",
                                "requestId",
                              ]
                            : value.kind ===
                                "read_normalized_checkpoint_export_page"
                              ? [
                                  "export",
                                  "kind",
                                  "protocolVersion",
                                  "requestId",
                                ]
                              : value.kind ===
                                  "begin_normalized_checkpoint_stage"
                                ? [
                                    "kind",
                                    "protocolVersion",
                                    "requestId",
                                    "stage",
                                  ]
                                : value.kind ===
                                    "append_normalized_checkpoint_stage_page"
                                  ? [
                                      "kind",
                                      "page",
                                      "protocolVersion",
                                      "requestId",
                                    ]
                                  : value.kind ===
                                      "activate_normalized_checkpoint_stage"
                                    ? [
                                        "activation",
                                        "kind",
                                        "protocolVersion",
                                        "requestId",
                                      ]
                                    : value.kind === "begin_scope_action"
                                      ? [
                                          "createdAt",
                                          "kind",
                                          "protocolVersion",
                                          "request",
                                          "requestId",
                                          "stageId",
                                        ]
                                      : value.kind === "append_scope_action"
                                        ? [
                                            "entityIds",
                                            "expectedOrdinal",
                                            "kind",
                                            "protocolVersion",
                                            "requestId",
                                            "stageId",
                                          ]
                                        : value.kind === "finalize_scope_action"
                                          ? [
                                              "expectedMemberCount",
                                              "kind",
                                              "protocolVersion",
                                              "requestId",
                                              "stageId",
                                            ]
                                          : value.kind === "page_scope_action"
                                            ? [
                                                "afterOrdinal",
                                                "kind",
                                                "protocolVersion",
                                                "requestId",
                                                "stageId",
                                              ]
                                            : value.kind ===
                                                "close_scope_action"
                                              ? [
                                                  "kind",
                                                  "protocolVersion",
                                                  "requestId",
                                                  "stageId",
                                                ]
                                              : [
                                                  "kind",
                                                  "protocolVersion",
                                                  "requestId",
                                                ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    ![
      "activate_normalized_checkpoint_stage",
      "abort_content_range_publication",
      "apply_follower_result",
      "append_content_range_publication",
      "append_normalized_checkpoint_stage_page",
      "begin_content_range_publication",
      "begin_normalized_checkpoint_stage",
      "begin_scope_action",
      "close",
      "close_scope_action",
      "commit_follower_intent",
      "describe_normalized_checkpoint_export",
      "append_scope_action",
      "finalize_scope_action",
      "finalize_content_range_publication",
      "evict_content",
      "follower_mutation_context",
      "follower_transport_context",
      "import_normalized_follower_result_transport",
      "import_normalized_operation_page",
      "install_follower_actor_enrollment",
      "mutate_device_contacts",
      "mutate_device_graph_layout",
      "mutate_content_policy",
      "open",
      "page_follower_intents",
      "page_eviction_candidates",
      "page_follower_transport",
      "page_hydration_candidates",
      "page_scope_action",
      "publish_follower_intent",
      "publish_normalized_follower_intent_transport",
      "query",
      "query_device_contacts",
      "read_normalized_checkpoint_receipt",
      "read_normalized_checkpoint_export_page",
      "read_content_state",
      "read_content_range",
      "read_follower_actor_enrollment_context",
      "store_follower_actor_request",
      "status",
      "verify_content_complete",
    ].includes(String(value.kind)) ||
    value.protocolVersion !== LIBRARY_CORE_SQLITE_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    value.requestId.length > 255
  ) {
    throw new TypeError("SQLite worker request identity is invalid");
  }
  if (value.kind === "read_normalized_checkpoint_export_page") {
    return Object.freeze({
      export: parseLibraryCorePinnedNormalizedCheckpointExportRequestV2(
        value.export,
      ),
      kind: "read_normalized_checkpoint_export_page",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "begin_normalized_checkpoint_stage") {
    parseLibraryCoreBeginNormalizedCheckpointStageV2(value.stage);
  } else if (value.kind === "append_normalized_checkpoint_stage_page") {
    parseLibraryCoreNormalizedCheckpointStagePageV2(value.page);
  } else if (value.kind === "activate_normalized_checkpoint_stage") {
    parseLibraryCoreActivateNormalizedCheckpointStageV2(value.activation);
  } else if (value.kind === "query") {
    const query = isClosedRecord(value.query)
      ? value.query.queryId === "account_detail_v1"
        ? parseLibraryCoreAccountDetailRequestV1(value.query)
        : value.query.queryId === "contact_match_v1"
          ? parseLibraryCoreContactMatchRequestV1(value.query)
          : value.query.queryId === "account_graph_page_v1"
            ? parseLibraryCoreAccountGraphPageRequestV1(value.query)
            : value.query.queryId === "account_link_candidates_v1"
              ? parseLibraryCoreAccountLinkCandidatesRequestV1(value.query)
              : value.query.queryId === "account_picker_page_v1"
                ? parseLibraryCoreAccountPickerPageRequestV1(value.query)
                : value.query.queryId === "account_timeline_v1"
                  ? parseLibraryCoreAccountTimelineRequestV1(value.query)
                  : value.query.queryId === "library_facet_summary_v1"
                    ? parseLibraryCoreFacetSummaryRequestV1(value.query)
                    : value.query.queryId === "change_feed_v1"
                      ? parseLibraryCoreChangeFeedRequestV1(value.query)
                      : value.query.queryId === "feed_browse_page_v3"
                        ? parseLibraryCoreFeedBrowsePageRequestV3(value.query)
                        : value.query.queryId === "filter_scope_summary_v1"
                          ? parseLibraryCoreFilterScopeSummaryRequestV1(
                              value.query,
                            )
                          : value.query.queryId === "friend_candidate_review_v1"
                            ? parseLibraryCoreFriendCandidateReviewRequestV1(
                                value.query,
                              )
                            : value.query.queryId ===
                                "friends_directory_page_v1"
                              ? parseLibraryCoreFriendsDirectoryPageRequestV1(
                                  value.query,
                                )
                              : value.query.queryId === "item_detail_v1"
                                ? parseLibraryCoreItemDetailRequestV1(
                                    value.query,
                                  )
                                : value.query.queryId === "item_reader_body_v1"
                                  ? parseLibraryCoreItemReaderBodyRequestV1(
                                      value.query,
                                    )
                                  : value.query.queryId ===
                                      "background_item_page_v1"
                                    ? parseLibraryCoreItemScanRequestV1(
                                        value.query,
                                      )
                                    : value.query.queryId ===
                                        "content_fetch_claim_v1"
                                      ? parseLibraryCoreContentFetchPageRequestV1(
                                          value.query,
                                        )
                                      : value.query.queryId ===
                                          "provider_media_page_v1"
                                        ? parseLibraryCoreProviderMediaPageRequestV1(
                                            value.query,
                                          )
                                        : value.query.queryId ===
                                            "map_markers_v1"
                                          ? parseLibraryCoreMapMarkersRequestV1(
                                              value.query,
                                            )
                                          : value.query.queryId ===
                                              "person_detail_v1"
                                            ? parseLibraryCorePersonDetailRequestV1(
                                                value.query,
                                              )
                                            : value.query.queryId ===
                                                "person_graph_page_v1"
                                              ? parseLibraryCorePersonGraphPageRequestV1(
                                                  value.query,
                                                )
                                              : value.query.queryId ===
                                                  "person_picker_page_v1"
                                                ? parseLibraryCorePersonPickerPageRequestV1(
                                                    value.query,
                                                  )
                                                : value.query.queryId ===
                                                    "person_timeline_v1"
                                                  ? parseLibraryCorePersonTimelineRequestV1(
                                                      value.query,
                                                    )
                                                  : value.query.queryId ===
                                                      "persons_graph_v1"
                                                    ? parseLibraryCorePersonsGraphRequestV1(
                                                        value.query,
                                                      )
                                                    : value.query.queryId ===
                                                        "rss_feed_detail_v1"
                                                      ? parseLibraryCoreRssFeedDetailRequestV1(
                                                          value.query,
                                                        )
                                                      : value.query.queryId ===
                                                          "rss_feed_page_v1"
                                                        ? parseLibraryCoreRssFeedPageRequestV1(
                                                            value.query,
                                                          )
                                                        : value.query
                                                              .queryId ===
                                                            "saved_analytics_v2"
                                                          ? parseLibraryCoreSavedAnalyticsRequestV2(
                                                              value.query,
                                                            )
                                                          : value.query
                                                                .queryId ===
                                                              "saved_feed_page_v2"
                                                            ? parseLibraryCoreSavedFeedPageRequestV2(
                                                                value.query,
                                                              )
                                                            : value.query
                                                                  .queryId ===
                                                                "story_wall_candidates_v1"
                                                              ? parseLibraryCoreStoryWallCandidatesRequestV1(
                                                                  value.query,
                                                                )
                                                              : value.query
                                                                    .queryId ===
                                                                  "search_page_v1"
                                                                ? parseLibraryCoreSearchPageRequestV1(
                                                                    value.query,
                                                                  )
                                                                : value.query
                                                                      .queryId ===
                                                                    "preferences_snapshot_v1"
                                                                  ? parseLibraryCorePreferencesSnapshotRequestV1(
                                                                      value.query,
                                                                    )
                                                                  : parseLibraryCoreFeedPageRequestV1(
                                                                      value.query,
                                                                    )
      : parseLibraryCoreFeedPageRequestV1(value.query);
    if (!query.ok) throw new TypeError(query.error);
  } else if (value.kind === "query_device_contacts") {
    const query = parseLibraryCoreDeviceContactQueryRequestV1(value.query);
    if (!query.ok) throw new TypeError(query.error);
  } else if (value.kind === "mutate_device_graph_layout") {
    const mutation = parseLibraryCoreDeviceGraphLayoutMutationV1(
      value.mutation,
    );
    if (!mutation.ok) throw new TypeError(mutation.error);
  } else if (value.kind === "mutate_device_contacts") {
    const mutation = parseLibraryCoreDeviceContactSyncMutationV1(
      value.mutation,
    );
    if (!mutation.ok) throw new TypeError(mutation.error);
  } else if (value.kind === "mutate_content_policy") {
    const mutation = parseLibraryCoreContentPolicyMutationV1(value.mutation);
    if (!mutation.ok) throw new TypeError(mutation.error);
  } else if (value.kind === "read_content_state") {
    const request = parseLibraryCoreContentStateRequestV1(value.request);
    if (!request.ok) throw new TypeError(request.error);
  } else if (value.kind === "read_content_range") {
    const request = parseLibraryCoreContentRangeReadRequestV1(value.request);
    if (!request.ok) throw new TypeError(request.error);
  } else if (value.kind === "verify_content_complete") {
    const request = parseLibraryCoreContentCompletionRequestV1(value.request);
    if (!request.ok) throw new TypeError(request.error);
  } else if (value.kind === "evict_content") {
    const request = parseLibraryCoreContentEvictionRequestV1(value.request);
    if (!request.ok) throw new TypeError(request.error);
  } else if (value.kind === "page_hydration_candidates") {
    const request = parseLibraryCoreHydrationCandidatePageRequestV1(
      value.request,
    );
    if (!request.ok) throw new TypeError(request.error);
  } else if (value.kind === "page_eviction_candidates") {
    const request = parseLibraryCoreEvictionCandidatePageRequestV1(
      value.request,
    );
    if (!request.ok) throw new TypeError(request.error);
  } else if (value.kind === "begin_content_range_publication") {
    const publication = parseLibraryCoreContentRangePublicationBeginV1(
      value.publication,
    );
    if (!publication.ok) throw new TypeError(publication.error);
  } else if (value.kind === "append_content_range_publication") {
    const publication = parseLibraryCoreContentRangePublicationAppendV1(
      value.publication,
    );
    if (!publication.ok) throw new TypeError(publication.error);
  } else if (value.kind === "finalize_content_range_publication") {
    const publication = parseLibraryCoreContentRangePublicationFinalizeV1(
      value.publication,
    );
    if (!publication.ok) throw new TypeError(publication.error);
  } else if (value.kind === "abort_content_range_publication") {
    const publication = parseLibraryCoreContentRangePublicationAbortV1(
      value.publication,
    );
    if (!publication.ok) throw new TypeError(publication.error);
  } else if (value.kind === "begin_scope_action") {
    const request = parseLibraryCoreAnyScopeActionRequestV1(value.request);
    if (
      !isBoundedWorkerIdentity(value.stageId) ||
      !Number.isSafeInteger(value.createdAt) ||
      Number(value.createdAt) < 0
    )
      throw new TypeError("SQLite scope action begin request is invalid");
    return Object.freeze({
      ...value,
      request,
    }) as LibraryCoreSqliteWorkerRequest;
  } else if (value.kind === "append_scope_action") {
    if (
      !isBoundedWorkerIdentity(value.stageId) ||
      !Number.isSafeInteger(value.expectedOrdinal) ||
      Number(value.expectedOrdinal) < 0 ||
      !Array.isArray(value.entityIds) ||
      value.entityIds.length < 1 ||
      value.entityIds.length > 256 ||
      value.entityIds.some((id) => !isBoundedScopeEntityId(id))
    )
      throw new TypeError("SQLite scope action append request is invalid");
  } else if (value.kind === "finalize_scope_action") {
    if (
      !isBoundedWorkerIdentity(value.stageId) ||
      !Number.isSafeInteger(value.expectedMemberCount) ||
      Number(value.expectedMemberCount) < 0
    )
      throw new TypeError("SQLite scope action finalize request is invalid");
  } else if (value.kind === "page_scope_action") {
    if (
      !isBoundedWorkerIdentity(value.stageId) ||
      !Number.isSafeInteger(value.afterOrdinal) ||
      Number(value.afterOrdinal) < -1
    )
      throw new TypeError("SQLite scope action page request is invalid");
  } else if (value.kind === "close_scope_action") {
    if (!isBoundedWorkerIdentity(value.stageId)) {
      throw new TypeError("SQLite scope action close request is invalid");
    }
  } else if (value.kind === "commit_follower_intent") {
    const commit = parseLibraryCoreFollowerIntentCommitV1(value.commit);
    return Object.freeze({
      commit,
      kind: "commit_follower_intent",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "page_follower_intents") {
    return Object.freeze({
      kind: "page_follower_intents",
      page: parseLibraryCoreFollowerIntentPageRequestV1(value.page),
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "page_follower_transport") {
    return Object.freeze({
      kind: "page_follower_transport",
      page: parseLibraryCoreFollowerTransportPageRequestV2(value.page),
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "publish_follower_intent") {
    return Object.freeze({
      kind: "publish_follower_intent",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      publication: parseLibraryCoreFollowerIntentPublicationV1(
        value.publication,
      ),
      requestId: value.requestId,
    });
  } else if (value.kind === "apply_follower_result") {
    return Object.freeze({
      apply: parseLibraryCoreFollowerResultApplyV1(value.apply),
      kind: "apply_follower_result",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "publish_normalized_follower_intent_transport") {
    return Object.freeze({
      kind: "publish_normalized_follower_intent_transport",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      publication: parseLibraryCoreNormalizedIntentTransportPublicationV2(
        value.publication,
      ),
      requestId: value.requestId,
    });
  } else if (value.kind === "import_normalized_follower_result_transport") {
    return Object.freeze({
      import: parseLibraryCoreNormalizedResultTransportImportV2(value.import),
      kind: "import_normalized_follower_result_transport",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "import_normalized_operation_page") {
    return Object.freeze({
      import: parseLibraryCoreNormalizedOperationImportPageV2(value.import),
      kind: "import_normalized_operation_page",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  } else if (value.kind === "store_follower_actor_request") {
    return Object.freeze({
      kind: "store_follower_actor_request",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
      store: parseLibraryCoreStoreFollowerActorRequestV2(value.store),
    });
  } else if (value.kind === "install_follower_actor_enrollment") {
    return Object.freeze({
      install: parseLibraryCoreInstallFollowerActorEnrollmentV2(value.install),
      kind: "install_follower_actor_enrollment",
      protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  }
  return value as unknown as LibraryCoreSqliteWorkerRequest;
}

export function createLibraryCoreSqliteFollowerResultApplyWorkerRequest(
  requestId: string,
  apply: LibraryCoreFollowerResultApplyV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    apply,
    kind: "apply_follower_result",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteNormalizedIntentTransportPublicationWorkerRequest(
  requestId: string,
  publication: LibraryCoreNormalizedIntentTransportPublicationV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "publish_normalized_follower_intent_transport",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteNormalizedResultTransportImportWorkerRequest(
  requestId: string,
  imported: LibraryCoreNormalizedResultTransportImportV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    import: imported,
    kind: "import_normalized_follower_result_transport",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteNormalizedOperationImportWorkerRequest(
  requestId: string,
  imported: LibraryCoreNormalizedOperationImportPageV2,
): Extract<
  LibraryCoreSqliteWorkerRequest,
  { readonly kind: "import_normalized_operation_page" }
> {
  const request = parseLibraryCoreSqliteWorkerRequest({
    import: imported,
    kind: "import_normalized_operation_page",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
  if (request.kind !== "import_normalized_operation_page") {
    throw new TypeError("normalized operation import request changed kind");
  }
  return request;
}

export function createLibraryCoreSqliteFollowerActorEnrollmentContextWorkerRequest(
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "read_follower_actor_enrollment_context",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteStoreFollowerActorRequestWorkerRequest(
  requestId: string,
  store: LibraryCoreStoreFollowerActorRequestV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "store_follower_actor_request",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    store,
  });
}

export function createLibraryCoreSqliteInstallFollowerActorEnrollmentWorkerRequest(
  requestId: string,
  install: LibraryCoreInstallFollowerActorEnrollmentV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    install,
    kind: "install_follower_actor_enrollment",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerMutationContextWorkerRequest(
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "follower_mutation_context",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function parseLibraryCoreSqliteFollowerMutationContextResponse(
  value: unknown,
): LibraryCoreFollowerMutationContextV1 {
  return parseLibraryCoreFollowerMutationContextV1(value);
}

export function createLibraryCoreSqliteFollowerIntentCommitWorkerRequest(
  requestId: string,
  commit: LibraryCoreFollowerIntentCommitV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    commit,
    kind: "commit_follower_intent",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerIntentPageWorkerRequest(
  requestId: string,
  page: LibraryCoreFollowerIntentPageRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "page_follower_intents",
    page,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerTransportContextWorkerRequest(
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "follower_transport_context",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerTransportPageWorkerRequest(
  requestId: string,
  page: LibraryCoreFollowerTransportPageRequestV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "page_follower_transport",
    page,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteFollowerIntentPublicationWorkerRequest(
  requestId: string,
  publication: LibraryCoreFollowerIntentPublicationV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "publish_follower_intent",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteWorkerRequest(
  kind: "close" | "open" | "status",
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteQueryWorkerRequest<
  T extends LibraryCoreSqliteQueryRequest,
>(requestId: string, query: T): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "query",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    query,
    requestId,
  });
}

export function createLibraryCoreSqliteDeviceGraphLayoutMutationWorkerRequest(
  requestId: string,
  mutation: LibraryCoreDeviceGraphLayoutMutationV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "mutate_device_graph_layout",
    mutation,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteDeviceContactMutationWorkerRequest(
  requestId: string,
  mutation: LibraryCoreDeviceContactSyncMutationV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "mutate_device_contacts",
    mutation,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteDeviceContactQueryWorkerRequest(
  requestId: string,
  query: LibraryCoreDeviceContactQueryRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "query_device_contacts",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    query,
    requestId,
  });
}

export function createLibraryCoreSqliteContentPolicyMutationWorkerRequest(
  requestId: string,
  mutation: LibraryCoreContentPolicyMutationV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "mutate_content_policy",
    mutation,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteContentStateWorkerRequest(
  requestId: string,
  request: LibraryCoreContentStateRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "read_content_state",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
  });
}

export function createLibraryCoreSqliteContentRangeReadWorkerRequest(
  requestId: string,
  request: LibraryCoreContentRangeReadRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "read_content_range",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
  });
}

export function createLibraryCoreSqliteContentCompletionWorkerRequest(
  requestId: string,
  request: LibraryCoreContentCompletionRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "verify_content_complete",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
  });
}

export function createLibraryCoreSqliteContentEvictionWorkerRequest(
  requestId: string,
  request: LibraryCoreContentEvictionRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "evict_content",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
  });
}

export function createLibraryCoreSqliteHydrationCandidatePageWorkerRequest(
  requestId: string,
  request: LibraryCoreHydrationCandidatePageRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "page_hydration_candidates",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
  });
}

export function createLibraryCoreSqliteEvictionCandidatePageWorkerRequest(
  requestId: string,
  request: LibraryCoreEvictionCandidatePageRequestV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "page_eviction_candidates",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
  });
}

export function createLibraryCoreSqliteContentRangePublicationBeginWorkerRequest(
  requestId: string,
  publication: LibraryCoreContentRangePublicationBeginV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "begin_content_range_publication",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteContentRangePublicationAppendWorkerRequest(
  requestId: string,
  publication: LibraryCoreContentRangePublicationAppendV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "append_content_range_publication",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteContentRangePublicationFinalizeWorkerRequest(
  requestId: string,
  publication: LibraryCoreContentRangePublicationFinalizeV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "finalize_content_range_publication",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteContentRangePublicationAbortWorkerRequest(
  requestId: string,
  publication: LibraryCoreContentRangePublicationAbortV1,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "abort_content_range_publication",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    publication,
    requestId,
  });
}

export function createLibraryCoreSqliteBeginScopeActionWorkerRequest(
  requestId: string,
  stageId: string,
  request: LibraryCoreAnyScopeActionRequestV1,
  createdAt: number,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    createdAt,
    kind: "begin_scope_action",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    request,
    requestId,
    stageId,
  });
}

export function createLibraryCoreSqliteAppendScopeActionWorkerRequest(
  requestId: string,
  stageId: string,
  expectedOrdinal: number,
  entityIds: readonly string[],
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    entityIds: [...entityIds],
    expectedOrdinal,
    kind: "append_scope_action",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stageId,
  });
}

export function createLibraryCoreSqliteFinalizeScopeActionWorkerRequest(
  requestId: string,
  stageId: string,
  expectedMemberCount: number,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    expectedMemberCount,
    kind: "finalize_scope_action",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stageId,
  });
}

export function createLibraryCoreSqlitePageScopeActionWorkerRequest(
  requestId: string,
  stageId: string,
  afterOrdinal: number,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    afterOrdinal,
    kind: "page_scope_action",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stageId,
  });
}

export function createLibraryCoreSqliteCloseScopeActionWorkerRequest(
  requestId: string,
  stageId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "close_scope_action",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stageId,
  });
}

export function createLibraryCoreSqliteBeginCheckpointWorkerRequest(
  requestId: string,
  stage: LibraryCoreBeginNormalizedCheckpointStageV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "begin_normalized_checkpoint_stage",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
    stage,
  });
}

export function createLibraryCoreSqliteAppendCheckpointPageWorkerRequest(
  requestId: string,
  page: LibraryCoreNormalizedCheckpointStagePageV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "append_normalized_checkpoint_stage_page",
    page,
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteActivateCheckpointWorkerRequest(
  requestId: string,
  activation: LibraryCoreActivateNormalizedCheckpointStageV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    activation,
    kind: "activate_normalized_checkpoint_stage",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteReadCheckpointReceiptWorkerRequest(
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "read_normalized_checkpoint_receipt",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteDescribeCheckpointExportWorkerRequest(
  requestId: string,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    kind: "describe_normalized_checkpoint_export",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function createLibraryCoreSqliteReadCheckpointExportPageWorkerRequest(
  requestId: string,
  request: LibraryCorePinnedNormalizedCheckpointExportRequestV2,
): LibraryCoreSqliteWorkerRequest {
  return parseLibraryCoreSqliteWorkerRequest({
    export: request,
    kind: "read_normalized_checkpoint_export_page",
    protocolVersion: LIBRARY_CORE_SQLITE_PROTOCOL_VERSION,
    requestId,
  });
}

export function parseLibraryCoreSqliteCheckpointSelectionResponse(
  value: unknown,
): LibraryCoreNormalizedCheckpointSelectionV2 {
  return parseLibraryCoreNormalizedCheckpointSelectionV2(value);
}
