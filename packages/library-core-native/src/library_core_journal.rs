//! Authoritative Library Core SQLite journal.
//!
//! Production entry points reach this module only through the native runtime,
//! canonical verifier, and enrolled actor. The verified input types remain
//! private so renderer IPC cannot manufacture authority by matching a Rust
//! struct's shape.

use rusqlite::config::DbConfig;
use rusqlite::limits::Limit;
use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Result as SqlResult, Transaction,
    TransactionBehavior,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt;
use std::path::Path;
use std::time::Duration;

#[path = "library_core_actor_capability.rs"]
mod actor_capability;
#[path = "library_core_journal_authority.rs"]
mod authority;
#[path = "library_core_journal_enrollment_verifier.rs"]
mod enrollment_verifier;
#[path = "library_core_journal_follower.rs"]
mod follower;
#[path = "library_core_journal_operation_verifier.rs"]
mod operation_verifier;

use actor_capability::ActorCapabilityState;

pub use follower::{
    FollowerIntentEnqueueReceipt, FollowerIntentOutboxCandidate, FollowerIntentOutboxEntry,
    FollowerIntentPublicationReceipt, FollowerOverlayReplayReceipt, FollowerResultImportCursor,
    FollowerResultImportReceipt, FollowerRuntimeStatus, StoredFollowerActorEnrollment,
    StoredFollowerActorRequest, VerifiedFollowerAnchor, VerifiedFollowerCheckpointActor,
    VerifiedFollowerIntentPublication, VerifiedFollowerIntentResult, VerifiedFollowerResultSegment,
};

const AUTHORITATIVE_SCHEMA_VERSION: i64 = 12;
// ASCII "FREE" in SQLite's 32-bit application_id header field.
const AUTHORITATIVE_APPLICATION_ID: i64 = 0x4652_4545;
const AUTHORITATIVE_SCHEMA_V1_SQL: &str =
    include_str!("../../shared/src/library-core/authoritative-schema-v1.sql");
const AUTHORITATIVE_SCHEMA_MIGRATIONS: [(i64, &str); 11] = [
    (
        2,
        include_str!("../../shared/src/library-core/authoritative-migration-002.sql"),
    ),
    (
        3,
        include_str!("../../shared/src/library-core/authoritative-migration-003.sql"),
    ),
    (
        4,
        include_str!("../../shared/src/library-core/authoritative-migration-004.sql"),
    ),
    (
        5,
        include_str!("../../shared/src/library-core/authoritative-migration-005.sql"),
    ),
    (
        6,
        include_str!("../../shared/src/library-core/authoritative-migration-006.sql"),
    ),
    (
        7,
        include_str!("../../shared/src/library-core/authoritative-migration-007.sql"),
    ),
    (
        8,
        include_str!("../../shared/src/library-core/authoritative-migration-008.sql"),
    ),
    (
        9,
        include_str!("../../shared/src/library-core/authoritative-migration-009.sql"),
    ),
    (
        10,
        include_str!("../../shared/src/library-core/authoritative-migration-010.sql"),
    ),
    (
        11,
        include_str!("../../shared/src/library-core/authoritative-migration-011.sql"),
    ),
    (
        12,
        include_str!("../../shared/src/library-core/authoritative-migration-012.sql"),
    ),
];

fn apply_schema_range(
    transaction: &Transaction<'_>,
    prior: i64,
    through: i64,
) -> JournalResult<()> {
    if prior == 0 {
        transaction.execute_batch(AUTHORITATIVE_SCHEMA_V1_SQL)?;
    }
    for (version, sql) in AUTHORITATIVE_SCHEMA_MIGRATIONS {
        if version > prior && version <= through {
            transaction.execute_batch(sql)?;
        }
    }
    Ok(())
}
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
const BASE_CACHE_KIB: i64 = -32 * 1024;
const MAX_TRANSACTION_MEMBERS: usize = 1_000;
const MAX_TRANSACTION_ENVELOPE_BYTES: usize = 4_194_304;
const MAX_CAUSAL_TIPS_PER_OPERATION: usize = 4_096;
const MAX_ENTITY_ID_BYTES: usize = 4_096;
const MAX_OPERATION_ID_BYTES: usize = 128;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_OUTBOX_PAGE_ENTRIES: usize = 256;
const MAX_OUTBOX_PAGE_BYTES: usize = 4_194_304;
const MAX_SCHEMA_CATALOG_ENTRIES: usize = 256;
const MAX_SCHEMA_CATALOG_IDENTIFIER_BYTES: i64 = 256;
const MAX_SCHEMA_CATALOG_BYTES: i64 = 1_048_576;
const SQLITE_MAX_VALUE_BYTES: i32 = 8 * 1024 * 1024;
const SQLITE_MAX_SQL_BYTES: i32 = 1024 * 1024;
const SQLITE_MAX_COLUMNS: i32 = 128;
const SQLITE_MAX_EXPRESSION_DEPTH: i32 = 64;
const SQLITE_MAX_COMPOUND_SELECTS: i32 = 8;
const SQLITE_MAX_FUNCTION_ARGUMENTS: i32 = 32;
const SQLITE_MAX_ATTACHED_DATABASES: i32 = 0;
const SQLITE_MAX_PATTERN_BYTES: i32 = 4_096;
const SQLITE_MAX_VARIABLE_NUMBER: i32 = 64;
const SQLITE_MAX_TRIGGER_DEPTH: i32 = 8;
const SQLITE_MAX_WORKER_THREADS: i32 = 0;
const OPERATION_OUTBOX_PAGE_SQL: &str = "
    SELECT operation.operationId, outbox.ingestSequence,
           outbox.enqueuedAtMs,
           length(CAST(operation.canonicalEnvelopeJson AS BLOB)),
           operation.canonicalEnvelopeJson,
           operation.transactionId,
           operation.transactionMemberIndex,
           operation.transactionMemberCount
    FROM library_core_replication_outbox AS outbox
    JOIN library_core_operations AS operation
      ON operation.operationId = outbox.operationId
     AND operation.ingestSequence = outbox.ingestSequence
    WHERE outbox.acknowledgedAtMs IS NULL
      AND outbox.ingestSequence > ?1
    ORDER BY outbox.ingestSequence
    LIMIT ?2;";
const ENROLLMENT_OUTBOX_PAGE_SQL: &str = "
    SELECT actor.enrollmentOperationId, outbox.enqueuedAtMs,
           length(CAST(actor.canonicalEnrollmentCertificateJson AS BLOB)),
           actor.canonicalEnrollmentCertificateJson
    FROM library_core_actors AS actor
    JOIN library_core_actor_enrollment_outbox AS outbox
      ON outbox.enrollmentOperationId = actor.enrollmentOperationId
     AND outbox.acknowledgedAtMs IS NULL
    WHERE outbox.enqueuedAtMs > ?1
       OR (
         outbox.enqueuedAtMs = ?1
         AND outbox.enrollmentOperationId > ?2 COLLATE BINARY
       )
    ORDER BY outbox.enqueuedAtMs, outbox.enrollmentOperationId COLLATE BINARY
    LIMIT ?3;";
const RESULT_OUTBOX_PAGE_SQL: &str = "
    SELECT resultOperationId, actorId, resultSequence, intentOperationId,
           intentSequence, status, providerReceiptDigest, enqueuedAtMs
    FROM library_core_intent_result_outbox
    WHERE libraryId = ?1 AND epochId = ?2 AND acknowledgedAtMs IS NULL
      AND (
        actorId > ?3 COLLATE BINARY
        OR (actorId = ?3 AND resultSequence > ?4)
      )
    ORDER BY actorId COLLATE BINARY, resultSequence
    LIMIT ?5;";

#[derive(Debug)]
pub enum JournalError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    UnsupportedSchemaVersion { expected: i64, actual: i64 },
    DatabaseIdentityMismatch { expected: i64, actual: i64 },
    UnversionedSchemaPresent,
    SchemaContractMismatch,
    InvalidVerifiedInput { field: &'static str },
    ActorEnrollmentConflict { actor_id: String },
    ActorNotFound { actor_id: String },
    AuthorityNotFound { library_id: String },
    AuthorityConflict,
    AuthorityProtocolConflict { library_id: String },
    StaleAuthority { library_id: String },
    StaleActorTip { actor_id: String },
    TransactionReplayConflict { transaction_id: String },
    UnknownCausalTip { operation_id: String },
    OperationVerification { index: usize, field: &'static str },
    EnrollmentVerification { field: &'static str },
}
/// What the runtime can say about an opened journal.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalRuntimeStatus {
    pub schema_version: i64,
    /// How far materialization has consumed the operation log.
    pub materializer_ingest_sequence: i64,
    pub actors: i64,
    pub operations: i64,
    pub read_state: i64,
    pub unacknowledged_outbox: i64,
}

impl From<rusqlite::Error> for JournalError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<std::io::Error> for JournalError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for JournalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "filesystem error: {error}"),
            Self::Sql(error) => write!(formatter, "SQLite error: {error}"),
            Self::UnsupportedSchemaVersion { expected, actual } => {
                write!(
                    formatter,
                    "unsupported schema version: expected {expected}, got {actual}"
                )
            }
            Self::DatabaseIdentityMismatch { expected, actual } => {
                write!(
                    formatter,
                    "authoritative database identity mismatch: expected {expected}, got {actual}"
                )
            }
            Self::UnversionedSchemaPresent => {
                formatter.write_str("unversioned authoritative schema is present")
            }
            Self::SchemaContractMismatch => {
                formatter.write_str("authoritative schema does not match its checked-in contract")
            }
            Self::InvalidVerifiedInput { field } => {
                write!(formatter, "invalid verified input field: {field}")
            }
            Self::ActorEnrollmentConflict { actor_id } => {
                write!(formatter, "actor enrollment conflicts for {actor_id}")
            }
            Self::ActorNotFound { actor_id } => write!(formatter, "actor not found: {actor_id}"),
            Self::AuthorityNotFound { library_id } => {
                write!(
                    formatter,
                    "active authority not found for library {library_id}"
                )
            }
            Self::AuthorityConflict => {
                formatter.write_str("more than one local authority is active")
            }
            Self::AuthorityProtocolConflict { library_id } => {
                write!(
                    formatter,
                    "native authority protocol conflicts for library {library_id}"
                )
            }
            Self::StaleAuthority { library_id } => {
                write!(
                    formatter,
                    "active authority is stale for library {library_id}"
                )
            }
            Self::StaleActorTip { actor_id } => {
                write!(formatter, "actor tip is stale: {actor_id}")
            }
            Self::TransactionReplayConflict { transaction_id } => {
                write!(formatter, "transaction replay conflicts: {transaction_id}")
            }
            Self::UnknownCausalTip { operation_id } => {
                write!(
                    formatter,
                    "operation has an unknown causal tip: {operation_id}"
                )
            }
            Self::OperationVerification { index, field } => {
                write!(
                    formatter,
                    "operation envelope {index} failed verification at {field}"
                )
            }
            Self::EnrollmentVerification { field } => {
                write!(
                    formatter,
                    "actor enrollment certificate failed verification at {field}"
                )
            }
        }
    }
}

impl std::error::Error for JournalError {}

pub type JournalResult<T> = std::result::Result<T, JournalError>;

#[derive(Debug, Clone, PartialEq)]
pub struct ActorState {
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub actor_id: String,
    pub actor_public_key: String,
    pub enrollment_operation_id: String,
    pub enrollment_certificate_digest: String,
    pub canonical_enrollment_certificate_json: String,
    pub actor_chain_genesis: String,
    pub next_sequence: i64,
    pub previous_operation_id: Option<String>,
    pub previous_chain_digest: String,
    pub(crate) capability: ActorCapabilityState,
}

#[derive(Debug, Clone)]
struct VerifiedActorEnrollment {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    enrollment_operation_id: String,
    enrollment_certificate_digest: String,
    canonical_enrollment_certificate_json: String,
    actor_chain_genesis: String,
    enrolled_at_ms: i64,
    capability: ActorCapabilityState,
}

#[derive(Debug)]
struct StoredActorRow {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    enrollment_operation_id: String,
    enrollment_certificate_digest: String,
    canonical_enrollment_certificate_json: String,
    actor_chain_genesis: String,
    next_sequence: i64,
    previous_operation_id: Option<String>,
    previous_chain_digest: String,
}

#[derive(Debug)]
struct StoredActorCapabilityRow {
    certificate_version: i64,
    actor_class: String,
    allowed_operation_types_json: String,
    scope_mode: String,
    scope_kind: Option<String>,
    scope_id: Option<String>,
    issuance_identity: Option<String>,
    retirement_identity: Option<String>,
    capability_certificate_digest: String,
    issued_at_ms: i64,
    retired: i64,
    retirement_certificate_digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedCausalTip {
    pub actor_id: String,
    pub sequence: i64,
    pub operation_id: String,
    pub chain_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedAuthorityState {
    pub library_id: String,
    pub epoch: i64,
    pub epoch_id: String,
    pub authority_key_id: String,
    pub authority_public_key: String,
    pub observed_frontier: Vec<VerifiedCausalTip>,
}

#[derive(Debug, Clone)]
pub(crate) struct VerifiedAuthorityEpoch {
    pub(crate) authority: AcceptedAuthorityState,
    pub(crate) transition_certificate_digest: String,
    pub(crate) canonical_transition_certificate_json: String,
    pub(crate) accepted_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VerifiedAuthorityProtocolTransition {
    pub(crate) library_id: String,
    pub(crate) source_epoch: i64,
    pub(crate) source_epoch_id: String,
    pub(crate) source_transition_certificate_digest: String,
    pub(crate) protocol_transition_certificate_digest: String,
    pub(crate) canonical_protocol_transition_certificate_json: String,
    pub(crate) source_manifest_digest: String,
    pub(crate) accepted_at_ms: i64,
}

#[derive(Debug, Clone)]
struct VerifiedOperation {
    operation_id: String,
    actor_sequence: i64,
    previous_actor_operation_id: Option<String>,
    previous_actor_chain_digest: String,
    actor_chain_digest: String,
    member_digest: String,
    signing_body_digest: String,
    envelope_digest: String,
    entity_id: String,
    entity_type: String,
    operation_type: String,
    item_json: Option<String>,
    rss_feed_json: Option<String>,
    preferences_patch_json: Option<String>,
    person_json: Option<String>,
    account_json: Option<String>,
    read_at_ms: Option<i64>,
    assigned: Option<bool>,
    assigned_at_ms: Option<i64>,
    removed_at_ms: Option<i64>,
    canonical_envelope_json: String,
    causal_tips: Vec<VerifiedCausalTip>,
}

#[derive(Debug, Clone)]
struct VerifiedOperationTransaction {
    transaction_id: String,
    transaction_digest: String,
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    actor_capability: ActorCapabilityState,
    canonical_envelope_bytes: usize,
    members: Vec<VerifiedOperation>,
}

#[derive(Debug, Clone, PartialEq)]
struct TransactionReceipt {
    transaction_id: String,
    transaction_digest: String,
    actor_id: String,
    member_count: usize,
    first_sequence: i64,
    last_sequence: i64,
    committed_operation_id: String,
    committed_chain_digest: String,
    first_ingest_sequence: i64,
    last_ingest_sequence: i64,
    previous_revision: i64,
    committed_revision: i64,
    committed_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq)]
struct ReadState {
    entity_id: String,
    read_at_ms: i64,
    source_operation_id: String,
    source_actor_id: String,
    source_sequence: i64,
    source_chain_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OperationOutboxEntry {
    operation_id: String,
    ingest_sequence: i64,
    enqueued_at_ms: i64,
    canonical_envelope_json: String,
    transaction_id: String,
    transaction_member_index: i64,
    transaction_member_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OperationOutboxPage {
    entries: Vec<OperationOutboxEntry>,
    next_after_ingest_sequence: Option<i64>,
    has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EnrollmentOutboxCursor {
    enqueued_at_ms: i64,
    enrollment_operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EnrollmentOutboxEntry {
    enrollment_operation_id: String,
    enqueued_at_ms: i64,
    canonical_enrollment_certificate_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EnrollmentOutboxPage {
    entries: Vec<EnrollmentOutboxEntry>,
    next_cursor: Option<EnrollmentOutboxCursor>,
    has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentResultOutboxEntry {
    pub result_operation_id: String,
    pub actor_id: String,
    pub result_sequence: i64,
    pub intent_operation_id: String,
    pub intent_sequence: i64,
    pub status: String,
    pub provider_receipt_digest: Option<String>,
    pub enqueued_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SchemaCatalogEntry {
    object_type: String,
    name: String,
    table_name: String,
    sql: String,
}

pub struct LibraryCoreJournal {
    connection: Connection,
}

fn is_lower_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_OPERATION_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn validate_actor_enrollment(enrollment: &VerifiedActorEnrollment) -> JournalResult<()> {
    if !is_lower_hex(&enrollment.library_id, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "library_id",
        });
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&enrollment.epoch) {
        return Err(JournalError::InvalidVerifiedInput { field: "epoch" });
    }
    for (field, value) in [
        ("epoch_id", enrollment.epoch_id.as_str()),
        ("actor_id", enrollment.actor_id.as_str()),
        (
            "enrollment_certificate_digest",
            enrollment.enrollment_certificate_digest.as_str(),
        ),
        (
            "actor_chain_genesis",
            enrollment.actor_chain_genesis.as_str(),
        ),
    ] {
        if !is_lower_hex(value, 32) {
            return Err(JournalError::InvalidVerifiedInput { field });
        }
    }
    if !is_lower_hex(&enrollment.actor_public_key, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "actor_public_key",
        });
    }
    if !is_operation_id(&enrollment.enrollment_operation_id) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "enrollment_operation_id",
        });
    }
    if enrollment.canonical_enrollment_certificate_json.is_empty()
        || enrollment.canonical_enrollment_certificate_json.len() > MAX_TRANSACTION_ENVELOPE_BYTES
    {
        return Err(JournalError::InvalidVerifiedInput {
            field: "canonical_enrollment_certificate_json",
        });
    }
    if !(0..=MAX_SAFE_INTEGER).contains(&enrollment.enrolled_at_ms) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "enrolled_at_ms",
        });
    }
    actor_capability::validate_capability_state(&enrollment.capability)
        .map_err(|field| JournalError::InvalidVerifiedInput { field })?;
    if enrollment.capability.capability_certificate_digest
        != enrollment.enrollment_certificate_digest
        || enrollment.capability.issued_at_ms != enrollment.enrolled_at_ms
        || enrollment.capability.retired
    {
        return Err(JournalError::InvalidVerifiedInput {
            field: "actor_capability",
        });
    }
    Ok(())
}

