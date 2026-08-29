use crate::library_core_canonical::encode_canonical_value;
use crate::lower_hex;
use crate::sqlite_contract_generated::{
    DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS, DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS,
    DEVICE_CONTACT_MAXIMUM_CANONICAL_BYTES, DEVICE_CONTACT_MAXIMUM_EMAILS,
    DEVICE_CONTACT_MAXIMUM_MUTATION_CANONICAL_BYTES, DEVICE_CONTACT_MAXIMUM_ORGANIZATIONS,
    DEVICE_CONTACT_MAXIMUM_PHONES, DEVICE_CONTACT_MAXIMUM_PHOTOS,
    DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES, DEVICE_CONTACT_MAXIMUM_SUGGESTION_ACCOUNTS,
    DEVICE_CONTACT_MUTATION_DIGEST_DOMAIN, DEVICE_CONTACT_PAGE_MAXIMUM_ROWS,
    DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS, DEVICE_CONTACT_SYNC_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt;

const MAXIMUM_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactNameV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub given_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub middle_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactValueV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactPhotoV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactOrganizationV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactMetadataV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactV1 {
    pub emails: Vec<DeviceContactValueV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<DeviceContactMetadataV1>,
    pub name: DeviceContactNameV1,
    pub organizations: Vec<DeviceContactOrganizationV1>,
    pub phones: Vec<DeviceContactValueV1>,
    pub photos: Vec<DeviceContactPhotoV1>,
    pub resource_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceContactSuggestionKindV1 {
    AttachAccountsToPerson,
    MergeAccounts,
}

impl DeviceContactSuggestionKindV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::AttachAccountsToPerson => "attach_accounts_to_person",
            Self::MergeAccounts => "merge_accounts",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceContactSuggestionConfidenceV1 {
    High,
    Medium,
}

impl DeviceContactSuggestionConfidenceV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactSuggestionV1 {
    pub account_ids: Vec<String>,
    pub confidence: DeviceContactSuggestionConfidenceV1,
    pub created_at: i64,
    pub id: String,
    pub kind: DeviceContactSuggestionKindV1,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactMatchResultV1 {
    pub resource_name: String,
    pub suggestion: Option<DeviceContactSuggestionV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceContactAuthStatusV1 {
    Connected,
    ReconnectRequired,
}

impl DeviceContactAuthStatusV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Connected => "connected",
            Self::ReconnectRequired => "reconnect_required",
        }
    }

    fn parse(value: &str) -> Result<Self, DeviceContactSyncError> {
        match value {
            "connected" => Ok(Self::Connected),
            "reconnect_required" => Ok(Self::ReconnectRequired),
            _ => Err(DeviceContactSyncError::Invalid(
                "device contact auth status is invalid",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceContactSyncStatusV1 {
    Error,
    Idle,
    Syncing,
}

impl DeviceContactSyncStatusV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Idle => "idle",
            Self::Syncing => "syncing",
        }
    }

    fn parse(value: &str) -> Result<Self, DeviceContactSyncError> {
        match value {
            "error" => Ok(Self::Error),
            "idle" => Ok(Self::Idle),
            "syncing" => Ok(Self::Syncing),
            _ => Err(DeviceContactSyncError::Invalid(
                "device contact sync status is invalid",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceContactErrorCodeV1 {
    Auth,
    MissingToken,
    Network,
    Unknown,
}

impl DeviceContactErrorCodeV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::MissingToken => "missing_token",
            Self::Network => "network",
            Self::Unknown => "unknown",
        }
    }

    fn parse(value: &str) -> Result<Self, DeviceContactSyncError> {
        match value {
            "auth" => Ok(Self::Auth),
            "missing_token" => Ok(Self::MissingToken),
            "network" => Ok(Self::Network),
            "unknown" => Ok(Self::Unknown),
            _ => Err(DeviceContactSyncError::Invalid(
                "device contact error code is invalid",
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "mutationKind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeviceContactSyncMutationV1 {
    DeviceContactGenerationBeginV1 {
        generation_id: String,
        schema_version: u32,
        started_at: i64,
    },
    DeviceContactDeltaAppendV1 {
        batch_ordinal: i64,
        contacts: Vec<DeviceContactV1>,
        deleted_resource_names: Vec<String>,
        generation_id: String,
        schema_version: u32,
        updated_at: i64,
    },
    DeviceContactMatchAppendV1 {
        generation_id: String,
        matched_at: i64,
        matches: Vec<DeviceContactMatchResultV1>,
        schema_version: u32,
    },
    DeviceContactGenerationActivateV1 {
        activated_at: i64,
        expected_contact_count: i64,
        generation_id: String,
        next_sync_token: String,
        schema_version: u32,
    },
    DeviceContactStatusSetV1 {
        auth_status: DeviceContactAuthStatusV1,
        error_code: Option<DeviceContactErrorCodeV1>,
        error_message: Option<String>,
        schema_version: u32,
        sync_started_at: Option<i64>,
        sync_status: DeviceContactSyncStatusV1,
        updated_at: i64,
    },
    DeviceContactSuggestionDismissV1 {
        dismissed_at: i64,
        schema_version: u32,
        suggestion_id: String,
    },
}

impl DeviceContactSyncMutationV1 {
    fn schema_version(&self) -> u32 {
        match self {
            Self::DeviceContactGenerationBeginV1 { schema_version, .. }
            | Self::DeviceContactDeltaAppendV1 { schema_version, .. }
            | Self::DeviceContactMatchAppendV1 { schema_version, .. }
            | Self::DeviceContactGenerationActivateV1 { schema_version, .. }
            | Self::DeviceContactStatusSetV1 { schema_version, .. }
            | Self::DeviceContactSuggestionDismissV1 { schema_version, .. } => *schema_version,
        }
    }

    fn generation_id(&self) -> Option<&str> {
        match self {
            Self::DeviceContactGenerationBeginV1 { generation_id, .. }
            | Self::DeviceContactDeltaAppendV1 { generation_id, .. }
            | Self::DeviceContactMatchAppendV1 { generation_id, .. }
            | Self::DeviceContactGenerationActivateV1 { generation_id, .. } => Some(generation_id),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactMutationReceiptV1 {
    pub active_generation_id: Option<String>,
    pub changed: bool,
    pub generation_id: Option<String>,
    pub matched_contact_count: i64,
    pub revision: i64,
    pub schema_version: u32,
    pub staged_contact_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactStatusRequestV1 {
    pub query_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactStatusResponseV1 {
    pub active_contact_count: i64,
    pub active_generation_id: Option<String>,
    pub auth_status: DeviceContactAuthStatusV1,
    pub created_friend_count: i64,
    pub last_error_code: Option<DeviceContactErrorCodeV1>,
    pub last_error_message: Option<String>,
    pub last_synced_at: Option<i64>,
    pub pending_suggestion_count: i64,
    pub query_id: String,
    pub revision: i64,
    pub schema_version: u32,
    pub sync_started_at: Option<i64>,
    pub sync_status: DeviceContactSyncStatusV1,
    pub sync_token: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactMatchPageRequestV1 {
    pub after_resource_name: Option<String>,
    pub generation_id: String,
    pub limit: usize,
    pub query_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactMatchPageResponseV1 {
    pub generation_id: String,
    pub next_cursor: Option<String>,
    pub query_id: String,
    pub revision: i64,
    pub rows: Vec<DeviceContactV1>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactSuggestionCursorV1 {
    pub confidence: DeviceContactSuggestionConfidenceV1,
    pub created_at: i64,
    pub suggestion_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactSuggestionPageRequestV1 {
    pub cursor: Option<DeviceContactSuggestionCursorV1>,
    pub limit: usize,
    pub query_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactSuggestionReviewRowV1 {
    pub contact: DeviceContactV1,
    pub suggestion: DeviceContactSuggestionV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactSuggestionPageResponseV1 {
    pub next_cursor: Option<DeviceContactSuggestionCursorV1>,
    pub query_id: String,
    pub revision: i64,
    pub rows: Vec<DeviceContactSuggestionReviewRowV1>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactUnmatchedCursorV1 {
    pub display_name: String,
    pub resource_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactUnmatchedPageRequestV1 {
    pub cursor: Option<DeviceContactUnmatchedCursorV1>,
    pub limit: usize,
    pub query_id: String,
    pub schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceContactUnmatchedPageResponseV1 {
    pub next_cursor: Option<DeviceContactUnmatchedCursorV1>,
    pub query_id: String,
    pub revision: i64,
    pub rows: Vec<DeviceContactV1>,
    pub schema_version: u32,
}

#[derive(Debug)]
pub enum DeviceContactSyncError {
    Invalid(&'static str),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for DeviceContactSyncError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::Sqlite(error) => write!(formatter, "SQLite device contact failure: {error}"),
        }
    }
}

impl std::error::Error for DeviceContactSyncError {}

impl From<rusqlite::Error> for DeviceContactSyncError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

fn valid_text(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
}

fn valid_time(value: i64) -> bool {
    (0..=MAXIMUM_SAFE_INTEGER).contains(&value)
}

fn validate_contact(contact: &DeviceContactV1) -> Result<(), DeviceContactSyncError> {
    if !valid_text(&contact.resource_name, 1, 1_024)
        || contact
            .etag
            .as_deref()
            .is_some_and(|value| !valid_text(value, 0, 2_048))
        || contact.emails.len() > DEVICE_CONTACT_MAXIMUM_EMAILS
        || contact.phones.len() > DEVICE_CONTACT_MAXIMUM_PHONES
        || contact.photos.len() > DEVICE_CONTACT_MAXIMUM_PHOTOS
        || contact.organizations.len() > DEVICE_CONTACT_MAXIMUM_ORGANIZATIONS
    {
        return Err(DeviceContactSyncError::Invalid("device contact is invalid"));
    }
    for value in [
        contact.name.display_name.as_deref(),
        contact.name.family_name.as_deref(),
        contact.name.given_name.as_deref(),
        contact.name.middle_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !valid_text(value, 0, 2_048) {
            return Err(DeviceContactSyncError::Invalid(
                "device contact name is invalid",
            ));
        }
    }
    if contact.emails.iter().chain(&contact.phones).any(|entry| {
        !valid_text(&entry.value, 1, 2_048)
            || entry
                .r#type
                .as_deref()
                .is_some_and(|value| !valid_text(value, 0, 255))
    }) || contact
        .photos
        .iter()
        .any(|entry| !valid_text(&entry.url, 1, 8_192))
        || contact.organizations.iter().any(|entry| {
            (entry.name.is_none() && entry.title.is_none())
                || entry
                    .name
                    .as_deref()
                    .is_some_and(|value| !valid_text(value, 0, 1_024))
                || entry
                    .title
                    .as_deref()
                    .is_some_and(|value| !valid_text(value, 0, 1_024))
        })
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact children are invalid",
        ));
    }
    let value = serde_json::to_value(contact)
        .map_err(|_| DeviceContactSyncError::Invalid("device contact is invalid"))?;
    encode_canonical_value(&value, DEVICE_CONTACT_MAXIMUM_CANONICAL_BYTES).map_err(|_| {
        DeviceContactSyncError::Invalid("device contact exceeds its canonical bound")
    })?;
    Ok(())
}

fn validate_suggestion(
    suggestion: &DeviceContactSuggestionV1,
) -> Result<(), DeviceContactSyncError> {
    let mut account_ids = HashSet::new();
    if !valid_text(&suggestion.id, 1, 8_192)
        || !valid_text(&suggestion.label, 1, 2_048)
        || suggestion
            .person_id
            .as_deref()
            .is_some_and(|value| !valid_text(value, 0, 2_048))
        || suggestion
            .reason
            .as_deref()
            .is_some_and(|value| !valid_text(value, 0, 4_096))
        || suggestion.account_ids.len() > DEVICE_CONTACT_MAXIMUM_SUGGESTION_ACCOUNTS
        || suggestion
            .account_ids
            .iter()
            .any(|value| !valid_text(value, 1, 1_024) || !account_ids.insert(value.as_str()))
        || !valid_time(suggestion.created_at)
        || (suggestion.kind == DeviceContactSuggestionKindV1::AttachAccountsToPerson)
            != suggestion.person_id.is_some()
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact suggestion is invalid",
        ));
    }
    Ok(())
}

fn validate_mutation(mutation: &DeviceContactSyncMutationV1) -> Result<(), DeviceContactSyncError> {
    if mutation.schema_version() != DEVICE_CONTACT_SYNC_SCHEMA_VERSION {
        return Err(DeviceContactSyncError::Invalid(
            "device contact schema version is invalid",
        ));
    }
    if let Some(generation_id) = mutation.generation_id() {
        if !valid_text(generation_id, 1, 255) {
            return Err(DeviceContactSyncError::Invalid(
                "device contact generation identity is invalid",
            ));
        }
    }
    match mutation {
        DeviceContactSyncMutationV1::DeviceContactGenerationBeginV1 { started_at, .. } => {
            if !valid_time(*started_at) {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact start time is invalid",
                ));
            }
        }
        DeviceContactSyncMutationV1::DeviceContactDeltaAppendV1 {
            batch_ordinal,
            contacts,
            deleted_resource_names,
            updated_at,
            ..
        } => {
            if !valid_time(*batch_ordinal)
                || !valid_time(*updated_at)
                || contacts.len() + deleted_resource_names.len() == 0
                || contacts.len() + deleted_resource_names.len()
                    > DEVICE_CONTACT_DELTA_MAXIMUM_MEMBERS
            {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact delta is invalid",
                ));
            }
            let mut identities = HashSet::new();
            for contact in contacts {
                validate_contact(contact)?;
                if !identities.insert(contact.resource_name.as_str()) {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact delta identity is repeated",
                    ));
                }
            }
            for resource_name in deleted_resource_names {
                if !valid_text(resource_name, 1, 1_024)
                    || !identities.insert(resource_name.as_str())
                {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact delta identity is invalid",
                    ));
                }
            }
        }
        DeviceContactSyncMutationV1::DeviceContactMatchAppendV1 {
            matched_at,
            matches,
            ..
        } => {
            if !valid_time(*matched_at)
                || matches.is_empty()
                || matches.len() > DEVICE_CONTACT_MATCH_MAXIMUM_MEMBERS
            {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact match batch is invalid",
                ));
            }
            let mut identities = HashSet::new();
            for entry in matches {
                if !valid_text(&entry.resource_name, 1, 1_024)
                    || !identities.insert(entry.resource_name.as_str())
                {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact match identity is invalid",
                    ));
                }
                if let Some(suggestion) = &entry.suggestion {
                    validate_suggestion(suggestion)?;
                }
            }
        }
        DeviceContactSyncMutationV1::DeviceContactGenerationActivateV1 {
            activated_at,
            expected_contact_count,
            next_sync_token,
            ..
        } => {
            if !valid_time(*activated_at)
                || !valid_time(*expected_contact_count)
                || !valid_text(next_sync_token, 0, 65_536)
            {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact activation is invalid",
                ));
            }
        }
        DeviceContactSyncMutationV1::DeviceContactStatusSetV1 {
            error_code,
            error_message,
            sync_started_at,
            sync_status,
            updated_at,
            ..
        } => {
            if error_code.is_some() != error_message.is_some()
                || error_message
                    .as_deref()
                    .is_some_and(|value| !valid_text(value, 0, 4_096))
                || match sync_status {
                    DeviceContactSyncStatusV1::Syncing => !sync_started_at.is_some_and(valid_time),
                    _ => sync_started_at.is_some(),
                }
                || !valid_time(*updated_at)
            {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact status is invalid",
                ));
            }
        }
        DeviceContactSyncMutationV1::DeviceContactSuggestionDismissV1 {
            dismissed_at,
            suggestion_id,
            ..
        } => {
            if !valid_time(*dismissed_at) || !valid_text(suggestion_id, 1, 8_192) {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact dismissal is invalid",
                ));
            }
        }
    }
    let value = serde_json::to_value(mutation)
        .map_err(|_| DeviceContactSyncError::Invalid("device contact mutation is invalid"))?;
    encode_canonical_value(&value, DEVICE_CONTACT_MAXIMUM_MUTATION_CANONICAL_BYTES).map_err(
        |_| DeviceContactSyncError::Invalid("device contact mutation exceeds its canonical bound"),
    )?;
    Ok(())
}

