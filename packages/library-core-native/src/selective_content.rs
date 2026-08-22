use crate::sqlite_contract_generated::SQLITE_LOCAL_MUTATION_PROGRAMS;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::fmt;

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

#[derive(Debug)]
pub enum SelectiveContentError {
    Invalid(&'static str),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for SelectiveContentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;

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
}
