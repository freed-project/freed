use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::fs::{FileExt, FileTypeExt, MetadataExt};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::library_core_bound_root::{file_from_duplicated_descriptor, LibraryCoreBoundRoot};
use crate::library_core_bound_sqlite_vfs::BoundSqliteDatabase;
use crate::normalized_sqlite::{
    configure_normalized_sqlite_connection, normalized_sqlite_open_flags,
};
use crate::sqlite_contract_generated::{
    NATIVE_COMMAND_MAXIMUM_FRAME_BYTES, NATIVE_COMMAND_PROTOCOL_VERSION,
};
use crate::{
    accept_normalized_operation_transaction_v1, append_normalized_checkpoint_stage_page_v2,
    begin_normalized_checkpoint_stage_v2, describe_normalized_checkpoint_export_v2,
    export_normalized_follower_result_page_v1, export_pinned_normalized_checkpoint_page_v2,
    finalize_normalized_checkpoint_stage_v2, get_content_state_v1,
    ingest_normalized_follower_intent_page_v1, lower_hex,
    normalized_primary_follower_actor_transport_state_v1, normalized_primary_mutation_context_v1,
    page_eviction_candidates_v1, page_hydration_candidates_v1, query_normalized_json_v1,
    set_content_policy_v1, sign_library_core_operation_digest, ActorKeyStore, AuthorityKeyStore,
    BeginNormalizedCheckpointStageV2, ContentPolicyMutationV1, ContentStateRequestV1,
    EvictionCandidatePageRequestV1, HydrationCandidatePageRequestV1, LibraryCoreProcessLease,
    NormalizedCheckpointRecordV2, NormalizedFollowerIntentStagePageV1,
    NormalizedFollowerResultPageRequestV1, NormalizedSqliteError,
    PinnedNormalizedCheckpointExportRequestV2, ProcessLeaseIdentity, SelectiveContentError,
};