pub fn digest_device_contact_sync_mutation_v1(
    mutation: &DeviceContactSyncMutationV1,
) -> Result<String, DeviceContactSyncError> {
    validate_mutation(mutation)?;
    let value = serde_json::to_value(mutation)
        .map_err(|_| DeviceContactSyncError::Invalid("device contact mutation is invalid"))?;
    let canonical = encode_canonical_value(&value, DEVICE_CONTACT_MAXIMUM_MUTATION_CANONICAL_BYTES)
        .map_err(|_| {
            DeviceContactSyncError::Invalid("device contact mutation exceeds its canonical bound")
        })?;
    let mut digest = Sha256::new();
    digest.update(DEVICE_CONTACT_MUTATION_DIGEST_DOMAIN.as_bytes());
    digest.update(canonical);
    Ok(lower_hex(&digest.finalize()))
}

fn advance_revision(
    transaction: &Transaction<'_>,
    updated_at: i64,
) -> Result<(), DeviceContactSyncError> {
    if transaction.execute(
        "UPDATE library_device_contact_sync_state
         SET revision = revision + 1, updated_at = ?1
         WHERE singleton_id = 1 AND revision < 9007199254740991;",
        params![updated_at],
    )? != 1
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact revision cannot advance",
        ));
    }
    Ok(())
}

