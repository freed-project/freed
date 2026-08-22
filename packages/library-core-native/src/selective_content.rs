use crate::sqlite_contract_generated::{
    CONTENT_RANGE_MAXIMUM_APPEND_BYTES, SQLITE_CONTENT_WORK_PROGRAMS,
    SQLITE_LOCAL_MUTATION_PROGRAMS,
};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::{Read, Write};

const MAXIMUM_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentHydrationPolicyV1 {
    MetadataOnly,
    StreamOnDemand,
    PartialCache,
    CompleteCache,
    PinnedOffline,
    Excluded,
}

impl ContentHydrationPolicyV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::MetadataOnly => "metadata_only",
            Self::StreamOnDemand => "stream_on_demand",
            Self::PartialCache => "partial_cache",
            Self::CompleteCache => "complete_cache",
            Self::PinnedOffline => "pinned_offline",
            Self::Excluded => "excluded",
        }
    }
}

impl FromSql for ContentHydrationPolicyV1 {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "metadata_only" => Ok(Self::MetadataOnly),
            "stream_on_demand" => Ok(Self::StreamOnDemand),
            "partial_cache" => Ok(Self::PartialCache),
            "complete_cache" => Ok(Self::CompleteCache),
            "pinned_offline" => Ok(Self::PinnedOffline),
            "excluded" => Ok(Self::Excluded),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentPolicyMutationV1 {
    pub content_digest: String,
    pub policy: ContentHydrationPolicyV1,
    pub schema_version: u32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentPolicyMutationReceiptV1 {
    pub changed: bool,
    pub content_digest: String,
    pub content_revision: i64,
    pub policy: ContentHydrationPolicyV1,
    pub schema_version: u32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentEvictionRequestV1 {
    pub content_digest: String,
    pub evicted_at: i64,
    pub expected_last_accessed_at: Option<i64>,
    pub reason: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentEvictionReceiptV1 {
    pub changed: bool,
    pub content_digest: String,
    pub content_revision: i64,
    pub evicted_ranges: i64,
    pub released_bytes: i64,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentWorkSourceV1 {
    pub content_revision: i64,
    pub generation_id: String,
    pub source_revision: i64,
    pub transition_sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HydrationCandidateCursorV1 {
    pub content_digest: String,
    pub policy_priority: i64,
    pub policy_updated_at: i64,
    pub range_index: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HydrationCandidatePageRequestV1 {
    pub after: Option<HydrationCandidateCursorV1>,
    pub limit: i64,
    pub schema_version: u32,
    pub source: Option<ContentWorkSourceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HydrationCandidateV1 {
    pub byte_length: i64,
    pub byte_offset: i64,
    pub cloud_availability_commitment: String,
    pub content_digest: String,
    pub media_type: String,
    pub policy: ContentHydrationPolicyV1,
    pub policy_priority: i64,
    pub policy_updated_at: i64,
    pub range_content_digest: String,
    pub range_index: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HydrationCandidatePageV1 {
    pub next: Option<HydrationCandidateCursorV1>,
    pub rows: Vec<HydrationCandidateV1>,
    pub schema_version: u32,
    pub source: ContentWorkSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvictionCandidateCursorV1 {
    pub content_digest: String,
    pub last_accessed_at: i64,
    pub policy_priority: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvictionCandidatePageRequestV1 {
    pub after: Option<EvictionCandidateCursorV1>,
    pub limit: i64,
    pub not_accessed_after: i64,
    pub schema_version: u32,
    pub source: Option<ContentWorkSourceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvictionCandidateV1 {
    pub content_digest: String,
    pub hydration_state: ContentHydrationStateV1,
    pub last_accessed_at: i64,
    pub policy: ContentHydrationPolicyV1,
    pub policy_priority: i64,
    pub verified_bytes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvictionCandidatePageV1 {
    pub next: Option<EvictionCandidateCursorV1>,
    pub rows: Vec<EvictionCandidateV1>,
    pub schema_version: u32,
    pub source: ContentWorkSourceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentStateRequestV1 {
    pub content_digest: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentHydrationStateV1 {
    MetadataOnly,
    Streamable,
    PartiallyCached,
    FullyCached,
    PinnedOffline,
    Excluded,
    Unavailable,
    Corrupt,
}

impl FromSql for ContentHydrationStateV1 {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "metadata_only" => Ok(Self::MetadataOnly),
            "streamable" => Ok(Self::Streamable),
            "partially_cached" => Ok(Self::PartiallyCached),
            "fully_cached" => Ok(Self::FullyCached),
            "pinned_offline" => Ok(Self::PinnedOffline),
            "excluded" => Ok(Self::Excluded),
            "unavailable" => Ok(Self::Unavailable),
            "corrupt" => Ok(Self::Corrupt),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentAvailabilityV1 {
    pub complete_digest_verified_at: Option<i64>,
    pub hydration_state: ContentHydrationStateV1,
    pub last_accessed_at: i64,
    pub storage_kind: String,
    pub updated_at: i64,
    pub verified_bytes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentStateV1 {
    pub availability: Option<ContentAvailabilityV1>,
    pub byte_length: i64,
    pub content_digest: String,
    pub content_revision: i64,
    pub media_type: String,
    pub policy: ContentHydrationPolicyV1,
    pub policy_updated_at: Option<i64>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedContentRangePublicationV1 {
    pub byte_length: i64,
    pub content_digest: String,
    pub range_content_digest: String,
    pub range_index: i64,
    pub schema_version: u32,
    pub storage_key: String,
    pub storage_kind: String,
    pub verified_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedContentRangeReceiptV1 {
    pub changed: bool,
    pub content_digest: String,
    pub content_revision: i64,
    pub hydration_state: ContentHydrationStateV1,
    pub range_index: i64,
    pub schema_version: u32,
    pub verified_bytes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentRangePublicationRequestV1 {
    pub content_digest: String,
    pub range_index: i64,
    pub schema_version: u32,
    pub verified_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentRangeReadRequestV1 {
    pub accessed_at: i64,
    pub content_digest: String,
    pub maximum_bytes: i64,
    pub range_index: i64,
    pub range_offset: i64,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentRangeReadResponseV1 {
    pub bytes: Vec<u8>,
    pub content_digest: String,
    pub next_range_offset: i64,
    pub range_complete: bool,
    pub range_index: i64,
    pub range_offset: i64,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentCompletionRequestV1 {
    pub content_digest: String,
    pub schema_version: u32,
    pub verified_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentCompletionReceiptV1 {
    pub changed: bool,
    pub content_digest: String,
    pub content_revision: i64,
    pub hydration_state: ContentHydrationStateV1,
    pub schema_version: u32,
    pub verified_bytes: i64,
}

pub trait DurableContentRangeObjectV1: Write {
    fn discard(&mut self) -> std::io::Result<()>;
    fn make_durable(&mut self) -> std::io::Result<()>;
    fn storage_key(&self) -> &str;
    fn storage_kind(&self) -> &str;
}

#[derive(Debug)]
pub enum SelectiveContentError {
    Invalid(&'static str),
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for SelectiveContentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::Io(error) => write!(formatter, "selective content I/O failure: {error}"),
            Self::Sqlite(error) => write!(formatter, "SQLite selective content failure: {error}"),
        }
    }
}

impl std::error::Error for SelectiveContentError {}

impl From<rusqlite::Error> for SelectiveContentError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<std::io::Error> for SelectiveContentError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn content_work_source_v1(
    connection: &Connection,
    expected: Option<&ContentWorkSourceV1>,
) -> Result<ContentWorkSourceV1, SelectiveContentError> {
    let (generation_id, source_revision, change_revision, content_revision): (
        String,
        i64,
        i64,
        i64,
    ) = connection.query_row(
        "SELECT generation.generation_id, meta.source_revision, change.revision, content.revision
             FROM library_meta AS meta
             JOIN library_materialization_generation AS generation ON generation.singleton_id = 1
             JOIN library_change_state AS change ON change.singleton_id = 1
             JOIN library_device_content_state AS content ON content.singleton_id = 1
             WHERE meta.singleton_id = 1;",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    if source_revision != change_revision {
        return Err(SelectiveContentError::Invalid(
            "content work source is inconsistent",
        ));
    }
    let source = ContentWorkSourceV1 {
        content_revision,
        generation_id,
        source_revision,
        transition_sequence: source_revision,
    };
    if expected.is_some_and(|expected| expected != &source) {
        return Err(SelectiveContentError::Invalid(
            "content work source is stale",
        ));
    }
    Ok(source)
}

pub fn page_hydration_candidates_v1(
    connection: &Connection,
    request: &HydrationCandidatePageRequestV1,
) -> Result<HydrationCandidatePageV1, SelectiveContentError> {
    if request.schema_version != 1
        || !(1..=128).contains(&request.limit)
        || (request.after.is_some() && request.source.is_none())
        || request.after.as_ref().is_some_and(|cursor| {
            !valid_digest(&cursor.content_digest)
                || !(0..=1).contains(&cursor.policy_priority)
                || !(0..=MAXIMUM_SAFE_INTEGER).contains(&cursor.policy_updated_at)
                || !(0..=MAXIMUM_SAFE_INTEGER).contains(&cursor.range_index)
        })
    {
        return Err(SelectiveContentError::Invalid(
            "hydration candidate page request is invalid",
        ));
    }
    let source = content_work_source_v1(connection, request.source.as_ref())?;
    let after = request.after.as_ref();
    let sql = SQLITE_CONTENT_WORK_PROGRAMS
        .iter()
        .find(|program| program.0 == "hydration_candidates_page_v1")
        .ok_or(SelectiveContentError::Invalid(
            "hydration candidate program is missing",
        ))?
        .1;
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement
        .query_map(
            params![
                after.map(|cursor| cursor.policy_priority),
                after.map(|cursor| cursor.policy_updated_at),
                after.map(|cursor| cursor.content_digest.as_str()),
                after.map(|cursor| cursor.range_index),
                request.limit + 1,
            ],
            |row| {
                Ok(HydrationCandidateV1 {
                    policy_priority: row.get(0)?,
                    policy_updated_at: row.get(1)?,
                    content_digest: row.get(2)?,
                    range_index: row.get(3)?,
                    byte_offset: row.get(4)?,
                    byte_length: row.get(5)?,
                    range_content_digest: row.get(6)?,
                    media_type: row.get(7)?,
                    policy: row.get(8)?,
                    cloud_availability_commitment: row.get(9)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = rows.len() > request.limit as usize;
    rows.truncate(request.limit as usize);
    let next = if has_more {
        rows.last().map(|row| HydrationCandidateCursorV1 {
            content_digest: row.content_digest.clone(),
            policy_priority: row.policy_priority,
            policy_updated_at: row.policy_updated_at,
            range_index: row.range_index,
        })
    } else {
        None
    };
    Ok(HydrationCandidatePageV1 {
        next,
        rows,
        schema_version: 1,
        source,
    })
}

pub fn page_eviction_candidates_v1(
    connection: &Connection,
    request: &EvictionCandidatePageRequestV1,
) -> Result<EvictionCandidatePageV1, SelectiveContentError> {
    if request.schema_version != 1
        || !(1..=128).contains(&request.limit)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&request.not_accessed_after)
        || (request.after.is_some() && request.source.is_none())
        || request.after.as_ref().is_some_and(|cursor| {
            !valid_digest(&cursor.content_digest)
                || !(0..=3).contains(&cursor.policy_priority)
                || !(0..=MAXIMUM_SAFE_INTEGER).contains(&cursor.last_accessed_at)
        })
    {
        return Err(SelectiveContentError::Invalid(
            "eviction candidate page request is invalid",
        ));
    }
    let source = content_work_source_v1(connection, request.source.as_ref())?;
    let after = request.after.as_ref();
    let sql = SQLITE_CONTENT_WORK_PROGRAMS
        .iter()
        .find(|program| program.0 == "eviction_candidates_page_v1")
        .ok_or(SelectiveContentError::Invalid(
            "eviction candidate program is missing",
        ))?
        .1;
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement
        .query_map(
            params![
                request.not_accessed_after,
                after.map(|cursor| cursor.policy_priority),
                after.map(|cursor| cursor.last_accessed_at),
                after.map(|cursor| cursor.content_digest.as_str()),
                request.limit + 1,
            ],
            |row| {
                Ok(EvictionCandidateV1 {
                    policy_priority: row.get(0)?,
                    last_accessed_at: row.get(1)?,
                    content_digest: row.get(2)?,
                    policy: row.get(3)?,
                    hydration_state: row.get(4)?,
                    verified_bytes: row.get(5)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = rows.len() > request.limit as usize;
    rows.truncate(request.limit as usize);
    let next = if has_more {
        rows.last().map(|row| EvictionCandidateCursorV1 {
            content_digest: row.content_digest.clone(),
            last_accessed_at: row.last_accessed_at,
            policy_priority: row.policy_priority,
        })
    } else {
        None
    };
    Ok(EvictionCandidatePageV1 {
        next,
        rows,
        schema_version: 1,
        source,
    })
}

pub fn set_content_policy_v1(
    connection: &mut Connection,
    mutation: &ContentPolicyMutationV1,
) -> Result<ContentPolicyMutationReceiptV1, SelectiveContentError> {
    if mutation.schema_version != 1
        || !valid_digest(&mutation.content_digest)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&mutation.updated_at)
    {
        return Err(SelectiveContentError::Invalid(
            "selective content policy mutation is invalid",
        ));
    }
    let program = SQLITE_LOCAL_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.0 == "content_policy_set_v1")
        .ok_or(SelectiveContentError::Invalid(
            "selective content policy program is missing",
        ))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let target_exists = transaction
        .query_row(program.3, params![mutation.content_digest], |row| {
            row.get::<_, i64>(0)
        })
        .optional()?
        == Some(1);
    if !target_exists {
        return Err(SelectiveContentError::Invalid(
            "selective content descriptor is unavailable",
        ));
    }
    let current = transaction
        .query_row(
            "SELECT policy, updated_at FROM library_device_content_policies
             WHERE content_digest = ?1 COLLATE BINARY;",
            params![mutation.content_digest],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    if current.as_ref().is_some_and(|(policy, updated_at)| {
        *updated_at > mutation.updated_at
            || (*updated_at == mutation.updated_at && policy != mutation.policy.as_str())
    }) {
        return Err(SelectiveContentError::Invalid(
            "selective content policy clock is stale or ambiguous",
        ));
    }
    let changed = transaction.execute(
        program.4,
        params![
            mutation.content_digest,
            mutation.policy.as_str(),
            mutation.updated_at
        ],
    )?;
    if changed > program.1 {
        return Err(SelectiveContentError::Invalid(
            "selective content policy mutation exceeded its row bound",
        ));
    }
    if changed == 1 {
        transaction.execute(
            "UPDATE library_device_content_availability
             SET hydration_state = CASE ?2
                   WHEN 'pinned_offline' THEN 'pinned_offline'
                   ELSE 'fully_cached'
                 END,
                 updated_at = ?3
             WHERE content_digest = ?1 COLLATE BINARY
               AND complete_digest_verified_at IS NOT NULL;",
            params![
                mutation.content_digest,
                mutation.policy.as_str(),
                mutation.updated_at
            ],
        )?;
        let advanced = transaction.execute(
            "UPDATE library_device_content_state
             SET revision = revision + 1
             WHERE singleton_id = 1 AND revision < 9007199254740991;",
            [],
        )?;
        if advanced != 1 {
            return Err(SelectiveContentError::Invalid(
                "selective content revision cannot advance",
            ));
        }
    }
    let content_revision = transaction.query_row(
        "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.commit()?;
    Ok(ContentPolicyMutationReceiptV1 {
        changed: changed == 1,
        content_digest: mutation.content_digest.clone(),
        content_revision,
        policy: mutation.policy,
        schema_version: 1,
        updated_at: mutation.updated_at,
    })
}

pub fn get_content_state_v1(
    connection: &Connection,
    request: &ContentStateRequestV1,
) -> Result<ContentStateV1, SelectiveContentError> {
    if request.schema_version != 1 || !valid_digest(&request.content_digest) {
        return Err(SelectiveContentError::Invalid(
            "selective content state request is invalid",
        ));
    }
    connection
        .query_row(
            "SELECT blob.byte_length, blob.media_type,
                    COALESCE(policy.policy, 'metadata_only'), policy.updated_at,
                    availability.hydration_state, availability.verified_bytes,
                    availability.storage_kind, availability.complete_digest_verified_at,
                    availability.last_accessed_at, availability.updated_at,
                    state.revision
             FROM library_blobs AS blob
             CROSS JOIN library_device_content_state AS state
             LEFT JOIN library_device_content_policies AS policy
               ON policy.content_digest = blob.content_digest
             LEFT JOIN library_device_content_availability AS availability
               ON availability.content_digest = blob.content_digest
             WHERE blob.content_digest = ?1 COLLATE BINARY AND state.singleton_id = 1
             LIMIT 1;",
            params![request.content_digest],
            |row| {
                let hydration_state = row.get::<_, Option<ContentHydrationStateV1>>(4)?;
                let availability = hydration_state
                    .map(|hydration_state| {
                        Ok::<ContentAvailabilityV1, rusqlite::Error>(ContentAvailabilityV1 {
                            complete_digest_verified_at: row.get(7)?,
                            hydration_state,
                            last_accessed_at: row.get(8)?,
                            storage_kind: row.get(6)?,
                            updated_at: row.get(9)?,
                            verified_bytes: row.get(5)?,
                        })
                    })
                    .transpose()?;
                Ok(ContentStateV1 {
                    availability,
                    byte_length: row.get(0)?,
                    content_digest: request.content_digest.clone(),
                    content_revision: row.get(10)?,
                    media_type: row.get(1)?,
                    policy: row.get(2)?,
                    policy_updated_at: row.get(3)?,
                    schema_version: 1,
                })
            },
        )
        .optional()?
        .ok_or(SelectiveContentError::Invalid(
            "selective content descriptor is unavailable",
        ))
}

pub fn register_verified_content_range_v1(
    connection: &mut Connection,
    publication: &VerifiedContentRangePublicationV1,
) -> Result<VerifiedContentRangeReceiptV1, SelectiveContentError> {
    if publication.schema_version != 1
        || !valid_digest(&publication.content_digest)
        || !valid_digest(&publication.range_content_digest)
        || !(1..=MAXIMUM_SAFE_INTEGER).contains(&publication.byte_length)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&publication.range_index)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&publication.verified_at)
        || !matches!(publication.storage_kind.as_str(), "content_vault" | "opfs")
        || publication.storage_key.is_empty()
        || publication.storage_key.len() > 1024
    {
        return Err(SelectiveContentError::Invalid(
            "verified content range publication is invalid",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let canonical = transaction
        .query_row(
            "SELECT range.byte_length, range.range_digest, blob.byte_length
             FROM library_content_ranges AS range
             JOIN library_blobs AS blob ON blob.content_digest = range.content_digest
             WHERE range.content_digest = ?1 COLLATE BINARY
               AND range.range_index = ?2
               AND blob.storage_layout = 'authenticated_ranges'
             LIMIT 1;",
            params![publication.content_digest, publication.range_index],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or(SelectiveContentError::Invalid(
            "canonical content range is unavailable",
        ))?;
    if canonical.0 != publication.byte_length || canonical.1 != publication.range_content_digest {
        return Err(SelectiveContentError::Invalid(
            "verified content range does not match canonical metadata",
        ));
    }
    let current = transaction
        .query_row(
            "SELECT storage_kind, storage_key, verified_at
             FROM library_device_content_ranges
             WHERE content_digest = ?1 COLLATE BINARY AND range_index = ?2;",
            params![publication.content_digest, publication.range_index],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let changed = current.as_ref().is_none_or(|value| {
        value
            != &(
                publication.storage_kind.clone(),
                publication.storage_key.clone(),
                publication.verified_at,
            )
    });
    if changed {
        transaction.execute(
            "INSERT INTO library_device_content_ranges
               (content_digest, range_index, verified_byte_length,
                verified_range_digest, storage_kind, storage_key, verified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(content_digest, range_index) DO UPDATE SET
               verified_byte_length = excluded.verified_byte_length,
               verified_range_digest = excluded.verified_range_digest,
               storage_kind = excluded.storage_kind,
               storage_key = excluded.storage_key,
               verified_at = excluded.verified_at;",
            params![
                publication.content_digest,
                publication.range_index,
                canonical.0,
                canonical.1,
                publication.storage_kind,
                publication.storage_key,
                publication.verified_at
            ],
        )?;
    }
    let verified_bytes = transaction.query_row(
        "SELECT COALESCE(sum(verified_byte_length), 0)
         FROM library_device_content_ranges
         WHERE content_digest = ?1 COLLATE BINARY;",
        params![publication.content_digest],
        |row| row.get::<_, i64>(0),
    )?;
    if verified_bytes > canonical.2 {
        return Err(SelectiveContentError::Invalid(
            "verified content byte count exceeds its descriptor",
        ));
    }
    if changed {
        transaction.execute(
            "INSERT INTO library_device_content_availability
               (content_digest, hydration_state, verified_bytes, storage_kind,
                complete_digest_verified_at, last_accessed_at, updated_at)
             VALUES (?1, 'partially_cached', ?2, ?3, NULL, ?4, ?4)
             ON CONFLICT(content_digest) DO UPDATE SET
               hydration_state = 'partially_cached',
               verified_bytes = excluded.verified_bytes,
               storage_kind = excluded.storage_kind,
               complete_digest_verified_at = NULL,
               updated_at = excluded.updated_at;",
            params![
                publication.content_digest,
                verified_bytes,
                publication.storage_kind,
                publication.verified_at
            ],
        )?;
        let advanced = transaction.execute(
            "UPDATE library_device_content_state
             SET revision = revision + 1
             WHERE singleton_id = 1 AND revision < 9007199254740991;",
            [],
        )?;
        if advanced != 1 {
            return Err(SelectiveContentError::Invalid(
                "selective content revision cannot advance",
            ));
        }
    }
    let content_revision = transaction.query_row(
        "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.commit()?;
    Ok(VerifiedContentRangeReceiptV1 {
        changed,
        content_digest: publication.content_digest.clone(),
        content_revision,
        hydration_state: ContentHydrationStateV1::PartiallyCached,
        range_index: publication.range_index,
        schema_version: 1,
        verified_bytes,
    })
}

pub(crate) fn register_verified_content_completion_v1(
    connection: &mut Connection,
    request: &ContentCompletionRequestV1,
    storage_kind: &str,
) -> Result<ContentCompletionReceiptV1, SelectiveContentError> {
    if request.schema_version != 1
        || !valid_digest(&request.content_digest)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&request.verified_at)
        || !matches!(storage_kind, "content_vault" | "opfs")
    {
        return Err(SelectiveContentError::Invalid(
            "content completion request is invalid",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (byte_length, range_count, verified_range_count, verified_bytes) = transaction
        .query_row(
            "SELECT blob.byte_length, blob.range_count,
                    (SELECT count(*) FROM library_content_ranges AS canonical
                     JOIN library_device_content_ranges AS local
                       ON local.content_digest = canonical.content_digest
                      AND local.range_index = canonical.range_index
                      AND local.verified_byte_length = canonical.byte_length
                      AND local.verified_range_digest = canonical.range_digest
                      AND local.storage_kind = ?2
                     WHERE canonical.content_digest = blob.content_digest),
                    (SELECT COALESCE(sum(local.verified_byte_length), 0)
                     FROM library_device_content_ranges AS local
                     WHERE local.content_digest = blob.content_digest
                       AND local.storage_kind = ?2)
             FROM library_blobs AS blob
             WHERE blob.content_digest = ?1 COLLATE BINARY
               AND blob.storage_layout = 'authenticated_ranges';",
            params![request.content_digest, storage_kind],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or(SelectiveContentError::Invalid(
            "content completion descriptor is unavailable",
        ))?;
    if verified_range_count != range_count || verified_bytes != byte_length {
        return Err(SelectiveContentError::Invalid(
            "content completion requires every canonical range",
        ));
    }
    let pinned = transaction
        .query_row(
            "SELECT policy = 'pinned_offline' FROM library_device_content_policies
             WHERE content_digest = ?1 COLLATE BINARY;",
            [&request.content_digest],
            |row| row.get::<_, bool>(0),
        )
        .optional()?
        .unwrap_or(false);
    let hydration_state = if pinned {
        ContentHydrationStateV1::PinnedOffline
    } else {
        ContentHydrationStateV1::FullyCached
    };
    let state_text = if pinned {
        "pinned_offline"
    } else {
        "fully_cached"
    };
    let current = transaction
        .query_row(
            "SELECT hydration_state, verified_bytes, storage_kind,
                    complete_digest_verified_at
             FROM library_device_content_availability
             WHERE content_digest = ?1 COLLATE BINARY;",
            [&request.content_digest],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?;
    let desired = (
        state_text.to_string(),
        verified_bytes,
        storage_kind.to_string(),
        Some(request.verified_at),
    );
    let changed = current.as_ref() != Some(&desired);
    if changed {
        transaction.execute(
            "INSERT INTO library_device_content_availability
               (content_digest, hydration_state, verified_bytes, storage_kind,
                complete_digest_verified_at, last_accessed_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
             ON CONFLICT(content_digest) DO UPDATE SET
               hydration_state = excluded.hydration_state,
               verified_bytes = excluded.verified_bytes,
               storage_kind = excluded.storage_kind,
               complete_digest_verified_at = excluded.complete_digest_verified_at,
               updated_at = excluded.updated_at;",
            params![
                request.content_digest,
                state_text,
                verified_bytes,
                storage_kind,
                request.verified_at
            ],
        )?;
        if transaction.execute(
            "UPDATE library_device_content_state SET revision = revision + 1
             WHERE singleton_id = 1 AND revision < 9007199254740991;",
            [],
        )? != 1
        {
            return Err(SelectiveContentError::Invalid(
                "selective content revision cannot advance",
            ));
        }
    }
    let content_revision = transaction.query_row(
        "SELECT revision FROM library_device_content_state WHERE singleton_id = 1;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.commit()?;
    Ok(ContentCompletionReceiptV1 {
        changed,
        content_digest: request.content_digest.clone(),
        content_revision,
        hydration_state,
        schema_version: 1,
        verified_bytes,
    })
}

pub(crate) fn mark_content_corrupt_v1(
    connection: &mut Connection,
    content_digest: &str,
    detected_at: i64,
) -> Result<(), SelectiveContentError> {
    if !valid_digest(content_digest) || !(0..=MAXIMUM_SAFE_INTEGER).contains(&detected_at) {
        return Err(SelectiveContentError::Invalid(
            "content corruption report is invalid",
        ));
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let changed = transaction.execute(
        "UPDATE library_device_content_availability
         SET hydration_state = 'corrupt',
             complete_digest_verified_at = NULL,
             updated_at = ?2
         WHERE content_digest = ?1 COLLATE BINARY
           AND (hydration_state IS NOT 'corrupt'
                OR complete_digest_verified_at IS NOT NULL
                OR updated_at IS NOT ?2);",
        params![content_digest, detected_at],
    )?;
    if changed == 1
        && transaction.execute(
            "UPDATE library_device_content_state SET revision = revision + 1
             WHERE singleton_id = 1 AND revision < 9007199254740991;",
            [],
        )? != 1
    {
        return Err(SelectiveContentError::Invalid(
            "selective content revision cannot advance",
        ));
    }
    transaction.commit()?;
    Ok(())
}

pub fn publish_content_range_from_reader_v1<R, D>(
    connection: &mut Connection,
    request: &ContentRangePublicationRequestV1,
    reader: &mut R,
    durable_object: &mut D,
) -> Result<VerifiedContentRangeReceiptV1, SelectiveContentError>
where
    R: Read,
    D: DurableContentRangeObjectV1,
{
    if request.schema_version != 1
        || !valid_digest(&request.content_digest)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&request.range_index)
        || !(0..=MAXIMUM_SAFE_INTEGER).contains(&request.verified_at)
    {
        return Err(SelectiveContentError::Invalid(
            "content range publication request is invalid",
        ));
    }
    let canonical = connection
        .query_row(
            "SELECT range.byte_length, range.range_digest
             FROM library_content_ranges AS range
             JOIN library_blobs AS blob ON blob.content_digest = range.content_digest
             WHERE range.content_digest = ?1 COLLATE BINARY
               AND range.range_index = ?2
               AND blob.storage_layout = 'authenticated_ranges'
             LIMIT 1;",
            params![request.content_digest, request.range_index],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or(SelectiveContentError::Invalid(
            "canonical content range is unavailable",
        ))?;
    let result = (|| -> Result<VerifiedContentRangeReceiptV1, SelectiveContentError> {
        let mut digest = Sha256::new();
        digest.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
        let mut buffer = vec![0u8; CONTENT_RANGE_MAXIMUM_APPEND_BYTES];
        let mut byte_count = 0i64;
        while byte_count < canonical.0 {
            let remaining = usize::try_from(canonical.0 - byte_count)
                .unwrap_or(usize::MAX)
                .min(buffer.len());
            let read = reader.read(&mut buffer[..remaining])?;
            if read == 0 {
                return Err(SelectiveContentError::Invalid(
                    "content range publication is incomplete",
                ));
            }
            durable_object.write_all(&buffer[..read])?;
            digest.update(&buffer[..read]);
            byte_count += i64::try_from(read).map_err(|_| {
                SelectiveContentError::Invalid("content range publication length is invalid")
            })?;
        }
        if reader.read(&mut buffer[..1])? != 0 {
            return Err(SelectiveContentError::Invalid(
                "content range publication exceeds canonical length",
            ));
        }
        if crate::lower_hex(&digest.finalize()) != canonical.1 {
            return Err(SelectiveContentError::Invalid(
                "content range publication digest is invalid",
            ));
        }
        durable_object.make_durable()?;
        register_verified_content_range_v1(
            connection,
            &VerifiedContentRangePublicationV1 {
                byte_length: canonical.0,
                content_digest: request.content_digest.clone(),
                range_content_digest: canonical.1,
                range_index: request.range_index,
                schema_version: 1,
                storage_key: durable_object.storage_key().to_owned(),
                storage_kind: durable_object.storage_kind().to_owned(),
                verified_at: request.verified_at,
            },
        )
    })();
    if result.is_err() {
        let _ = durable_object.discard();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;
    use std::io::Cursor;

    struct MemoryDurableObject {
        bytes: Vec<u8>,
        discarded: bool,
        durable: bool,
        maximum_write: usize,
    }

    impl Write for MemoryDurableObject {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.maximum_write = self.maximum_write.max(bytes.len());
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl DurableContentRangeObjectV1 for MemoryDurableObject {
        fn discard(&mut self) -> std::io::Result<()> {
            self.discarded = true;
            self.bytes.clear();
            Ok(())
        }

        fn make_durable(&mut self) -> std::io::Result<()> {
            self.durable = true;
            Ok(())
        }

        fn storage_key(&self) -> &str {
            "native-range-object"
        }

        fn storage_kind(&self) -> &str {
            "content_vault"
        }
    }

    fn fixture() -> (Connection, String) {
        let connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let digest = "a".repeat(64);
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                 VALUES (?1, 5000000000, 65536, 0, 'video/mp4');",
                params![digest],
            )
            .expect("descriptor");
        (connection, digest)
    }

    fn ranged_fixture() -> (Connection, String) {
        let connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let digest = "a".repeat(64);
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    cloud_availability_commitment, media_type)
                 VALUES (?1, 10, 'authenticated_ranges', 0, 0, 2, 5, ?2,
                         'video', ?3, 'video/mp4');",
                params![digest, "d".repeat(64), "e".repeat(64)],
            )
            .expect("descriptor");
        connection
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 0, 5, ?2), (?1, 1, 5, 5, ?3);",
                params![digest, "b".repeat(64), "c".repeat(64)],
            )
            .expect("ranges");
        (connection, digest)
    }

    fn streaming_fixture(bytes: &[u8]) -> (Connection, String) {
        let connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let mut digest = Sha256::new();
        digest.update(b"freed.library-core.v1/digest-bytes/blob-content\0");
        digest.update(bytes);
        let digest = crate::lower_hex(&digest.finalize());
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, storage_layout, chunk_bytes, chunk_count,
                    range_count, range_granularity, range_index_root_digest, rendition_id,
                    cloud_availability_commitment, media_type)
                 VALUES (?1, ?2, 'authenticated_ranges', 0, 0, 1, ?2, ?3,
                         'video', ?4, 'video/mp4');",
                params![digest, bytes.len() as i64, "d".repeat(64), "e".repeat(64)],
            )
            .expect("descriptor");
        connection
            .execute(
                "INSERT INTO library_content_ranges
                   (content_digest, range_index, byte_offset, byte_length, range_digest)
                 VALUES (?1, 0, 0, ?2, ?1);",
                params![digest, bytes.len() as i64],
            )
            .expect("range");
        (connection, digest)
    }

    #[test]
    fn policy_is_local_bounded_and_separate_from_availability() {
        let (mut connection, digest) = fixture();
        let before = get_content_state_v1(
            &connection,
            &ContentStateRequestV1 {
                content_digest: digest.clone(),
                schema_version: 1,
            },
        )
        .expect("initial state");
        assert_eq!(before.byte_length, 5_000_000_000);
        assert_eq!(before.policy, ContentHydrationPolicyV1::MetadataOnly);
        assert_eq!(before.availability, None);

        let mutation = ContentPolicyMutationV1 {
            content_digest: digest.clone(),
            policy: ContentHydrationPolicyV1::PinnedOffline,
            schema_version: 1,
            updated_at: 25,
        };
        let receipt = set_content_policy_v1(&mut connection, &mutation).expect("policy");
        assert!(receipt.changed);
        assert_eq!(receipt.content_revision, 1);
        assert!(
            !set_content_policy_v1(&mut connection, &mutation)
                .expect("retry")
                .changed
        );

        let after = get_content_state_v1(
            &connection,
            &ContentStateRequestV1 {
                content_digest: digest,
                schema_version: 1,
            },
        )
        .expect("updated state");
        assert_eq!(after.policy, ContentHydrationPolicyV1::PinnedOffline);
        assert_eq!(after.availability, None);
        assert_eq!(after.content_revision, 1);
    }

    #[test]
    fn policy_rejects_missing_content_and_ambiguous_clocks() {
        let (mut connection, digest) = fixture();
        set_content_policy_v1(
            &mut connection,
            &ContentPolicyMutationV1 {
                content_digest: digest.clone(),
                policy: ContentHydrationPolicyV1::PartialCache,
                schema_version: 1,
                updated_at: 25,
            },
        )
        .expect("initial policy");
        let ambiguous = set_content_policy_v1(
            &mut connection,
            &ContentPolicyMutationV1 {
                content_digest: digest,
                policy: ContentHydrationPolicyV1::Excluded,
                schema_version: 1,
                updated_at: 25,
            },
        )
        .expect_err("ambiguous clock");
        assert!(ambiguous.to_string().contains("stale or ambiguous"));
        let missing = get_content_state_v1(
            &connection,
            &ContentStateRequestV1 {
                content_digest: "b".repeat(64),
                schema_version: 1,
            },
        )
        .expect_err("missing descriptor");
        assert!(missing.to_string().contains("unavailable"));
    }

    #[test]
    fn verified_ranges_bind_canonical_identity_and_advance_local_state_only() {
        let (mut connection, digest) = ranged_fixture();
        let publication = VerifiedContentRangePublicationV1 {
            byte_length: 5,
            content_digest: digest.clone(),
            range_content_digest: "b".repeat(64),
            range_index: 0,
            schema_version: 1,
            storage_key: "range-object-one".into(),
            storage_kind: "content_vault".into(),
            verified_at: 50,
        };
        let receipt = register_verified_content_range_v1(&mut connection, &publication)
            .expect("verified publication");
        assert!(receipt.changed);
        assert_eq!(receipt.verified_bytes, 5);
        assert_eq!(receipt.content_revision, 1);
        assert!(
            !register_verified_content_range_v1(&mut connection, &publication)
                .expect("exact retry")
                .changed
        );
        let state = get_content_state_v1(
            &connection,
            &ContentStateRequestV1 {
                content_digest: digest,
                schema_version: 1,
            },
        )
        .expect("content state");
        assert_eq!(
            state.availability.expect("availability").hydration_state,
            ContentHydrationStateV1::PartiallyCached
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_checkpoint_export
                     WHERE registry_key LIKE '%device_content%';",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("checkpoint local row count"),
            0
        );
    }

    #[test]
    fn verified_ranges_reject_caller_supplied_digest_or_length() {
        let (mut connection, digest) = ranged_fixture();
        for publication in [
            VerifiedContentRangePublicationV1 {
                byte_length: 4,
                content_digest: digest.clone(),
                range_content_digest: "b".repeat(64),
                range_index: 0,
                schema_version: 1,
                storage_key: "wrong-length".into(),
                storage_kind: "content_vault".into(),
                verified_at: 50,
            },
            VerifiedContentRangePublicationV1 {
                byte_length: 5,
                content_digest: digest.clone(),
                range_content_digest: "f".repeat(64),
                range_index: 0,
                schema_version: 1,
                storage_key: "wrong-digest".into(),
                storage_kind: "content_vault".into(),
                verified_at: 50,
            },
        ] {
            let error = register_verified_content_range_v1(&mut connection, &publication)
                .expect_err("canonical mismatch");
            assert!(error.to_string().contains("canonical metadata"));
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_device_content_ranges;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("local ranges"),
            0
        );
    }

    #[test]
    fn native_range_publication_streams_then_durably_registers() {
        let bytes = (0..(CONTENT_RANGE_MAXIMUM_APPEND_BYTES * 2 + 17))
            .map(|index| ((index * 19 + 3) % 251) as u8)
            .collect::<Vec<_>>();
        let (mut connection, digest) = streaming_fixture(&bytes);
        let mut reader = Cursor::new(bytes.clone());
        let mut durable = MemoryDurableObject {
            bytes: Vec::new(),
            discarded: false,
            durable: false,
            maximum_write: 0,
        };
        let receipt = publish_content_range_from_reader_v1(
            &mut connection,
            &ContentRangePublicationRequestV1 {
                content_digest: digest,
                range_index: 0,
                schema_version: 1,
                verified_at: 100,
            },
            &mut reader,
            &mut durable,
        )
        .expect("publish range");
        assert!(receipt.changed);
        assert_eq!(receipt.verified_bytes, bytes.len() as i64);
        assert!(durable.durable);
        assert!(!durable.discarded);
        assert_eq!(durable.bytes, bytes);
        assert_eq!(durable.maximum_write, CONTENT_RANGE_MAXIMUM_APPEND_BYTES);
    }

    #[test]
    fn native_range_publication_discards_changed_bytes_before_sqlite() {
        let expected = vec![1, 2, 3, 4];
        let (mut connection, digest) = streaming_fixture(&expected);
        let mut reader = Cursor::new(vec![1, 2, 3, 5]);
        let mut durable = MemoryDurableObject {
            bytes: Vec::new(),
            discarded: false,
            durable: false,
            maximum_write: 0,
        };
        let error = publish_content_range_from_reader_v1(
            &mut connection,
            &ContentRangePublicationRequestV1 {
                content_digest: digest,
                range_index: 0,
                schema_version: 1,
                verified_at: 100,
            },
            &mut reader,
            &mut durable,
        )
        .expect_err("reject changed bytes");
        assert!(error.to_string().contains("digest is invalid"));
        assert!(durable.discarded);
        assert!(!durable.durable);
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_device_content_ranges;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("local ranges"),
            0
        );
    }

    #[test]
    fn content_work_pages_are_bounded_and_source_fenced() {
        let (mut connection, digest) = ranged_fixture();
        connection
            .execute(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                 VALUES (1, 'library', 1, 'epoch', 7, 7);",
                [],
            )
            .expect("meta");
        connection
            .execute(
                "INSERT INTO library_materialization_generation
                   (singleton_id, generation_id)
                 VALUES (1, ?1);",
                params!["9".repeat(64)],
            )
            .expect("generation");
        connection
            .execute(
                "UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;",
                [],
            )
            .expect("change revision");
        set_content_policy_v1(
            &mut connection,
            &ContentPolicyMutationV1 {
                content_digest: digest.clone(),
                policy: ContentHydrationPolicyV1::CompleteCache,
                schema_version: 1,
                updated_at: 25,
            },
        )
        .expect("policy");
        register_verified_content_range_v1(
            &mut connection,
            &VerifiedContentRangePublicationV1 {
                byte_length: 5,
                content_digest: digest.clone(),
                range_content_digest: "b".repeat(64),
                range_index: 0,
                schema_version: 1,
                storage_key: "range-object-one".into(),
                storage_kind: "content_vault".into(),
                verified_at: 50,
            },
        )
        .expect("local range");

        let hydration = page_hydration_candidates_v1(
            &connection,
            &HydrationCandidatePageRequestV1 {
                after: None,
                limit: 1,
                schema_version: 1,
                source: None,
            },
        )
        .expect("hydration page");
        assert_eq!(hydration.rows.len(), 1);
        assert_eq!(hydration.rows[0].range_index, 1);
        assert_eq!(hydration.rows[0].content_digest, digest);
        assert_eq!(hydration.next, None);

        let eviction = page_eviction_candidates_v1(
            &connection,
            &EvictionCandidatePageRequestV1 {
                after: None,
                limit: 1,
                not_accessed_after: 50,
                schema_version: 1,
                source: None,
            },
        )
        .expect("eviction page");
        assert_eq!(eviction.rows.len(), 1);
        assert_eq!(eviction.rows[0].last_accessed_at, 50);
        connection
            .execute(
                "UPDATE library_device_content_state SET revision = revision + 1
                 WHERE singleton_id = 1;",
                [],
            )
            .expect("advance local state");
        let stale = page_eviction_candidates_v1(
            &connection,
            &EvictionCandidatePageRequestV1 {
                after: Some(EvictionCandidateCursorV1 {
                    content_digest: eviction.rows[0].content_digest.clone(),
                    last_accessed_at: eviction.rows[0].last_accessed_at,
                    policy_priority: eviction.rows[0].policy_priority,
                }),
                limit: 1,
                not_accessed_after: 50,
                schema_version: 1,
                source: Some(eviction.source),
            },
        )
        .expect_err("stale source");
        assert!(stale.to_string().contains("source is stale"));
    }
}
