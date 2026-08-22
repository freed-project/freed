use crate::sqlite_contract_generated::{
    CONTENT_RANGE_MAXIMUM_APPEND_BYTES, SQLITE_LOCAL_MUTATION_PROGRAMS,
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
    pub storage_key: Option<String>,
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
                    availability.storage_kind, availability.storage_key,
                    availability.complete_digest_verified_at, availability.updated_at,
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
                            complete_digest_verified_at: row.get(8)?,
                            hydration_state,
                            storage_key: row.get(7)?,
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
                storage_key, complete_digest_verified_at, updated_at)
             VALUES (?1, 'partially_cached', ?2, ?3, NULL, NULL, ?4)
             ON CONFLICT(content_digest) DO UPDATE SET
               hydration_state = 'partially_cached',
               verified_bytes = excluded.verified_bytes,
               storage_kind = excluded.storage_kind,
               storage_key = NULL,
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
}