fn mutation_receipt(
    transaction: &Transaction<'_>,
    generation_id: Option<&str>,
    changed: bool,
) -> Result<DeviceContactMutationReceiptV1, DeviceContactSyncError> {
    let (active_generation_id, revision) = transaction.query_row(
        "SELECT active_generation_id, revision
         FROM library_device_contact_sync_state WHERE singleton_id = 1;",
        [],
        |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let counts = generation_id
        .map(|generation_id| {
            transaction
                .query_row(
                    "SELECT staged_contact_count, matched_contact_count
                     FROM library_device_contact_generations
                     WHERE generation_id = ?1 COLLATE BINARY;",
                    params![generation_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()
        })
        .transpose()?
        .flatten()
        .unwrap_or((0, 0));
    Ok(DeviceContactMutationReceiptV1 {
        active_generation_id,
        changed,
        generation_id: generation_id.map(str::to_owned),
        matched_contact_count: counts.1,
        revision,
        schema_version: DEVICE_CONTACT_SYNC_SCHEMA_VERSION,
        staged_contact_count: counts.0,
    })
}

fn clone_active_generation(
    transaction: &Transaction<'_>,
    generation_id: &str,
    active_generation_id: &str,
) -> Result<(), DeviceContactSyncError> {
    transaction.execute(
        "INSERT INTO library_device_contacts
           (generation_id, resource_name, etag, display_name, given_name,
            family_name, middle_name, deleted, updated_at)
         SELECT ?1, resource_name, etag, display_name, given_name, family_name,
                middle_name, deleted, updated_at
         FROM library_device_contacts WHERE generation_id = ?2 COLLATE BINARY;",
        params![generation_id, active_generation_id],
    )?;
    for table in [
        "library_device_contact_emails",
        "library_device_contact_phones",
    ] {
        transaction.execute(
            &format!(
                "INSERT INTO {table}
                   (generation_id, resource_name, ordinal, value, type_value)
                 SELECT ?1, resource_name, ordinal, value, type_value
                 FROM {table} WHERE generation_id = ?2 COLLATE BINARY;"
            ),
            params![generation_id, active_generation_id],
        )?;
    }
    transaction.execute(
        "INSERT INTO library_device_contact_photos
           (generation_id, resource_name, ordinal, url, is_default)
         SELECT ?1, resource_name, ordinal, url, is_default
         FROM library_device_contact_photos WHERE generation_id = ?2 COLLATE BINARY;",
        params![generation_id, active_generation_id],
    )?;
    transaction.execute(
        "INSERT INTO library_device_contact_organizations
           (generation_id, resource_name, ordinal, name, title)
         SELECT ?1, resource_name, ordinal, name, title
         FROM library_device_contact_organizations WHERE generation_id = ?2 COLLATE BINARY;",
        params![generation_id, active_generation_id],
    )?;
    Ok(())
}

fn insert_contact(
    transaction: &Transaction<'_>,
    generation_id: &str,
    contact: &DeviceContactV1,
    updated_at: i64,
) -> Result<(), DeviceContactSyncError> {
    transaction.execute(
        "DELETE FROM library_device_contacts
         WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY;",
        params![generation_id, contact.resource_name],
    )?;
    transaction.execute(
        "INSERT INTO library_device_contacts
           (generation_id, resource_name, etag, display_name, given_name,
            family_name, middle_name, deleted, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9);",
        params![
            generation_id,
            contact.resource_name,
            contact.etag,
            contact.name.display_name,
            contact.name.given_name,
            contact.name.family_name,
            contact.name.middle_name,
            i64::from(contact.metadata.as_ref().and_then(|value| value.deleted) == Some(true)),
            updated_at,
        ],
    )?;
    for (ordinal, entry) in contact.emails.iter().enumerate() {
        transaction.execute(
            "INSERT INTO library_device_contact_emails
               (generation_id, resource_name, ordinal, value, type_value)
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![
                generation_id,
                contact.resource_name,
                ordinal as i64,
                entry.value,
                entry.r#type
            ],
        )?;
    }
    for (ordinal, entry) in contact.phones.iter().enumerate() {
        transaction.execute(
            "INSERT INTO library_device_contact_phones
               (generation_id, resource_name, ordinal, value, type_value)
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![
                generation_id,
                contact.resource_name,
                ordinal as i64,
                entry.value,
                entry.r#type
            ],
        )?;
    }
    for (ordinal, entry) in contact.photos.iter().enumerate() {
        transaction.execute(
            "INSERT INTO library_device_contact_photos
               (generation_id, resource_name, ordinal, url, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![
                generation_id,
                contact.resource_name,
                ordinal as i64,
                entry.url,
                i64::from(entry.default == Some(true))
            ],
        )?;
    }
    for (ordinal, entry) in contact.organizations.iter().enumerate() {
        transaction.execute(
            "INSERT INTO library_device_contact_organizations
               (generation_id, resource_name, ordinal, name, title)
             VALUES (?1, ?2, ?3, ?4, ?5);",
            params![
                generation_id,
                contact.resource_name,
                ordinal as i64,
                entry.name,
                entry.title
            ],
        )?;
    }
    Ok(())
}

pub fn query_device_contact_status_v1(
    connection: &Connection,
    request: &DeviceContactStatusRequestV1,
) -> Result<DeviceContactStatusResponseV1, DeviceContactSyncError> {
    if request.schema_version != DEVICE_CONTACT_SYNC_SCHEMA_VERSION
        || request.query_id != "device_contact_status_v1"
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact status request is invalid",
        ));
    }
    let row = connection.query_row(
        "SELECT state.revision, state.active_generation_id, state.auth_status,
                state.sync_status, state.sync_started_at, state.sync_token,
                state.last_synced_at, state.last_error_code,
                state.last_error_message,
                (SELECT count(*) FROM library_accounts AS account
                 WHERE account.kind = 'contact' COLLATE BINARY
                   AND account.provider = 'google_contacts' COLLATE BINARY
                   AND account.person_id IS NOT NULL),
                state.updated_at,
                CASE WHEN state.active_generation_id IS NULL THEN 0 ELSE
                  (SELECT count(*) FROM library_device_contacts AS contact
                   WHERE contact.generation_id = state.active_generation_id
                     AND contact.deleted = 0) END,
                CASE WHEN state.active_generation_id IS NULL THEN 0 ELSE
                  (SELECT count(*) FROM library_device_contact_suggestions AS suggestion
                   WHERE suggestion.generation_id = state.active_generation_id
                     AND suggestion.dismissed_at IS NULL) END
         FROM library_device_contact_sync_state AS state WHERE state.singleton_id = 1;",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
            ))
        },
    )?;
    let response = DeviceContactStatusResponseV1 {
        active_contact_count: row.11,
        active_generation_id: row.1,
        auth_status: DeviceContactAuthStatusV1::parse(&row.2)?,
        created_friend_count: row.9,
        last_error_code: row
            .7
            .as_deref()
            .map(DeviceContactErrorCodeV1::parse)
            .transpose()?,
        last_error_message: row.8,
        last_synced_at: row.6,
        pending_suggestion_count: row.12,
        query_id: "device_contact_status_v1".to_owned(),
        revision: row.0,
        schema_version: DEVICE_CONTACT_SYNC_SCHEMA_VERSION,
        sync_started_at: row.4,
        sync_status: DeviceContactSyncStatusV1::parse(&row.3)?,
        sync_token: row.5,
        updated_at: row.10,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| DeviceContactSyncError::Invalid("device contact status response is invalid"))?
        .len()
        > DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact status response exceeds its byte bound",
        ));
    }
    Ok(response)
}