fn validate_transaction(transaction: &VerifiedOperationTransaction) -> JournalResult<()> {
    if !is_operation_id(&transaction.transaction_id) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "transaction_id",
        });
    }
    if !is_lower_hex(&transaction.transaction_digest, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "transaction_digest",
        });
    }
    if !is_lower_hex(&transaction.library_id, 32) {
        return Err(JournalError::InvalidVerifiedInput {
            field: "library_id",
        });
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&transaction.epoch) {
        return Err(JournalError::InvalidVerifiedInput { field: "epoch" });
    }
    if !is_lower_hex(&transaction.epoch_id, 32) {
        return Err(JournalError::InvalidVerifiedInput { field: "epoch_id" });
    }
    if !is_lower_hex(&transaction.actor_id, 32) {
        return Err(JournalError::InvalidVerifiedInput { field: "actor_id" });
    }
    actor_capability::validate_capability_state(&transaction.actor_capability)
        .map_err(|field| JournalError::InvalidVerifiedInput { field })?;
    if transaction.members.is_empty() || transaction.members.len() > MAX_TRANSACTION_MEMBERS {
        return Err(JournalError::InvalidVerifiedInput { field: "members" });
    }
    if transaction.canonical_envelope_bytes == 0
        || transaction.canonical_envelope_bytes > MAX_TRANSACTION_ENVELOPE_BYTES
    {
        return Err(JournalError::InvalidVerifiedInput {
            field: "canonical_envelope_bytes",
        });
    }

    let mut measured_bytes = 0usize;
    for (index, member) in transaction.members.iter().enumerate() {
        if !is_operation_id(&member.operation_id) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "operation_id",
            });
        }
        let expected_sequence = transaction.members[0]
            .actor_sequence
            .checked_add(index as i64)
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "actor_sequence",
            })?;
        if !(1..MAX_SAFE_INTEGER).contains(&member.actor_sequence)
            || member.actor_sequence != expected_sequence
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "actor_sequence",
            });
        }
        if index > 0
            && member.previous_actor_operation_id.as_deref()
                != Some(transaction.members[index - 1].operation_id.as_str())
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "previous_actor_operation_id",
            });
        }
        for (field, value) in [
            (
                "previous_actor_chain_digest",
                member.previous_actor_chain_digest.as_str(),
            ),
            ("actor_chain_digest", member.actor_chain_digest.as_str()),
            ("member_digest", member.member_digest.as_str()),
            ("signing_body_digest", member.signing_body_digest.as_str()),
            ("envelope_digest", member.envelope_digest.as_str()),
        ] {
            if !is_lower_hex(value, 32) {
                return Err(JournalError::InvalidVerifiedInput { field });
            }
        }
        if index > 0
            && member.previous_actor_chain_digest
                != transaction.members[index - 1].actor_chain_digest
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "previous_actor_chain_digest",
            });
        }
        if member.entity_id.is_empty() || member.entity_id.len() > MAX_ENTITY_ID_BYTES {
            return Err(JournalError::InvalidVerifiedInput { field: "entity_id" });
        }
        let payload_slot_count = usize::from(member.item_json.is_some())
            + usize::from(member.rss_feed_json.is_some())
            + usize::from(member.preferences_patch_json.is_some())
            + usize::from(member.person_json.is_some())
            + usize::from(member.account_json.is_some())
            + usize::from(member.read_at_ms.is_some())
            + usize::from(member.assigned.is_some() || member.assigned_at_ms.is_some())
            + usize::from(member.removed_at_ms.is_some());
        if payload_slot_count != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "operation_payload",
            });
        }
        match member.operation_type.as_str() {
            "feed_item_capture_upsert" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_none()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput { field: "item_json" });
                }
            }
            "feed_item_read_assignment" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member
                        .read_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "read_at_ms",
                    });
                }
            }
            "feed_item_saved_assignment"
            | "feed_item_archive_assignment"
            | "feed_item_like_assignment" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_none()
                    || member
                        .assigned_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "user_state_assignment",
                    });
                }
            }
            "feed_item_remove" => {
                if member.entity_type != "FeedItem"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "removed_at_ms",
                    });
                }
            }
            "rss_feed_upsert" => {
                if member.entity_type != "RssFeed"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_none()
                    || member.preferences_patch_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "rss_feed_json",
                    });
                }
            }
            "rss_feed_remove_keep_items" | "rss_feed_remove_with_items" => {
                if member.entity_type != "RssFeed"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "rss_feed_remove",
                    });
                }
            }
            "preferences_leaf_assignment" => {
                if member.entity_type != "UserPreferences"
                    || member.entity_id != "preferences"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "preferences_patch_json",
                    });
                }
            }
            "person_upsert" => {
                if member.entity_type != "Person"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.person_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "person_json",
                    });
                }
            }
            "person_remove_and_accounts" => {
                if member.entity_type != "Person"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.person_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "person_remove",
                    });
                }
            }
            "account_upsert" => {
                if member.entity_type != "Account"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_none()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member.removed_at_ms.is_some()
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "account_json",
                    });
                }
            }
            "account_remove" => {
                if member.entity_type != "Account"
                    || member.item_json.is_some()
                    || member.rss_feed_json.is_some()
                    || member.preferences_patch_json.is_some()
                    || member.person_json.is_some()
                    || member.account_json.is_some()
                    || member.read_at_ms.is_some()
                    || member.assigned.is_some()
                    || member.assigned_at_ms.is_some()
                    || member
                        .removed_at_ms
                        .is_none_or(|value| !(0..=MAX_SAFE_INTEGER).contains(&value))
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "account_remove",
                    });
                }
            }
            _ => {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "operation_type",
                });
            }
        }
        if member.canonical_envelope_json.is_empty() {
            return Err(JournalError::InvalidVerifiedInput {
                field: "canonical_envelope_json",
            });
        }
        measured_bytes = measured_bytes
            .checked_add(member.canonical_envelope_json.len())
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "canonical_envelope_bytes",
            })?;
        if member.causal_tips.len() > MAX_CAUSAL_TIPS_PER_OPERATION {
            return Err(JournalError::InvalidVerifiedInput {
                field: "causal_tips",
            });
        }
        for tip in &member.causal_tips {
            if !is_lower_hex(&tip.actor_id, 32)
                || !(1..=MAX_SAFE_INTEGER).contains(&tip.sequence)
                || !is_operation_id(&tip.operation_id)
                || !is_lower_hex(&tip.chain_digest, 32)
            {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "causal_tip",
                });
            }
        }
    }
    if measured_bytes != transaction.canonical_envelope_bytes {
        return Err(JournalError::InvalidVerifiedInput {
            field: "canonical_envelope_bytes",
        });
    }
    Ok(())
}

impl LibraryCoreJournal {
    /// Read access for tests in sibling modules that assert what a
    /// production write actually put in the authoritative tables.
    #[cfg(test)]
    pub(crate) fn connection_for_test(&self) -> &Connection {
        &self.connection
    }