const PROTOCOL_VERSION: u8 = 2;
const EXECUTABLE_FD: RawFd = 3;
const DATA_ROOT_FD: RawFd = 4;
const STATE_ROOT_FD: RawFd = 5;
const ADMISSION_FD: RawFd = 6;
const CREDENTIAL_DESCRIPTOR_FD: RawFd = 7;
const LIFETIME_FD: RawFd = 8;
const COMMAND_REQUEST_FD: RawFd = 9;
const COMMAND_RESPONSE_FD: RawFd = 10;
const MAX_CONTROL_BYTES: usize = 4 * 1_024;
const MAX_ADMISSION_BYTES: usize = 64 * 1_024;
const MAX_CREDENTIAL_DESCRIPTOR_BYTES: usize = 4 * 1_024;
const MAX_MOUNTED_CREDENTIAL_BYTES: usize = 64 * 1_024;
const MOUNTED_CREDENTIAL_READ_BUFFER_BYTES: usize = 8 * 1_024;
const MOUNTED_CREDENTIAL_DIRECTORY: &str = "mounted-credentials";
const NORMALIZED_LIBRARY_DIRECTORY: &str = "library-sqlite";
const SIDECAR_IDENTITY: ProcessLeaseIdentity<'static> =
    ProcessLeaseIdentity::new("library-authority-sidecar", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct LibraryCoreSidecarError(&'static str);

impl std::fmt::Display for LibraryCoreSidecarError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for LibraryCoreSidecarError {}

fn failure(code: &'static str) -> LibraryCoreSidecarError {
    LibraryCoreSidecarError(code)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartEnvelope {
    r#type: String,
    protocol_version: u8,
    role: String,
    parent_nonce: String,
    config_digest: String,
    executable_digest: String,
    executable_fd: RawFd,
    data_root_fd: RawFd,
    state_root_fd: RawFd,
    admission_fd: RawFd,
    credential_descriptor_fd: RawFd,
    lifetime_fd: RawFd,
    command_request_fd: RawFd,
    command_response_fd: RawFd,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdmissionRecord {
    format: String,
    schema_version: u8,
    role: String,
    config_digest: String,
    executable_digest: String,
    data_root_device: String,
    data_root_inode: String,
    state_root_device: String,
    state_root_inode: String,
    credential_descriptor_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CredentialDescriptor {
    schema_version: u8,
    backend: String,
    record_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MountedPrimaryCredentialV1 {
    format: String,
    schema_version: u8,
    library_id: String,
    authority_key_pkcs8_base64: String,
    actor_key_pkcs8_base64: String,
}

impl Drop for MountedPrimaryCredentialV1 {
    fn drop(&mut self) {
        self.authority_key_pkcs8_base64.zeroize();
        self.actor_key_pkcs8_base64.zeroize();
    }
}

struct MountedPrimaryCredentials {
    library_id: String,
    authority_key_pkcs8: Zeroizing<Vec<u8>>,
    actor_key_pkcs8: Zeroizing<Vec<u8>>,
}

struct MountedAuthorityKeyStore<'a>(&'a MountedPrimaryCredentials);

impl AuthorityKeyStore for MountedAuthorityKeyStore<'_> {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String> {
        if library_id != self.0.library_id {
            return Err("mounted authority key Library identity changed".to_string());
        }
        Ok(Some(self.0.authority_key_pkcs8.to_vec()))
    }

    fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
        Err("mounted authority key store is read only".to_string())
    }
}

struct MountedActorKeyStore<'a>(&'a MountedPrimaryCredentials);

impl ActorKeyStore for MountedActorKeyStore<'_> {
    fn load(&self, library_id: &str) -> Result<Option<Vec<u8>>, String> {
        if library_id != self.0.library_id {
            return Err("mounted actor key Library identity changed".to_string());
        }
        Ok(Some(self.0.actor_key_pkcs8.to_vec()))
    }

    fn store(&self, _library_id: &str, _bytes: &[u8]) -> Result<(), String> {
        Err("mounted actor key store is read only".to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyRecord<'a> {
    r#type: &'static str,
    protocol_version: u8,
    role: &'static str,
    pid: u32,
    lease_held: bool,
    authority_open: bool,
    admission_accepted: bool,
    credentials_ready: bool,
    watchdog_active: bool,
    command_channel_ready: bool,
    parent_nonce: &'a str,
    config_digest: &'a str,
    executable_digest: &'a str,
    data_root_device: String,
    data_root_inode: String,
    state_root_device: String,
    state_root_inode: String,
    admission_digest: String,
    credential_descriptor_digest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeCommandRequestV1 {
    protocol_version: u32,
    request_id: String,
    command_id: String,
    payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCommandResponseV1<'a> {
    protocol_version: u32,
    request_id: &'a str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<&'static str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppendCheckpointStageCommandV2 {
    stage_id: String,
    records: Vec<NormalizedCheckpointRecordV2>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FinalizeCheckpointStageCommandV2 {
    stage_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignOperationCommandV1 {
    library_id: String,
    epoch_id: String,
    actor_id: String,
    actor_public_key: String,
    operation_signing_body_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignOperationReceiptV1 {
    actor_id: String,
    operation_signing_body_digest: String,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitTransactionCommandV1 {
    library_id: String,
    canonical_envelope_json: Vec<String>,
    committed_at_ms: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IngestFollowerIntentPageCommandV1 {
    page: NormalizedFollowerIntentStagePageV1,
    received_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrimaryFollowerActorTransportStateCommandV1 {
    actor_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyCommandPayload {}

/// Native normalized Library authority owned by one inherited data-root descriptor.
struct LibraryCoreSidecarAuthority {
    database: BoundSqliteDatabase,
    _lease: LibraryCoreProcessLease,
    _root: LibraryCoreBoundRoot,
    _normalized_root: LibraryCoreBoundRoot,
}

impl LibraryCoreSidecarAuthority {
    fn open_from_inherited_descriptor(descriptor: RawFd) -> Result<Self, LibraryCoreSidecarError> {
        let root = LibraryCoreBoundRoot::from_inherited_descriptor(descriptor)
            .map_err(|_| failure("data_root_invalid"))?;
        if !root.is_private_for(unsafe { libc::geteuid() }) {
            return Err(failure("root_not_private"));
        }
        let lease = LibraryCoreProcessLease::acquire_bound(&root, SIDECAR_IDENTITY)
            .map_err(|_| failure("lease_unavailable"))?;
        if !lease.owns_lock() {
            return Err(failure("lease_unavailable"));
        }
        let normalized_directory = root
            .open_or_create_private_directory(NORMALIZED_LIBRARY_DIRECTORY)
            .map_err(|_| failure("authority_open_failed"))?;
        let normalized_root =
            LibraryCoreBoundRoot::from_inherited_descriptor(normalized_directory.as_raw_fd())
                .map_err(|_| failure("authority_open_failed"))?;
        let database = BoundSqliteDatabase::from_directory(
            normalized_directory
                .try_clone()
                .map_err(|_| failure("authority_open_failed"))?,
        )
        .map_err(|_| failure("authority_open_failed"))?;
        let connection = database
            .open(normalized_sqlite_open_flags(true))
            .map_err(|_| failure("authority_open_failed"))?;
        configure_normalized_sqlite_connection(&connection)
            .map_err(|_| failure("authority_open_failed"))?;
        drop(connection);
        Ok(Self {
            database,
            _lease: lease,
            _root: root,
            _normalized_root: normalized_root,
        })
    }

    fn connect(&self) -> Result<rusqlite::Connection, LibraryCoreSidecarError> {
        let connection = self
            .database
            .open(normalized_sqlite_open_flags(false))
            .map_err(|_| failure("authority_open_failed"))?;
        configure_normalized_sqlite_connection(&connection)
            .map_err(|_| failure("authority_open_failed"))?;
        Ok(connection)
    }
}

/// Run the fixed fd3 through fd8 sidecar protocol until the lifetime pipe
/// closes. The function emits no error details and never opens a listener.
pub fn run_library_authority_sidecar() -> Result<(), LibraryCoreSidecarError> {
    let envelope = read_start_envelope()?;
    let executable_digest = sha256_descriptor(EXECUTABLE_FD)?;
    if executable_digest != envelope.executable_digest {
        return Err(failure("executable_digest_mismatch"));
    }

    let data_root = LibraryCoreBoundRoot::from_inherited_descriptor(DATA_ROOT_FD)
        .map_err(|_| failure("data_root_invalid"))?;
    let state_root = LibraryCoreBoundRoot::from_inherited_descriptor(STATE_ROOT_FD)
        .map_err(|_| failure("state_root_invalid"))?;
    let process_owner = unsafe { libc::geteuid() };
    if !data_root.is_private_for(process_owner) || !state_root.is_private_for(process_owner) {
        return Err(failure("root_not_private"));
    }
    if data_root.device() == state_root.device() && data_root.inode() == state_root.inode() {
        return Err(failure("root_identity_collision"));
    }

    let credential_bytes = read_private_regular_descriptor(
        CREDENTIAL_DESCRIPTOR_FD,
        MAX_CREDENTIAL_DESCRIPTOR_BYTES,
        process_owner,
    )?;
    let credential_descriptor_digest = sha256_bytes(&credential_bytes);
    let credential: CredentialDescriptor = serde_json::from_slice(&credential_bytes)
        .map_err(|_| failure("credential_descriptor_invalid"))?;
    validate_credential_descriptor(&credential)?;
    let primary_credentials = read_primary_credentials(&state_root, &credential)?;

    let admission_bytes =
        read_private_regular_descriptor(ADMISSION_FD, MAX_ADMISSION_BYTES, process_owner)?;
    let admission_digest = sha256_bytes(&admission_bytes);
    let admission: AdmissionRecord =
        serde_json::from_slice(&admission_bytes).map_err(|_| failure("admission_invalid"))?;
    validate_admission(
        &admission,
        &envelope,
        &data_root,
        &state_root,
        &credential_descriptor_digest,
    )?;
    validate_lifetime_descriptor(LIFETIME_FD)?;
    validate_command_descriptor(COMMAND_REQUEST_FD)?;
    validate_command_descriptor(COMMAND_RESPONSE_FD)?;

    let authority = LibraryCoreSidecarAuthority::open_from_inherited_descriptor(DATA_ROOT_FD)?;
    let connection = authority.connect()?;
    assert_primary_credentials_match_storage(&connection, &primary_credentials)?;
    drop(connection);
    start_command_loop(authority.database.clone(), primary_credentials)?;

    let ready = ReadyRecord {
        r#type: "ready",
        protocol_version: PROTOCOL_VERSION,
        role: "primary",
        pid: std::process::id(),
        lease_held: true,
        authority_open: true,
        admission_accepted: true,
        credentials_ready: true,
        watchdog_active: true,
        command_channel_ready: true,
        parent_nonce: &envelope.parent_nonce,
        config_digest: &envelope.config_digest,
        executable_digest: &executable_digest,
        data_root_device: data_root.device().to_string(),
        data_root_inode: data_root.inode().to_string(),
        state_root_device: state_root.device().to_string(),
        state_root_inode: state_root.inode().to_string(),
        admission_digest,
        credential_descriptor_digest,
    };
    write_ready_record(&ready)?;
    wait_for_lifetime_close(LIFETIME_FD)?;
    drop(authority);
    Ok(())
}

fn start_command_loop(
    database: BoundSqliteDatabase,
    credentials: MountedPrimaryCredentials,
) -> Result<(), LibraryCoreSidecarError> {
    let request = unsafe { File::from_raw_fd(COMMAND_REQUEST_FD) };
    let response = unsafe { File::from_raw_fd(COMMAND_RESPONSE_FD) };
    std::thread::Builder::new()
        .name("freed-library-command-v1".to_string())
        .spawn(move || {
            if run_command_loop(database, credentials, request, response).is_err() {
                std::process::exit(1);
            }
        })
        .map_err(|_| failure("command_channel_unavailable"))?;
    Ok(())
}

fn run_command_loop(
    database: BoundSqliteDatabase,
    credentials: MountedPrimaryCredentials,
    mut request: File,
    mut response: File,
) -> Result<(), LibraryCoreSidecarError> {
    loop {
        let payload = read_command_frame(&mut request)?;
        let command: NativeCommandRequestV1 =
            serde_json::from_slice(&payload).map_err(|_| failure("command_invalid"))?;
        if command.protocol_version != NATIVE_COMMAND_PROTOCOL_VERSION
            || !valid_digest(&command.request_id)
        {
            return Err(failure("command_invalid"));
        }
        let mut connection = database
            .open(normalized_sqlite_open_flags(false))
            .map_err(|_| failure("command_storage_failed"))?;
        configure_normalized_sqlite_connection(&connection)
            .map_err(|_| failure("command_storage_failed"))?;
        let outcome = execute_native_command_v1(
            &mut connection,
            &credentials,
            command.command_id.as_str(),
            command.payload,
        );
        let response_record = match outcome {
            Ok(result) => NativeCommandResponseV1 {
                protocol_version: NATIVE_COMMAND_PROTOCOL_VERSION,
                request_id: &command.request_id,
                ok: true,
                result: Some(result),
                error_code: None,
            },
            Err(error_code) => NativeCommandResponseV1 {
                protocol_version: NATIVE_COMMAND_PROTOCOL_VERSION,
                request_id: &command.request_id,
                ok: false,
                result: None,
                error_code: Some(error_code),
            },
        };
        write_command_frame(&mut response, &response_record)?;
    }
}

fn execute_native_command_v1(
    connection: &mut rusqlite::Connection,
    credentials: &MountedPrimaryCredentials,
    command_id: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    match command_id {
        "append_checkpoint_stage_v2" => {
            let command: AppendCheckpointStageCommandV2 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                append_normalized_checkpoint_stage_page_v2(
                    connection,
                    &command.stage_id,
                    &command.records,
                )
                .map_err(normalized_command_error)?,
            )
        }
        "begin_checkpoint_stage_v2" => {
            let command: BeginNormalizedCheckpointStageV2 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                begin_normalized_checkpoint_stage_v2(connection, &command)
                    .map_err(normalized_command_error)?,
            )
        }
        "commit_transaction_v1" => {
            let command: CommitTransactionCommandV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            if command.committed_at_ms < 0
                || command.library_id != credentials.library_id
                || command.canonical_envelope_json.is_empty()
                || command.canonical_envelope_json.len()
                    > crate::sqlite_contract_generated::OPERATION_TRANSACTION_MAXIMUM_MEMBERS
                || command.canonical_envelope_json.iter().any(|member| {
                    member.is_empty()
                        || member.len()
                            > crate::sqlite_contract_generated::CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES
                })
                || command
                    .canonical_envelope_json
                    .iter()
                    .try_fold(0_usize, |total, member| total.checked_add(member.len()))
                    .is_none_or(|total| {
                        total
                            > crate::sqlite_contract_generated::OPERATION_TRANSACTION_MAXIMUM_BYTES
                    })
            {
                return Err("request_invalid");
            }
            let canonical_envelopes = command
                .canonical_envelope_json
                .into_iter()
                .map(String::into_bytes)
                .collect::<Vec<_>>();
            let authority_store = MountedAuthorityKeyStore(credentials);
            let authority_key_pair =
                crate::load_established_authority_key_pair(&authority_store, &command.library_id)
                    .map_err(|_| "credential_invalid")?;
            encode_command_result(
                accept_normalized_operation_transaction_v1(
                    connection,
                    &canonical_envelopes,
                    &authority_key_pair,
                    command.committed_at_ms,
                )
                .map_err(normalized_command_error)?,
            )
        }
        "content_policy_set_v1" => {
            let command: ContentPolicyMutationV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                set_content_policy_v1(connection, &command).map_err(selective_content_error)?,
            )
        }
        "content_eviction_candidates_page_v1" => {
            let command: EvictionCandidatePageRequestV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                page_eviction_candidates_v1(connection, &command)
                    .map_err(selective_content_error)?,
            )
        }
        "content_hydration_candidates_page_v1" => {
            let command: HydrationCandidatePageRequestV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                page_hydration_candidates_v1(connection, &command)
                    .map_err(selective_content_error)?,
            )
        }
        "content_state_get_v1" => {
            let command: ContentStateRequestV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                get_content_state_v1(connection, &command).map_err(selective_content_error)?,
            )
        }
        "describe_checkpoint_export_v2" => {
            serde_json::from_value::<EmptyCommandPayload>(payload)
                .map_err(|_| "request_invalid")?;
            encode_command_result(
                describe_normalized_checkpoint_export_v2(connection)
                    .map_err(normalized_command_error)?,
            )
        }
        "export_checkpoint_page_v2" => {
            let command: PinnedNormalizedCheckpointExportRequestV2 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                export_pinned_normalized_checkpoint_page_v2(connection, &command)
                    .map_err(normalized_command_error)?,
            )
        }
        "export_follower_result_page_v1" => {
            let command: NormalizedFollowerResultPageRequestV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                export_normalized_follower_result_page_v1(connection, &command)
                    .map_err(normalized_command_error)?,
            )
        }
        "finalize_checkpoint_stage_v2" => {
            let command: FinalizeCheckpointStageCommandV2 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                finalize_normalized_checkpoint_stage_v2(connection, &command.stage_id)
                    .map_err(normalized_command_error)?,
            )
        }
        "inspect_storage_v1" => {
            serde_json::from_value::<EmptyCommandPayload>(payload)
                .map_err(|_| "request_invalid")?;
            inspect_normalized_storage_v1(connection)
        }
        "ingest_follower_intent_page_v1" => {
            let command: IngestFollowerIntentPageCommandV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            let authority_store = MountedAuthorityKeyStore(credentials);
            let authority_key_pair = crate::load_established_authority_key_pair(
                &authority_store,
                &credentials.library_id,
            )
            .map_err(|_| "credential_invalid")?;
            encode_command_result(
                ingest_normalized_follower_intent_page_v1(
                    connection,
                    &command.page,
                    &authority_key_pair,
                    command.received_at,
                )
                .map_err(normalized_command_error)?,
            )
        }
        "primary_follower_actor_transport_state_v1" => {
            let command: PrimaryFollowerActorTransportStateCommandV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            encode_command_result(
                normalized_primary_follower_actor_transport_state_v1(connection, &command.actor_id)
                    .map_err(normalized_command_error)?,
            )
        }
        "primary_mutation_context_v1" => {
            serde_json::from_value::<EmptyCommandPayload>(payload)
                .map_err(|_| "request_invalid")?;
            encode_command_result(
                normalized_primary_mutation_context_v1(connection)
                    .map_err(normalized_command_error)?,
            )
        }
        "query_v1" => {
            query_normalized_json_v1(connection, payload).map_err(normalized_command_error)
        }
        "sign_operation_v1" => {
            let command: SignOperationCommandV1 =
                serde_json::from_value(payload).map_err(|_| "request_invalid")?;
            let context = normalized_primary_mutation_context_v1(connection)
                .map_err(normalized_command_error)?;
            if command.library_id != credentials.library_id
                || command.library_id != context.library_id
                || command.epoch_id != context.epoch_id
                || command.actor_id != context.actor_id
                || command.actor_public_key != context.actor_public_key
            {
                return Err("request_invalid");
            }
            let signature = sign_library_core_operation_digest(
                &MountedActorKeyStore(credentials),
                &command.library_id,
                &command.actor_public_key,
                &command.operation_signing_body_digest,
            )
            .map_err(|_| "credential_invalid")?;
            encode_command_result(SignOperationReceiptV1 {
                actor_id: command.actor_id,
                operation_signing_body_digest: command.operation_signing_body_digest,
                signature,
            })
        }
        _ => Err("command_unknown"),
    }
}

fn encode_command_result<T: Serialize>(value: T) -> Result<Value, &'static str> {
    serde_json::to_value(value).map_err(|_| "response_invalid")
}

fn inspect_normalized_storage_v1(connection: &rusqlite::Connection) -> Result<Value, &'static str> {
    let (contract_version, schema_version, protocol_version, schema_sha256): (
        u32,
        u32,
        u32,
        String,
    ) = connection
        .query_row(
            "SELECT contract_version, schema_version, protocol_version, schema_sha256
             FROM library_storage_meta WHERE singleton_id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| "storage_unavailable")?;
    let authority = connection
        .query_row(
            "SELECT meta.library_id, meta.authority_epoch, meta.source_revision, active.writer_id
             FROM library_meta AS meta
             JOIN library_active_authority AS active
               ON active.active_key = 'active'
              AND active.library_id = meta.library_id
              AND active.epoch_id = meta.authority_epoch
             WHERE meta.singleton_id = 1",
            [],
            |row| {
                Ok(json!({
                    "authorityEpoch": row.get::<_, String>(1)?,
                    "libraryId": row.get::<_, String>(0)?,
                    "sourceRevision": row.get::<_, u64>(2)?,
                    "writerId": row.get::<_, String>(3)?,
                }))
            },
        )
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(Value::Null),
            error => Err(error),
        })
        .map_err(|_| "storage_unavailable")?;
    Ok(json!({
        "activeAuthority": authority,
        "applicationId": crate::sqlite_contract_generated::SQLITE_APPLICATION_ID,
        "contractVersion": contract_version,
        "protocolVersion": protocol_version,
        "schemaSha256": schema_sha256,
        "schemaVersion": schema_version,
    }))
}