pub fn query_device_contact_match_page_v1(
    connection: &Connection,
    request: &DeviceContactMatchPageRequestV1,
) -> Result<DeviceContactMatchPageResponseV1, DeviceContactSyncError> {
    if request.schema_version != DEVICE_CONTACT_SYNC_SCHEMA_VERSION
        || !valid_text(&request.generation_id, 1, 255)
        || request.limit == 0
        || request.limit > DEVICE_CONTACT_PAGE_MAXIMUM_ROWS
        || request.query_id != "device_contact_match_page_v1"
        || request
            .after_resource_name
            .as_deref()
            .is_some_and(|value| !valid_text(value, 1, 1_024))
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact match page request is invalid",
        ));
    }
    let (state, revision) = connection
        .query_row(
            "SELECT generation.state, sync.revision
             FROM library_device_contact_generations AS generation
             JOIN library_device_contact_sync_state AS sync ON sync.singleton_id = 1
             WHERE generation.generation_id = ?1 COLLATE BINARY;",
            params![request.generation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
        .ok_or(DeviceContactSyncError::Invalid(
            "device contact generation is unavailable",
        ))?;
    if state != "building" {
        return Err(DeviceContactSyncError::Invalid(
            "device contact generation is not building",
        ));
    }
    let mut statement = connection.prepare(
        "SELECT contact.resource_name, contact.etag, contact.display_name,
                contact.given_name, contact.family_name, contact.middle_name,
                contact.deleted,
                COALESCE((SELECT json_group_array(json_object('type', child.type_value, 'value', child.value)) FROM (SELECT type_value, value FROM library_device_contact_emails WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]'),
                COALESCE((SELECT json_group_array(json_object('type', child.type_value, 'value', child.value)) FROM (SELECT type_value, value FROM library_device_contact_phones WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]'),
                COALESCE((SELECT json_group_array(json_object('default', json(CASE child.is_default WHEN 1 THEN 'true' ELSE 'false' END), 'url', child.url)) FROM (SELECT is_default, url FROM library_device_contact_photos WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]'),
                COALESCE((SELECT json_group_array(json_object('name', child.name, 'title', child.title)) FROM (SELECT name, title FROM library_device_contact_organizations WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]')
         FROM library_device_contacts AS contact
         WHERE contact.generation_id = ?1 COLLATE BINARY AND contact.deleted = 0
           AND (?2 IS NULL OR contact.resource_name > ?2 COLLATE BINARY)
           AND NOT EXISTS (SELECT 1 FROM library_device_contact_match_receipts AS receipt
                           WHERE receipt.generation_id = contact.generation_id
                             AND receipt.resource_name = contact.resource_name)
         ORDER BY contact.resource_name COLLATE BINARY ASC LIMIT ?3;",
    )?;
    let mut query = statement.query(params![
        request.generation_id,
        request.after_resource_name,
        i64::try_from(request.limit + 1)
            .map_err(|_| DeviceContactSyncError::Invalid("device contact page limit is invalid"))?
    ])?;
    let mut rows = Vec::new();
    let mut has_more = false;
    let mut canonical_bytes = 4_096usize;
    while let Some(row) = query.next()? {
        if rows.len() == request.limit {
            has_more = true;
            break;
        }
        let contact = DeviceContactV1 {
            resource_name: row.get(0)?,
            etag: row.get(1)?,
            name: DeviceContactNameV1 {
                display_name: row.get(2)?,
                given_name: row.get(3)?,
                family_name: row.get(4)?,
                middle_name: row.get(5)?,
            },
            metadata: if row.get::<_, i64>(6)? == 1 {
                Some(DeviceContactMetadataV1 {
                    deleted: Some(true),
                })
            } else {
                None
            },
            emails: serde_json::from_str(&row.get::<_, String>(7)?).map_err(|_| {
                DeviceContactSyncError::Invalid("device contact email page is invalid")
            })?,
            phones: serde_json::from_str(&row.get::<_, String>(8)?).map_err(|_| {
                DeviceContactSyncError::Invalid("device contact phone page is invalid")
            })?,
            photos: serde_json::from_str(&row.get::<_, String>(9)?).map_err(|_| {
                DeviceContactSyncError::Invalid("device contact photo page is invalid")
            })?,
            organizations: serde_json::from_str(&row.get::<_, String>(10)?).map_err(|_| {
                DeviceContactSyncError::Invalid("device contact organization page is invalid")
            })?,
        };
        validate_contact(&contact)?;
        let row_bytes = serde_json::to_vec(&contact)
            .map_err(|_| DeviceContactSyncError::Invalid("device contact page row is invalid"))?
            .len()
            + 1;
        if canonical_bytes + row_bytes > DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES {
            has_more = true;
            break;
        }
        canonical_bytes += row_bytes;
        rows.push(contact);
    }
    let response = DeviceContactMatchPageResponseV1 {
        generation_id: request.generation_id.clone(),
        next_cursor: if has_more {
            rows.last().map(|row| row.resource_name.clone())
        } else {
            None
        },
        query_id: "device_contact_match_page_v1".to_owned(),
        revision,
        rows,
        schema_version: DEVICE_CONTACT_SYNC_SCHEMA_VERSION,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| {
            DeviceContactSyncError::Invalid("device contact match page response is invalid")
        })?
        .len()
        > DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact match page response exceeds its byte bound",
        ));
    }
    Ok(response)
}

fn active_contact_context(
    connection: &Connection,
) -> Result<(String, i64), DeviceContactSyncError> {
    let (generation_id, revision) = connection.query_row(
        "SELECT active_generation_id, revision
         FROM library_device_contact_sync_state WHERE singleton_id = 1;",
        [],
        |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
    )?;
    generation_id
        .map(|generation_id| (generation_id, revision))
        .ok_or(DeviceContactSyncError::Invalid(
            "device contact generation is unavailable",
        ))
}

fn load_device_contact(
    connection: &Connection,
    generation_id: &str,
    resource_name: &str,
) -> Result<DeviceContactV1, DeviceContactSyncError> {
    let contact = connection
        .query_row(
            "SELECT contact.etag, contact.display_name, contact.given_name,
                    contact.family_name, contact.middle_name, contact.deleted,
                    COALESCE((SELECT json_group_array(json_object('type', child.type_value, 'value', child.value)) FROM (SELECT type_value, value FROM library_device_contact_emails WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]'),
                    COALESCE((SELECT json_group_array(json_object('type', child.type_value, 'value', child.value)) FROM (SELECT type_value, value FROM library_device_contact_phones WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]'),
                    COALESCE((SELECT json_group_array(json_object('default', json(CASE child.is_default WHEN 1 THEN 'true' ELSE 'false' END), 'url', child.url)) FROM (SELECT is_default, url FROM library_device_contact_photos WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]'),
                    COALESCE((SELECT json_group_array(json_object('name', child.name, 'title', child.title)) FROM (SELECT name, title FROM library_device_contact_organizations WHERE generation_id = contact.generation_id AND resource_name = contact.resource_name ORDER BY ordinal) AS child), '[]')
             FROM library_device_contacts AS contact
             WHERE contact.generation_id = ?1 COLLATE BINARY
               AND contact.resource_name = ?2 COLLATE BINARY;",
            params![generation_id, resource_name],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?
        .ok_or(DeviceContactSyncError::Invalid(
            "device contact row is unavailable",
        ))?;
    let value = DeviceContactV1 {
        emails: serde_json::from_str(&contact.6)
            .map_err(|_| DeviceContactSyncError::Invalid("device contact emails are invalid"))?,
        etag: contact.0,
        metadata: (contact.5 == 1).then_some(DeviceContactMetadataV1 {
            deleted: Some(true),
        }),
        name: DeviceContactNameV1 {
            display_name: contact.1,
            given_name: contact.2,
            family_name: contact.3,
            middle_name: contact.4,
        },
        organizations: serde_json::from_str(&contact.9).map_err(|_| {
            DeviceContactSyncError::Invalid("device contact organizations are invalid")
        })?,
        phones: serde_json::from_str(&contact.7)
            .map_err(|_| DeviceContactSyncError::Invalid("device contact phones are invalid"))?,
        photos: serde_json::from_str(&contact.8)
            .map_err(|_| DeviceContactSyncError::Invalid("device contact photos are invalid"))?,
        resource_name: resource_name.to_owned(),
    };
    validate_contact(&value)?;
    Ok(value)
}

fn bounded_page_push<T: Serialize>(
    rows: &mut Vec<T>,
    row: T,
    bytes: &mut usize,
) -> Result<bool, DeviceContactSyncError> {
    let row_bytes = serde_json::to_vec(&row)
        .map_err(|_| DeviceContactSyncError::Invalid("device contact review row is invalid"))?
        .len()
        + 1;
    if *bytes + row_bytes > DEVICE_CONTACT_MAXIMUM_RESPONSE_BYTES {
        return Ok(false);
    }
    *bytes += row_bytes;
    rows.push(row);
    Ok(true)
}

pub fn query_device_contact_suggestion_page_v1(
    connection: &Connection,
    request: &DeviceContactSuggestionPageRequestV1,
) -> Result<DeviceContactSuggestionPageResponseV1, DeviceContactSyncError> {
    if request.schema_version != 1
        || request.query_id != "device_contact_suggestion_page_v1"
        || request.limit == 0
        || request.limit > DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS
        || request.cursor.as_ref().is_some_and(|cursor| {
            !valid_time(cursor.created_at) || !valid_text(&cursor.suggestion_id, 1, 8_192)
        })
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact suggestion page request is invalid",
        ));
    }
    let (generation_id, revision) = active_contact_context(connection)?;
    let cursor_rank = request
        .cursor
        .as_ref()
        .map(|cursor| match cursor.confidence {
            DeviceContactSuggestionConfidenceV1::High => 0_i64,
            DeviceContactSuggestionConfidenceV1::Medium => 1_i64,
        });
    let mut statement = connection.prepare(
        "SELECT suggestion.suggestion_id, suggestion.resource_name, suggestion.kind,
                suggestion.confidence, suggestion.person_id, suggestion.label,
                suggestion.reason, suggestion.created_at,
                COALESCE((SELECT json_group_array(account_id) FROM
                  (SELECT account_id FROM library_device_contact_suggestion_accounts
                   WHERE generation_id = suggestion.generation_id
                     AND suggestion_id = suggestion.suggestion_id ORDER BY ordinal)), '[]')
         FROM library_device_contact_suggestions AS suggestion
         WHERE suggestion.generation_id = ?1 COLLATE BINARY
           AND suggestion.dismissed_at IS NULL
           AND (?2 IS NULL OR CASE suggestion.confidence WHEN 'high' THEN 0 ELSE 1 END > ?2
             OR (CASE suggestion.confidence WHEN 'high' THEN 0 ELSE 1 END = ?2
                 AND suggestion.created_at < ?3)
             OR (CASE suggestion.confidence WHEN 'high' THEN 0 ELSE 1 END = ?2
                 AND suggestion.created_at = ?3 AND suggestion.suggestion_id > ?4 COLLATE BINARY))
         ORDER BY CASE suggestion.confidence WHEN 'high' THEN 0 ELSE 1 END,
                  suggestion.created_at DESC, suggestion.suggestion_id COLLATE BINARY ASC
         LIMIT ?5;",
    )?;
    let mut query = statement.query(params![
        generation_id,
        cursor_rank,
        request.cursor.as_ref().map(|cursor| cursor.created_at),
        request
            .cursor
            .as_ref()
            .map(|cursor| cursor.suggestion_id.as_str()),
        i64::try_from(request.limit + 1).unwrap_or(51),
    ])?;
    let mut rows = Vec::new();
    let mut next_cursor = None;
    let mut bytes = 4_096usize;
    while let Some(row) = query.next()? {
        if rows.len() == request.limit {
            break;
        }
        let confidence_text: String = row.get(3)?;
        let confidence = match confidence_text.as_str() {
            "high" => DeviceContactSuggestionConfidenceV1::High,
            "medium" => DeviceContactSuggestionConfidenceV1::Medium,
            _ => {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact suggestion confidence is invalid",
                ))
            }
        };
        let suggestion = DeviceContactSuggestionV1 {
            account_ids: serde_json::from_str(&row.get::<_, String>(8)?).map_err(|_| {
                DeviceContactSyncError::Invalid("device contact suggestion accounts are invalid")
            })?,
            confidence,
            created_at: row.get(7)?,
            id: row.get(0)?,
            kind: match row.get::<_, String>(2)?.as_str() {
                "attach_accounts_to_person" => {
                    DeviceContactSuggestionKindV1::AttachAccountsToPerson
                }
                "merge_accounts" => DeviceContactSuggestionKindV1::MergeAccounts,
                _ => {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact suggestion kind is invalid",
                    ))
                }
            },
            label: row.get(5)?,
            person_id: row.get(4)?,
            reason: row.get(6)?,
        };
        validate_suggestion(&suggestion)?;
        let contact = load_device_contact(connection, &generation_id, &row.get::<_, String>(1)?)?;
        let cursor = DeviceContactSuggestionCursorV1 {
            confidence,
            created_at: suggestion.created_at,
            suggestion_id: suggestion.id.clone(),
        };
        if !bounded_page_push(
            &mut rows,
            DeviceContactSuggestionReviewRowV1 {
                contact,
                suggestion,
            },
            &mut bytes,
        )? {
            break;
        }
        next_cursor = Some(cursor);
    }
    if rows.len() < request.limit {
        next_cursor = None;
    }
    Ok(DeviceContactSuggestionPageResponseV1 {
        next_cursor,
        query_id: "device_contact_suggestion_page_v1".to_owned(),
        revision,
        rows,
        schema_version: 1,
    })
}

pub fn query_device_contact_unmatched_page_v1(
    connection: &Connection,
    request: &DeviceContactUnmatchedPageRequestV1,
) -> Result<DeviceContactUnmatchedPageResponseV1, DeviceContactSyncError> {
    if request.schema_version != 1
        || request.query_id != "device_contact_unmatched_page_v1"
        || request.limit == 0
        || request.limit > DEVICE_CONTACT_REVIEW_MAXIMUM_ROWS
        || request.cursor.as_ref().is_some_and(|cursor| {
            !valid_text(&cursor.display_name, 0, 2_048)
                || !valid_text(&cursor.resource_name, 1, 1_024)
        })
    {
        return Err(DeviceContactSyncError::Invalid(
            "device contact unmatched page request is invalid",
        ));
    }
    let (generation_id, revision) = active_contact_context(connection)?;
    let mut statement = connection.prepare(
        "SELECT COALESCE(contact.display_name, ''), contact.resource_name
         FROM library_device_contacts AS contact
         WHERE contact.generation_id = ?1 COLLATE BINARY AND contact.deleted = 0
           AND EXISTS (SELECT 1 FROM library_device_contact_match_receipts AS receipt
                       WHERE receipt.generation_id = contact.generation_id AND receipt.resource_name = contact.resource_name)
           AND NOT EXISTS (SELECT 1 FROM library_device_contact_suggestions AS suggestion
                           WHERE suggestion.generation_id = contact.generation_id AND suggestion.resource_name = contact.resource_name)
           AND NOT EXISTS (SELECT 1 FROM library_accounts AS account
                           WHERE account.provider = 'google_contacts' COLLATE BINARY
                             AND account.external_id = contact.resource_name COLLATE BINARY)
           AND (?2 IS NULL OR COALESCE(contact.display_name, '') > ?2 COLLATE BINARY
             OR (COALESCE(contact.display_name, '') = ?2 COLLATE BINARY AND contact.resource_name > ?3 COLLATE BINARY))
         ORDER BY COALESCE(contact.display_name, '') COLLATE BINARY, contact.resource_name COLLATE BINARY LIMIT ?4;",
    )?;
    let mut query = statement.query(params![
        generation_id,
        request.cursor.as_ref().map(|c| c.display_name.as_str()),
        request.cursor.as_ref().map(|c| c.resource_name.as_str()),
        i64::try_from(request.limit + 1).unwrap_or(51)
    ])?;
    let mut rows = Vec::new();
    let mut next_cursor = None;
    let mut bytes = 4_096usize;
    while let Some(row) = query.next()? {
        if rows.len() == request.limit {
            break;
        }
        let cursor = DeviceContactUnmatchedCursorV1 {
            display_name: row.get(0)?,
            resource_name: row.get(1)?,
        };
        let contact = load_device_contact(connection, &generation_id, &cursor.resource_name)?;
        if !bounded_page_push(&mut rows, contact, &mut bytes)? {
            break;
        }
        next_cursor = Some(cursor);
    }
    if rows.len() < request.limit {
        next_cursor = None;
    }
    Ok(DeviceContactUnmatchedPageResponseV1 {
        next_cursor,
        query_id: "device_contact_unmatched_page_v1".to_owned(),
        revision,
        rows,
        schema_version: 1,
    })
}

pub fn mutate_device_contact_sync_v1(
    connection: &mut Connection,
    mutation: &DeviceContactSyncMutationV1,
) -> Result<DeviceContactMutationReceiptV1, DeviceContactSyncError> {
    validate_mutation(mutation)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut changed = false;
    match mutation {
        DeviceContactSyncMutationV1::DeviceContactGenerationBeginV1 {
            generation_id,
            started_at,
            ..
        } => {
            let building = transaction
                .query_row(
                    "SELECT generation_id FROM library_device_contact_generations WHERE state = 'building';",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let mut building = building;
            if let Some(existing) = building.as_ref() {
                if existing != generation_id {
                    let sync_status = transaction.query_row(
                        "SELECT sync_status FROM library_device_contact_sync_state WHERE singleton_id = 1;",
                        [],
                        |row| row.get::<_, String>(0),
                    )?;
                    if sync_status == "syncing" {
                        return Err(DeviceContactSyncError::Invalid(
                            "another device contact generation is building",
                        ));
                    }
                    transaction.execute(
                        "DELETE FROM library_device_contact_generations
                         WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';",
                        params![existing],
                    )?;
                    building = None;
                }
            }
            if building.is_none() {
                let active = transaction.query_row(
                    "SELECT active_generation_id FROM library_device_contact_sync_state WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )?;
                transaction.execute(
                    "INSERT INTO library_device_contact_generations
                       (generation_id, state, expected_contact_count, staged_contact_count,
                        matched_contact_count, created_at, activated_at)
                     VALUES (?1, 'building', 0, 0, 0, ?2, NULL);",
                    params![generation_id, started_at],
                )?;
                if let Some(active) = active {
                    clone_active_generation(&transaction, generation_id, &active)?;
                }
                let count = transaction.query_row(
                    "SELECT count(*) FROM library_device_contacts WHERE generation_id = ?1 COLLATE BINARY;",
                    params![generation_id],
                    |row| row.get::<_, i64>(0),
                )?;
                transaction.execute(
                    "UPDATE library_device_contact_generations
                     SET expected_contact_count = ?2, staged_contact_count = ?2
                     WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';",
                    params![generation_id, count],
                )?;
                transaction.execute(
                    "UPDATE library_device_contact_sync_state
                     SET auth_status = 'connected', sync_status = 'syncing',
                         sync_started_at = ?1, last_error_code = NULL,
                         last_error_message = NULL
                     WHERE singleton_id = 1;",
                    params![started_at],
                )?;
                advance_revision(&transaction, *started_at)?;
                changed = true;
            }
        }
        DeviceContactSyncMutationV1::DeviceContactDeltaAppendV1 {
            batch_ordinal,
            contacts,
            deleted_resource_names,
            generation_id,
            updated_at,
            ..
        } => {
            let digest = digest_device_contact_sync_mutation_v1(mutation)?;
            let existing = transaction
                .query_row(
                    "SELECT batch_digest FROM library_device_contact_delta_receipts
                     WHERE generation_id = ?1 COLLATE BINARY AND batch_ordinal = ?2;",
                    params![generation_id, batch_ordinal],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(existing) = existing {
                if existing != digest {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact delta replay changed",
                    ));
                }
            } else {
                let expected_ordinal = transaction.query_row(
                    "SELECT count(*) FROM library_device_contact_delta_receipts
                     WHERE generation_id = ?1 COLLATE BINARY;",
                    params![generation_id],
                    |row| row.get::<_, i64>(0),
                )?;
                if expected_ordinal != *batch_ordinal {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact delta batch ordinal is not contiguous",
                    ));
                }
                let state = transaction
                    .query_row(
                        "SELECT state FROM library_device_contact_generations
                         WHERE generation_id = ?1 COLLATE BINARY;",
                        params![generation_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                if state.as_deref() != Some("building") {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact generation is not building",
                    ));
                }
                for resource_name in deleted_resource_names {
                    transaction.execute(
                        "DELETE FROM library_device_contacts
                         WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY;",
                        params![generation_id, resource_name],
                    )?;
                }
                for contact in contacts {
                    insert_contact(&transaction, generation_id, contact, *updated_at)?;
                }
                transaction.execute(
                    "INSERT INTO library_device_contact_delta_receipts
                       (generation_id, batch_ordinal, batch_digest, applied_at)
                     VALUES (?1, ?2, ?3, ?4);",
                    params![generation_id, batch_ordinal, digest, updated_at],
                )?;
                let count = transaction.query_row(
                    "SELECT count(*) FROM library_device_contacts
                     WHERE generation_id = ?1 COLLATE BINARY AND deleted = 0;",
                    params![generation_id],
                    |row| row.get::<_, i64>(0),
                )?;
                transaction.execute(
                    "UPDATE library_device_contact_generations
                     SET expected_contact_count = ?2, staged_contact_count = ?2
                     WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';",
                    params![generation_id, count],
                )?;
                advance_revision(&transaction, *updated_at)?;
                changed = true;
            }
        }
        DeviceContactSyncMutationV1::DeviceContactMatchAppendV1 {
            generation_id,
            matched_at,
            matches,
            schema_version,
        } => {
            for entry in matches {
                let one = DeviceContactSyncMutationV1::DeviceContactMatchAppendV1 {
                    generation_id: generation_id.clone(),
                    matched_at: *matched_at,
                    matches: vec![entry.clone()],
                    schema_version: *schema_version,
                };
                let digest = digest_device_contact_sync_mutation_v1(&one)?;
                let existing = transaction
                    .query_row(
                        "SELECT result_digest FROM library_device_contact_match_receipts
                         WHERE generation_id = ?1 COLLATE BINARY AND resource_name = ?2 COLLATE BINARY;",
                        params![generation_id, entry.resource_name],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                if let Some(existing) = existing {
                    if existing != digest {
                        return Err(DeviceContactSyncError::Invalid(
                            "device contact match replay changed",
                        ));
                    }
                    continue;
                }
                let exists = transaction.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM library_device_contacts AS contact
                       JOIN library_device_contact_generations AS generation
                         ON generation.generation_id = contact.generation_id
                       WHERE contact.generation_id = ?1 COLLATE BINARY
                         AND contact.resource_name = ?2 COLLATE BINARY
                         AND contact.deleted = 0 AND generation.state = 'building');",
                    params![generation_id, entry.resource_name],
                    |row| row.get::<_, i64>(0),
                )?;
                if exists != 1 {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact match target is unavailable",
                    ));
                }
                if let Some(suggestion) = &entry.suggestion {
                    let active = transaction.query_row(
                        "SELECT active_generation_id FROM library_device_contact_sync_state WHERE singleton_id = 1;",
                        [],
                        |row| row.get::<_, Option<String>>(0),
                    )?;
                    let dismissed_at = active
                        .map(|active| {
                            transaction
                                .query_row(
                                    "SELECT dismissed_at FROM library_device_contact_suggestions
                                     WHERE generation_id = ?1 COLLATE BINARY AND suggestion_id = ?2 COLLATE BINARY;",
                                    params![active, suggestion.id],
                                    |row| row.get::<_, Option<i64>>(0),
                                )
                                .optional()
                        })
                        .transpose()?
                        .flatten()
                        .flatten();
                    transaction.execute(
                        "INSERT INTO library_device_contact_suggestions
                           (generation_id, suggestion_id, resource_name, kind, confidence,
                            person_id, label, reason, created_at, dismissed_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10);",
                        params![
                            generation_id,
                            suggestion.id,
                            entry.resource_name,
                            suggestion.kind.as_str(),
                            suggestion.confidence.as_str(),
                            suggestion.person_id,
                            suggestion.label,
                            suggestion.reason,
                            suggestion.created_at,
                            dismissed_at,
                        ],
                    )?;
                    for (ordinal, account_id) in suggestion.account_ids.iter().enumerate() {
                        transaction.execute(
                            "INSERT INTO library_device_contact_suggestion_accounts
                               (generation_id, suggestion_id, ordinal, account_id)
                             VALUES (?1, ?2, ?3, ?4);",
                            params![generation_id, suggestion.id, ordinal as i64, account_id],
                        )?;
                    }
                }
                transaction.execute(
                    "INSERT INTO library_device_contact_match_receipts
                       (generation_id, resource_name, result_digest, matched_at)
                     VALUES (?1, ?2, ?3, ?4);",
                    params![generation_id, entry.resource_name, digest, matched_at],
                )?;
                changed = true;
            }
            if changed {
                let count = transaction.query_row(
                    "SELECT count(*) FROM library_device_contact_match_receipts
                     WHERE generation_id = ?1 COLLATE BINARY;",
                    params![generation_id],
                    |row| row.get::<_, i64>(0),
                )?;
                if transaction.execute(
                    "UPDATE library_device_contact_generations SET matched_contact_count = ?2
                     WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';",
                    params![generation_id, count],
                )? != 1
                {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact generation is not building",
                    ));
                }
                advance_revision(&transaction, *matched_at)?;
            }
        }
        DeviceContactSyncMutationV1::DeviceContactGenerationActivateV1 {
            activated_at,
            expected_contact_count,
            generation_id,
            next_sync_token,
            ..
        } => {
            let (prior_active, prior_token, prior_time) = transaction.query_row(
                "SELECT active_generation_id, sync_token, last_synced_at
                 FROM library_device_contact_sync_state WHERE singleton_id = 1;",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )?;
            if prior_active.as_deref() == Some(generation_id) {
                if prior_token.as_deref() != Some(next_sync_token)
                    || prior_time != Some(*activated_at)
                {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact activation replay changed",
                    ));
                }
            } else {
                let generation = transaction
                    .query_row(
                        "SELECT state, staged_contact_count, matched_contact_count
                         FROM library_device_contact_generations WHERE generation_id = ?1 COLLATE BINARY;",
                        params![generation_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
                    )
                    .optional()?;
                if generation.as_ref().is_none_or(|value| {
                    value.0 != "building"
                        || value.1 != *expected_contact_count
                        || value.2 != *expected_contact_count
                }) {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact generation is incomplete",
                    ));
                }
                if transaction.execute(
                    "UPDATE library_device_contact_sync_state
                     SET active_generation_id = ?1, auth_status = 'connected', sync_status = 'idle',
                         sync_started_at = NULL, sync_token = ?2, last_synced_at = ?3,
                         last_error_code = NULL, last_error_message = NULL,
                         revision = revision + 1, updated_at = ?3
                     WHERE singleton_id = 1 AND revision < 9007199254740991;",
                    params![generation_id, next_sync_token, activated_at],
                )? != 1
                {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact revision cannot advance",
                    ));
                }
                if let Some(prior_active) = prior_active {
                    transaction.execute(
                        "DELETE FROM library_device_contact_generations WHERE generation_id = ?1 COLLATE BINARY;",
                        params![prior_active],
                    )?;
                }
                if transaction.execute(
                    "UPDATE library_device_contact_generations SET state = 'active', activated_at = ?2
                     WHERE generation_id = ?1 COLLATE BINARY AND state = 'building';",
                    params![generation_id, activated_at],
                )? != 1
                {
                    return Err(DeviceContactSyncError::Invalid("device contact generation activation failed"));
                }
                changed = true;
            }
        }
        DeviceContactSyncMutationV1::DeviceContactStatusSetV1 {
            auth_status,
            error_code,
            error_message,
            sync_started_at,
            sync_status,
            updated_at,
            ..
        } => {
            let current = transaction.query_row(
                "SELECT auth_status, sync_status, sync_started_at, last_error_code, last_error_message
                 FROM library_device_contact_sync_state WHERE singleton_id = 1;",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<i64>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?)),
            )?;
            let error_code_text = error_code.map(|value| value.as_str());
            changed = current.0 != auth_status.as_str()
                || current.1 != sync_status.as_str()
                || current.2 != *sync_started_at
                || current.3.as_deref() != error_code_text
                || current.4 != *error_message;
            if changed
                && transaction.execute(
                    "UPDATE library_device_contact_sync_state
                     SET auth_status = ?1, sync_status = ?2, sync_started_at = ?3,
                         last_error_code = ?4, last_error_message = ?5,
                         revision = revision + 1, updated_at = ?6
                     WHERE singleton_id = 1 AND revision < 9007199254740991;",
                    params![
                        auth_status.as_str(),
                        sync_status.as_str(),
                        sync_started_at,
                        error_code_text,
                        error_message,
                        updated_at
                    ],
                )? != 1
            {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact revision cannot advance",
                ));
            }
        }
        DeviceContactSyncMutationV1::DeviceContactSuggestionDismissV1 {
            dismissed_at,
            suggestion_id,
            ..
        } => {
            let active = transaction.query_row(
                "SELECT active_generation_id FROM library_device_contact_sync_state WHERE singleton_id = 1;",
                [],
                |row| row.get::<_, Option<String>>(0),
            )?;
            let Some(active) = active else {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact generation is unavailable",
                ));
            };
            let existing = transaction
                .query_row(
                    "SELECT dismissed_at FROM library_device_contact_suggestions
                     WHERE generation_id = ?1 COLLATE BINARY AND suggestion_id = ?2 COLLATE BINARY;",
                    params![active, suggestion_id],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()?;
            let Some(existing) = existing else {
                return Err(DeviceContactSyncError::Invalid(
                    "device contact suggestion is unavailable",
                ));
            };
            if let Some(existing) = existing {
                if existing != *dismissed_at {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact dismissal replay changed",
                    ));
                }
            } else {
                if transaction.execute(
                    "UPDATE library_device_contact_suggestions SET dismissed_at = ?3
                     WHERE generation_id = ?1 COLLATE BINARY AND suggestion_id = ?2 COLLATE BINARY
                       AND dismissed_at IS NULL;",
                    params![active, suggestion_id, dismissed_at],
                )? != 1
                {
                    return Err(DeviceContactSyncError::Invalid(
                        "device contact suggestion dismissal raced",
                    ));
                }
                advance_revision(&transaction, *dismissed_at)?;
                changed = true;
            }
        }
    }
    let receipt = mutation_receipt(&transaction, mutation.generation_id(), changed)?;
    transaction.commit()?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;

    fn contact() -> DeviceContactV1 {
        DeviceContactV1 {
            emails: vec![DeviceContactValueV1 {
                r#type: Some("work".to_owned()),
                value: "ada@example.com".to_owned(),
            }],
            etag: Some("etag-1".to_owned()),
            metadata: None,
            name: DeviceContactNameV1 {
                display_name: Some("Ada Lovelace".to_owned()),
                family_name: Some("Lovelace".to_owned()),
                given_name: Some("Ada".to_owned()),
                middle_name: None,
            },
            organizations: vec![DeviceContactOrganizationV1 {
                name: Some("Analytical Engine".to_owned()),
                title: Some("Programmer".to_owned()),
            }],
            phones: vec![DeviceContactValueV1 {
                r#type: Some("mobile".to_owned()),
                value: "+15551234567".to_owned(),
            }],
            photos: vec![DeviceContactPhotoV1 {
                default: Some(true),
                url: "https://example.com/ada.jpg".to_owned(),
            }],
            resource_name: "people/ada".to_owned(),
        }
    }

    #[test]
    fn native_contact_mutations_are_replay_safe_and_activate_atomically() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        let begin = DeviceContactSyncMutationV1::DeviceContactGenerationBeginV1 {
            generation_id: "contacts-1".to_owned(),
            schema_version: 1,
            started_at: 100,
        };
        assert!(
            mutate_device_contact_sync_v1(&mut connection, &begin)
                .expect("begin")
                .changed
        );
        assert!(
            !mutate_device_contact_sync_v1(&mut connection, &begin)
                .expect("begin retry")
                .changed
        );
        let mut unmatched_contact = contact();
        unmatched_contact.resource_name = "people/grace".to_owned();
        unmatched_contact.name.display_name = Some("Grace Hopper".to_owned());
        let delta = DeviceContactSyncMutationV1::DeviceContactDeltaAppendV1 {
            batch_ordinal: 0,
            contacts: vec![contact(), unmatched_contact.clone()],
            deleted_resource_names: vec![],
            generation_id: "contacts-1".to_owned(),
            schema_version: 1,
            updated_at: 110,
        };
        assert!(
            mutate_device_contact_sync_v1(&mut connection, &delta)
                .expect("delta")
                .changed
        );
        assert!(
            !mutate_device_contact_sync_v1(&mut connection, &delta)
                .expect("delta retry")
                .changed
        );
        let page = query_device_contact_match_page_v1(
            &connection,
            &DeviceContactMatchPageRequestV1 {
                after_resource_name: None,
                generation_id: "contacts-1".to_owned(),
                limit: 64,
                query_id: "device_contact_match_page_v1".to_owned(),
                schema_version: 1,
            },
        )
        .expect("match page");
        assert_eq!(page.rows, vec![contact(), unmatched_contact.clone()]);
        assert_eq!(page.next_cursor, None);
        let matches = DeviceContactSyncMutationV1::DeviceContactMatchAppendV1 {
            generation_id: "contacts-1".to_owned(),
            matched_at: 120,
            matches: vec![
                DeviceContactMatchResultV1 {
                    resource_name: "people/ada".to_owned(),
                    suggestion: Some(DeviceContactSuggestionV1 {
                        account_ids: vec![],
                        confidence: DeviceContactSuggestionConfidenceV1::High,
                        created_at: 120,
                        id: "suggestion-ada".to_owned(),
                        kind: DeviceContactSuggestionKindV1::MergeAccounts,
                        label: "Ada Lovelace".to_owned(),
                        person_id: None,
                        reason: Some("Exact name".to_owned()),
                    }),
                },
                DeviceContactMatchResultV1 {
                    resource_name: "people/grace".to_owned(),
                    suggestion: None,
                },
            ],
            schema_version: 1,
        };
        assert!(
            mutate_device_contact_sync_v1(&mut connection, &matches)
                .expect("match")
                .changed
        );
        assert!(query_device_contact_match_page_v1(
            &connection,
            &DeviceContactMatchPageRequestV1 {
                after_resource_name: None,
                generation_id: "contacts-1".to_owned(),
                limit: 64,
                query_id: "device_contact_match_page_v1".to_owned(),
                schema_version: 1,
            },
        )
        .expect("matched page")
        .rows
        .is_empty());
        let activate = DeviceContactSyncMutationV1::DeviceContactGenerationActivateV1 {
            activated_at: 130,
            expected_contact_count: 2,
            generation_id: "contacts-1".to_owned(),
            next_sync_token: "token-1".to_owned(),
            schema_version: 1,
        };
        let receipt = mutate_device_contact_sync_v1(&mut connection, &activate).expect("activate");
        assert!(receipt.changed);
        assert_eq!(receipt.active_generation_id.as_deref(), Some("contacts-1"));
        assert!(
            !mutate_device_contact_sync_v1(&mut connection, &activate)
                .expect("activate retry")
                .changed
        );
        assert_eq!(connection.query_row("SELECT count(*) FROM library_device_contacts WHERE generation_id = 'contacts-1';", [], |row| row.get::<_, i64>(0)).expect("count"), 2);
        let status = query_device_contact_status_v1(
            &connection,
            &DeviceContactStatusRequestV1 {
                query_id: "device_contact_status_v1".to_owned(),
                schema_version: 1,
            },
        )
        .expect("status");
        assert_eq!(status.active_contact_count, 2);
        assert_eq!(status.pending_suggestion_count, 1);
        assert_eq!(status.sync_token.as_deref(), Some("token-1"));
        let suggestions = query_device_contact_suggestion_page_v1(
            &connection,
            &DeviceContactSuggestionPageRequestV1 {
                cursor: None,
                limit: 50,
                query_id: "device_contact_suggestion_page_v1".to_owned(),
                schema_version: 1,
            },
        )
        .expect("suggestions");
        assert_eq!(suggestions.rows.len(), 1);
        assert_eq!(suggestions.rows[0].contact.resource_name, "people/ada");
        let unmatched = query_device_contact_unmatched_page_v1(
            &connection,
            &DeviceContactUnmatchedPageRequestV1 {
                cursor: None,
                limit: 50,
                query_id: "device_contact_unmatched_page_v1".to_owned(),
                schema_version: 1,
            },
        )
        .expect("unmatched");
        assert_eq!(unmatched.rows, vec![unmatched_contact]);
        connection
            .execute(
                "INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                 VALUES ('person:grace', 'Grace Hopper', 'friend', 3, 140, 140);",
                [],
            )
            .expect("created friend");
        connection
            .execute(
                "INSERT INTO library_accounts
                   (id, person_id, kind, provider, external_id, first_seen_at, last_seen_at,
                    discovered_from, created_at, updated_at)
                 VALUES ('contact:google:people/grace', 'person:grace', 'contact',
                         'google_contacts', 'people/grace', 140, 140,
                         'contact_import', 140, 140);",
                [],
            )
            .expect("linked contact account");
        assert!(query_device_contact_unmatched_page_v1(
            &connection,
            &DeviceContactUnmatchedPageRequestV1 {
                cursor: None,
                limit: 50,
                query_id: "device_contact_unmatched_page_v1".to_owned(),
                schema_version: 1,
            },
        )
        .expect("linked contact excluded")
        .rows
        .is_empty());
        assert_eq!(
            query_device_contact_status_v1(
                &connection,
                &DeviceContactStatusRequestV1 {
                    query_id: "device_contact_status_v1".to_owned(),
                    schema_version: 1,
                },
            )
            .expect("derived friend count")
            .created_friend_count,
            1
        );
    }

    #[test]
    fn native_contact_generation_recovers_only_after_sync_is_marked_interrupted() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        mutate_device_contact_sync_v1(
            &mut connection,
            &DeviceContactSyncMutationV1::DeviceContactGenerationBeginV1 {
                generation_id: "contacts-stale".to_owned(),
                schema_version: 1,
                started_at: 100,
            },
        )
        .expect("stale begin");
        let concurrent = mutate_device_contact_sync_v1(
            &mut connection,
            &DeviceContactSyncMutationV1::DeviceContactGenerationBeginV1 {
                generation_id: "contacts-concurrent".to_owned(),
                schema_version: 1,
                started_at: 110,
            },
        );
        assert!(matches!(
            concurrent,
            Err(DeviceContactSyncError::Invalid(_))
        ));
        mutate_device_contact_sync_v1(
            &mut connection,
            &DeviceContactSyncMutationV1::DeviceContactStatusSetV1 {
                auth_status: DeviceContactAuthStatusV1::Connected,
                error_code: Some(DeviceContactErrorCodeV1::Network),
                error_message: Some("interrupted".to_owned()),
                schema_version: 1,
                sync_started_at: None,
                sync_status: DeviceContactSyncStatusV1::Error,
                updated_at: 120,
            },
        )
        .expect("mark interrupted");
        let recovered = mutate_device_contact_sync_v1(
            &mut connection,
            &DeviceContactSyncMutationV1::DeviceContactGenerationBeginV1 {
                generation_id: "contacts-recovered".to_owned(),
                schema_version: 1,
                started_at: 130,
            },
        )
        .expect("recover begin");
        assert!(recovered.changed);
        let building = connection
            .query_row(
                "SELECT generation_id FROM library_device_contact_generations WHERE state = 'building';",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("building generation");
        assert_eq!(building, "contacts-recovered");
    }

    #[test]
    fn native_contact_json_is_closed_and_digest_is_stable() {
        let parsed: DeviceContactSyncMutationV1 = serde_json::from_str(
            r#"{"batchOrdinal":0,"contacts":[],"deletedResourceNames":["people/deleted"],"generationId":"contacts-1","mutationKind":"device_contact_delta_append_v1","schemaVersion":1,"updatedAt":110}"#,
        ).expect("shared mutation");
        assert_eq!(
            digest_device_contact_sync_mutation_v1(&parsed).expect("digest"),
            "966cf9a2505a7ddcae8260bacab9aaa4aaa109a609f668a9359d962c4be6fccd"
        );
        assert!(serde_json::from_str::<DeviceContactSyncMutationV1>(
            r#"{"extra":true,"generationId":"contacts-1","mutationKind":"device_contact_generation_begin_v1","schemaVersion":1,"startedAt":100}"#,
        ).is_err());
    }
}