    pub fn open(path: &Path) -> JournalResult<Self> {
        let file_name = path.file_name().ok_or(JournalError::InvalidVerifiedInput {
            field: "database_path",
        })?;
        let parent = path
            .parent()
            .filter(|candidate| !candidate.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        // SQLite's NOFOLLOW flag rejects a symlink in any path component.
        // Resolve the already-existing parent first so ordinary system aliases
        // such as macOS /var do not make a literal final file unusable.
        let resolved_path = parent.canonicalize()?.join(file_name);
        let existing_file = Self::preflight_existing_file(&resolved_path)?;
        Self::open_after_preflight(&resolved_path, existing_file)
    }

    /// Opens one database name relative to a process working directory that
    /// was pinned from an inherited directory descriptor before SQLite ran.
    ///
    /// The caller owns the process-wide working-directory invariant. This
    /// entry point deliberately skips canonicalization so SQLite's database,
    /// WAL, and shared-memory opens all resolve from that pinned directory
    /// inode rather than from a cached macOS pathname.
    #[cfg(unix)]
    pub(crate) fn open_bound_relative(file_name: &Path) -> JournalResult<Self> {
        if file_name.components().count() != 1
            || file_name.file_name() != Some(file_name.as_os_str())
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "database_path",
            });
        }
        let existing_file = Self::preflight_existing_file(file_name)?;
        Self::open_after_preflight(file_name, existing_file)
    }

    /// Counts the runtime can report after opening.
    ///
    /// Deliberately cheap and read-only. This is the first observable evidence
    /// that a production call reached the journal, so it must not mutate.
    pub fn runtime_status(&self) -> JournalResult<JournalRuntimeStatus> {
        let schema_version: i64 =
            self.connection
                .pragma_query_value(None, "user_version", |row| row.get(0))?;
        let materializer_ingest_sequence: i64 = self.connection.query_row(
            "SELECT integerValue FROM library_core_meta
             WHERE key = 'materializerIngestSequence';",
            [],
            |row| row.get(0),
        )?;
        let actors: i64 =
            self.connection
                .query_row("SELECT COUNT(*) FROM library_core_actors;", [], |row| {
                    row.get(0)
                })?;
        let operations: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM library_core_operations;",
            [],
            |row| row.get(0),
        )?;
        let read_state: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM library_core_feed_item_read_state;",
            [],
            |row| row.get(0),
        )?;
        let unacknowledged_outbox: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM library_core_replication_outbox
             WHERE acknowledgedAtMs IS NULL;",
            [],
            |row| row.get(0),
        )?;
        Ok(JournalRuntimeStatus {
            schema_version,
            materializer_ingest_sequence,
            actors,
            operations,
            read_state,
            unacknowledged_outbox,
        })
    }

    fn open_after_preflight(resolved_path: &Path, existing_file: bool) -> JournalResult<Self> {
        let mut open_flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
            | OpenFlags::SQLITE_OPEN_NOFOLLOW
            | OpenFlags::SQLITE_OPEN_EXRESCODE;
        if !existing_file {
            open_flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
        let connection = Connection::open_with_flags(resolved_path, open_flags)?;
        // Recheck every exact handle that will receive write configuration,
        // including the CREATE path. A foreign file can appear after an
        // absent-file preflight but before this open. It must be rejected
        // before WAL negotiation changes its bytes or creates sidecars.
        Self::configure_validation_connection(&connection)?;
        Self::validate_existing_connection(&connection)?;
        let mut journal = Self { connection };
        journal.configure()?;
        journal.migrate()?;
        Ok(journal)
    }

    fn preflight_existing_file(path: &Path) -> JournalResult<bool> {
        if !path.try_exists()? {
            return Ok(false);
        }
        // Reject a foreign, future, or structurally changed file through a
        // read-only handle. The later writable open must not be the operation
        // that discovers the file is not an accepted Library Core database,
        // because WAL negotiation can change the header and create sidecars.
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_EXRESCODE,
        )?;
        Self::configure_validation_connection(&connection)?;
        Self::validate_existing_connection(&connection)?;
        Ok(true)
    }

    fn validate_existing_connection(connection: &Connection) -> JournalResult<()> {
        let version =
            connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        let application_id =
            connection.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
        if !(0..=AUTHORITATIVE_SCHEMA_VERSION).contains(&version) {
            return Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual: version,
            });
        }
        if (version == 0 && application_id != 0)
            || (version > 0 && application_id != AUTHORITATIVE_APPLICATION_ID)
        {
            return Err(JournalError::DatabaseIdentityMismatch {
                expected: AUTHORITATIVE_APPLICATION_ID,
                actual: application_id,
            });
        }
        let has_unversioned_tables = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%');",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if version == 0 {
            return if has_unversioned_tables {
                Err(JournalError::UnversionedSchemaPresent)
            } else {
                Ok(())
            };
        }
        Self::verify_schema_contract_at(connection, version)?;
        Ok(())
    }

    fn open_in_memory() -> JournalResult<Self> {
        let connection = Connection::open_in_memory()?;
        let mut journal = Self { connection };
        journal.configure()?;
        journal.migrate()?;
        Ok(journal)
    }

    fn configure(&self) -> JournalResult<()> {
        Self::configure_validation_connection(&self.connection)?;
        #[cfg(target_os = "macos")]
        self.connection.pragma_update(None, "fullfsync", "ON")?;
        self.connection.pragma_update(None, "journal_mode", "WAL")?;
        // Unlike the rebuildable shadow projection, this log is authoritative.
        // A successful commit must survive process loss and power loss.
        self.connection.pragma_update(None, "synchronous", "FULL")?;
        self.connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    }

    fn configure_validation_connection(connection: &Connection) -> JournalResult<()> {
        // The journal executes checked-in SQL with at most 20 parameters and
        // accepts canonical payloads capped at 4 MiB. Keep SQLite's parser and
        // row allocations close to that contract instead of inheriting its
        // much larger general-purpose defaults.
        connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, SQLITE_MAX_VALUE_BYTES);
        connection.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, SQLITE_MAX_SQL_BYTES);
        connection.set_limit(Limit::SQLITE_LIMIT_COLUMN, SQLITE_MAX_COLUMNS);
        connection.set_limit(Limit::SQLITE_LIMIT_EXPR_DEPTH, SQLITE_MAX_EXPRESSION_DEPTH);
        connection.set_limit(
            Limit::SQLITE_LIMIT_COMPOUND_SELECT,
            SQLITE_MAX_COMPOUND_SELECTS,
        );
        connection.set_limit(
            Limit::SQLITE_LIMIT_FUNCTION_ARG,
            SQLITE_MAX_FUNCTION_ARGUMENTS,
        );
        connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, SQLITE_MAX_ATTACHED_DATABASES);
        connection.set_limit(
            Limit::SQLITE_LIMIT_LIKE_PATTERN_LENGTH,
            SQLITE_MAX_PATTERN_BYTES,
        );
        connection.set_limit(
            Limit::SQLITE_LIMIT_VARIABLE_NUMBER,
            SQLITE_MAX_VARIABLE_NUMBER,
        );
        connection.set_limit(Limit::SQLITE_LIMIT_TRIGGER_DEPTH, SQLITE_MAX_TRIGGER_DEPTH);
        connection.set_limit(
            Limit::SQLITE_LIMIT_WORKER_THREADS,
            SQLITE_MAX_WORKER_THREADS,
        );
        connection.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
        connection.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
        // Reject SQLite's legacy fallback that silently treats a misspelled
        // double-quoted identifier as a string literal. All checked-in schema
        // and queries use standard SQL quoting, so ambiguity is a defect.
        connection.set_db_config(DbConfig::SQLITE_DBCONFIG_DQS_DDL, false)?;
        connection.set_db_config(DbConfig::SQLITE_DBCONFIG_DQS_DML, false)?;
        connection.busy_timeout(BUSY_TIMEOUT)?;
        connection.pragma_update(None, "cache_size", BASE_CACHE_KIB)?;
        connection.pragma_update(None, "mmap_size", 0)?;
        connection.pragma_update(None, "temp_store", "FILE")?;
        connection.pragma_update(None, "cell_size_check", "ON")?;
        Ok(())
    }

    fn migrate(&mut self) -> JournalResult<()> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior =
            transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        let prior_application_id =
            transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
        if !(0..=AUTHORITATIVE_SCHEMA_VERSION).contains(&prior) {
            return Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual: prior,
            });
        }
        if (prior == 0 && prior_application_id != 0)
            || (prior > 0 && prior_application_id != AUTHORITATIVE_APPLICATION_ID)
        {
            return Err(JournalError::DatabaseIdentityMismatch {
                expected: AUTHORITATIVE_APPLICATION_ID,
                actual: prior_application_id,
            });
        }
        let has_unversioned_tables = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%');",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if prior == 0 && has_unversioned_tables {
            return Err(JournalError::UnversionedSchemaPresent);
        }
        apply_schema_range(&transaction, prior, AUTHORITATIVE_SCHEMA_VERSION)?;
        let actual =
            transaction.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
        let actual_application_id =
            transaction.pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))?;
        if actual != AUTHORITATIVE_SCHEMA_VERSION {
            return Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual,
            });
        }
        if actual_application_id != AUTHORITATIVE_APPLICATION_ID {
            return Err(JournalError::DatabaseIdentityMismatch {
                expected: AUTHORITATIVE_APPLICATION_ID,
                actual: actual_application_id,
            });
        }
        Self::verify_schema_contract_at(&transaction, AUTHORITATIVE_SCHEMA_VERSION)?;
        transaction.commit()?;
        Ok(())
    }

    fn schema_catalog(connection: &Connection) -> JournalResult<Vec<SchemaCatalogEntry>> {
        let mut statement = connection.prepare(
            "SELECT
               length(CAST(type AS BLOB)),
               length(CAST(name AS BLOB)),
               length(CAST(tbl_name AS BLOB)),
               length(CAST(sql AS BLOB)),
               type, name, tbl_name, sql
             FROM sqlite_schema
             WHERE type IN ('table', 'index', 'trigger', 'view')
               AND name NOT LIKE 'sqlite_%'
             ORDER BY type COLLATE BINARY, name COLLATE BINARY,
                      tbl_name COLLATE BINARY
             LIMIT ?1;",
        )?;
        let mut rows = statement.query(params![MAX_SCHEMA_CATALOG_ENTRIES as i64 + 1])?;
        let mut entries = Vec::new();
        let mut retained_bytes = 0i64;
        while let Some(row) = rows.next()? {
            if entries.len() == MAX_SCHEMA_CATALOG_ENTRIES {
                return Err(JournalError::SchemaContractMismatch);
            }
            let type_bytes: Option<i64> = row.get(0)?;
            let name_bytes: Option<i64> = row.get(1)?;
            let table_name_bytes: Option<i64> = row.get(2)?;
            let sql_bytes: Option<i64> = row.get(3)?;
            let (type_bytes, name_bytes, table_name_bytes, sql_bytes) =
                match (type_bytes, name_bytes, table_name_bytes, sql_bytes) {
                    (
                        Some(type_bytes),
                        Some(name_bytes),
                        Some(table_name_bytes),
                        Some(sql_bytes),
                    ) if (1..=16).contains(&type_bytes)
                        && (1..=MAX_SCHEMA_CATALOG_IDENTIFIER_BYTES).contains(&name_bytes)
                        && (1..=MAX_SCHEMA_CATALOG_IDENTIFIER_BYTES)
                            .contains(&table_name_bytes)
                        && (1..=MAX_SCHEMA_CATALOG_BYTES).contains(&sql_bytes) =>
                    {
                        (type_bytes, name_bytes, table_name_bytes, sql_bytes)
                    }
                    _ => return Err(JournalError::SchemaContractMismatch),
                };
            retained_bytes = retained_bytes
                .checked_add(type_bytes)
                .and_then(|bytes| bytes.checked_add(name_bytes))
                .and_then(|bytes| bytes.checked_add(table_name_bytes))
                .and_then(|bytes| bytes.checked_add(sql_bytes))
                .filter(|bytes| *bytes <= MAX_SCHEMA_CATALOG_BYTES)
                .ok_or(JournalError::SchemaContractMismatch)?;
            entries.push(SchemaCatalogEntry {
                object_type: row.get(4)?,
                name: row.get(5)?,
                table_name: row.get(6)?,
                sql: row.get(7)?,
            });
        }
        Ok(entries)
    }

    fn verify_schema_contract_at(connection: &Connection, version: i64) -> JournalResult<()> {
        let mut reference = Connection::open_in_memory()?;
        {
            let transaction = reference.transaction()?;
            apply_schema_range(&transaction, 0, version)?;
            transaction.commit()?;
        }
        let expected = Self::schema_catalog(&reference)?;
        let actual = Self::schema_catalog(connection)?;
        if actual != expected {
            return Err(JournalError::SchemaContractMismatch);
        }
        Ok(())
    }

    fn stored_actor_at(
        connection: &Connection,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> SqlResult<Option<StoredActorRow>> {
        connection
            .query_row(
                "SELECT libraryId, epoch, epochId, actorId, actorPublicKey, \
                 enrollmentOperationId, enrollmentCertificateDigest,
                 canonicalEnrollmentCertificateJson, actorChainGenesis,
                 nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors \
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(StoredActorRow {
                        library_id: row.get(0)?,
                        epoch: row.get(1)?,
                        epoch_id: row.get(2)?,
                        actor_id: row.get(3)?,
                        actor_public_key: row.get(4)?,
                        enrollment_operation_id: row.get(5)?,
                        enrollment_certificate_digest: row.get(6)?,
                        canonical_enrollment_certificate_json: row.get(7)?,
                        actor_chain_genesis: row.get(8)?,
                        next_sequence: row.get(9)?,
                        previous_operation_id: row.get(10)?,
                        previous_chain_digest: row.get(11)?,
                    })
                },
            )
            .optional()
    }

    fn stored_actor_capability_at(
        connection: &Connection,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> SqlResult<Option<StoredActorCapabilityRow>> {
        connection
            .query_row(
                "SELECT certificateVersion, actorClass,
                        allowedOperationTypesJson, scopeMode, scopeKind, scopeId,
                        issuanceIdentity, retirementIdentity,
                        capabilityCertificateDigest, issuedAtMs, retired,
                        retirementCertificateDigest
                 FROM library_core_actor_capability_state
                 WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![library_id, epoch_id, actor_id],
                |row| {
                    Ok(StoredActorCapabilityRow {
                        certificate_version: row.get(0)?,
                        actor_class: row.get(1)?,
                        allowed_operation_types_json: row.get(2)?,
                        scope_mode: row.get(3)?,
                        scope_kind: row.get(4)?,
                        scope_id: row.get(5)?,
                        issuance_identity: row.get(6)?,
                        retirement_identity: row.get(7)?,
                        capability_certificate_digest: row.get(8)?,
                        issued_at_ms: row.get(9)?,
                        retired: row.get(10)?,
                        retirement_certificate_digest: row.get(11)?,
                    })
                },
            )
            .optional()
    }

    fn actor_state_at(
        connection: &Connection,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<ActorState>> {
        let Some(actor) = Self::stored_actor_at(connection, library_id, epoch_id, actor_id)? else {
            return Ok(None);
        };
        let capability = Self::stored_actor_capability_at(
            connection, library_id, epoch_id, actor_id,
        )?
        .ok_or(JournalError::InvalidVerifiedInput {
            field: "actor_capability_missing",
        })?;
        let capability = actor_capability::parse_stored_capability(
            capability.certificate_version,
            capability.actor_class,
            capability.allowed_operation_types_json,
            capability.scope_mode,
            capability.scope_kind,
            capability.scope_id,
            capability.issuance_identity,
            capability.retirement_identity,
            capability.capability_certificate_digest,
            capability.issued_at_ms,
            capability.retired,
            capability.retirement_certificate_digest,
        )
        .map_err(|field| JournalError::InvalidVerifiedInput { field })?;
        if capability.capability_certificate_digest != actor.enrollment_certificate_digest {
            return Err(JournalError::InvalidVerifiedInput {
                field: "actor_capability_digest",
            });
        }
        Ok(Some(ActorState {
            library_id: actor.library_id,
            epoch: actor.epoch,
            epoch_id: actor.epoch_id,
            actor_id: actor.actor_id,
            actor_public_key: actor.actor_public_key,
            enrollment_operation_id: actor.enrollment_operation_id,
            enrollment_certificate_digest: actor.enrollment_certificate_digest,
            canonical_enrollment_certificate_json: actor.canonical_enrollment_certificate_json,
            actor_chain_genesis: actor.actor_chain_genesis,
            next_sequence: actor.next_sequence,
            previous_operation_id: actor.previous_operation_id,
            previous_chain_digest: actor.previous_chain_digest,
            capability,
        }))
    }

    fn actor_state_with_signed_capability_at(
        connection: &Connection,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<ActorState>> {
        let Some(actor) = Self::actor_state_at(connection, library_id, epoch_id, actor_id)? else {
            return Ok(None);
        };
        // The older journal unit fixtures predate the native certificate
        // verifier. Production builds never carry this exact marker and always
        // reverify both v1 and v2 canonical enrollment bytes below.
        #[cfg(test)]
        if actor.canonical_enrollment_certificate_json == "{\"certificate\":\"fixture\"}" {
            if actor.capability.certificate_version != 1 {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "actor_capability_signed_cache",
                });
            }
            return Ok(Some(actor));
        }
        let authority =
            authority::authority_epoch_state(connection, library_id, actor.epoch, &actor.epoch_id)?
                .ok_or_else(|| JournalError::AuthorityNotFound {
                    library_id: library_id.to_owned(),
                })?;
        let signed = enrollment_verifier::verify_actor_enrollment(
            actor.canonical_enrollment_certificate_json.as_bytes(),
            &authority,
        )?;
        let mut stored_signed_capability = actor.capability.clone();
        stored_signed_capability.retired = false;
        stored_signed_capability.retirement_certificate_digest = None;
        if actor.library_id != signed.library_id
            || actor.epoch != signed.epoch
            || actor.epoch_id != signed.epoch_id
            || actor.actor_id != signed.actor_id
            || actor.actor_public_key != signed.actor_public_key
            || actor.enrollment_operation_id != signed.enrollment_operation_id
            || actor.enrollment_certificate_digest != signed.enrollment_certificate_digest
            || actor.canonical_enrollment_certificate_json
                != signed.canonical_enrollment_certificate_json
            || actor.actor_chain_genesis != signed.actor_chain_genesis
            || stored_signed_capability != signed.capability
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "actor_capability_signed_cache",
            });
        }
        Ok(Some(actor))
    }

    fn actor_state_in(
        transaction: &Transaction<'_>,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<ActorState>> {
        Self::actor_state_at(transaction, library_id, epoch_id, actor_id)
    }

    /// The stored actor, if this library, epoch and actor are already
    /// enrolled.
    ///
    /// A caller that mints enrollment certificates must check this first. The
    /// signed enrollment body carries `created_at_ms`, so rebuilding one for
    /// an actor that is already enrolled would produce a different certificate
    /// digest and be refused as a conflict rather than seen as a replay.
    pub(crate) fn actor_state(
        &self,
        library_id: &str,
        epoch_id: &str,
        actor_id: &str,
    ) -> JournalResult<Option<ActorState>> {
        Self::actor_state_at(&self.connection, library_id, epoch_id, actor_id)
    }

    /// Return the bounded actor set for one exact authority epoch in binary
    /// actor-id order so checkpoint construction is deterministic.
    pub fn actor_states(&self, library_id: &str, epoch_id: &str) -> JournalResult<Vec<ActorState>> {
        let mut statement = self.connection.prepare(
            "SELECT actorId FROM library_core_actors
             WHERE libraryId = ?1 AND epochId = ?2
             ORDER BY actorId COLLATE BINARY
             LIMIT 1001;",
        )?;
        let actor_ids = statement
            .query_map(params![library_id, epoch_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if actor_ids.len() > 1_000 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "actor_state_count",
            });
        }
        let mut actors = Vec::with_capacity(actor_ids.len());
        for actor_id in actor_ids {
            actors.push(
                Self::actor_state_at(&self.connection, library_id, epoch_id, &actor_id)?
                    .ok_or(JournalError::ActorNotFound { actor_id })?,
            );
        }
        Ok(actors)
    }

    fn verify_operation_transaction(
        &self,
        canonical_envelopes: &[Vec<u8>],
    ) -> JournalResult<VerifiedOperationTransaction> {
        operation_verifier::verify_operation_transaction(canonical_envelopes, |identity| {
            Self::actor_state_with_signed_capability_at(
                &self.connection,
                &identity.library_id,
                &identity.epoch_id,
                &identity.actor_id,
            )?
            .ok_or_else(|| JournalError::ActorNotFound {
                actor_id: identity.actor_id.clone(),
            })
        })
    }

    fn verify_follower_operation_transaction(
        &self,
        canonical_envelopes: &[Vec<u8>],
    ) -> JournalResult<VerifiedOperationTransaction> {
        operation_verifier::verify_operation_transaction(canonical_envelopes, |identity| {
            self.follower_actor_state(&identity.library_id, &identity.epoch_id, &identity.actor_id)?
                .ok_or_else(|| JournalError::ActorNotFound {
                    actor_id: identity.actor_id.clone(),
                })
        })
    }

    pub fn verify_and_enqueue_follower_intent(
        &mut self,
        canonical_envelopes: &[Vec<u8>],
        enqueued_at_ms: i64,
    ) -> JournalResult<FollowerIntentEnqueueReceipt> {
        let verified = self.verify_follower_operation_transaction(canonical_envelopes)?;
        self.enqueue_verified_follower_transaction(&verified, enqueued_at_ms)
    }

    fn verify_and_commit_read_transaction(
        &mut self,
        canonical_envelopes: &[Vec<u8>],
        committed_at_ms: i64,
    ) -> JournalResult<TransactionReceipt> {
        let verified = self.verify_operation_transaction(canonical_envelopes)?;
        self.commit_read_transaction(&verified, committed_at_ms)
    }

    /// Admit one renderer-independent signed read transaction through the
    /// native verifier and authoritative commit boundary.
    pub fn accept_operation_transaction(
        &mut self,
        canonical_envelopes: &[Vec<u8>],
        committed_at_ms: i64,
    ) -> JournalResult<Vec<IntentResultOutboxEntry>> {
        let verified = self.verify_operation_transaction(canonical_envelopes)?;
        let transaction_id = verified.transaction_id.clone();
        self.commit_read_transaction(&verified, committed_at_ms)?;
        self.intent_results_for_transaction(&transaction_id)
    }

    fn enroll_actor_in(
        transaction: &Transaction<'_>,
        enrollment: &VerifiedActorEnrollment,
    ) -> JournalResult<ActorState> {
        if let Some(existing) = Self::actor_state_in(
            transaction,
            &enrollment.library_id,
            &enrollment.epoch_id,
            &enrollment.actor_id,
        )? {
            if Self::actor_matches_enrollment(&existing, enrollment) {
                return Ok(existing);
            }
            return Err(JournalError::ActorEnrollmentConflict {
                actor_id: enrollment.actor_id.clone(),
            });
        }
        transaction.execute(
            "INSERT INTO library_core_actors (
               libraryId, epoch, epochId, actorId, actorPublicKey,
               enrollmentOperationId, enrollmentCertificateDigest,
               canonicalEnrollmentCertificateJson, actorChainGenesis,
               nextSequence, previousOperationId, previousChainDigest,
               enrolledAtMs
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, NULL, ?9, ?10
             );",
            params![
                enrollment.library_id,
                enrollment.epoch,
                enrollment.epoch_id,
                enrollment.actor_id,
                enrollment.actor_public_key,
                enrollment.enrollment_operation_id,
                enrollment.enrollment_certificate_digest,
                enrollment.canonical_enrollment_certificate_json,
                enrollment.actor_chain_genesis,
                enrollment.enrolled_at_ms,
            ],
        )?;
        transaction.execute(
            "INSERT INTO library_core_actor_enrollment_outbox (
               enrollmentOperationId, enqueuedAtMs, acknowledgedAtMs
             ) VALUES (?1, ?2, NULL);",
            params![
                enrollment.enrollment_operation_id,
                enrollment.enrolled_at_ms,
            ],
        )?;
        let (scope_mode, scope_kind, scope_id) = enrollment.capability.stored_scope();
        transaction.execute(
            "INSERT INTO library_core_actor_capability_state (
               libraryId, epoch, epochId, actorId, certificateVersion,
               actorClass, allowedOperationTypesJson, scopeMode, scopeKind,
               scopeId, issuanceIdentity, retirementIdentity,
               capabilityCertificateDigest, issuedAtMs, retired,
               retirementCertificateDigest
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
               ?13, ?14, 0, NULL
             );",
            params![
                enrollment.library_id,
                enrollment.epoch,
                enrollment.epoch_id,
                enrollment.actor_id,
                enrollment.capability.certificate_version,
                enrollment.capability.actor_class,
                enrollment.capability.allowed_operation_types_json(),
                scope_mode,
                scope_kind,
                scope_id,
                enrollment.capability.issuance_identity,
                enrollment.capability.retirement_identity,
                enrollment.capability.capability_certificate_digest,
                enrollment.capability.issued_at_ms,
            ],
        )?;
        let state = Self::actor_state_in(
            transaction,
            &enrollment.library_id,
            &enrollment.epoch_id,
            &enrollment.actor_id,
        )?
        .ok_or_else(|| JournalError::ActorNotFound {
            actor_id: enrollment.actor_id.clone(),
        })?;
        Ok(state)
    }

    fn actor_matches_enrollment(
        existing: &ActorState,
        enrollment: &VerifiedActorEnrollment,
    ) -> bool {
        existing.epoch == enrollment.epoch
            && existing.actor_public_key == enrollment.actor_public_key
            && existing.enrollment_operation_id == enrollment.enrollment_operation_id
            && existing.enrollment_certificate_digest == enrollment.enrollment_certificate_digest
            && existing.canonical_enrollment_certificate_json
                == enrollment.canonical_enrollment_certificate_json
            && existing.actor_chain_genesis == enrollment.actor_chain_genesis
            && existing.capability == enrollment.capability
    }

    fn enroll_actor_under_authority(
        &mut self,
        enrollment: &VerifiedActorEnrollment,
        expected_authority: &AcceptedAuthorityState,
        allow_missing_admission_for_first_actor: bool,
    ) -> JournalResult<ActorState> {
        validate_actor_enrollment(enrollment)?;
        if enrollment.library_id != expected_authority.library_id
            || enrollment.epoch != expected_authority.epoch
            || enrollment.epoch_id != expected_authority.epoch_id
        {
            return Err(JournalError::StaleAuthority {
                library_id: enrollment.library_id.clone(),
            });
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = Self::actor_state_in(
            &transaction,
            &enrollment.library_id,
            &enrollment.epoch_id,
            &enrollment.actor_id,
        )? {
            if Self::actor_matches_enrollment(&existing, enrollment) {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(JournalError::ActorEnrollmentConflict {
                actor_id: enrollment.actor_id.clone(),
            });
        }
        let admission_exists = transaction.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM library_core_cloud_writer_admission
               WHERE singletonId = 1
             );",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if admission_exists {
            Self::require_cloud_writer_admission(&transaction, &enrollment.library_id)?;
        } else if allow_missing_admission_for_first_actor {
            let actor_exists = transaction.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM library_core_actors WHERE libraryId = ?1
                 );",
                [&enrollment.library_id],
                |row| row.get::<_, bool>(0),
            )?;
            if actor_exists {
                return Err(JournalError::StaleAuthority {
                    library_id: enrollment.library_id.clone(),
                });
            }
        } else {
            return Err(JournalError::StaleAuthority {
                library_id: enrollment.library_id.clone(),
            });
        }
        authority::require_active_authority(&transaction, expected_authority)?;
        let state = Self::enroll_actor_in(&transaction, enrollment)?;
        transaction.commit()?;
        Ok(state)
    }

    #[cfg(test)]
    fn enroll_actor(&mut self, enrollment: &VerifiedActorEnrollment) -> JournalResult<ActorState> {
        let authority = authority::active_authority(&self.connection, &enrollment.library_id)?
            .ok_or_else(|| JournalError::AuthorityNotFound {
                library_id: enrollment.library_id.clone(),
            })?;
        self.enroll_actor_under_authority(enrollment, &authority, false)
    }

    fn verify_actor_enrollment(
        &self,
        canonical_certificate: &[u8],
        authority: &AcceptedAuthorityState,
    ) -> JournalResult<VerifiedActorEnrollment> {
        enrollment_verifier::verify_actor_enrollment(canonical_certificate, authority)
    }

    /// Verify a canonical enrollment certificate against the active authority
    /// and enroll the actor it names.
    ///
    /// Replaying the exact same certificate returns the stored actor; a
    /// different certificate for the same actor is a conflict, not an update.
    pub(crate) fn verify_and_enroll_actor(
        &mut self,
        canonical_certificate: &[u8],
        library_id: &str,
    ) -> JournalResult<ActorState> {
        let authority =
            authority::active_authority(&self.connection, library_id)?.ok_or_else(|| {
                JournalError::AuthorityNotFound {
                    library_id: library_id.to_owned(),
                }
            })?;
        let enrollment = self.verify_actor_enrollment(canonical_certificate, &authority)?;
        self.enroll_actor_under_authority(&enrollment, &authority, false)
    }

    /// Enroll the first native Desktop actor before a cloud control tuple can
    /// exist. This grants no operation admission. Once any actor exists, or a
    /// cloud admission row exists, the ordinary fail-closed admission fence
    /// applies. Exact replay still returns the stored actor first.
    pub(crate) fn verify_and_enroll_initial_desktop_actor(
        &mut self,
        canonical_certificate: &[u8],
        library_id: &str,
    ) -> JournalResult<ActorState> {
        let authority =
            authority::active_authority(&self.connection, library_id)?.ok_or_else(|| {
                JournalError::AuthorityNotFound {
                    library_id: library_id.to_owned(),
                }
            })?;
        let enrollment = self.verify_actor_enrollment(canonical_certificate, &authority)?;
        self.enroll_actor_under_authority(&enrollment, &authority, true)
    }

    /// Verify and install the authority-countersigned certificate for this
    /// follower without admitting the actor to the canonical writer journal.
    pub fn verify_and_install_follower_actor(
        &mut self,
        canonical_certificate: &[u8],
    ) -> JournalResult<StoredFollowerActorEnrollment> {
        let anchor = self
            .follower_anchor()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "follower_actor_enrollment.anchor",
            })?;
        let enrollment = self.verify_actor_enrollment(canonical_certificate, &anchor.authority)?;
        self.install_verified_follower_actor_enrollment(&enrollment)
    }

    #[cfg(test)]
    fn install_fixture_authority(
        &mut self,
        library_id: &str,
        epoch: i64,
        epoch_id: &str,
    ) -> JournalResult<AcceptedAuthorityState> {
        let authority = self.install_authority_epoch(&VerifiedAuthorityEpoch {
            authority: AcceptedAuthorityState {
                library_id: library_id.to_owned(),
                epoch,
                epoch_id: epoch_id.to_owned(),
                authority_key_id: "a".repeat(64),
                authority_public_key: "b".repeat(64),
                observed_frontier: Vec::new(),
            },
            transition_certificate_digest: format!("{epoch:064x}"),
            canonical_transition_certificate_json: format!(
                "{{\"transition\":\"fixture-{epoch}\"}}"
            ),
            accepted_at_ms: 900,
        })?;
        self.connection.execute(
            "INSERT INTO library_core_cloud_writer_admission (
               singletonId, localWriterId, activeWriterId, storageEpoch,
               controlRevision, verifiedAtMs
             ) VALUES (1, ?1, ?1, ?2, 'fixture-admission', 1)
             ON CONFLICT(singletonId) DO UPDATE SET
               localWriterId = excluded.localWriterId,
               activeWriterId = excluded.activeWriterId,
               storageEpoch = excluded.storageEpoch,
               controlRevision = excluded.controlRevision,
               verifiedAtMs = excluded.verifiedAtMs;",
            params!["8".repeat(64), epoch_id],
        )?;
        Ok(authority)
    }

    fn transaction_receipt_in(
        connection: &Connection,
        transaction_id: &str,
    ) -> SqlResult<Option<TransactionReceipt>> {
        connection
            .query_row(
                "SELECT transactionId, transactionDigest, actorId, memberCount,
                 firstSequence, lastSequence, committedOperationId,
                 committedChainDigest, firstIngestSequence,
                 lastIngestSequence, previousRevision, committedRevision,
                 committedAtMs
                 FROM library_core_transactions WHERE transactionId = ?1;",
                params![transaction_id],
                |row| {
                    Ok(TransactionReceipt {
                        transaction_id: row.get(0)?,
                        transaction_digest: row.get(1)?,
                        actor_id: row.get(2)?,
                        member_count: row.get::<_, i64>(3)? as usize,
                        first_sequence: row.get(4)?,
                        last_sequence: row.get(5)?,
                        committed_operation_id: row.get(6)?,
                        committed_chain_digest: row.get(7)?,
                        first_ingest_sequence: row.get(8)?,
                        last_ingest_sequence: row.get(9)?,
                        previous_revision: row.get(10)?,
                        committed_revision: row.get(11)?,
                        committed_at_ms: row.get(12)?,
                    })
                },
            )
            .optional()
    }

    fn causal_tip_exists(
        transaction: &Transaction<'_>,
        library_id: &str,
        epoch_id: &str,
        tip: &VerifiedCausalTip,
    ) -> SqlResult<bool> {
        transaction.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM library_core_operations
               WHERE libraryId = ?1 AND epochId = ?2
                 AND actorId = ?3 AND actorSequence = ?4
                 AND operationId = ?5 AND actorChainDigest = ?6
             );",
            params![
                library_id,
                epoch_id,
                tip.actor_id,
                tip.sequence,
                tip.operation_id,
                tip.chain_digest
            ],
            |row| row.get(0),
        )
    }

    fn projection_revision_in(transaction: &Transaction<'_>) -> SqlResult<i64> {
        transaction.query_row(
            "SELECT integerValue FROM library_core_meta
             WHERE key = 'projectionRevision';",
            [],
            |row| row.get(0),
        )
    }

    fn meta_integer_in(transaction: &Transaction<'_>, key: &str) -> SqlResult<i64> {
        transaction.query_row(
            "SELECT integerValue FROM library_core_meta WHERE key = ?1;",
            params![key],
            |row| row.get(0),
        )
    }

    /// Fail closed when the most recently verified cloud control tuple names
    /// another host as the active writer. This check intentionally runs in
    /// the same immediate transaction as the authoritative mutation. A stale
    /// renderer decision cannot race a control refresh and commit afterward.
    fn require_cloud_writer_admission(
        transaction: &Transaction<'_>,
        library_id: &str,
    ) -> JournalResult<()> {
        let writer_ids = transaction
            .query_row(
                "SELECT localWriterId, activeWriterId
                 FROM library_core_cloud_writer_admission
                 WHERE singletonId = 1;",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if writer_ids
            .as_ref()
            .is_none_or(|(local_writer_id, active_writer_id)| local_writer_id != active_writer_id)
        {
            return Err(JournalError::StaleAuthority {
                library_id: library_id.to_owned(),
            });
        }
        Ok(())
    }

    fn commit_read_transaction(
        &mut self,
        verified: &VerifiedOperationTransaction,
        committed_at_ms: i64,
    ) -> JournalResult<TransactionReceipt> {
        validate_transaction(verified)?;
        if !(0..=MAX_SAFE_INTEGER).contains(&committed_at_ms) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "committed_at_ms",
            });
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        Self::require_cloud_writer_admission(&transaction, &verified.library_id)?;
        authority::require_active_epoch(
            &transaction,
            &verified.library_id,
            verified.epoch,
            &verified.epoch_id,
        )?;
        let actor = Self::actor_state_in(
            &transaction,
            &verified.library_id,
            &verified.epoch_id,
            &verified.actor_id,
        )?
        .ok_or_else(|| JournalError::ActorNotFound {
            actor_id: verified.actor_id.clone(),
        })?;
        if actor.capability != verified.actor_capability {
            return Err(JournalError::InvalidVerifiedInput {
                field: "actor_capability_changed",
            });
        }
        for member in &verified.members {
            if actor.capability.retired {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "actor_capability_retired",
                });
            }
            if matches!(
                &actor.capability.scope,
                actor_capability::ActorCapabilityScope::Bounded { .. }
            ) {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "actor_capability_scope",
                });
            }
            if !actor.capability.allows_operation(&member.operation_type) {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "actor_capability_operation",
                });
            }
        }
        if let Some(receipt) = Self::transaction_receipt_in(&transaction, &verified.transaction_id)?
        {
            if receipt.transaction_digest == verified.transaction_digest
                && receipt.actor_id == verified.actor_id
                && receipt.member_count == verified.members.len()
            {
                transaction.commit()?;
                return Ok(receipt);
            }
            return Err(JournalError::TransactionReplayConflict {
                transaction_id: verified.transaction_id.clone(),
            });
        }
        let first = &verified.members[0];
        if actor.epoch != verified.epoch
            || actor.next_sequence != first.actor_sequence
            || actor.previous_operation_id != first.previous_actor_operation_id
            || actor.previous_chain_digest != first.previous_actor_chain_digest
        {
            return Err(JournalError::StaleActorTip {
                actor_id: verified.actor_id.clone(),
            });
        }
        for member in &verified.members {
            for tip in &member.causal_tips {
                if !Self::causal_tip_exists(
                    &transaction,
                    &verified.library_id,
                    &verified.epoch_id,
                    tip,
                )? {
                    return Err(JournalError::UnknownCausalTip {
                        operation_id: member.operation_id.clone(),
                    });
                }
            }
        }
        let previous_revision = Self::projection_revision_in(&transaction)?;
        let committed_revision =
            previous_revision
                .checked_add(1)
                .ok_or(JournalError::InvalidVerifiedInput {
                    field: "projection_revision",
                })?;
        if committed_revision > MAX_SAFE_INTEGER {
            return Err(JournalError::InvalidVerifiedInput {
                field: "projection_revision",
            });
        }
        let last = verified
            .members
            .last()
            .ok_or(JournalError::InvalidVerifiedInput { field: "members" })?;
        let first_ingest_sequence = Self::meta_integer_in(&transaction, "nextIngestSequence")?;
        if !(1..=MAX_SAFE_INTEGER).contains(&first_ingest_sequence) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "next_ingest_sequence",
            });
        }
        let last_ingest_sequence = first_ingest_sequence
            .checked_add(verified.members.len() as i64 - 1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "ingest_sequence",
            })?;
        let prior_materializer_sequence =
            Self::meta_integer_in(&transaction, "materializerIngestSequence")?;
        if prior_materializer_sequence != first_ingest_sequence - 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "materializer_ingest_sequence",
            });
        }
        transaction.execute(
            "INSERT INTO library_core_transactions (
               transactionId, transactionDigest, libraryId, epoch, epochId,
               actorId, memberCount, firstSequence, lastSequence,
               previousOperationId, previousChainDigest, committedOperationId,
               committedChainDigest, canonicalEnvelopeBytes,
               firstIngestSequence, lastIngestSequence, previousRevision,
               committedRevision, committedAtMs
             ) VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
               ?14, ?15, ?16, ?17, ?18, ?19
             );",
            params![
                verified.transaction_id,
                verified.transaction_digest,
                verified.library_id,
                verified.epoch,
                verified.epoch_id,
                verified.actor_id,
                verified.members.len() as i64,
                first.actor_sequence,
                last.actor_sequence,
                first.previous_actor_operation_id,
                first.previous_actor_chain_digest,
                last.operation_id,
                last.actor_chain_digest,
                verified.canonical_envelope_bytes as i64,
                first_ingest_sequence,
                last_ingest_sequence,
                previous_revision,
                committed_revision,
                committed_at_ms,
            ],
        )?;

        let mut product_rows_updated = 0_usize;
        for (index, member) in verified.members.iter().enumerate() {
            transaction.execute(
                "INSERT INTO library_core_operations (
                   operationId, transactionId, transactionMemberIndex,
                   transactionMemberCount, libraryId, epoch, epochId, actorId,
                   actorSequence, ingestSequence, previousActorOperationId,
                   previousActorChainDigest, actorChainDigest,
                   transactionDigest, memberDigest, signingBodyDigest,
                   envelopeDigest, operationType, entityType, entityId,
                   canonicalEnvelopeJson, committedAtMs
                 ) VALUES (
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                   ?13, ?14, ?15, ?16, ?17, ?18,
                   ?19, ?20, ?21, ?22
                 );",
                params![
                    member.operation_id,
                    verified.transaction_id,
                    index as i64,
                    verified.members.len() as i64,
                    verified.library_id,
                    verified.epoch,
                    verified.epoch_id,
                    verified.actor_id,
                    member.actor_sequence,
                    first_ingest_sequence + index as i64,
                    member.previous_actor_operation_id,
                    member.previous_actor_chain_digest,
                    member.actor_chain_digest,
                    verified.transaction_digest,
                    member.member_digest,
                    member.signing_body_digest,
                    member.envelope_digest,
                    member.operation_type,
                    member.entity_type,
                    member.entity_id,
                    member.canonical_envelope_json,
                    committed_at_ms,
                ],
            )?;
            for (tip_index, tip) in member.causal_tips.iter().enumerate() {
                transaction.execute(
                    "INSERT INTO library_core_operation_causal_tips (
                       operationId, tipIndex, actorId, sequence,
                       tipOperationId, chainDigest
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
                    params![
                        member.operation_id,
                        tip_index as i64,
                        tip.actor_id,
                        tip.sequence,
                        tip.operation_id,
                        tip.chain_digest,
                    ],
                )?;
            }
            if let Some(read_at_ms) = member.read_at_ms {
                transaction.execute(
                    "INSERT INTO library_core_feed_item_read_state (
                       entityId, readAtMs, sourceOperationId, sourceActorId,
                       sourceSequence, sourceChainDigest
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(entityId) DO UPDATE SET
                       readAtMs = excluded.readAtMs,
                       sourceOperationId = excluded.sourceOperationId,
                       sourceActorId = excluded.sourceActorId,
                       sourceSequence = excluded.sourceSequence,
                       sourceChainDigest = excluded.sourceChainDigest
                     WHERE excluded.readAtMs < library_core_feed_item_read_state.readAtMs
                        OR (
                          excluded.readAtMs = library_core_feed_item_read_state.readAtMs
                          AND excluded.sourceOperationId
                            < library_core_feed_item_read_state.sourceOperationId
                        );",
                    params![
                        member.entity_id,
                        read_at_ms,
                        member.operation_id,
                        verified.actor_id,
                        member.actor_sequence,
                        member.actor_chain_digest,
                    ],
                )?;
            }
            transaction.execute(
                "INSERT INTO library_core_replication_outbox (
                   operationId, ingestSequence, enqueuedAtMs, acknowledgedAtMs
                 ) VALUES (?1, ?2, ?3, NULL);",
                params![
                    member.operation_id,
                    first_ingest_sequence + index as i64,
                    committed_at_ms
                ],
            )?;
            let result_digest = Sha256::digest(member.operation_id.as_bytes());
            let result_digest = Sha256::digest(
                [
                    verified.epoch_id.as_bytes(),
                    b"\0",
                    result_digest.as_slice(),
                ]
                .concat(),
            );
            let result_operation_id = format!(
                "result:accepted:{}",
                result_digest
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            );
            transaction.execute(
                "INSERT INTO library_core_intent_result_outbox (
                   resultOperationId, libraryId, epochId, actorId, resultSequence,
                   intentOperationId, intentSequence, status,
                   providerReceiptDigest, enqueuedAtMs, acknowledgedAtMs
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'accepted', NULL, ?8, NULL);",
                params![
                    result_operation_id,
                    verified.library_id,
                    verified.epoch_id,
                    verified.actor_id,
                    member.actor_sequence,
                    member.operation_id,
                    member.actor_sequence,
                    committed_at_ms,
                ],
            )?;
            product_rows_updated +=
                Self::materialize_product_member(&transaction, member, committed_at_ms)?;
        }
        if product_rows_updated > 0 {
            let updated = transaction.execute(
                "UPDATE library_core_desktop_state
                 SET revision = revision + 1
                 WHERE singletonId = 1 AND active = 1
                   AND revision < 9007199254740991;",
                [],
            )?;
            if updated != 1 {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "desktop_library_revision",
                });
            }
        }
        let updated = transaction.execute(
            "UPDATE library_core_actors
             SET nextSequence = ?1, previousOperationId = ?2,
                 previousChainDigest = ?3
             WHERE libraryId = ?4 AND epochId = ?5 AND actorId = ?6
               AND nextSequence = ?7
               AND previousOperationId IS ?8
               AND previousChainDigest = ?9;",
            params![
                last.actor_sequence + 1,
                last.operation_id,
                last.actor_chain_digest,
                verified.library_id,
                verified.epoch_id,
                verified.actor_id,
                actor.next_sequence,
                actor.previous_operation_id,
                actor.previous_chain_digest,
            ],
        )?;
        if updated != 1 {
            return Err(JournalError::StaleActorTip {
                actor_id: verified.actor_id.clone(),
            });
        }
        let next_ingest_sequence = last_ingest_sequence
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "next_ingest_sequence",
            })?;
        let ingest_updated = transaction.execute(
            "UPDATE library_core_meta SET integerValue = ?1
             WHERE key = 'nextIngestSequence' AND integerValue = ?2;",
            params![next_ingest_sequence, first_ingest_sequence],
        )?;
        if ingest_updated != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "next_ingest_sequence",
            });
        }
        let materializer_updated = transaction.execute(
            "UPDATE library_core_meta SET integerValue = ?1
             WHERE key = 'materializerIngestSequence' AND integerValue = ?2;",
            params![last_ingest_sequence, prior_materializer_sequence],
        )?;
        if materializer_updated != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "materializer_ingest_sequence",
            });
        }
        let revision_updated = transaction.execute(
            "UPDATE library_core_meta SET integerValue = ?1
             WHERE key = 'projectionRevision' AND integerValue = ?2;",
            params![committed_revision, previous_revision],
        )?;
        if revision_updated != 1 {
            return Err(JournalError::InvalidVerifiedInput {
                field: "projection_revision",
            });
        }
        let receipt = TransactionReceipt {
            transaction_id: verified.transaction_id.clone(),
            transaction_digest: verified.transaction_digest.clone(),
            actor_id: verified.actor_id.clone(),
            member_count: verified.members.len(),
            first_sequence: first.actor_sequence,
            last_sequence: last.actor_sequence,
            committed_operation_id: last.operation_id.clone(),
            committed_chain_digest: last.actor_chain_digest.clone(),
            first_ingest_sequence,
            last_ingest_sequence,
            previous_revision,
            committed_revision,
            committed_at_ms,
        };
        transaction.commit()?;
        Ok(receipt)
    }

    fn materialize_product_member(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
        committed_at_ms: i64,
    ) -> JournalResult<usize> {
        if member.entity_type == "RssFeed" {
            Self::materialize_rss_feed(transaction, member, committed_at_ms)
        } else if member.entity_type == "UserPreferences" {
            Self::materialize_preferences(transaction, member)
        } else if member.operation_type == "person_remove_and_accounts" {
            Self::materialize_person_remove(transaction, member)
        } else if member.operation_type == "account_remove" {
            Self::materialize_account_remove(transaction, member)
        } else if member.entity_type == "Person" {
            Self::materialize_person(transaction, member)
        } else if member.entity_type == "Account" {
            Self::materialize_account(transaction, member)
        } else if let Some(item_json) = member.item_json.as_deref() {
            let deleted_at = transaction
                .query_row(
                    "SELECT deletedAt FROM library_core_feed_items WHERE globalId = ?1;",
                    params![member.entity_id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()?;
            if deleted_at.flatten().is_some() {
                Ok(0)
            } else {
                crate::product_projection::upsert_item(transaction, item_json, committed_at_ms)
                    .map_err(|_| JournalError::InvalidVerifiedInput { field: "item_json" })?;
                Ok(1)
            }
        } else if let Some(read_at_ms) = member.read_at_ms {
            transaction
                .execute(
                    "UPDATE library_core_feed_items
                     SET readAt = ?1,
                         payloadJson = json_set(payloadJson, '$.userState.readAt', ?1),
                         updatedAtMs = ?2
                     WHERE globalId = ?3 AND deletedAt IS NULL
                       AND (readAt IS NULL OR ?1 < readAt);",
                    params![read_at_ms, committed_at_ms, member.entity_id],
                )
                .map_err(Into::into)
        } else if let Some(removed_at_ms) = member.removed_at_ms {
            transaction
                .execute(
                    "UPDATE library_core_feed_items
                     SET deletedAt = ?1, updatedAtMs = ?2
                     WHERE globalId = ?3 AND deletedAt IS NULL;",
                    params![removed_at_ms, committed_at_ms, member.entity_id],
                )
                .map_err(Into::into)
        } else {
            let assigned = i64::from(member.assigned.expect("validated assignment"));
            let assigned_at_ms = member.assigned_at_ms.expect("validated assignment time");
            let updated = match member.operation_type.as_str() {
                "feed_item_saved_assignment" => transaction.execute(
                    "UPDATE library_core_feed_items SET
                       saved = ?1,
                       archived = CASE WHEN ?1 = 1 THEN 0 ELSE archived END,
                       archivedAt = CASE WHEN ?1 = 1 THEN NULL ELSE archivedAt END,
                       payloadJson = CASE WHEN ?1 = 0
                         THEN json_remove(json_set(payloadJson, '$.userState.saved', json('false')), '$.userState.savedAt')
                         ELSE json_remove(json_set(payloadJson,
                           '$.userState.saved', json('true'), '$.userState.savedAt', ?2,
                           '$.userState.archived', json('false')), '$.userState.archivedAt')
                       END,
                       updatedAtMs = ?3
                     WHERE globalId = ?4 AND deletedAt IS NULL
                       AND (saved IS NOT ?1 OR (?1 = 1 AND archived IS 1));",
                    params![assigned, assigned_at_ms, committed_at_ms, member.entity_id],
                )?,
                "feed_item_archive_assignment" => transaction.execute(
                    "UPDATE library_core_feed_items SET
                       archived = ?1,
                       archivedAt = CASE WHEN ?1 = 1 THEN ?2 ELSE NULL END,
                       payloadJson = CASE WHEN ?1 = 0
                         THEN json_remove(json_set(payloadJson, '$.userState.archived', json('false')), '$.userState.archivedAt')
                         ELSE json_set(payloadJson, '$.userState.archived', json('true'), '$.userState.archivedAt', ?2)
                       END,
                       updatedAtMs = ?3
                     WHERE globalId = ?4 AND deletedAt IS NULL
                       AND archived IS NOT ?1
                       AND (?1 = 0 OR saved IS NOT 1);",
                    params![assigned, assigned_at_ms, committed_at_ms, member.entity_id],
                )?,
                "feed_item_like_assignment" => transaction.execute(
                    "UPDATE library_core_feed_items SET
                       liked = ?1,
                       likedAt = CASE WHEN ?1 = 1 THEN ?2 ELSE NULL END,
                       likedSyncedAt = NULL,
                       payloadJson = CASE WHEN ?1 = 0
                         THEN json_remove(json_set(payloadJson, '$.userState.liked', json('false')), '$.userState.likedAt', '$.userState.likedSyncedAt')
                         ELSE json_remove(json_set(payloadJson, '$.userState.liked', json('true'), '$.userState.likedAt', ?2), '$.userState.likedSyncedAt')
                       END,
                       updatedAtMs = ?3
                     WHERE globalId = ?4 AND deletedAt IS NULL
                       AND liked IS NOT ?1;",
                    params![assigned, assigned_at_ms, committed_at_ms, member.entity_id],
                )?,
                _ => unreachable!("validated assignment operation type"),
            };
            Ok(updated)
        }
    }

    fn materialize_rss_feed(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
        committed_at_ms: i64,
    ) -> JournalResult<usize> {
        let shell_json = transaction
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_state",
            })?;
        let mut shell: Value =
            serde_json::from_str(&shell_json).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let shell_object = shell
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let feeds = shell_object
            .entry("feeds")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_feeds",
            })?;

        let shell_changed = match member.operation_type.as_str() {
            "rss_feed_upsert" => {
                let feed: Value = serde_json::from_str(
                    member
                        .rss_feed_json
                        .as_deref()
                        .expect("validated RSS feed payload"),
                )
                .map_err(|_| JournalError::InvalidVerifiedInput {
                    field: "rss_feed_json",
                })?;
                if feeds.get(&member.entity_id) == Some(&feed) {
                    false
                } else {
                    feeds.insert(member.entity_id.clone(), feed);
                    true
                }
            }
            "rss_feed_remove_keep_items" | "rss_feed_remove_with_items" => {
                feeds.remove(&member.entity_id).is_some()
            }
            _ => unreachable!("validated RSS feed operation"),
        };

        if shell_changed {
            let updated_shell =
                serde_json::to_string(&shell).map_err(|_| JournalError::InvalidVerifiedInput {
                    field: "desktop_library_shell",
                })?;
            transaction.execute(
                "UPDATE library_core_desktop_state SET shellJson = ?1
                 WHERE singletonId = 1 AND active = 1;",
                params![updated_shell],
            )?;
        }

        let removed_items = if member.operation_type == "rss_feed_remove_with_items" {
            transaction.execute(
                "UPDATE library_core_feed_items
                 SET deletedAt = ?1, updatedAtMs = ?2
                 WHERE feedUrl = ?3 AND deletedAt IS NULL;",
                params![
                    member.removed_at_ms.expect("validated RSS removal time"),
                    committed_at_ms,
                    member.entity_id,
                ],
            )?
        } else {
            0
        };
        Ok(usize::from(shell_changed) + removed_items)
    }

    fn materialize_preferences(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
    ) -> JournalResult<usize> {
        fn merge(target: &mut Value, patch: &Value) {
            match (target, patch) {
                (Value::Object(target), Value::Object(patch)) => {
                    for (key, value) in patch {
                        match target.get_mut(key) {
                            Some(current) => merge(current, value),
                            None => {
                                target.insert(key.clone(), value.clone());
                            }
                        }
                    }
                }
                (target, patch) => *target = patch.clone(),
            }
        }

        let shell_json = transaction
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_state",
            })?;
        let mut shell: Value =
            serde_json::from_str(&shell_json).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let patch: Value = serde_json::from_str(
            member
                .preferences_patch_json
                .as_deref()
                .expect("validated preferences patch"),
        )
        .map_err(|_| JournalError::InvalidVerifiedInput {
            field: "preferences_patch_json",
        })?;
        let preferences = shell
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?
            .entry("preferences")
            .or_insert_with(|| Value::Object(Default::default()));
        let previous = preferences.clone();
        merge(preferences, &patch);
        if *preferences == previous {
            return Ok(0);
        }
        let updated_shell =
            serde_json::to_string(&shell).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        transaction.execute(
            "UPDATE library_core_desktop_state SET shellJson = ?1
             WHERE singletonId = 1 AND active = 1;",
            params![updated_shell],
        )?;
        Ok(1)
    }

    fn materialize_person(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
    ) -> JournalResult<usize> {
        let shell_json = transaction
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_state",
            })?;
        let mut shell: Value =
            serde_json::from_str(&shell_json).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let person: Value = serde_json::from_str(
            member
                .person_json
                .as_deref()
                .expect("validated person payload"),
        )
        .map_err(|_| JournalError::InvalidVerifiedInput {
            field: "person_json",
        })?;
        let persons = shell
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?
            .entry("persons")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_persons",
            })?;
        if persons.get(&member.entity_id) == Some(&person) {
            return Ok(0);
        }
        persons.insert(member.entity_id.clone(), person);
        let updated_shell =
            serde_json::to_string(&shell).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        transaction.execute(
            "UPDATE library_core_desktop_state SET shellJson = ?1
             WHERE singletonId = 1 AND active = 1;",
            params![updated_shell],
        )?;
        Ok(1)
    }

    fn materialize_person_remove(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
    ) -> JournalResult<usize> {
        let shell_json = transaction
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_state",
            })?;
        let mut shell: Value =
            serde_json::from_str(&shell_json).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let shell_object = shell
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let person_removed = shell_object
            .entry("persons")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_persons",
            })?
            .remove(&member.entity_id)
            .is_some();
        let accounts = shell_object
            .entry("accounts")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_accounts",
            })?;
        let account_ids = accounts
            .iter()
            .filter(|(_, account)| {
                account.get("personId").and_then(Value::as_str) == Some(member.entity_id.as_str())
            })
            .map(|(account_id, _)| account_id.clone())
            .collect::<Vec<_>>();
        for account_id in &account_ids {
            accounts.remove(account_id);
        }
        if !person_removed && account_ids.is_empty() {
            return Ok(0);
        }
        let updated_shell =
            serde_json::to_string(&shell).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        transaction.execute(
            "UPDATE library_core_desktop_state SET shellJson = ?1
             WHERE singletonId = 1 AND active = 1;",
            params![updated_shell],
        )?;
        Ok(usize::from(person_removed) + account_ids.len())
    }

    fn materialize_account(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
    ) -> JournalResult<usize> {
        let shell_json = transaction
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_state",
            })?;
        let mut shell: Value =
            serde_json::from_str(&shell_json).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let account: Value = serde_json::from_str(
            member
                .account_json
                .as_deref()
                .expect("validated account payload"),
        )
        .map_err(|_| JournalError::InvalidVerifiedInput {
            field: "account_json",
        })?;
        let accounts = shell
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?
            .entry("accounts")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_accounts",
            })?;
        if accounts.get(&member.entity_id) == Some(&account) {
            return Ok(0);
        }
        accounts.insert(member.entity_id.clone(), account);
        let updated_shell =
            serde_json::to_string(&shell).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        transaction.execute(
            "UPDATE library_core_desktop_state SET shellJson = ?1
             WHERE singletonId = 1 AND active = 1;",
            params![updated_shell],
        )?;
        Ok(1)
    }

    fn materialize_account_remove(
        transaction: &Transaction<'_>,
        member: &VerifiedOperation,
    ) -> JournalResult<usize> {
        let shell_json = transaction
            .query_row(
                "SELECT shellJson FROM library_core_desktop_state
                 WHERE singletonId = 1 AND active = 1;",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_state",
            })?;
        let mut shell: Value =
            serde_json::from_str(&shell_json).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        let removed = shell
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?
            .entry("accounts")
            .or_insert_with(|| Value::Object(Default::default()))
            .as_object_mut()
            .ok_or(JournalError::InvalidVerifiedInput {
                field: "desktop_library_accounts",
            })?
            .remove(&member.entity_id)
            .is_some();
        if !removed {
            return Ok(0);
        }
        let updated_shell =
            serde_json::to_string(&shell).map_err(|_| JournalError::InvalidVerifiedInput {
                field: "desktop_library_shell",
            })?;
        transaction.execute(
            "UPDATE library_core_desktop_state SET shellJson = ?1
             WHERE singletonId = 1 AND active = 1;",
            params![updated_shell],
        )?;
        Ok(1)
    }

    fn intent_results_for_transaction(
        &self,
        transaction_id: &str,
    ) -> JournalResult<Vec<IntentResultOutboxEntry>> {
        if !is_operation_id(transaction_id) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "transaction_id",
            });
        }
        let mut statement = self.connection.prepare(
            "SELECT result.resultOperationId, result.actorId,
                    result.resultSequence, result.intentOperationId,
                    result.intentSequence, result.status,
                    result.providerReceiptDigest, result.enqueuedAtMs
             FROM library_core_intent_result_outbox AS result
             JOIN library_core_operations AS operation
               ON operation.operationId = result.intentOperationId
             WHERE operation.transactionId = ?1
             ORDER BY operation.transactionMemberIndex;",
        )?;
        let rows = statement.query_map(params![transaction_id], |row| {
            Ok(IntentResultOutboxEntry {
                result_operation_id: row.get(0)?,
                actor_id: row.get(1)?,
                result_sequence: row.get(2)?,
                intent_operation_id: row.get(3)?,
                intent_sequence: row.get(4)?,
                status: row.get(5)?,
                provider_receipt_digest: row.get(6)?,
                enqueued_at_ms: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<SqlResult<Vec<_>>>()?)
    }

    pub fn pending_intent_results(
        &self,
        library_id: &str,
        epoch_id: &str,
        maximum_entries: usize,
    ) -> JournalResult<Vec<IntentResultOutboxEntry>> {
        if !is_lower_hex(library_id, 32)
            || !is_operation_id(epoch_id)
            || maximum_entries == 0
            || maximum_entries > MAX_OUTBOX_PAGE_ENTRIES
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "result_outbox_maximum_entries",
            });
        }
        let mut statement = self.connection.prepare(RESULT_OUTBOX_PAGE_SQL)?;
        let rows = statement.query_map(
            params![library_id, epoch_id, "", 0_i64, maximum_entries as i64],
            |row| {
                Ok(IntentResultOutboxEntry {
                    result_operation_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    result_sequence: row.get(2)?,
                    intent_operation_id: row.get(3)?,
                    intent_sequence: row.get(4)?,
                    status: row.get(5)?,
                    provider_receipt_digest: row.get(6)?,
                    enqueued_at_ms: row.get(7)?,
                })
            },
        )?;
        Ok(rows.collect::<SqlResult<Vec<_>>>()?)
    }

    pub fn acknowledge_intent_results(
        &mut self,
        result_operation_ids: &[String],
        acknowledged_at_ms: i64,
    ) -> JournalResult<()> {
        if result_operation_ids.is_empty()
            || result_operation_ids.len() > MAX_OUTBOX_PAGE_ENTRIES
            || !(0..=MAX_SAFE_INTEGER).contains(&acknowledged_at_ms)
            || result_operation_ids
                .iter()
                .any(|value| !is_operation_id(value))
        {
            return Err(JournalError::InvalidVerifiedInput {
                field: "result_acknowledgement",
            });
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for result_operation_id in result_operation_ids {
            let existing: Option<i64> = transaction
                .query_row(
                    "SELECT enqueuedAtMs FROM library_core_intent_result_outbox
                     WHERE resultOperationId = ?1;",
                    params![result_operation_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(enqueued_at_ms) = existing else {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "result_acknowledgement",
                });
            };
            if acknowledged_at_ms < enqueued_at_ms {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "result_acknowledgement_time",
                });
            }
            transaction.execute(
                "UPDATE library_core_intent_result_outbox
                 SET acknowledgedAtMs = COALESCE(acknowledgedAtMs, ?1)
                 WHERE resultOperationId = ?2;",
                params![acknowledged_at_ms, result_operation_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn read_state(&self, entity_id: &str) -> JournalResult<Option<ReadState>> {
        Ok(self
            .connection
            .query_row(
                "SELECT entityId, readAtMs, sourceOperationId, sourceActorId,
                 sourceSequence, sourceChainDigest
                 FROM library_core_feed_item_read_state WHERE entityId = ?1;",
                params![entity_id],
                |row| {
                    Ok(ReadState {
                        entity_id: row.get(0)?,
                        read_at_ms: row.get(1)?,
                        source_operation_id: row.get(2)?,
                        source_actor_id: row.get(3)?,
                        source_sequence: row.get(4)?,
                        source_chain_digest: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    fn operation_outbox_page(
        &self,
        after_ingest_sequence: i64,
        maximum_entries: usize,
    ) -> JournalResult<OperationOutboxPage> {
        self.operation_outbox_page_with_budget(
            after_ingest_sequence,
            maximum_entries,
            MAX_OUTBOX_PAGE_BYTES,
        )
    }

    fn operation_outbox_page_with_budget(
        &self,
        after_ingest_sequence: i64,
        maximum_entries: usize,
        maximum_bytes: usize,
    ) -> JournalResult<OperationOutboxPage> {
        if !(0..=MAX_SAFE_INTEGER).contains(&after_ingest_sequence) {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_after_ingest_sequence",
            });
        }
        if maximum_entries == 0 || maximum_entries > MAX_OUTBOX_PAGE_ENTRIES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_entries",
            });
        }
        if maximum_bytes == 0 || maximum_bytes > MAX_OUTBOX_PAGE_BYTES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_bytes",
            });
        }

        let row_limit =
            maximum_entries
                .checked_add(1)
                .ok_or(JournalError::InvalidVerifiedInput {
                    field: "outbox_maximum_entries",
                })?;
        let mut statement = self.connection.prepare(OPERATION_OUTBOX_PAGE_SQL)?;
        let mut rows = statement.query(params![after_ingest_sequence, row_limit as i64])?;
        let mut entries = Vec::with_capacity(maximum_entries);
        let mut pending_transaction = Vec::new();
        let mut pending_transaction_bytes = 0usize;
        let mut retained_bytes = 0usize;
        let mut has_more = false;

        while let Some(row) = rows.next()? {
            let transaction_id: String = row.get(5)?;
            let transaction_member_index: i64 = row.get(6)?;
            let transaction_member_count: i64 = row.get(7)?;
            if !(1..=MAX_OUTBOX_PAGE_ENTRIES as i64).contains(&transaction_member_count)
                || !(0..transaction_member_count).contains(&transaction_member_index)
            {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_transaction_members",
                });
            }
            if transaction_member_index == 0 {
                if !pending_transaction.is_empty() {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "outbox_transaction_members",
                    });
                }
                if transaction_member_count as usize > maximum_entries {
                    if entries.is_empty() {
                        return Err(JournalError::InvalidVerifiedInput {
                            field: "outbox_maximum_entries",
                        });
                    }
                    has_more = true;
                    break;
                }
                if entries.len() + transaction_member_count as usize > maximum_entries {
                    has_more = true;
                    break;
                }
            } else if pending_transaction.is_empty() {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_transaction_members",
                });
            }
            if entries.len() == maximum_entries {
                has_more = true;
                break;
            }
            let entry_bytes: i64 = row.get(3)?;
            if !(1..=MAX_OUTBOX_PAGE_BYTES as i64).contains(&entry_bytes) {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            let entry_bytes = entry_bytes as usize;
            let canonical_envelope_json: String = row.get(4)?;
            if canonical_envelope_json.len() != entry_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            pending_transaction_bytes = pending_transaction_bytes.checked_add(entry_bytes).ok_or(
                JournalError::InvalidVerifiedInput {
                    field: "outbox_transaction_bytes",
                },
            )?;
            pending_transaction.push(OperationOutboxEntry {
                operation_id: row.get(0)?,
                ingest_sequence: row.get(1)?,
                enqueued_at_ms: row.get(2)?,
                canonical_envelope_json,
                transaction_id: transaction_id.clone(),
                transaction_member_index,
                transaction_member_count,
            });
            if transaction_member_index + 1 == transaction_member_count {
                if pending_transaction.len() != transaction_member_count as usize
                    || pending_transaction
                        .iter()
                        .enumerate()
                        .any(|(index, entry)| {
                            entry.transaction_id != transaction_id
                                || entry.transaction_member_index != index as i64
                                || entry.transaction_member_count != transaction_member_count
                        })
                {
                    return Err(JournalError::InvalidVerifiedInput {
                        field: "outbox_transaction_members",
                    });
                }
                let next_bytes = retained_bytes
                    .checked_add(pending_transaction_bytes)
                    .ok_or(JournalError::InvalidVerifiedInput {
                        field: "outbox_transaction_bytes",
                    })?;
                if next_bytes > maximum_bytes {
                    if entries.is_empty() {
                        return Err(JournalError::InvalidVerifiedInput {
                            field: "outbox_transaction_bytes",
                        });
                    }
                    pending_transaction.clear();
                    has_more = true;
                    break;
                }
                retained_bytes = next_bytes;
                entries.append(&mut pending_transaction);
                pending_transaction_bytes = 0;
            }
        }
        if !pending_transaction.is_empty() {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_transaction_members",
            });
        }

        let next_after_ingest_sequence = entries.last().map(|entry| entry.ingest_sequence);
        Ok(OperationOutboxPage {
            entries,
            next_after_ingest_sequence,
            has_more,
        })
    }

    fn enrollment_outbox_page(
        &self,
        after: Option<&EnrollmentOutboxCursor>,
        maximum_entries: usize,
    ) -> JournalResult<EnrollmentOutboxPage> {
        self.enrollment_outbox_page_with_budget(after, maximum_entries, MAX_OUTBOX_PAGE_BYTES)
    }

    fn enrollment_outbox_page_with_budget(
        &self,
        after: Option<&EnrollmentOutboxCursor>,
        maximum_entries: usize,
        maximum_bytes: usize,
    ) -> JournalResult<EnrollmentOutboxPage> {
        if maximum_entries == 0 || maximum_entries > MAX_OUTBOX_PAGE_ENTRIES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_entries",
            });
        }
        if maximum_bytes == 0 || maximum_bytes > MAX_OUTBOX_PAGE_BYTES {
            return Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_bytes",
            });
        }
        let (after_ms, after_id) = match after {
            Some(cursor)
                if (0..=MAX_SAFE_INTEGER).contains(&cursor.enqueued_at_ms)
                    && is_operation_id(&cursor.enrollment_operation_id) =>
            {
                (
                    cursor.enqueued_at_ms,
                    cursor.enrollment_operation_id.as_str(),
                )
            }
            Some(_) => {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "enrollment_outbox_cursor",
                });
            }
            None => (-1, ""),
        };
        let row_limit =
            maximum_entries
                .checked_add(1)
                .ok_or(JournalError::InvalidVerifiedInput {
                    field: "outbox_maximum_entries",
                })?;
        let mut statement = self.connection.prepare(ENROLLMENT_OUTBOX_PAGE_SQL)?;
        let mut rows = statement.query(params![after_ms, after_id, row_limit as i64])?;
        let mut entries = Vec::with_capacity(maximum_entries);
        let mut retained_bytes = 0usize;
        let mut has_more = false;

        while let Some(row) = rows.next()? {
            if entries.len() == maximum_entries {
                has_more = true;
                break;
            }
            let entry_bytes: i64 = row.get(2)?;
            if !(1..=MAX_OUTBOX_PAGE_BYTES as i64).contains(&entry_bytes) {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            let entry_bytes = entry_bytes as usize;
            if entries.is_empty() && entry_bytes > maximum_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            if retained_bytes
                .checked_add(entry_bytes)
                .is_none_or(|next| next > maximum_bytes)
            {
                has_more = true;
                break;
            }
            let canonical_enrollment_certificate_json: String = row.get(3)?;
            if canonical_enrollment_certificate_json.len() != entry_bytes {
                return Err(JournalError::InvalidVerifiedInput {
                    field: "outbox_entry_bytes",
                });
            }
            entries.push(EnrollmentOutboxEntry {
                enrollment_operation_id: row.get(0)?,
                enqueued_at_ms: row.get(1)?,
                canonical_enrollment_certificate_json,
            });
            retained_bytes += entry_bytes;
        }

        let next_cursor = entries.last().map(|entry| EnrollmentOutboxCursor {
            enqueued_at_ms: entry.enqueued_at_ms,
            enrollment_operation_id: entry.enrollment_operation_id.clone(),
        });
        Ok(EnrollmentOutboxPage {
            entries,
            next_cursor,
            has_more,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(byte: &str) -> String {
        byte.repeat(64)
    }

    fn actor() -> VerifiedActorEnrollment {
        VerifiedActorEnrollment {
            library_id: digest("1"),
            epoch: 1,
            epoch_id: digest("2"),
            actor_id: digest("3"),
            actor_public_key: digest("4"),
            enrollment_operation_id: "op:actor:enroll:fixture".to_string(),
            enrollment_certificate_digest: digest("5"),
            canonical_enrollment_certificate_json: "{\"certificate\":\"fixture\"}".to_string(),
            actor_chain_genesis: digest("6"),
            enrolled_at_ms: 1_000,
            capability: actor_capability::ActorCapabilityState::legacy_editor(digest("5"), 1_000),
        }
    }

    fn actor_variant(hex_digit: &str, operation_suffix: &str) -> VerifiedActorEnrollment {
        let certificate_digest = digest(hex_digit);
        VerifiedActorEnrollment {
            actor_id: digest(hex_digit),
            actor_public_key: digest(if hex_digit == "f" { "e" } else { "f" }),
            enrollment_operation_id: format!("op:actor:enroll:{operation_suffix}"),
            enrollment_certificate_digest: certificate_digest.clone(),
            canonical_enrollment_certificate_json: format!(
                "{{\"certificate\":\"{operation_suffix}\"}}"
            ),
            actor_chain_genesis: digest(if hex_digit == "b" { "a" } else { "b" }),
            capability: actor_capability::ActorCapabilityState::legacy_editor(
                certificate_digest,
                1_000,
            ),
            ..actor()
        }
    }

    fn install_actor_authority(journal: &mut LibraryCoreJournal) {
        let enrollment = actor();
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority");
    }

    fn transaction(
        transaction_id: &str,
        first_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        reads: &[(&str, i64)],
    ) -> VerifiedOperationTransaction {
        let enrollment = actor();
        let transaction_digest = digest("7");
        let mut previous_operation = previous_operation_id.map(str::to_string);
        let mut previous_chain = previous_chain_digest.to_string();
        let mut members = Vec::new();
        for (index, (entity_id, read_at_ms)) in reads.iter().enumerate() {
            let operation_id = format!("{transaction_id}:member:{index}");
            let actor_chain_digest = format!("{:064x}", first_sequence + index as i64 + 100);
            let canonical_envelope_json = format!("{{\"operation_id\":\"{operation_id}\"}}");
            members.push(VerifiedOperation {
                operation_id: operation_id.clone(),
                actor_sequence: first_sequence + index as i64,
                previous_actor_operation_id: previous_operation.clone(),
                previous_actor_chain_digest: previous_chain,
                actor_chain_digest: actor_chain_digest.clone(),
                member_digest: format!("{:064x}", first_sequence + index as i64 + 150),
                signing_body_digest: format!("{:064x}", first_sequence + index as i64 + 175),
                envelope_digest: format!("{:064x}", first_sequence + index as i64 + 200),
                entity_id: (*entity_id).to_string(),
                entity_type: "FeedItem".to_string(),
                operation_type: "feed_item_read_assignment".to_string(),
                item_json: None,
                rss_feed_json: None,
                preferences_patch_json: None,
                person_json: None,
                account_json: None,
                read_at_ms: Some(*read_at_ms),
                assigned: None,
                assigned_at_ms: None,
                removed_at_ms: None,
                canonical_envelope_json,
                causal_tips: Vec::new(),
            });
            previous_operation = Some(operation_id);
            previous_chain = actor_chain_digest;
        }
        let canonical_envelope_bytes = members
            .iter()
            .map(|member| member.canonical_envelope_json.len())
            .sum();
        VerifiedOperationTransaction {
            transaction_id: transaction_id.to_string(),
            transaction_digest,
            library_id: enrollment.library_id,
            epoch: enrollment.epoch,
            epoch_id: enrollment.epoch_id,
            actor_id: enrollment.actor_id,
            actor_capability: enrollment.capability,
            canonical_envelope_bytes,
            members,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn assignment_transaction(
        transaction_id: &str,
        actor_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        entity_id: &str,
        field: &str,
        assigned: bool,
        assigned_at_ms: i64,
    ) -> VerifiedOperationTransaction {
        let mut verified = transaction(
            transaction_id,
            actor_sequence,
            previous_operation_id,
            previous_chain_digest,
            &[(entity_id, assigned_at_ms)],
        );
        let member = &mut verified.members[0];
        member.operation_type = match field {
            "saved" => "feed_item_saved_assignment",
            "archived" => "feed_item_archive_assignment",
            "liked" => "feed_item_like_assignment",
            _ => panic!("unsupported fixture assignment field"),
        }
        .to_string();
        member.read_at_ms = None;
        member.assigned = Some(assigned);
        member.assigned_at_ms = Some(assigned_at_ms);
        verified
    }

    fn removal_transaction(
        transaction_id: &str,
        actor_sequence: i64,
        previous_operation_id: Option<&str>,
        previous_chain_digest: &str,
        entity_id: &str,
        removed_at_ms: i64,
    ) -> VerifiedOperationTransaction {
        let mut verified = transaction(
            transaction_id,
            actor_sequence,
            previous_operation_id,
            previous_chain_digest,
            &[(entity_id, removed_at_ms)],
        );
        let member = &mut verified.members[0];
        member.operation_type = "feed_item_remove".to_string();
        member.read_at_ms = None;
        member.removed_at_ms = Some(removed_at_ms);
        verified
    }

    #[test]
    fn configures_full_durability_and_exact_schema() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let journal = LibraryCoreJournal::open(&directory.path().join("library-core.sqlite"))
            .expect("open journal");
        let journal_mode: String = journal
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal mode");
        let synchronous: i64 = journal
            .connection
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .expect("synchronous");
        let foreign_keys: i64 = journal
            .connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign keys");
        let version: i64 = journal
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user version");
        let application_id: i64 = journal
            .connection
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .expect("application ID");
        let cell_size_check: i64 = journal
            .connection
            .pragma_query_value(None, "cell_size_check", |row| row.get(0))
            .expect("cell-size check");
        #[cfg(target_os = "macos")]
        let fullfsync: i64 = journal
            .connection
            .pragma_query_value(None, "fullfsync", |row| row.get(0))
            .expect("full filesystem sync");
        let defensive = journal
            .connection
            .db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
            .expect("defensive mode");
        let trusted_schema = journal
            .connection
            .db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA)
            .expect("trusted schema");
        let double_quoted_ddl_literals = journal
            .connection
            .db_config(DbConfig::SQLITE_DBCONFIG_DQS_DDL)
            .expect("double-quoted DDL literals");
        let double_quoted_dml_literals = journal
            .connection
            .db_config(DbConfig::SQLITE_DBCONFIG_DQS_DML)
            .expect("double-quoted DML literals");
        assert_eq!(journal_mode, "wal");
        assert_eq!(synchronous, 2);
        assert_eq!(foreign_keys, 1);
        assert_eq!(version, AUTHORITATIVE_SCHEMA_VERSION);
        assert_eq!(application_id, AUTHORITATIVE_APPLICATION_ID);
        assert_eq!(cell_size_check, 1);
        #[cfg(target_os = "macos")]
        assert_eq!(fullfsync, 1);
        assert!(defensive);
        assert!(!trusted_schema);
        assert!(!double_quoted_ddl_literals);
        assert!(!double_quoted_dml_literals);
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_LENGTH),
            SQLITE_MAX_VALUE_BYTES
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_SQL_LENGTH),
            SQLITE_MAX_SQL_BYTES
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_COLUMN),
            SQLITE_MAX_COLUMNS
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_EXPR_DEPTH),
            SQLITE_MAX_EXPRESSION_DEPTH
        );
        assert_eq!(
            journal
                .connection
                .limit(Limit::SQLITE_LIMIT_COMPOUND_SELECT),
            SQLITE_MAX_COMPOUND_SELECTS
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_FUNCTION_ARG),
            SQLITE_MAX_FUNCTION_ARGUMENTS
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_ATTACHED),
            SQLITE_MAX_ATTACHED_DATABASES
        );
        assert_eq!(
            journal
                .connection
                .limit(Limit::SQLITE_LIMIT_LIKE_PATTERN_LENGTH),
            SQLITE_MAX_PATTERN_BYTES
        );
        assert_eq!(
            journal
                .connection
                .limit(Limit::SQLITE_LIMIT_VARIABLE_NUMBER),
            SQLITE_MAX_VARIABLE_NUMBER
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_TRIGGER_DEPTH),
            SQLITE_MAX_TRIGGER_DEPTH
        );
        assert_eq!(
            journal.connection.limit(Limit::SQLITE_LIMIT_WORKER_THREADS),
            SQLITE_MAX_WORKER_THREADS
        );
    }

    #[test]
    fn authority_epoch_rejects_two_frontier_tips_for_one_actor() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let actor_id = digest("1");
        let epoch = VerifiedAuthorityEpoch {
            authority: AcceptedAuthorityState {
                library_id: digest("2"),
                epoch: 1,
                epoch_id: digest("3"),
                authority_key_id: digest("4"),
                authority_public_key: digest("5"),
                observed_frontier: vec![
                    VerifiedCausalTip {
                        actor_id: actor_id.clone(),
                        sequence: 1,
                        operation_id: "op:frontier:one".to_owned(),
                        chain_digest: digest("6"),
                    },
                    VerifiedCausalTip {
                        actor_id,
                        sequence: 2,
                        operation_id: "op:frontier:two".to_owned(),
                        chain_digest: digest("7"),
                    },
                ],
            },
            transition_certificate_digest: digest("8"),
            canonical_transition_certificate_json: "{\"transition\":\"fixture\"}".to_owned(),
            accepted_at_ms: 900,
        };

        assert!(matches!(
            journal.install_authority_epoch(&epoch),
            Err(JournalError::InvalidVerifiedInput {
                field: "authority.observed_frontier"
            })
        ));
    }

    #[test]
    fn upgrades_the_installed_v3_schema_to_current_without_resetting_the_database() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let mut connection = Connection::open(&path).expect("create v3 database");
        {
            let transaction = connection.transaction().expect("begin v3 schema");
            apply_schema_range(&transaction, 0, 3).expect("apply v3 schema");
            transaction
                .execute(
                    "INSERT INTO library_core_meta (key, integerValue)
                     VALUES ('upgradeSentinel', 42);",
                    [],
                )
                .expect("write installed data sentinel");
            transaction.commit().expect("commit v3 schema");
        }
        drop(connection);

        let journal = LibraryCoreJournal::open(&path).expect("upgrade v3 journal");
        let version: i64 = journal
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read upgraded version");
        let admission_table_exists: bool = journal
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema
                 WHERE type = 'table'
                   AND name = 'library_core_cloud_writer_admission');",
                [],
                |row| row.get(0),
            )
            .expect("read writer admission catalog entry");
        let timeline_indexes: i64 = journal
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'index'
                   AND name IN (
                     'library_core_feed_items_all_timeline',
                     'library_core_feed_items_visible_timeline',
                     'library_core_feed_items_all_author_timeline',
                     'library_core_feed_items_visible_author_timeline',
                     'library_core_feed_items_all_feed_timeline',
                     'library_core_feed_items_visible_feed_timeline'
                   );",
                [],
                |row| row.get(0),
            )
            .expect("read bounded timeline indexes");
        let follower_tables: i64 = journal
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'table'
                   AND name IN (
                     'library_core_follower_anchor',
                     'library_core_follower_actor',
                     'library_core_follower_enrollment_publication',
                     'library_core_follower_intent_actor',
                     'library_core_follower_intent_transaction',
                     'library_core_follower_intent_operation',
                     'library_core_follower_intent_result'
                   );",
                [],
                |row| row.get(0),
            )
            .expect("read isolated follower tables");
        let native_authority_protocol_table_exists: bool = journal
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema
                 WHERE type = 'table'
                   AND name = 'library_core_native_authority_protocol');",
                [],
                |row| row.get(0),
            )
            .expect("read native authority protocol catalog entry");
        let sentinel: i64 = journal
            .connection
            .query_row(
                "SELECT integerValue FROM library_core_meta
                 WHERE key = 'upgradeSentinel';",
                [],
                |row| row.get(0),
            )
            .expect("read preserved installed data");
        assert_eq!(version, AUTHORITATIVE_SCHEMA_VERSION);
        assert!(admission_table_exists);
        assert_eq!(timeline_indexes, 6);
        assert_eq!(follower_tables, 7);
        assert!(native_authority_protocol_table_exists);
        assert_eq!(sentinel, 42);
    }

    #[test]
    fn v11_actor_migration_installs_exact_legacy_policy_and_missing_state_fails_closed() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let mut connection = Connection::open(&path).expect("create v11 database");
        let library_id = "1".repeat(64);
        let epoch_id = "2".repeat(64);
        let actor_id = "3".repeat(64);
        let certificate_digest = "4".repeat(64);
        {
            let transaction = connection.transaction().expect("begin v11 schema");
            apply_schema_range(&transaction, 0, 11).expect("apply v11 schema");
            transaction
                .execute(
                    "INSERT INTO library_core_authority_epochs (
                       libraryId, epoch, epochId, transitionCertificateDigest,
                       canonicalTransitionCertificateJson, authorityKeyId,
                       authorityPublicKey, acceptedAtMs
                     ) VALUES (?1, 1, ?2, ?3, '{}', ?4, ?5, 900);",
                    params![
                        &library_id,
                        &epoch_id,
                        "5".repeat(64),
                        "6".repeat(64),
                        "7".repeat(64),
                    ],
                )
                .expect("insert authority");
            transaction
                .execute(
                    "INSERT INTO library_core_actors (
                       libraryId, epoch, epochId, actorId, actorPublicKey,
                       enrollmentOperationId, enrollmentCertificateDigest,
                       canonicalEnrollmentCertificateJson, actorChainGenesis,
                       nextSequence, previousOperationId, previousChainDigest,
                       enrolledAtMs
                     ) VALUES (?1, 1, ?2, ?3, ?4, 'op:legacy:migration', ?5,
                               '{}', ?6, 1, NULL, ?6, 1000);",
                    params![
                        &library_id,
                        &epoch_id,
                        &actor_id,
                        "8".repeat(64),
                        &certificate_digest,
                        "9".repeat(64),
                    ],
                )
                .expect("insert v11 actor");
            transaction.commit().expect("commit v11 database");
        }
        drop(connection);

        let journal = LibraryCoreJournal::open(&path).expect("upgrade v11 journal");
        let stored: (i64, String, String, String, String, i64) = journal
            .connection
            .query_row(
                "SELECT certificateVersion, actorClass, allowedOperationTypesJson,
                        scopeMode, capabilityCertificateDigest, issuedAtMs
                   FROM library_core_actor_capability_state
                  WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![&library_id, &epoch_id, &actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("read migrated legacy policy");
        assert_eq!(stored.0, 1);
        assert_eq!(stored.1, "legacy_editor");
        assert_eq!(
            stored.2,
            "[\"account_remove\",\"account_upsert\",\"feed_item_archive_assignment\",\"feed_item_capture_upsert\",\"feed_item_like_assignment\",\"feed_item_read_assignment\",\"feed_item_remove\",\"feed_item_saved_assignment\",\"person_remove_and_accounts\",\"person_upsert\",\"preferences_leaf_assignment\",\"rss_feed_remove_keep_items\",\"rss_feed_remove_with_items\",\"rss_feed_upsert\"]"
        );
        assert!(!stored.2.contains("future_operation"));
        assert_eq!(stored.3, "legacy_editor");
        assert_eq!(stored.4, certificate_digest);
        assert_eq!(stored.5, 1_000);
        assert!(journal
            .actor_state(&library_id, &epoch_id, &actor_id)
            .expect("read migrated actor")
            .is_some());

        journal
            .connection
            .execute(
                "DELETE FROM library_core_actor_capability_state
                  WHERE libraryId = ?1 AND epochId = ?2 AND actorId = ?3;",
                params![&library_id, &epoch_id, &actor_id],
            )
            .expect("remove capability fixture");
        assert!(matches!(
            journal.actor_state(&library_id, &epoch_id, &actor_id),
            Err(JournalError::InvalidVerifiedInput {
                field: "actor_capability_missing"
            })
        ));
    }

    #[test]
    fn upgrades_v7_follower_anchor_without_inventing_checkpoint_receipts() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let mut connection = Connection::open(&path).expect("create v7 database");
        {
            let transaction = connection.transaction().expect("begin v7 schema");
            apply_schema_range(&transaction, 0, 7).expect("apply v7 schema");
            transaction
                .execute(
                    "INSERT INTO library_core_follower_anchor (
                       singletonId, libraryId, epoch, epochId, authorityKeyId,
                       authorityPublicKey, observedFrontierJson,
                       manifestObjectKey, manifestContentDigest, generation,
                       remoteIngestSequence, remoteMaterializedDigest,
                       writerId, controlRevision, installedAtMs
                     ) VALUES (1, ?1, 3, ?2, ?3, ?4, '[]', 'manifest-1',
                               ?5, 1, 10, ?6, ?7, 'revision-1', 1000);",
                    params![
                        "a".repeat(64),
                        "b".repeat(64),
                        "c".repeat(64),
                        "d".repeat(64),
                        "1".repeat(64),
                        "2".repeat(64),
                        "3".repeat(64),
                    ],
                )
                .expect("write v7 follower anchor");
            transaction.commit().expect("commit v7 schema");
        }
        drop(connection);

        let journal = LibraryCoreJournal::open(&path).expect("upgrade v7 journal");
        let stored: (String, Option<String>, Option<String>, Option<i64>) = journal
            .connection
            .query_row(
                "SELECT manifestObjectKey, manifestTransportObjectId,
                        checkpointActorId,
                        checkpointAcceptedSequence
                 FROM library_core_follower_anchor WHERE singletonId = 1;",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read upgraded follower anchor");
        assert_eq!(stored, ("manifest-1".to_string(), None, None, None));
        assert_eq!(journal.follower_anchor().unwrap(), None);
    }

    #[test]
    fn opening_rejects_a_mismatched_database_identity() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let journal = LibraryCoreJournal::open(&path).expect("create journal");
        drop(journal);
        let connection = Connection::open(&path).expect("open raw database");
        connection
            .pragma_update(None, "application_id", 0)
            .expect("remove authoritative database identity");
        drop(connection);
        let bytes_before_rejection = std::fs::read(&path).expect("read mismatched database");

        match LibraryCoreJournal::open(&path) {
            Err(JournalError::DatabaseIdentityMismatch { expected, actual }) => {
                assert_eq!(expected, AUTHORITATIVE_APPLICATION_ID);
                assert_eq!(actual, 0);
            }
            Err(error) => panic!("unexpected database identity error: {error}"),
            Ok(_) => panic!("mismatched database identity must fail closed"),
        }
        assert_eq!(
            std::fs::read(&path).expect("reread mismatched database"),
            bytes_before_rejection
        );
    }

    #[cfg(unix)]
    #[test]
    fn opening_rejects_a_symbolic_link_to_an_authoritative_database() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let target_path = directory.path().join("authoritative.sqlite");
        let link_path = directory.path().join("library-core.sqlite");
        let journal =
            LibraryCoreJournal::open(&target_path).expect("create authoritative database");
        drop(journal);
        symlink(&target_path, &link_path).expect("create database symbolic link");

        match LibraryCoreJournal::open(&link_path) {
            Err(JournalError::Sql(_)) => {}
            Err(error) => panic!("unexpected symbolic-link error: {error}"),
            Ok(_) => panic!("symbolic-link database path must fail closed"),
        }

        LibraryCoreJournal::open(&target_path)
            .expect("direct authoritative database path remains valid");
    }

    #[test]
    fn opening_rejects_a_foreign_blank_database_before_schema_creation() {
        const FOREIGN_APPLICATION_ID: i64 = 0x1234_5678;

        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let connection = Connection::open(&path).expect("create raw database");
        connection
            .pragma_update(None, "application_id", FOREIGN_APPLICATION_ID)
            .expect("set foreign database identity");
        drop(connection);

        match LibraryCoreJournal::open(&path) {
            Err(JournalError::DatabaseIdentityMismatch { expected, actual }) => {
                assert_eq!(expected, AUTHORITATIVE_APPLICATION_ID);
                assert_eq!(actual, FOREIGN_APPLICATION_ID);
            }
            Err(error) => panic!("unexpected database identity error: {error}"),
            Ok(_) => panic!("foreign blank database must fail closed"),
        }

        let connection = Connection::open(&path).expect("reopen raw database");
        let schema_object_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%';",
                [],
                |row| row.get(0),
            )
            .expect("count schema objects");
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user version");
        assert_eq!(schema_object_count, 0);
        assert_eq!(version, 0);
    }

    #[test]
    fn absent_file_preflight_cannot_race_a_foreign_database_into_writable_configuration() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory
            .path()
            .canonicalize()
            .expect("canonical temporary directory")
            .join("library-core.sqlite");
        assert!(
            !LibraryCoreJournal::preflight_existing_file(&path).expect("preflight absent database")
        );

        let connection = Connection::open(&path).expect("race foreign database into place");
        connection
            .execute_batch("CREATE TABLE foreign_records (id INTEGER PRIMARY KEY) STRICT;")
            .expect("create foreign schema");
        drop(connection);
        let bytes_before_rejection = std::fs::read(&path).expect("read foreign database");

        match LibraryCoreJournal::open_after_preflight(&path, false) {
            Err(JournalError::UnversionedSchemaPresent) => {}
            Err(error) => panic!("unexpected raced-database error: {error}"),
            Ok(_) => panic!("raced foreign database must fail closed"),
        }
        assert_eq!(
            std::fs::read(&path).expect("reread foreign database"),
            bytes_before_rejection
        );
        let sidecar_path = |suffix: &str| {
            let mut value = path.as_os_str().to_owned();
            value.push(suffix);
            std::path::PathBuf::from(value)
        };
        assert!(!sidecar_path("-wal").exists());
        assert!(!sidecar_path("-shm").exists());
    }

    #[test]
    fn opening_rejects_missing_or_unregistered_schema_objects() {
        for mutation in [
            "DROP INDEX library_core_replication_outbox_order;",
            "CREATE TABLE unregistered_authority_state (id TEXT PRIMARY KEY) STRICT;",
        ] {
            let directory = tempfile::tempdir().expect("temporary directory");
            let path = directory.path().join("library-core.sqlite");
            let journal = LibraryCoreJournal::open(&path).expect("create journal");
            drop(journal);
            let connection = Connection::open(&path).expect("open raw database");
            connection
                .execute_batch(mutation)
                .expect("mutate schema without changing user version");
            drop(connection);
            let bytes_before_rejection =
                std::fs::read(&path).expect("read changed-schema database");

            match LibraryCoreJournal::open(&path) {
                Err(JournalError::SchemaContractMismatch) => {}
                Err(error) => panic!("unexpected schema error: {error}"),
                Ok(_) => panic!("schema mutation must fail closed: {mutation}"),
            }
            assert_eq!(
                std::fs::read(&path).expect("reread changed-schema database"),
                bytes_before_rejection
            );
        }
    }

    /// The read-state upsert carries two rules, not one.
    ///
    /// `minimum_present_nonnegative_safe_integer_v1` decides which read time
    /// wins. It says nothing about which of two *equal* read times wins, and
    /// that second question decides the provenance columns. The SQL answers it
    /// by preferring the lower source operation id.
    ///
    /// This is executed rather than string-matched. The locator test in
    /// `native-materializer-binding.test.ts` can see that the column is
    /// consulted; only running the SQL can show which way the comparison goes.
    #[test]
    fn equal_read_times_are_broken_by_the_lower_source_operation_id() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");

        let entity = "rss:item:1";
        let read_at = 900;

        let provenance = |journal: &LibraryCoreJournal| -> (i64, String) {
            journal
                .connection
                .query_row(
                    "SELECT readAtMs, sourceOperationId
                     FROM library_core_feed_item_read_state WHERE entityId = ?1;",
                    params![entity],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .expect("read state row")
        };

        let first = transaction(
            "tx:mmm",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[(entity, read_at)],
        );
        journal
            .commit_read_transaction(&first, 1_000)
            .expect("commit first");
        assert_eq!(
            provenance(&journal),
            (read_at, "tx:mmm:member:0".to_string())
        );

        // Equal read time, HIGHER operation id. The value is already correct,
        // so provenance must not move.
        let higher = transaction(
            "tx:zzz",
            2,
            Some("tx:mmm:member:0"),
            &format!("{:064x}", 101),
            &[(entity, read_at)],
        );
        journal
            .commit_read_transaction(&higher, 2_000)
            .expect("commit higher");
        assert_eq!(
            provenance(&journal),
            (read_at, "tx:mmm:member:0".to_string()),
            "a higher operation id must not claim provenance at equal read time"
        );

        // Equal read time, LOWER operation id. Provenance moves, value does not.
        let lower = transaction(
            "tx:aaa",
            3,
            Some("tx:zzz:member:0"),
            &format!("{:064x}", 102),
            &[(entity, read_at)],
        );
        journal
            .commit_read_transaction(&lower, 3_000)
            .expect("commit lower");
        assert_eq!(
            provenance(&journal),
            (read_at, "tx:aaa:member:0".to_string()),
            "a lower operation id must take provenance at equal read time"
        );

        // Positive control for the algebra itself, kept separate on purpose: a
        // strictly earlier read time wins regardless of operation id ordering.
        let earlier = transaction(
            "tx:zzy",
            4,
            Some("tx:aaa:member:0"),
            &format!("{:064x}", 103),
            &[(entity, read_at - 1)],
        );
        journal
            .commit_read_transaction(&earlier, 4_000)
            .expect("commit earlier");
        assert_eq!(
            provenance(&journal),
            (read_at - 1, "tx:zzy:member:0".to_string()),
            "the minimum rule decides the value independently of the tie-break"
        );
    }

    #[test]
    fn enrollment_and_response_loss_retry_are_idempotent() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        let first = journal.enroll_actor(&enrollment).expect("enroll actor");
        let retry = journal.enroll_actor(&enrollment).expect("retry enrollment");
        assert_eq!(first, retry);

        journal
            .connection
            .execute(
                "INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 7, 1, 1, ?1, 2, 2, '{}', 1, 1);",
                params![digest("a")],
            )
            .expect("install active product state");
        for entity_id in ["rss:item:1", "rss:item:2"] {
            journal
                .connection
                .execute(
                    "INSERT INTO library_core_feed_items (
                       globalId, readAt, payloadJson, updatedAtMs
                     ) VALUES (?1, NULL, ?2, 1);",
                    params![
                        entity_id,
                        format!("{{\"globalId\":\"{entity_id}\",\"userState\":{{}}}}")
                    ],
                )
                .expect("install product feed item");
        }

        let verified = transaction(
            "tx:read:one",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900), ("rss:item:2", 901)],
        );
        let receipt = journal
            .commit_read_transaction(&verified, 1_100)
            .expect("commit transaction");
        let replay = journal
            .commit_read_transaction(&verified, 9_999)
            .expect("response-loss retry");
        assert_eq!(receipt, replay);
        assert_eq!(receipt.first_ingest_sequence, 1);
        let product_rows = journal
            .connection
            .prepare(
                "SELECT readAt, json_extract(payloadJson, '$.userState.readAt'),
                        updatedAtMs
                 FROM library_core_feed_items ORDER BY globalId COLLATE BINARY;",
            )
            .expect("prepare product read-state query")
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .expect("query product read state")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect product read state");
        assert_eq!(product_rows, vec![(900, 900, 1_100), (901, 901, 1_100)]);
        assert_eq!(
            journal
                .connection
                .query_row(
                    "SELECT revision FROM library_core_desktop_state WHERE singletonId = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("read product revision"),
            8,
            "one accepted transaction advances the product revision exactly once",
        );
        assert_eq!(receipt.last_ingest_sequence, 2);
        assert_eq!(receipt.previous_revision, 0);
        assert_eq!(receipt.committed_revision, 1);
        let late_enrollment_retry = journal
            .enroll_actor(&enrollment)
            .expect("enrollment retry after actor progress");
        assert_eq!(late_enrollment_retry.next_sequence, 3);
        assert_eq!(
            late_enrollment_retry.previous_operation_id.as_deref(),
            Some("tx:read:one:member:1")
        );

        let counts: (i64, i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_actor_enrollment_outbox),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'projectionRevision'),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'nextIngestSequence'),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'materializerIngestSequence');",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("counts");
        assert_eq!(counts, (1, 2, 2, 1, 1, 3, 2));
        let ingest_sequences: Vec<i64> = {
            let mut statement = journal
                .connection
                .prepare(
                    "SELECT ingestSequence FROM library_core_operations
                     ORDER BY ingestSequence;",
                )
                .expect("prepare ingest query");
            statement
                .query_map([], |row| row.get(0))
                .expect("query ingest sequences")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect ingest sequences")
        };
        assert_eq!(ingest_sequences, vec![1, 2]);
        let queued_envelopes: Vec<String> = {
            let mut statement = journal
                .connection
                .prepare(
                    "SELECT operation.canonicalEnvelopeJson
                     FROM library_core_replication_outbox AS outbox
                     JOIN library_core_operations AS operation
                       ON operation.operationId = outbox.operationId
                     ORDER BY operation.ingestSequence;",
                )
                .expect("prepare outbox join");
            statement
                .query_map([], |row| row.get(0))
                .expect("query queued envelopes")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect queued envelopes")
        };
        assert_eq!(
            queued_envelopes,
            verified
                .members
                .iter()
                .map(|member| member.canonical_envelope_json.clone())
                .collect::<Vec<_>>()
        );
        let queued_enrollment: String = journal
            .connection
            .query_row(
                "SELECT actor.canonicalEnrollmentCertificateJson
                 FROM library_core_actor_enrollment_outbox AS outbox
                 JOIN library_core_actors AS actor
                   ON actor.enrollmentOperationId = outbox.enrollmentOperationId;",
                [],
                |row| row.get(0),
            )
            .expect("queued enrollment certificate");
        assert_eq!(
            queued_enrollment,
            enrollment.canonical_enrollment_certificate_json
        );
    }

    #[test]
    fn user_state_assignment_materializes_once_and_replay_is_idempotent() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 7, 1, 1, '{}', 1, 1, '{{}}', 1, 1);
                 INSERT INTO library_core_feed_items (
                   globalId, saved, archived, liked, payloadJson, updatedAtMs
                 ) VALUES (
                   'rss:item:toggle', 0, 0, 0,
                   '{{"globalId":"rss:item:toggle","userState":{{}}}}', 1
                 );"#,
                digest("a")
            ))
            .expect("install product fixture");

        let verified = assignment_transaction(
            "tx:assignment:saved",
            1,
            None,
            &enrollment.actor_chain_genesis,
            "rss:item:toggle",
            "saved",
            true,
            900,
        );
        let receipt = journal
            .commit_read_transaction(&verified, 1_100)
            .expect("commit assignment");
        let replay = journal
            .commit_read_transaction(&verified, 9_999)
            .expect("replay assignment");
        assert_eq!(receipt, replay);

        let repeated_true = assignment_transaction(
            "tx:assignment:saved:repeat",
            2,
            Some(&verified.members[0].operation_id),
            &verified.members[0].actor_chain_digest,
            "rss:item:toggle",
            "saved",
            true,
            950,
        );
        journal
            .commit_read_transaction(&repeated_true, 1_200)
            .expect("commit repeated true assignment");

        let state: (i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT saved, archived,
                        json_extract(payloadJson, '$.userState.saved'),
                        updatedAtMs,
                        (SELECT revision FROM library_core_desktop_state
                         WHERE singletonId = 1)
                 FROM library_core_feed_items WHERE globalId = 'rss:item:toggle';",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read materialized toggle");
        assert_eq!(state, (1, 0, 1, 1_100, 8));
        assert_eq!(
            journal
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM library_core_replication_outbox;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("count replication outbox"),
            2
        );
        assert_eq!(
            journal
                .intent_results_for_transaction(&verified.transaction_id)
                .expect("read accepted result")
                .len(),
            1
        );
    }

    #[test]
    fn feed_item_remove_commits_tombstone_receipt_and_outbox_atomically() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(&format!(
                r#"INSERT INTO library_core_desktop_state (
                   singletonId, active, revision, sourceGeneration,
                   sourceRevision, sourceDigest, expectedItemCount,
                   importedItemCount, shellJson, startedAtMs, activatedAtMs
                 ) VALUES (1, 1, 4, 1, 1, '{}', 1, 1, '{{}}', 1, 1);
                 INSERT INTO library_core_feed_items (
                   globalId, saved, archived, liked, payloadJson, updatedAtMs
                 ) VALUES (
                   'rss:item:remove', 0, 0, 0,
                   '{{"globalId":"rss:item:remove","userState":{{}}}}', 1
                 );"#,
                digest("b")
            ))
            .expect("install product fixture");

        let verified = removal_transaction(
            "tx:remove:item",
            1,
            None,
            &enrollment.actor_chain_genesis,
            "rss:item:remove",
            1_500,
        );
        journal
            .commit_read_transaction(&verified, 1_600)
            .expect("commit removal");

        let state: (i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT deletedAt, updatedAtMs,
                        (SELECT revision FROM library_core_desktop_state WHERE singletonId = 1),
                        (SELECT COUNT(*) FROM library_core_replication_outbox)
                 FROM library_core_feed_items WHERE globalId = 'rss:item:remove';",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read tombstone state");
        assert_eq!(state, (1_500, 1_600, 5, 1));
        assert_eq!(
            journal
                .connection
                .query_row(
                    "SELECT status FROM library_core_intent_result_outbox;",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("read acceptance receipt"),
            "accepted"
        );
    }

    #[test]
    fn operation_outbox_pages_by_ingest_sequence_and_byte_budget() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let verified = transaction(
            "tx:read:outbox-page",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[
                ("rss:item:outbox-1", 901),
                ("rss:item:outbox-2", 902),
                ("rss:item:outbox-3", 903),
            ],
        );
        journal
            .commit_read_transaction(&verified, 1_100)
            .expect("commit transaction");

        assert!(matches!(
            journal.operation_outbox_page(0, 2),
            Err(JournalError::InvalidVerifiedInput {
                field: "outbox_maximum_entries"
            })
        ));
        let first = journal
            .operation_outbox_page(0, 3)
            .expect("complete transaction page");
        assert_eq!(first.entries.len(), 3);
        assert_eq!(
            first
                .entries
                .iter()
                .map(|entry| entry.ingest_sequence)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            first
                .entries
                .iter()
                .map(|entry| entry.canonical_envelope_json.as_str())
                .collect::<Vec<_>>(),
            verified.members[..]
                .iter()
                .map(|member| member.canonical_envelope_json.as_str())
                .collect::<Vec<_>>()
        );
        assert_eq!(first.next_after_ingest_sequence, Some(3));
        assert!(!first.has_more);

        let first_entry_bytes = verified.members[0].canonical_envelope_json.len();
        assert!(matches!(
            journal.operation_outbox_page_with_budget(0, 3, first_entry_bytes),
            Err(JournalError::InvalidVerifiedInput {
                field: "outbox_transaction_bytes"
            })
        ));
    }

    #[test]
    fn enrollment_outbox_keyset_preserves_equal_timestamps() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let first_actor = actor_variant("8", "page-a");
        let second_actor = actor_variant("9", "page-b");
        journal
            .enroll_actor(&first_actor)
            .expect("enroll first actor");
        journal
            .enroll_actor(&second_actor)
            .expect("enroll second actor");

        let first = journal
            .enrollment_outbox_page(None, 1)
            .expect("first enrollment page");
        assert_eq!(first.entries.len(), 1);
        assert_eq!(
            first.entries[0].canonical_enrollment_certificate_json,
            first_actor.canonical_enrollment_certificate_json
        );
        assert!(first.has_more);

        let second = journal
            .enrollment_outbox_page(first.next_cursor.as_ref(), 1)
            .expect("second enrollment page");
        assert_eq!(second.entries.len(), 1);
        assert_eq!(
            second.entries[0].canonical_enrollment_certificate_json,
            second_actor.canonical_enrollment_certificate_json
        );
        assert!(!second.has_more);

        let byte_bounded = journal
            .enrollment_outbox_page_with_budget(
                None,
                2,
                first_actor.canonical_enrollment_certificate_json.len(),
            )
            .expect("byte-bounded enrollment page");
        assert_eq!(byte_bounded.entries.len(), 1);
        assert!(byte_bounded.has_more);
    }

    #[test]
    fn outbox_queries_use_index_order_without_temporary_sorts() {
        let journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        for (sql, params, expected_index) in [
            (
                OPERATION_OUTBOX_PAGE_SQL,
                vec![rusqlite::types::Value::Integer(0), 2.into()],
                "library_core_replication_outbox_order",
            ),
            (
                ENROLLMENT_OUTBOX_PAGE_SQL,
                vec![
                    rusqlite::types::Value::Integer(-1),
                    rusqlite::types::Value::Text(String::new()),
                    2.into(),
                ],
                "library_core_actor_enrollment_outbox_order",
            ),
        ] {
            let mut statement = journal
                .connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare query plan");
            let details = statement
                .query_map(rusqlite::params_from_iter(params), |row| {
                    row.get::<_, String>(3)
                })
                .expect("query plan")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect query plan");
            assert!(
                details
                    .iter()
                    .all(|detail| !detail.contains("USE TEMP B-TREE")),
                "outbox keyset query must not sort an unbounded table: {details:?}"
            );
            assert!(
                details.iter().any(|detail| detail.contains(expected_index)),
                "outbox keyset query must use {expected_index}: {details:?}"
            );
        }
    }

    #[test]
    fn response_loss_retry_returns_the_exact_receipt_after_reopen() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("library-core.sqlite");
        let enrollment = actor();
        let verified = transaction(
            "tx:read:reopen-retry",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:reopen", 900)],
        );
        let receipt = {
            let mut journal = LibraryCoreJournal::open(&path).expect("open journal");
            install_actor_authority(&mut journal);
            journal.enroll_actor(&enrollment).expect("enroll actor");
            journal
                .commit_read_transaction(&verified, 1_100)
                .expect("commit transaction")
        };

        let mut reopened = LibraryCoreJournal::open(&path).expect("reopen journal");
        let retry = reopened
            .commit_read_transaction(&verified, 9_999)
            .expect("response-loss retry after reopen");
        assert_eq!(retry, receipt);
        assert_eq!(retry.first_ingest_sequence, 1);
        assert_eq!(retry.last_ingest_sequence, 1);
        let results = reopened
            .intent_results_for_transaction(&verified.transaction_id)
            .expect("read durable acceptance result");
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].intent_operation_id,
            verified.members[0].operation_id
        );
        assert_eq!(results[0].result_sequence, 1);
        assert_eq!(results[0].status, "accepted");
        assert_eq!(results[0].provider_receipt_digest, None);
        let pending = reopened
            .pending_intent_results(&verified.library_id, &verified.epoch_id, 256)
            .expect("read pending results after reopen");
        assert_eq!(pending, results);
        reopened
            .acknowledge_intent_results(
                &[results[0].result_operation_id.clone()],
                results[0].enqueued_at_ms,
            )
            .expect("acknowledge published result");
        assert!(reopened
            .pending_intent_results(&verified.library_id, &verified.epoch_id, 256)
            .expect("read results after acknowledgement")
            .is_empty());
        let counts: (i64, i64, i64, i64) = reopened
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("row counts");
        assert_eq!(counts, (1, 1, 1, 1));
    }

    #[test]
    fn result_outbox_failure_rolls_back_the_canonical_intent() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_intent_result
                 BEFORE INSERT ON library_core_intent_result_outbox
                 BEGIN
                   SELECT RAISE(ABORT, 'injected intent result failure');
                 END;",
            )
            .expect("install result failpoint");
        let verified = transaction(
            "tx:read:result-failure",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:result-failure", 900)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::Sql(_))
        ));
        let counts: (i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("atomic row counts");
        assert_eq!(counts, (0, 0, 0, 0));
    }

    #[test]
    fn retired_cloud_writer_cannot_enroll_or_commit_authoritative_operations() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        journal
            .connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(singletonId) DO UPDATE SET
                   localWriterId = excluded.localWriterId,
                   activeWriterId = excluded.activeWriterId,
                   storageEpoch = excluded.storageEpoch,
                   controlRevision = excluded.controlRevision,
                   verifiedAtMs = excluded.verifiedAtMs;",
                params![digest("8"), digest("9"), digest("a"), "etag-retired", 1_000],
            )
            .expect("record retired writer admission");

        let enrollment = actor();
        assert!(matches!(
            journal.enroll_actor(&enrollment),
            Err(JournalError::StaleAuthority { .. })
        ));

        journal
            .connection
            .execute(
                "UPDATE library_core_cloud_writer_admission
                 SET activeWriterId = localWriterId WHERE singletonId = 1;",
                [],
            )
            .expect("restore writer admission");
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute(
                "UPDATE library_core_cloud_writer_admission
                 SET activeWriterId = ?1 WHERE singletonId = 1;",
                params![digest("9")],
            )
            .expect("retire writer after enrollment");

        let verified = transaction(
            "tx:read:retired-writer",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:retired-writer", 900)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::StaleAuthority { .. })
        ));
        let counts: (i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox);",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("authoritative row counts");
        assert_eq!(counts, (0, 0, 0));
    }

    #[test]
    fn capability_change_after_verification_is_rechecked_before_any_commit_write() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let verified = transaction(
            "tx:read:capability-race",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:capability-race", 900)],
        );
        journal
            .connection
            .execute(
                "UPDATE library_core_actor_capability_state
                    SET retired = 1, retirementCertificateDigest = ?1
                  WHERE actorId = ?2;",
                params![digest("9"), enrollment.actor_id],
            )
            .expect("retire actor after verification");

        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::InvalidVerifiedInput {
                field: "actor_capability_changed"
            })
        ));
        let state: (i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("unchanged authoritative state");
        assert_eq!(state, (0, 0, 0, 0, 1, 0));
    }

    #[test]
    fn capability_retirement_after_exact_replay_verification_denies_receipt() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let verified = transaction(
            "tx:read:capability-replay-race",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:capability-replay-race", 900)],
        );
        journal
            .commit_read_transaction(&verified, 1_100)
            .expect("commit before retirement");
        journal
            .connection
            .execute(
                "UPDATE library_core_actor_capability_state
                    SET retired = 1, retirementCertificateDigest = ?1
                  WHERE actorId = ?2;",
                params![digest("9"), enrollment.actor_id],
            )
            .expect("retire actor after exact replay verification");
        let state_before: (i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("state before denied receipt retrieval");

        assert!(matches!(
            journal.commit_read_transaction(&verified, 9_999),
            Err(JournalError::InvalidVerifiedInput {
                field: "actor_capability_changed"
            })
        ));
        let state_after: (i64, i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT COUNT(*) FROM library_core_intent_result_outbox),
                   (SELECT nextSequence FROM library_core_actors WHERE actorId = ?1),
                   (SELECT integerValue FROM library_core_meta
                     WHERE key = 'projectionRevision');",
                [&enrollment.actor_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("state after denied receipt retrieval");
        assert_eq!(state_after, state_before);
    }

    #[test]
    fn missing_cloud_writer_admission_cannot_enroll_or_commit() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        let enrollment = actor();
        journal
            .install_fixture_authority(
                &enrollment.library_id,
                enrollment.epoch,
                &enrollment.epoch_id,
            )
            .expect("install authority without admission");
        journal
            .connection
            .execute("DELETE FROM library_core_cloud_writer_admission;", [])
            .expect("remove fixture admission");

        assert!(matches!(
            journal.enroll_actor(&enrollment),
            Err(JournalError::StaleAuthority { .. })
        ));
        journal
            .connection
            .execute(
                "INSERT INTO library_core_cloud_writer_admission (
                   singletonId, localWriterId, activeWriterId, storageEpoch,
                   controlRevision, verifiedAtMs
                 ) VALUES (1, ?1, ?1, ?2, 'temporary-admission', 1);",
                params![digest("8"), enrollment.epoch_id],
            )
            .expect("install temporary admission");
        journal
            .enroll_actor(&enrollment)
            .expect("enroll admitted actor");
        journal
            .connection
            .execute("DELETE FROM library_core_cloud_writer_admission;", [])
            .expect("remove admission");
        let verified = transaction(
            "tx:read:missing-admission",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:missing-admission", 900)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::StaleAuthority { .. })
        ));
        let operation_count: i64 = journal
            .connection
            .query_row("SELECT COUNT(*) FROM library_core_operations;", [], |row| {
                row.get(0)
            })
            .expect("count operations");
        assert_eq!(operation_count, 0);
    }

    #[test]
    fn authority_epoch_change_fences_uncommitted_old_epoch_operations() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let verified = transaction(
            "tx:read:stale-epoch",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:stale", 900)],
        );

        journal
            .install_fixture_authority(&enrollment.library_id, 2, &digest("9"))
            .expect("advance authority epoch");
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::StaleAuthority { .. })
        ));
        let counts: (i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'projectionRevision');",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("old epoch counts");
        assert_eq!(counts, (0, 0, 0));
    }

    #[test]
    fn commit_is_atomic_across_journal_projection_outbox_tip_and_receipt() {
        let mut enrollment_journal =
            LibraryCoreJournal::open_in_memory().expect("open enrollment journal");
        install_actor_authority(&mut enrollment_journal);
        enrollment_journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_enrollment_outbox
                 BEFORE INSERT ON library_core_actor_enrollment_outbox
                 BEGIN
                   SELECT RAISE(ABORT, 'injected enrollment outbox failure');
                 END;",
            )
            .expect("install enrollment failpoint");
        assert!(matches!(
            enrollment_journal.enroll_actor(&actor()),
            Err(JournalError::Sql(_))
        ));
        let enrollment_rows: i64 = enrollment_journal
            .connection
            .query_row("SELECT COUNT(*) FROM library_core_actors;", [], |row| {
                row.get(0)
            })
            .expect("enrollment row count");
        assert_eq!(enrollment_rows, 0);

        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_second_outbox
                 BEFORE INSERT ON library_core_replication_outbox
                 WHEN (SELECT COUNT(*) FROM library_core_replication_outbox) = 1
                 BEGIN
                   SELECT RAISE(ABORT, 'injected outbox failure');
                 END;",
            )
            .expect("install failpoint");
        let verified = transaction(
            "tx:read:rollback",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900), ("rss:item:2", 901)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::Sql(_))
        ));

        for table in [
            "library_core_transactions",
            "library_core_operations",
            "library_core_feed_item_read_state",
            "library_core_replication_outbox",
        ] {
            let count: i64 = journal
                .connection
                .query_row(&format!("SELECT COUNT(*) FROM {table};"), [], |row| {
                    row.get(0)
                })
                .expect("table count");
            assert_eq!(count, 0, "{table} must roll back");
        }
        let state = journal
            .connection
            .query_row(
                "SELECT nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors WHERE actorId = ?1;",
                params![enrollment.actor_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("actor state");
        assert_eq!(state, (1, None, enrollment.actor_chain_genesis));
    }

    #[test]
    fn failure_after_actor_tip_update_rolls_back_every_authoritative_write() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        journal
            .connection
            .execute_batch(
                "CREATE TEMP TRIGGER reject_projection_revision
                 BEFORE UPDATE ON library_core_meta
                 WHEN OLD.key = 'projectionRevision'
                 BEGIN
                   SELECT RAISE(ABORT, 'injected projection revision failure');
                 END;",
            )
            .expect("install late failpoint");
        let verified = transaction(
            "tx:read:late-rollback",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:late-rollback", 900)],
        );
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::Sql(_))
        ));

        let counts: (i64, i64, i64, i64, i64) = journal
            .connection
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM library_core_transactions),
                   (SELECT COUNT(*) FROM library_core_operations),
                   (SELECT COUNT(*) FROM library_core_feed_item_read_state),
                   (SELECT COUNT(*) FROM library_core_replication_outbox),
                   (SELECT integerValue FROM library_core_meta
                    WHERE key = 'projectionRevision');",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("post-rollback counts");
        assert_eq!(counts, (0, 0, 0, 0, 0));
        let state = journal
            .connection
            .query_row(
                "SELECT nextSequence, previousOperationId, previousChainDigest
                 FROM library_core_actors WHERE actorId = ?1;",
                params![enrollment.actor_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("actor state");
        assert_eq!(state, (1, None, enrollment.actor_chain_genesis));
    }

    #[test]
    fn monotone_read_projection_survives_later_and_equal_assignments() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let first = transaction(
            "tx:read:first",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900)],
        );
        journal
            .commit_read_transaction(&first, 1_100)
            .expect("first read");
        let first_member = &first.members[0];

        let later = transaction(
            "tx:read:later",
            2,
            Some(&first_member.operation_id),
            &first_member.actor_chain_digest,
            &[("rss:item:1", 950)],
        );
        journal
            .commit_read_transaction(&later, 1_200)
            .expect("later read");
        let state = journal
            .read_state("rss:item:1")
            .expect("read state")
            .expect("materialized row");
        assert_eq!(state.read_at_ms, 900);
        assert_eq!(state.source_operation_id, first_member.operation_id);

        let earlier = transaction(
            "tx:read:earlier",
            3,
            Some(&later.members[0].operation_id),
            &later.members[0].actor_chain_digest,
            &[("rss:item:1", 800)],
        );
        journal
            .commit_read_transaction(&earlier, 1_300)
            .expect("earlier read");
        assert_eq!(
            journal
                .read_state("rss:item:1")
                .expect("read state")
                .expect("materialized row")
                .read_at_ms,
            800
        );
    }

    #[test]
    fn stale_tips_replays_and_unknown_causal_tips_fail_closed() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let first = transaction(
            "tx:read:first",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900)],
        );
        journal
            .commit_read_transaction(&first, 1_100)
            .expect("first transaction");

        let conflicting_replay = VerifiedOperationTransaction {
            transaction_digest: digest("8"),
            ..first.clone()
        };
        assert!(matches!(
            journal.commit_read_transaction(&conflicting_replay, 1_200),
            Err(JournalError::TransactionReplayConflict { .. })
        ));
        assert!(matches!(
            journal.commit_read_transaction(
                &transaction(
                    "tx:read:stale",
                    1,
                    None,
                    &enrollment.actor_chain_genesis,
                    &[("rss:item:2", 901)],
                ),
                1_200,
            ),
            Err(JournalError::StaleActorTip { .. })
        ));

        let first_member = &first.members[0];
        let mut unknown = transaction(
            "tx:read:unknown-causal",
            2,
            Some(&first_member.operation_id),
            &first_member.actor_chain_digest,
            &[("rss:item:2", 901)],
        );
        unknown.members[0].causal_tips.push(VerifiedCausalTip {
            actor_id: digest("9"),
            sequence: 1,
            operation_id: "op:missing".to_string(),
            chain_digest: digest("a"),
        });
        assert!(matches!(
            journal.commit_read_transaction(&unknown, 1_200),
            Err(JournalError::UnknownCausalTip { .. })
        ));
        unknown.members[0].causal_tips[0] = VerifiedCausalTip {
            actor_id: enrollment.actor_id,
            sequence: 1,
            operation_id: first_member.operation_id.clone(),
            chain_digest: first_member.actor_chain_digest.clone(),
        };
        journal
            .commit_read_transaction(&unknown, 1_200)
            .expect("known exact causal tip");
    }

    #[test]
    fn causal_tips_cannot_cross_library_or_epoch_authority() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let local_enrollment = actor();
        journal
            .enroll_actor(&local_enrollment)
            .expect("enroll local actor");

        let mut foreign_library_enrollment = local_enrollment.clone();
        foreign_library_enrollment.library_id = digest("b");
        foreign_library_enrollment.enrollment_operation_id =
            "op:actor:enroll:foreign-library".to_string();
        foreign_library_enrollment.enrollment_certificate_digest = digest("c");
        foreign_library_enrollment.capability =
            actor_capability::ActorCapabilityState::legacy_editor(
                foreign_library_enrollment
                    .enrollment_certificate_digest
                    .clone(),
                foreign_library_enrollment.enrolled_at_ms,
            );
        journal
            .install_fixture_authority(
                &foreign_library_enrollment.library_id,
                foreign_library_enrollment.epoch,
                &foreign_library_enrollment.epoch_id,
            )
            .expect("install foreign-library authority");
        journal
            .enroll_actor(&foreign_library_enrollment)
            .expect("enroll foreign-library actor");
        let mut foreign_library_transaction = transaction(
            "tx:read:foreign-library",
            1,
            None,
            &foreign_library_enrollment.actor_chain_genesis,
            &[("rss:item:foreign-library", 900)],
        );
        foreign_library_transaction.library_id = foreign_library_enrollment.library_id.clone();
        foreign_library_transaction.actor_capability =
            foreign_library_enrollment.capability.clone();
        journal
            .commit_read_transaction(&foreign_library_transaction, 1_100)
            .expect("commit foreign-library transaction");

        let foreign_library_member = &foreign_library_transaction.members[0];
        let mut local_with_foreign_library_tip = transaction(
            "tx:read:local-with-foreign-library-tip",
            1,
            None,
            &local_enrollment.actor_chain_genesis,
            &[("rss:item:local", 901)],
        );
        local_with_foreign_library_tip.members[0]
            .causal_tips
            .push(VerifiedCausalTip {
                actor_id: foreign_library_enrollment.actor_id.clone(),
                sequence: foreign_library_member.actor_sequence,
                operation_id: foreign_library_member.operation_id.clone(),
                chain_digest: foreign_library_member.actor_chain_digest.clone(),
            });
        assert!(matches!(
            journal.commit_read_transaction(&local_with_foreign_library_tip, 1_200),
            Err(JournalError::UnknownCausalTip { .. })
        ));

        let mut epoch_journal = LibraryCoreJournal::open_in_memory().expect("open epoch journal");
        install_actor_authority(&mut epoch_journal);
        let epoch_one_enrollment = actor();
        epoch_journal
            .enroll_actor(&epoch_one_enrollment)
            .expect("enroll epoch-one actor");
        let epoch_one_transaction = transaction(
            "tx:read:epoch-one-causal-source",
            1,
            None,
            &epoch_one_enrollment.actor_chain_genesis,
            &[("rss:item:epoch-one", 902)],
        );
        epoch_journal
            .commit_read_transaction(&epoch_one_transaction, 1_300)
            .expect("commit epoch-one transaction");

        let mut foreign_epoch_enrollment = local_enrollment.clone();
        foreign_epoch_enrollment.epoch = 2;
        foreign_epoch_enrollment.epoch_id = digest("d");
        foreign_epoch_enrollment.enrollment_operation_id =
            "op:actor:enroll:foreign-epoch".to_string();
        foreign_epoch_enrollment.enrollment_certificate_digest = digest("e");
        foreign_epoch_enrollment.capability = actor_capability::ActorCapabilityState::legacy_editor(
            foreign_epoch_enrollment
                .enrollment_certificate_digest
                .clone(),
            foreign_epoch_enrollment.enrolled_at_ms,
        );
        epoch_journal
            .install_fixture_authority(
                &foreign_epoch_enrollment.library_id,
                foreign_epoch_enrollment.epoch,
                &foreign_epoch_enrollment.epoch_id,
            )
            .expect("install epoch-two authority");
        epoch_journal
            .enroll_actor(&foreign_epoch_enrollment)
            .expect("enroll foreign-epoch actor");
        let mut epoch_two_transaction = transaction(
            "tx:read:epoch-two-with-epoch-one-tip",
            1,
            None,
            &foreign_epoch_enrollment.actor_chain_genesis,
            &[("rss:item:epoch-two", 903)],
        );
        epoch_two_transaction.epoch = foreign_epoch_enrollment.epoch;
        epoch_two_transaction.epoch_id = foreign_epoch_enrollment.epoch_id;
        epoch_two_transaction.actor_capability = foreign_epoch_enrollment.capability.clone();
        let epoch_one_member = &epoch_one_transaction.members[0];
        epoch_two_transaction.members[0]
            .causal_tips
            .push(VerifiedCausalTip {
                actor_id: epoch_one_enrollment.actor_id,
                sequence: epoch_one_member.actor_sequence,
                operation_id: epoch_one_member.operation_id.clone(),
                chain_digest: epoch_one_member.actor_chain_digest.clone(),
            });
        assert!(matches!(
            epoch_journal.commit_read_transaction(&epoch_two_transaction, 1_400),
            Err(JournalError::UnknownCausalTip { .. })
        ));
    }

    #[test]
    fn actor_sequence_restarts_are_scoped_to_the_authority_epoch() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let first_enrollment = actor();
        journal
            .enroll_actor(&first_enrollment)
            .expect("enroll first epoch actor");
        journal
            .commit_read_transaction(
                &transaction(
                    "tx:read:epoch-one",
                    1,
                    None,
                    &first_enrollment.actor_chain_genesis,
                    &[("rss:item:epoch-one", 900)],
                ),
                1_100,
            )
            .expect("commit first epoch operation");

        let second_enrollment = VerifiedActorEnrollment {
            epoch: 2,
            epoch_id: digest("8"),
            enrollment_operation_id: "op:actor:enroll:epoch-two".to_string(),
            enrollment_certificate_digest: digest("9"),
            actor_chain_genesis: digest("a"),
            enrolled_at_ms: 1_200,
            capability: actor_capability::ActorCapabilityState::legacy_editor(digest("9"), 1_200),
            ..first_enrollment
        };
        journal
            .install_fixture_authority(
                &second_enrollment.library_id,
                second_enrollment.epoch,
                &second_enrollment.epoch_id,
            )
            .expect("install second authority epoch");
        journal
            .enroll_actor(&second_enrollment)
            .expect("enroll same actor in second epoch");
        let second_transaction = VerifiedOperationTransaction {
            epoch: second_enrollment.epoch,
            epoch_id: second_enrollment.epoch_id.clone(),
            actor_capability: second_enrollment.capability.clone(),
            ..transaction(
                "tx:read:epoch-two",
                1,
                None,
                &second_enrollment.actor_chain_genesis,
                &[("rss:item:epoch-two", 901)],
            )
        };
        journal
            .commit_read_transaction(&second_transaction, 1_300)
            .expect("commit second epoch sequence one");

        let sequences: Vec<(i64, String, i64)> = {
            let mut statement = journal
                .connection
                .prepare(
                    "SELECT epoch, epochId, actorSequence
                     FROM library_core_operations
                     WHERE actorId = ?1
                     ORDER BY epoch;",
                )
                .expect("prepare actor sequence query");
            statement
                .query_map(params![second_enrollment.actor_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .expect("query actor sequences")
                .collect::<SqlResult<Vec<_>>>()
                .expect("collect actor sequences")
        };
        assert_eq!(
            sequences,
            vec![(1, digest("2"), 1), (2, second_enrollment.epoch_id, 1)]
        );
    }

    #[test]
    fn rejects_cross_runtime_unsafe_integers_before_sqlite() {
        let mut journal = LibraryCoreJournal::open_in_memory().expect("open journal");
        install_actor_authority(&mut journal);
        let mut enrollment = actor();
        enrollment.enrolled_at_ms = MAX_SAFE_INTEGER + 1;
        assert!(matches!(
            journal.enroll_actor(&enrollment),
            Err(JournalError::InvalidVerifiedInput {
                field: "enrolled_at_ms"
            })
        ));

        let enrollment = actor();
        journal.enroll_actor(&enrollment).expect("enroll actor");
        let mut verified = transaction(
            "tx:read:unsafe",
            1,
            None,
            &enrollment.actor_chain_genesis,
            &[("rss:item:1", 900)],
        );
        verified.members[0].read_at_ms = Some(MAX_SAFE_INTEGER + 1);
        assert!(matches!(
            journal.commit_read_transaction(&verified, 1_100),
            Err(JournalError::InvalidVerifiedInput {
                field: "read_at_ms"
            })
        ));
    }

    #[test]
    fn opening_rejects_unversioned_or_future_schema() {
        let unversioned_directory = tempfile::tempdir().expect("unversioned directory");
        let unversioned_path = unversioned_directory.path().join("library-core.sqlite");
        let unversioned_connection = Connection::open(&unversioned_path).expect("unversioned file");
        unversioned_connection
            .execute_batch("CREATE TABLE unexpected (id INTEGER) STRICT;")
            .expect("unversioned table");
        drop(unversioned_connection);
        let unversioned_bytes = std::fs::read(&unversioned_path).expect("read unversioned file");
        assert!(matches!(
            LibraryCoreJournal::open(&unversioned_path),
            Err(JournalError::UnversionedSchemaPresent)
        ));
        assert_eq!(
            std::fs::read(&unversioned_path).expect("reread unversioned file"),
            unversioned_bytes
        );

        let future_directory = tempfile::tempdir().expect("future directory");
        let future_path = future_directory.path().join("library-core.sqlite");
        let future_connection = Connection::open(&future_path).expect("future file");
        future_connection
            .pragma_update(None, "application_id", AUTHORITATIVE_APPLICATION_ID)
            .expect("future application ID");
        future_connection
            .pragma_update(None, "user_version", 99)
            .expect("future version");
        drop(future_connection);
        let future_bytes = std::fs::read(&future_path).expect("read future file");
        assert!(matches!(
            LibraryCoreJournal::open(&future_path),
            Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual: 99
            })
        ));
        assert_eq!(
            std::fs::read(&future_path).expect("reread future file"),
            future_bytes
        );

        let mut unversioned = LibraryCoreJournal {
            connection: Connection::open_in_memory().expect("connection"),
        };
        unversioned
            .configure()
            .expect("configure unversioned connection");
        unversioned
            .connection
            .execute_batch("CREATE TABLE unexpected (id INTEGER) STRICT;")
            .expect("unversioned table");
        assert!(matches!(
            unversioned.migrate(),
            Err(JournalError::UnversionedSchemaPresent)
        ));

        let mut future = LibraryCoreJournal {
            connection: Connection::open_in_memory().expect("connection"),
        };
        future.configure().expect("configure future connection");
        future
            .connection
            .pragma_update(None, "user_version", 99)
            .expect("future version");
        assert!(matches!(
            future.migrate(),
            Err(JournalError::UnsupportedSchemaVersion {
                expected: AUTHORITATIVE_SCHEMA_VERSION,
                actual: 99
            })
        ));
    }
}