fn assert_primary_credentials_match_storage(
    connection: &rusqlite::Connection,
    credentials: &MountedPrimaryCredentials,
) -> Result<(), LibraryCoreSidecarError> {
    let stored_library_id = connection
        .query_row(
            "SELECT library_id FROM library_meta WHERE singleton_id = 1;",
            [],
            |row| row.get::<_, String>(0),
        )
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(String::new()),
            error => Err(error),
        })
        .map_err(|_| failure("credential_invalid"))?;
    if !stored_library_id.is_empty() && stored_library_id != credentials.library_id {
        return Err(failure("credential_invalid"));
    }

    let authority_public_key = lower_hex(
        Ed25519KeyPair::from_pkcs8(&credentials.authority_key_pkcs8)
            .map_err(|_| failure("credential_invalid"))?
            .public_key()
            .as_ref(),
    );
    let stored_authority_public_key = connection
        .query_row(
            "SELECT epoch.authority_public_key
             FROM library_active_authority AS active
             JOIN library_authority_epochs AS epoch ON epoch.epoch_id = active.epoch_id
             WHERE active.active_key = 'active';",
            [],
            |row| row.get::<_, String>(0),
        )
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(String::new()),
            error => Err(error),
        })
        .map_err(|_| failure("credential_invalid"))?;
    if !stored_authority_public_key.is_empty()
        && stored_authority_public_key != authority_public_key
    {
        return Err(failure("credential_invalid"));
    }

    if let Ok(context) = normalized_primary_mutation_context_v1(connection) {
        let actor_public_key = lower_hex(
            Ed25519KeyPair::from_pkcs8(&credentials.actor_key_pkcs8)
                .map_err(|_| failure("credential_invalid"))?
                .public_key()
                .as_ref(),
        );
        if context.library_id != credentials.library_id
            || context.actor_public_key != actor_public_key
        {
            return Err(failure("credential_invalid"));
        }
    }
    Ok(())
}

fn normalized_command_error(error: NormalizedSqliteError) -> &'static str {
    match error {
        NormalizedSqliteError::Content(_)
        | NormalizedSqliteError::InvalidRequest(_)
        | NormalizedSqliteError::Transport(_) => "request_invalid",
        NormalizedSqliteError::Protocol(_) | NormalizedSqliteError::Sqlite(_) => "command_failed",
    }
}

fn selective_content_error(error: SelectiveContentError) -> &'static str {
    match error {
        SelectiveContentError::Invalid(_) => "request_invalid",
        SelectiveContentError::Io(_) | SelectiveContentError::Sqlite(_) => "command_failed",
    }
}

fn read_command_frame(reader: &mut File) -> Result<Vec<u8>, LibraryCoreSidecarError> {
    let mut length = [0_u8; 4];
    reader
        .read_exact(&mut length)
        .map_err(|_| failure("command_channel_closed"))?;
    let length =
        usize::try_from(u32::from_be_bytes(length)).map_err(|_| failure("command_invalid"))?;
    if length == 0 || length > NATIVE_COMMAND_MAXIMUM_FRAME_BYTES {
        return Err(failure("command_invalid"));
    }
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|_| failure("command_channel_closed"))?;
    Ok(payload)
}

fn write_command_frame<T: Serialize>(
    writer: &mut File,
    response: &T,
) -> Result<(), LibraryCoreSidecarError> {
    let payload = serde_json::to_vec(response).map_err(|_| failure("response_invalid"))?;
    if payload.is_empty() || payload.len() > NATIVE_COMMAND_MAXIMUM_FRAME_BYTES {
        return Err(failure("response_invalid"));
    }
    let length = u32::try_from(payload.len()).map_err(|_| failure("response_invalid"))?;
    writer
        .write_all(&length.to_be_bytes())
        .and_then(|()| writer.write_all(&payload))
        .and_then(|()| writer.flush())
        .map_err(|_| failure("command_channel_closed"))
}

fn read_start_envelope() -> Result<StartEnvelope, LibraryCoreSidecarError> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((MAX_CONTROL_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| failure("control_read_failed"))?;
    if bytes.is_empty() || bytes.len() > MAX_CONTROL_BYTES || !bytes.ends_with(b"\n") {
        return Err(failure("control_invalid"));
    }
    let payload = &bytes[..bytes.len() - 1];
    if payload.is_empty() || payload.contains(&b'\n') {
        return Err(failure("control_invalid"));
    }
    let envelope: StartEnvelope =
        serde_json::from_slice(payload).map_err(|_| failure("control_invalid"))?;
    if envelope.r#type != "start"
        || envelope.protocol_version != PROTOCOL_VERSION
        || envelope.role != "primary"
        || !valid_digest(&envelope.parent_nonce)
        || !valid_digest(&envelope.config_digest)
        || !valid_digest(&envelope.executable_digest)
        || envelope.executable_fd != EXECUTABLE_FD
        || envelope.data_root_fd != DATA_ROOT_FD
        || envelope.state_root_fd != STATE_ROOT_FD
        || envelope.admission_fd != ADMISSION_FD
        || envelope.credential_descriptor_fd != CREDENTIAL_DESCRIPTOR_FD
        || envelope.lifetime_fd != LIFETIME_FD
        || envelope.command_request_fd != COMMAND_REQUEST_FD
        || envelope.command_response_fd != COMMAND_RESPONSE_FD
    {
        return Err(failure("control_invalid"));
    }
    Ok(envelope)
}

fn validate_admission(
    admission: &AdmissionRecord,
    envelope: &StartEnvelope,
    data_root: &LibraryCoreBoundRoot,
    state_root: &LibraryCoreBoundRoot,
    credential_descriptor_digest: &str,
) -> Result<(), LibraryCoreSidecarError> {
    if admission.format != "freed_library_service_admission_v1"
        || admission.schema_version != 1
        || admission.role != "primary"
        || admission.config_digest != envelope.config_digest
        || admission.executable_digest != envelope.executable_digest
        || admission.data_root_device != data_root.device().to_string()
        || admission.data_root_inode != data_root.inode().to_string()
        || admission.state_root_device != state_root.device().to_string()
        || admission.state_root_inode != state_root.inode().to_string()
        || admission.credential_descriptor_digest != credential_descriptor_digest
    {
        return Err(failure("admission_invalid"));
    }
    Ok(())
}

fn validate_credential_descriptor(
    descriptor: &CredentialDescriptor,
) -> Result<(), LibraryCoreSidecarError> {
    if descriptor.schema_version != 1 || !valid_record_id(&descriptor.record_id) {
        return Err(failure("credential_descriptor_invalid"));
    }
    if descriptor.backend != "mounted-credential" {
        return Err(failure("credential_backend_unavailable"));
    }
    Ok(())
}

fn read_primary_credentials(
    state_root: &LibraryCoreBoundRoot,
    descriptor: &CredentialDescriptor,
) -> Result<MountedPrimaryCredentials, LibraryCoreSidecarError> {
    let directory_descriptor =
        openat_readonly(state_root.descriptor(), MOUNTED_CREDENTIAL_DIRECTORY, true)?;
    let directory_metadata = directory_descriptor
        .metadata()
        .map_err(|_| failure("credential_unavailable"))?;
    if !directory_metadata.file_type().is_dir()
        || directory_metadata.uid() != state_root.owner()
        || directory_metadata.mode() & 0o7777 != 0o700
    {
        return Err(failure("credential_unavailable"));
    }
    let mut credential = openat_readonly(
        directory_descriptor.as_raw_fd(),
        &descriptor.record_id,
        false,
    )?;
    read_open_primary_credentials(&mut credential, state_root.owner(), || {})
}

fn read_open_primary_credentials<F>(
    credential: &mut File,
    owner: u32,
    after_initial_metadata: F,
) -> Result<MountedPrimaryCredentials, LibraryCoreSidecarError>
where
    F: FnOnce(),
{
    let initial_metadata = credential
        .metadata()
        .map_err(|_| failure("credential_unavailable"))?;
    if !credential_metadata_is_private(&initial_metadata, owner) {
        return Err(failure("credential_unavailable"));
    }
    after_initial_metadata();

    let credential_bytes = read_bounded_credential_bytes(credential)?;
    let final_metadata = credential
        .metadata()
        .map_err(|_| failure("credential_unavailable"))?;
    // This slice proves only exact access to one private mounted record. Its
    // bytes stay opaque until task 11.5 defines an approved secret format.
    if final_metadata.dev() != initial_metadata.dev()
        || final_metadata.ino() != initial_metadata.ino()
        || final_metadata.len() != initial_metadata.len()
        || final_metadata.len() != credential_bytes.len() as u64
        || !credential_metadata_is_private(&final_metadata, owner)
    {
        return Err(failure("credential_unavailable"));
    }
    parse_primary_credentials(&credential_bytes)
}

fn read_bounded_credential_bytes<R: Read>(
    reader: &mut R,
) -> Result<Zeroizing<Vec<u8>>, LibraryCoreSidecarError> {
    let mut bytes = Zeroizing::new(Vec::new());
    let mut buffer = Zeroizing::new([0u8; MOUNTED_CREDENTIAL_READ_BUFFER_BYTES]);
    loop {
        let remaining = MAX_MOUNTED_CREDENTIAL_BYTES + 1 - bytes.len();
        let read_limit = remaining.min(buffer.len());
        let count = reader
            .read(&mut buffer[..read_limit])
            .map_err(|_| failure("credential_unavailable"))?;
        if count == 0 {
            buffer.zeroize();
            return Ok(bytes);
        }
        bytes.extend_from_slice(&buffer[..count]);
        buffer[..count].zeroize();
        if bytes.len() > MAX_MOUNTED_CREDENTIAL_BYTES {
            return Err(failure("credential_unavailable"));
        }
    }
}

fn parse_primary_credentials(
    bytes: &[u8],
) -> Result<MountedPrimaryCredentials, LibraryCoreSidecarError> {
    let envelope: MountedPrimaryCredentialV1 =
        serde_json::from_slice(bytes).map_err(|_| failure("credential_invalid"))?;
    if envelope.format != "freed_library_primary_credentials_v1"
        || envelope.schema_version != 1
        || !valid_digest(&envelope.library_id)
    {
        return Err(failure("credential_invalid"));
    }
    let authority_key_pkcs8 = Zeroizing::new(
        BASE64
            .decode(&envelope.authority_key_pkcs8_base64)
            .map_err(|_| failure("credential_invalid"))?,
    );
    let actor_key_pkcs8 = Zeroizing::new(
        BASE64
            .decode(&envelope.actor_key_pkcs8_base64)
            .map_err(|_| failure("credential_invalid"))?,
    );
    if authority_key_pkcs8.is_empty()
        || actor_key_pkcs8.is_empty()
        || Ed25519KeyPair::from_pkcs8(&authority_key_pkcs8).is_err()
        || Ed25519KeyPair::from_pkcs8(&actor_key_pkcs8).is_err()
    {
        return Err(failure("credential_invalid"));
    }
    Ok(MountedPrimaryCredentials {
        library_id: envelope.library_id.clone(),
        authority_key_pkcs8,
        actor_key_pkcs8,
    })
}

#[cfg(test)]
fn read_bounded_credential<R: Read>(
    reader: &mut R,
    buffer: &mut [u8; MOUNTED_CREDENTIAL_READ_BUFFER_BYTES],
) -> Result<usize, LibraryCoreSidecarError> {
    let mut byte_count = 0usize;
    loop {
        let remaining = MAX_MOUNTED_CREDENTIAL_BYTES + 1 - byte_count;
        let read_limit = remaining.min(buffer.len());
        let count = match reader.read(&mut buffer[..read_limit]) {
            Ok(count) => count,
            Err(_) => {
                buffer.zeroize();
                return Err(failure("credential_unavailable"));
            }
        };
        if count == 0 {
            buffer.zeroize();
            return Ok(byte_count);
        }
        byte_count += count;
        buffer[..count].zeroize();
        if byte_count > MAX_MOUNTED_CREDENTIAL_BYTES {
            buffer.zeroize();
            return Err(failure("credential_unavailable"));
        }
    }
}

fn openat_readonly(
    parent: RawFd,
    name: &str,
    directory: bool,
) -> Result<File, LibraryCoreSidecarError> {
    let name = std::ffi::CString::new(name).map_err(|_| failure("credential_unavailable"))?;
    let directory_flag = if directory { libc::O_DIRECTORY } else { 0 };
    let descriptor = unsafe {
        libc::openat(
            parent,
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | directory_flag,
        )
    };
    if descriptor < 0 {
        return Err(failure("credential_unavailable"));
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

fn credential_metadata_is_private(metadata: &std::fs::Metadata, owner: u32) -> bool {
    metadata.file_type().is_file()
        && metadata.uid() == owner
        && metadata.mode() & 0o7777 == 0o600
        && metadata.nlink() == 1
        && metadata.len() > 0
        && metadata.len() <= MAX_MOUNTED_CREDENTIAL_BYTES as u64
}

fn read_private_regular_descriptor(
    descriptor: RawFd,
    maximum_bytes: usize,
    owner: u32,
) -> Result<Vec<u8>, LibraryCoreSidecarError> {
    let file = file_from_duplicated_descriptor(descriptor)
        .map_err(|_| failure("descriptor_read_failed"))?;
    read_private_regular_file_with_hook(&file, maximum_bytes, owner, || {})
}

fn sha256_descriptor(descriptor: RawFd) -> Result<String, LibraryCoreSidecarError> {
    let file = file_from_duplicated_descriptor(descriptor)
        .map_err(|_| failure("descriptor_read_failed"))?;
    sha256_executable_file_with_hook(&file, 0, || {})
}

#[derive(Debug, Eq, PartialEq)]
struct ExactDescriptorMetadata {
    is_regular_file: bool,
    device: u64,
    inode: u64,
    owner: u32,
    mode: u32,
    links: u64,
    size: u64,
}

fn exact_descriptor_metadata(
    file: &File,
) -> Result<ExactDescriptorMetadata, LibraryCoreSidecarError> {
    let metadata = file
        .metadata()
        .map_err(|_| failure("descriptor_read_failed"))?;
    Ok(ExactDescriptorMetadata {
        is_regular_file: metadata.file_type().is_file(),
        device: metadata.dev(),
        inode: metadata.ino(),
        owner: metadata.uid(),
        mode: metadata.mode(),
        links: metadata.nlink(),
        size: metadata.len(),
    })
}

fn read_private_regular_file_with_hook<F>(
    file: &File,
    maximum_bytes: usize,
    owner: u32,
    after_initial_metadata: F,
) -> Result<Vec<u8>, LibraryCoreSidecarError>
where
    F: FnOnce(),
{
    let initial = exact_descriptor_metadata(file)?;
    if !initial.is_regular_file
        || initial.owner != owner
        || initial.mode & 0o7777 != 0o600
        || initial.links != 1
        || initial.size > maximum_bytes as u64
    {
        return Err(failure("descriptor_invalid"));
    }
    after_initial_metadata();
    let capacity = usize::try_from(initial.size).map_err(|_| failure("descriptor_invalid"))?;
    let mut bytes = Vec::with_capacity(capacity);
    read_exact_descriptor_chunks(file, &initial, |chunk| bytes.extend_from_slice(chunk))?;
    Ok(bytes)
}

fn sha256_executable_file_with_hook<F>(
    file: &File,
    owner: u32,
    after_initial_metadata: F,
) -> Result<String, LibraryCoreSidecarError>
where
    F: FnOnce(),
{
    let initial = exact_descriptor_metadata(file)?;
    // Release sidecars require the root-owned executable already enforced by
    // the supervisor. Debug builds also admit their build owner's inode so the
    // real descriptor protocol can run in the nonprivileged integration lane.
    let owner_is_accepted = initial.owner == owner
        || (cfg!(debug_assertions) && owner == 0 && initial.owner == unsafe { libc::geteuid() });
    if !initial.is_regular_file
        || !owner_is_accepted
        || initial.links != 1
        || initial.mode & 0o022 != 0
    {
        return Err(failure("executable_invalid"));
    }
    after_initial_metadata();
    let mut digest = Sha256::new();
    read_exact_descriptor_chunks(file, &initial, |chunk| digest.update(chunk))?;
    Ok(lower_hex(&digest.finalize()))
}

fn read_exact_descriptor_chunks<F>(
    file: &File,
    initial: &ExactDescriptorMetadata,
    mut consume: F,
) -> Result<(), LibraryCoreSidecarError>
where
    F: FnMut(&[u8]),
{
    let mut buffer = [0u8; 64 * 1_024];
    let mut offset = 0u64;
    while offset < initial.size {
        let remaining = (initial.size - offset).min(buffer.len() as u64) as usize;
        let count = file
            .read_at(&mut buffer[..remaining], offset)
            .map_err(|_| failure("descriptor_read_failed"))?;
        if count == 0 {
            return Err(failure("descriptor_read_failed"));
        }
        consume(&buffer[..count]);
        offset += count as u64;
    }
    let mut eof_probe = [0u8; 1];
    if file
        .read_at(&mut eof_probe, initial.size)
        .map_err(|_| failure("descriptor_read_failed"))?
        != 0
    {
        return Err(failure("descriptor_invalid"));
    }
    if exact_descriptor_metadata(file)? != *initial {
        return Err(failure("descriptor_invalid"));
    }
    Ok(())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    lower_hex(&Sha256::digest(bytes))
}

fn descriptor_metadata(descriptor: RawFd) -> Result<std::fs::Metadata, LibraryCoreSidecarError> {
    file_from_duplicated_descriptor(descriptor)
        .and_then(|file| file.metadata().map_err(Into::into))
        .map_err(|_| failure("descriptor_invalid"))
}

fn validate_lifetime_descriptor(descriptor: RawFd) -> Result<(), LibraryCoreSidecarError> {
    let metadata = descriptor_metadata(descriptor)?;
    if !metadata.file_type().is_fifo() && !metadata.file_type().is_socket() {
        return Err(failure("lifetime_invalid"));
    }
    Ok(())
}

fn validate_command_descriptor(descriptor: RawFd) -> Result<(), LibraryCoreSidecarError> {
    let metadata = descriptor_metadata(descriptor)?;
    if !metadata.file_type().is_fifo() && !metadata.file_type().is_socket() {
        return Err(failure("command_channel_invalid"));
    }
    Ok(())
}

fn write_ready_record(ready: &ReadyRecord<'_>) -> Result<(), LibraryCoreSidecarError> {
    let mut bytes = serde_json::to_vec(ready).map_err(|_| failure("ready_encode_failed"))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err(failure("ready_encode_failed"));
    }
    let mut stdout = unsafe { File::from_raw_fd(libc::STDOUT_FILENO) };
    stdout
        .write_all(&bytes)
        .and_then(|()| stdout.flush())
        .map_err(|_| failure("ready_write_failed"))?;
    drop(stdout);
    Ok(())
}

fn wait_for_lifetime_close(descriptor: RawFd) -> Result<(), LibraryCoreSidecarError> {
    let mut lifetime =
        file_from_duplicated_descriptor(descriptor).map_err(|_| failure("lifetime_invalid"))?;
    let mut byte = [0u8; 1];
    loop {
        match lifetime.read(&mut byte) {
            Ok(0) => return Ok(()),
            Ok(_) => return Err(failure("lifetime_invalid")),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(failure("lifetime_invalid")),
        }
    }
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_record_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 128
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

#[cfg(test)]
mod tests {
    use std::fs::{File, OpenOptions};
    use std::io::{Error, Seek, SeekFrom};
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{symlink, MetadataExt, OpenOptionsExt, PermissionsExt};
    use std::process::Command;

    use tempfile::tempdir;

    use super::*;

    const BOUND_AUTHORITY_HELPER_SCENARIO: &str = "FREED_BOUND_AUTHORITY_HELPER_SCENARIO";
    const BOUND_AUTHORITY_HELPER_ROOT: &str = "FREED_BOUND_AUTHORITY_HELPER_ROOT";

    fn test_primary_credentials(library_id: &str) -> MountedPrimaryCredentials {
        MountedPrimaryCredentials {
            library_id: library_id.to_string(),
            authority_key_pkcs8: Zeroizing::new(
                Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new())
                    .expect("generate authority key")
                    .as_ref()
                    .to_vec(),
            ),
            actor_key_pkcs8: Zeroizing::new(
                Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new())
                    .expect("generate actor key")
                    .as_ref()
                    .to_vec(),
            ),
        }
    }

    fn test_primary_credential_bytes(library_id: &str) -> Vec<u8> {
        let credentials = test_primary_credentials(library_id);
        serde_json::to_vec(&json!({
            "actorKeyPkcs8Base64": BASE64.encode(credentials.actor_key_pkcs8.as_slice()),
            "authorityKeyPkcs8Base64": BASE64.encode(credentials.authority_key_pkcs8.as_slice()),
            "format": "freed_library_primary_credentials_v1",
            "libraryId": library_id,
            "schemaVersion": 1
        }))
        .expect("encode credential fixture")
    }

    fn install_primary_context(
        connection: &rusqlite::Connection,
        credentials: &MountedPrimaryCredentials,
    ) -> (String, String, String) {
        let epoch_id = "b".repeat(64);
        let actor_id = "c".repeat(64);
        let actor_public_key = lower_hex(
            Ed25519KeyPair::from_pkcs8(&credentials.actor_key_pkcs8)
                .expect("parse actor key")
                .public_key()
                .as_ref(),
        );
        let authority_public_key = lower_hex(
            Ed25519KeyPair::from_pkcs8(&credentials.authority_key_pkcs8)
                .expect("parse authority key")
                .public_key()
                .as_ref(),
        );
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch,
                  source_revision, updated_at)
                 VALUES (1, ?1, 1, ?2, 0, 1000);",
                rusqlite::params![credentials.library_id, epoch_id],
            )
            .expect("insert Library metadata");
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 0, ?6, ?7, 1000);",
                rusqlite::params![
                    epoch_id,
                    credentials.library_id,
                    "d".repeat(64),
                    authority_public_key,
                    "e".repeat(64),
                    "f".repeat(64),
                    "1".repeat(64),
                ],
            )
            .expect("insert authority epoch");
        connection
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', ?1, ?2, ?3, 0, 1000);",
                rusqlite::params![credentials.library_id, epoch_id, actor_id],
            )
            .expect("activate authority");
        connection
            .execute(
                "INSERT INTO library_writer_admission
                 (singleton_id, local_writer_id, active_writer_id,
                  observed_manifest_generation, observed_at)
                 VALUES (1, ?1, ?1, 0, 1000);",
                rusqlite::params![actor_id],
            )
            .expect("admit writer");
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  created_at, updated_at)
                 VALUES (?1, ?2, 'desktop', ?3, ?4, ?5, '{}', ?6,
                         0, NULL, ?6, 1000, 1000);",
                rusqlite::params![
                    actor_id,
                    epoch_id,
                    actor_public_key,
                    "4".repeat(64),
                    "2".repeat(64),
                    "3".repeat(64),
                ],
            )
            .expect("insert Primary actor");
        (epoch_id, actor_id, actor_public_key)
    }

    fn exercise_authority(authority: &LibraryCoreSidecarAuthority) {
        let credentials = test_primary_credentials(&"a".repeat(64));
        let mut connection = authority.connect().expect("connect normalized authority");
        let user_version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read normalized schema version");
        let application_id: u32 = connection
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .expect("read normalized application identity");
        let protocol_version: u32 = connection
            .query_row(
                "SELECT protocol_version FROM library_storage_meta WHERE singleton_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read normalized protocol version");
        let legacy_tables: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'table' AND name = 'library_core_desktop_state'",
                [],
                |row| row.get(0),
            )
            .expect("check historical table absence");
        assert_eq!(
            user_version,
            crate::sqlite_contract_generated::SQLITE_SCHEMA_VERSION
        );
        assert_eq!(
            application_id,
            crate::sqlite_contract_generated::SQLITE_APPLICATION_ID
        );
        assert_eq!(
            protocol_version,
            crate::sqlite_contract_generated::SQLITE_PROTOCOL_VERSION
        );
        assert_eq!(legacy_tables, 0);
        let inspection = execute_native_command_v1(
            &mut connection,
            &credentials,
            "inspect_storage_v1",
            json!({}),
        )
        .expect("inspect normalized command storage");
        assert_eq!(inspection["activeAuthority"], Value::Null);
        assert_eq!(
            inspection["schemaSha256"],
            crate::sqlite_contract_generated::NORMALIZED_SCHEMA_SHA256
        );
        let digest = "c".repeat(64);
        connection
            .execute(
                "INSERT INTO library_blobs
                   (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
                 VALUES (?1, 5000000000, 65536, 0, 'video/mp4');",
                rusqlite::params![digest],
            )
            .expect("insert large content descriptor");
        let policy = execute_native_command_v1(
            &mut connection,
            &credentials,
            "content_policy_set_v1",
            json!({
                "contentDigest": digest,
                "policy": "pinned_offline",
                "schemaVersion": 1,
                "updatedAt": 1000
            }),
        )
        .expect("set selective content policy");
        assert_eq!(policy["changed"], true);
        let state = execute_native_command_v1(
            &mut connection,
            &credentials,
            "content_state_get_v1",
            json!({"contentDigest": digest, "schemaVersion": 1}),
        )
        .expect("get selective content state");
        assert_eq!(state["byteLength"], 5_000_000_000_u64);
        assert_eq!(state["policy"], "pinned_offline");
        assert_eq!(state["availability"], Value::Null);
    }

    #[test]
    fn bound_authority_helper() {
        let Ok(scenario) = std::env::var(BOUND_AUTHORITY_HELPER_SCENARIO) else {
            return;
        };
        let root = std::path::PathBuf::from(
            std::env::var(BOUND_AUTHORITY_HELPER_ROOT).expect("helper root"),
        );
        let moved = root.with_file_name("moved-data");
        let descriptor = File::open(&root).expect("open root descriptor");
        if scenario == "rename-before-open" {
            std::fs::rename(&root, &moved).expect("move root before authority open");
            std::fs::create_dir(&root).expect("install replacement root");
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .expect("secure replacement root");
        }
        let authority =
            LibraryCoreSidecarAuthority::open_from_inherited_descriptor(descriptor.as_raw_fd())
                .expect("open descriptor-bound authority");
        if scenario == "rename-after-open" {
            std::fs::rename(&root, &moved).expect("move root after authority open");
            std::fs::create_dir(&root).expect("install replacement root");
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .expect("secure replacement root");
        }
        exercise_authority(&authority);
    }

    fn run_bound_authority_helper(root: &std::path::Path, scenario: &str) {
        let status = Command::new(std::env::current_exe().expect("current test executable"))
            .arg("--exact")
            .arg("library_core_sidecar::tests::bound_authority_helper")
            .arg("--nocapture")
            .env(BOUND_AUTHORITY_HELPER_SCENARIO, scenario)
            .env(BOUND_AUTHORITY_HELPER_ROOT, root)
            .status()
            .expect("run bound authority helper");
        assert!(status.success(), "bound authority helper failed");
    }

    #[test]
    fn descriptor_bound_authority_opens_only_the_normalized_catalog() {
        let root = tempdir().expect("temporary root");
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("set root permissions");
        run_bound_authority_helper(root.path(), "staged");
        assert!(root
            .path()
            .join(NORMALIZED_LIBRARY_DIRECTORY)
            .join("library-core.sqlite")
            .is_file());
        assert!(!root.path().join("library-core").exists());
        assert!(!root.path().join("library-backups").exists());
    }

    #[test]
    fn descriptor_bound_authority_refuses_a_foreign_catalog_without_legacy_fallback() {
        let root = tempdir().expect("temporary root");
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("set root permissions");
        let normalized = root.path().join(NORMALIZED_LIBRARY_DIRECTORY);
        std::fs::create_dir(&normalized).expect("create normalized directory");
        std::fs::set_permissions(&normalized, std::fs::Permissions::from_mode(0o700))
            .expect("set normalized directory permissions");
        let foreign_path = normalized.join("library-core.sqlite");
        let foreign = rusqlite::Connection::open(&foreign_path).expect("create foreign database");
        foreign
            .pragma_update(None, "application_id", 7)
            .expect("set foreign application identity");
        drop(foreign);

        let descriptor = File::open(root.path()).expect("open root descriptor");
        assert_eq!(
            LibraryCoreSidecarAuthority::open_from_inherited_descriptor(descriptor.as_raw_fd())
                .map(|_| ()),
            Err(failure("authority_open_failed"))
        );
        let foreign = rusqlite::Connection::open(&foreign_path).expect("reopen foreign database");
        let application_id: u32 = foreign
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .expect("read foreign application identity");
        assert_eq!(application_id, 7);
        assert!(!root.path().join("library-core").exists());
        assert!(!root.path().join("library-backups").exists());
    }

    #[test]
    fn native_command_registry_is_closed_and_frames_are_bounded() {
        let root = tempdir().expect("temporary root");
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("set root permissions");
        let descriptor = File::open(root.path()).expect("open root descriptor");
        let authority =
            LibraryCoreSidecarAuthority::open_from_inherited_descriptor(descriptor.as_raw_fd())
                .expect("open normalized authority");
        let mut connection = authority.connect().expect("connect normalized authority");
        let credentials = test_primary_credentials(&"a".repeat(64));
        for command_id in crate::sqlite_contract_generated::NATIVE_COMMAND_IDS {
            assert_ne!(
                execute_native_command_v1(&mut connection, &credentials, command_id, json!({}),),
                Err("command_unknown"),
                "generated command {command_id} is not dispatched"
            );
        }
        assert_eq!(
            execute_native_command_v1(&mut connection, &credentials, "shell_import_v1", json!({}),),
            Err("command_unknown")
        );

        let mut oversized = tempfile::tempfile().expect("temporary frame");
        oversized
            .write_all(
                &u32::try_from(NATIVE_COMMAND_MAXIMUM_FRAME_BYTES + 1)
                    .expect("frame bound fits u32")
                    .to_be_bytes(),
            )
            .expect("write oversized frame header");
        oversized
            .seek(SeekFrom::Start(0))
            .expect("rewind oversized frame");
        assert_eq!(
            read_command_frame(&mut oversized),
            Err(failure("command_invalid"))
        );
    }

    #[test]
    fn native_primary_commands_keep_signing_keys_inside_the_sidecar() {
        let root = tempdir().expect("temporary root");
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("set root permissions");
        let descriptor = File::open(root.path()).expect("open root descriptor");
        let authority =
            LibraryCoreSidecarAuthority::open_from_inherited_descriptor(descriptor.as_raw_fd())
                .expect("open normalized authority");
        let mut connection = authority.connect().expect("connect normalized authority");
        let credentials = test_primary_credentials(&"a".repeat(64));
        let (epoch_id, actor_id, actor_public_key) =
            install_primary_context(&connection, &credentials);
        assert_primary_credentials_match_storage(&connection, &credentials)
            .expect("match Primary credentials to selected SQLite authority");
        let foreign_credentials = test_primary_credentials(&"9".repeat(64));
        assert_eq!(
            assert_primary_credentials_match_storage(&connection, &foreign_credentials),
            Err(failure("credential_invalid"))
        );

        let context = execute_native_command_v1(
            &mut connection,
            &credentials,
            "primary_mutation_context_v1",
            json!({}),
        )
        .expect("read Primary mutation context");
        assert_eq!(context["libraryId"], credentials.library_id);
        assert_eq!(context["epochId"], epoch_id);
        assert_eq!(context["actorId"], actor_id);
        assert_eq!(context["actorPublicKey"], actor_public_key);

        let operation_digest = "4".repeat(64);
        let signed = execute_native_command_v1(
            &mut connection,
            &credentials,
            "sign_operation_v1",
            json!({
                "actorId": actor_id,
                "actorPublicKey": actor_public_key,
                "epochId": epoch_id,
                "libraryId": credentials.library_id,
                "operationSigningBodyDigest": operation_digest
            }),
        )
        .expect("sign operation inside sidecar");
        let expected_signature = sign_library_core_operation_digest(
            &MountedActorKeyStore(&credentials),
            &credentials.library_id,
            &actor_public_key,
            &operation_digest,
        )
        .expect("produce expected signature");
        assert_eq!(signed["signature"], expected_signature);
        assert!(signed.get("actorKeyPkcs8Base64").is_none());
        assert!(signed.get("authorityKeyPkcs8Base64").is_none());

        assert_eq!(
            execute_native_command_v1(
                &mut connection,
                &credentials,
                "commit_transaction_v1",
                json!({
                    "canonicalEnvelopeJson": [],
                    "committedAtMs": 2000,
                    "libraryId": credentials.library_id
                }),
            ),
            Err("request_invalid")
        );
    }

    #[test]
    fn descriptor_bound_authority_stays_on_fd4_after_root_path_replacement() {
        let fixture = tempdir().expect("temporary fixture");
        let root = fixture.path().join("data");
        let moved = fixture.path().join("moved-data");
        std::fs::create_dir(&root).expect("create data root");
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .expect("set data root permissions");
        run_bound_authority_helper(&root, "rename-after-open");
        assert!(moved
            .join(NORMALIZED_LIBRARY_DIRECTORY)
            .join("library-core.sqlite")
            .is_file());
        assert!(!root.join(NORMALIZED_LIBRARY_DIRECTORY).exists());
        assert!(!root.join("process.lock").exists());
    }

    #[test]
    fn descriptor_bound_authority_stays_on_fd4_when_replaced_before_open() {
        let fixture = tempdir().expect("temporary fixture");
        let root = fixture.path().join("data");
        let moved = fixture.path().join("moved-data");
        std::fs::create_dir(&root).expect("create data root");
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
            .expect("set data root permissions");

        run_bound_authority_helper(&root, "rename-before-open");
        assert!(moved.join("process.lock").is_file());
        assert!(moved
            .join(NORMALIZED_LIBRARY_DIRECTORY)
            .join("library-core.sqlite")
            .is_file());
        assert!(!root.join("process.lock").exists());
        assert!(!root.join(NORMALIZED_LIBRARY_DIRECTORY).exists());
        assert!(!root.join("library-backups").exists());
    }

    #[test]
    fn record_ids_cannot_escape_the_bound_state_root() {
        for invalid in [
            "",
            ".hidden",
            "../secret",
            "/absolute/secret",
            "record/secret",
            "record secret",
        ] {
            assert!(!valid_record_id(invalid), "accepted {invalid:?}");
        }
        assert!(valid_record_id("primary:drive-v1"));
    }

    fn bound_root(path: &std::path::Path) -> (File, LibraryCoreBoundRoot) {
        let descriptor = File::open(path).expect("open directory descriptor");
        let root = LibraryCoreBoundRoot::from_inherited_descriptor(descriptor.as_raw_fd())
            .expect("bind directory");
        (descriptor, root)
    }

    fn mounted_descriptor(record_id: &str) -> CredentialDescriptor {
        CredentialDescriptor {
            schema_version: 1,
            backend: "mounted-credential".to_string(),
            record_id: record_id.to_string(),
        }
    }

    fn write_private(path: &std::path::Path, bytes: &[u8]) {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .expect("create private file");
        file.write_all(bytes).expect("write private file");
    }

    #[test]
    fn mounted_credential_requires_one_private_bounded_physical_file() {
        let fixture = tempdir().expect("temporary state root");
        let mounted = fixture.path().join(MOUNTED_CREDENTIAL_DIRECTORY);
        std::fs::create_dir(&mounted).expect("create mounted credential directory");
        std::fs::set_permissions(&mounted, std::fs::Permissions::from_mode(0o700))
            .expect("set mounted directory permissions");
        let (_descriptor, state_root) = bound_root(fixture.path());

        let valid = mounted.join("valid");
        write_private(&valid, &test_primary_credential_bytes(&"a".repeat(64)));
        read_primary_credentials(&state_root, &mounted_descriptor("valid"))
            .expect("accept private credential");
        let valid_metadata = std::fs::metadata(&valid).expect("valid credential metadata");
        assert!(!credential_metadata_is_private(
            &valid_metadata,
            valid_metadata.uid().saturating_add(1)
        ));

        let symlink_path = mounted.join("symlink");
        symlink(&valid, &symlink_path).expect("create credential symlink");
        assert_eq!(
            read_primary_credentials(&state_root, &mounted_descriptor("symlink")).map(|_| ()),
            Err(failure("credential_unavailable"))
        );

        let hardlink = mounted.join("hardlink");
        std::fs::hard_link(&valid, &hardlink).expect("create credential hardlink");
        assert_eq!(
            read_primary_credentials(&state_root, &mounted_descriptor("hardlink")).map(|_| ()),
            Err(failure("credential_unavailable"))
        );

        let oversized = mounted.join("oversized");
        write_private(&oversized, &vec![b'x'; MAX_MOUNTED_CREDENTIAL_BYTES + 1]);
        assert_eq!(
            read_primary_credentials(&state_root, &mounted_descriptor("oversized")).map(|_| ()),
            Err(failure("credential_unavailable"))
        );

        let broad_mode = mounted.join("broad-mode");
        write_private(&broad_mode, b"opaque");
        std::fs::set_permissions(&broad_mode, std::fs::Permissions::from_mode(0o640))
            .expect("broaden credential mode");
        assert_eq!(
            read_primary_credentials(&state_root, &mounted_descriptor("broad-mode")).map(|_| ()),
            Err(failure("credential_unavailable"))
        );

        std::fs::set_permissions(&mounted, std::fs::Permissions::from_mode(0o750))
            .expect("broaden credential directory mode");
        assert_eq!(
            read_primary_credentials(&state_root, &mounted_descriptor("broad-mode")).map(|_| ()),
            Err(failure("credential_unavailable"))
        );
    }

    #[test]
    fn mounted_credential_requires_closed_primary_secret_semantics() {
        let fixture = tempdir().expect("temporary state root");
        let mounted = fixture.path().join(MOUNTED_CREDENTIAL_DIRECTORY);
        std::fs::create_dir(&mounted).expect("create mounted credential directory");
        std::fs::set_permissions(&mounted, std::fs::Permissions::from_mode(0o700))
            .expect("set mounted credential directory permissions");
        let (_descriptor, state_root) = bound_root(fixture.path());
        let record_id = "opaque-primary";
        std::fs::write(mounted.join(record_id), [0xff, 0x00, 0x7f])
            .expect("write opaque mounted credential");
        std::fs::set_permissions(
            mounted.join(record_id),
            std::fs::Permissions::from_mode(0o600),
        )
        .expect("set mounted credential permissions");

        assert_eq!(
            read_primary_credentials(
                &state_root,
                &CredentialDescriptor {
                    schema_version: 1,
                    backend: "mounted-credential".to_string(),
                    record_id: record_id.to_string(),
                },
            )
            .map(|_| ()),
            Err(failure("credential_invalid"))
        );
    }

    #[test]
    fn concurrent_credential_growth_is_bounded_and_cannot_reach_ready() {
        let fixture = tempdir().expect("temporary state root");
        let mounted = fixture.path().join(MOUNTED_CREDENTIAL_DIRECTORY);
        std::fs::create_dir(&mounted).expect("create mounted credential directory");
        std::fs::set_permissions(&mounted, std::fs::Permissions::from_mode(0o700))
            .expect("set mounted credential directory permissions");
        let credential_path = mounted.join("growing");
        write_private(
            &credential_path,
            &test_primary_credential_bytes(&"a".repeat(64)),
        );
        let mut credential = File::open(&credential_path).expect("open credential");
        let owner = credential.metadata().expect("credential metadata").uid();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let writer_barrier = barrier.clone();
        let writer = std::thread::spawn(move || {
            writer_barrier.wait();
            let mut file = OpenOptions::new()
                .append(true)
                .open(credential_path)
                .expect("open growing credential");
            let block = [b'x'; MOUNTED_CREDENTIAL_READ_BUFFER_BYTES];
            for _ in 0..16 {
                file.write_all(&block).expect("grow credential");
            }
        });

        let result = read_open_primary_credentials(&mut credential, owner, || {
            barrier.wait();
            writer
                .join()
                .expect("grow credential after initial metadata");
        });
        assert_eq!(result.map(|_| ()), Err(failure("credential_unavailable")));
    }

    #[test]
    fn partial_credential_read_error_zeroizes_the_guarded_buffer() {
        struct PartialThenError(bool);

        impl Read for PartialThenError {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                if self.0 {
                    buffer[..6].copy_from_slice(b"secret");
                    return Err(Error::other("injected read failure"));
                }
                self.0 = true;
                buffer[..6].copy_from_slice(b"secret");
                Ok(6)
            }
        }

        let mut reader = PartialThenError(false);
        let mut buffer = [0u8; MOUNTED_CREDENTIAL_READ_BUFFER_BYTES];
        assert_eq!(
            read_bounded_credential(&mut reader, &mut buffer),
            Err(failure("credential_unavailable"))
        );
        assert!(buffer.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn fd6_and_fd7_descriptor_drift_cannot_reach_ready() {
        for descriptor_name in ["fd6-admission", "fd7-credential-descriptor"] {
            for mutation in ["append", "chmod", "link"] {
                let fixture = tempdir().expect("descriptor fixture");
                let path = fixture.path().join(descriptor_name);
                write_private(&path, b"bounded-record");
                let file = File::open(&path).expect("open private descriptor");
                let owner = file.metadata().expect("descriptor metadata").uid();
                let linked_path = fixture.path().join("linked-record");
                let result =
                    read_private_regular_file_with_hook(&file, MAX_ADMISSION_BYTES, owner, || {
                        match mutation {
                            "append" => OpenOptions::new()
                                .append(true)
                                .open(&path)
                                .and_then(|mut changed| changed.write_all(b"drift"))
                                .expect("append descriptor"),
                            "chmod" => std::fs::set_permissions(
                                &path,
                                std::fs::Permissions::from_mode(0o640),
                            )
                            .expect("change descriptor mode"),
                            "link" => {
                                std::fs::hard_link(&path, &linked_path).expect("link descriptor")
                            }
                            _ => unreachable!(),
                        }
                    });
                assert_eq!(
                    result,
                    Err(failure("descriptor_invalid")),
                    "{descriptor_name} accepted {mutation} drift"
                );
            }
        }
    }

    #[test]
    fn fd3_executable_descriptor_drift_cannot_reach_ready() {
        for mutation in ["append", "chmod", "link"] {
            let fixture = tempdir().expect("executable fixture");
            let path = fixture.path().join("sidecar");
            write_private(&path, b"executable-bytes");
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .expect("set executable mode");
            let file = File::open(&path).expect("open executable descriptor");
            let owner = file.metadata().expect("executable metadata").uid();
            let linked_path = fixture.path().join("sidecar-link");
            let result = sha256_executable_file_with_hook(&file, owner, || match mutation {
                "append" => OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .and_then(|mut changed| changed.write_all(b"drift"))
                    .expect("append executable"),
                "chmod" => std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                    .expect("change executable mode"),
                "link" => std::fs::hard_link(&path, &linked_path).expect("link executable"),
                _ => unreachable!(),
            });
            assert_eq!(
                result,
                Err(failure("descriptor_invalid")),
                "fd3 accepted {mutation} drift"
            );
        }
    }

    #[test]
    fn mounted_credential_directory_cannot_be_a_symlink() {
        let fixture = tempdir().expect("temporary state root");
        let target = tempdir().expect("temporary credential target");
        std::fs::set_permissions(target.path(), std::fs::Permissions::from_mode(0o700))
            .expect("set target permissions");
        write_private(
            &target.path().join("record"),
            &test_primary_credential_bytes(&"a".repeat(64)),
        );
        symlink(
            target.path(),
            fixture.path().join(MOUNTED_CREDENTIAL_DIRECTORY),
        )
        .expect("create mounted directory symlink");
        let (_descriptor, state_root) = bound_root(fixture.path());
        assert_eq!(
            read_primary_credentials(&state_root, &mounted_descriptor("record")).map(|_| ()),
            Err(failure("credential_unavailable"))
        );
    }

    #[test]
    fn unsupported_credential_backends_fail_closed() {
        let descriptor = CredentialDescriptor {
            schema_version: 1,
            backend: "os-vault".to_string(),
            record_id: "primary".to_string(),
        };
        assert_eq!(
            validate_credential_descriptor(&descriptor),
            Err(failure("credential_backend_unavailable"))
        );
    }

    #[test]
    fn admission_digest_or_descriptor_identity_drift_fails_closed() {
        let data_fixture = tempdir().expect("temporary data root");
        let state_fixture = tempdir().expect("temporary state root");
        let (_data_descriptor, data_root) = bound_root(data_fixture.path());
        let (_state_descriptor, state_root) = bound_root(state_fixture.path());
        let envelope = StartEnvelope {
            r#type: "start".to_string(),
            protocol_version: 1,
            role: "primary".to_string(),
            parent_nonce: "a".repeat(64),
            config_digest: "b".repeat(64),
            executable_digest: "c".repeat(64),
            executable_fd: 3,
            data_root_fd: 4,
            state_root_fd: 5,
            admission_fd: 6,
            credential_descriptor_fd: 7,
            lifetime_fd: 8,
            command_request_fd: 9,
            command_response_fd: 10,
        };
        let mut admission = AdmissionRecord {
            format: "freed_library_service_admission_v1".to_string(),
            schema_version: 1,
            role: "primary".to_string(),
            config_digest: envelope.config_digest.clone(),
            executable_digest: envelope.executable_digest.clone(),
            data_root_device: data_root.device().to_string(),
            data_root_inode: data_root.inode().to_string(),
            state_root_device: state_root.device().to_string(),
            state_root_inode: state_root.inode().to_string(),
            credential_descriptor_digest: "d".repeat(64),
        };
        validate_admission(
            &admission,
            &envelope,
            &data_root,
            &state_root,
            &"d".repeat(64),
        )
        .expect("accept exact admission");

        admission.credential_descriptor_digest = "e".repeat(64);
        assert_eq!(
            validate_admission(
                &admission,
                &envelope,
                &data_root,
                &state_root,
                &"d".repeat(64),
            ),
            Err(failure("admission_invalid"))
        );
        admission.credential_descriptor_digest = "d".repeat(64);
        admission.data_root_inode = state_root.inode().to_string();
        assert_eq!(
            validate_admission(
                &admission,
                &envelope,
                &data_root,
                &state_root,
                &"d".repeat(64),
            ),
            Err(failure("admission_invalid"))
        );
    }
}
