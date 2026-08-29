//! Native admission for signed, bounded agent reads.
//!
//! The local socket is transport only. This module verifies canonical bytes,
//! active authority, actor identity, capability state, the exact registered
//! query grant, and the actor signature before dispatching a closed query.

use crate::library_core_canonical::{
    decode_canonical_value, encode_operation_digest_input, encode_signature_input,
};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::normalized_query::query_normalized_json_v1;
use crate::normalized_sqlite::NormalizedSqliteError;
use crate::sqlite_contract_generated::{
    AGENT_QUERY_DIGEST_DOMAIN, AGENT_QUERY_FORMAT, AGENT_QUERY_IDS,
    AGENT_QUERY_MAXIMUM_CANONICAL_BYTES, AGENT_QUERY_RESULT_FORMAT, AGENT_QUERY_SIGNATURE_DOMAIN,
};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const ENVELOPE_KEYS: [&str; 3] = [
    "actor_signature",
    "agent_query_body",
    "agent_query_body_digest",
];
const BODY_KEYS: [&str; 10] = [
    "actor_id",
    "capability_certificate_digest",
    "capability_id",
    "epoch",
    "epoch_id",
    "format",
    "library_id",
    "query",
    "request_id",
    "signature_algorithm",
];
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedAgentQueryResultV1 {
    pub format: &'static str,
    pub library_id: String,
    pub epoch_id: String,
    pub actor_id: String,
    pub capability_id: String,
    pub request_id: String,
    pub query_id: String,
    pub source_revision: u64,
    pub result: Value,
}

struct ParsedAgentQuery {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    actor_id: String,
    capability_id: String,
    capability_certificate_digest: String,
    request_id: String,
    query_id: String,
    query: Value,
    body_digest: String,
    actor_signature: String,
}

struct AgentAuthorityRow {
    library_id: String,
    epoch: i64,
    epoch_id: String,
    source_revision: i64,
    actor_public_key: String,
    actor_class: String,
    scope_mode: String,
    capability_certificate_digest: String,
    actor_retired_at: Option<i64>,
    capability_retired_at: Option<i64>,
    query_granted: i64,
}

fn invalid() -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest("signed agent query is invalid")
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a Map<String, Value>, NormalizedSqliteError> {
    let object = value.as_object().ok_or_else(invalid)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid());
    }
    Ok(object)
}

fn string(object: &Map<String, Value>, key: &str) -> Result<String, NormalizedSqliteError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(invalid)
}

fn lower_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn digest_hex(value: &Value) -> Result<String, NormalizedSqliteError> {
    let input = encode_operation_digest_input(
        AGENT_QUERY_DIGEST_DOMAIN,
        value,
        AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| invalid())?;
    Ok(crate::lower_hex(&Sha256::digest(input)))
}

fn parse(canonical_agent_query_json: &str) -> Result<ParsedAgentQuery, NormalizedSqliteError> {
    let decoded = decode_canonical_value(
        canonical_agent_query_json.as_bytes(),
        AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| invalid())?;
    let envelope = exact_object(decoded.value(), &ENVELOPE_KEYS)?;
    let body = envelope.get("agent_query_body").ok_or_else(invalid)?;
    let body_object = exact_object(body, &BODY_KEYS)?;
    if body_object.get("format").and_then(Value::as_str) != Some(AGENT_QUERY_FORMAT)
        || body_object
            .get("signature_algorithm")
            .and_then(Value::as_str)
            != Some("ed25519")
    {
        return Err(invalid());
    }
    let library_id = string(body_object, "library_id")?;
    let epoch = body_object
        .get("epoch")
        .and_then(Value::as_i64)
        .filter(|value| (1..=MAX_SAFE_INTEGER).contains(value))
        .ok_or_else(invalid)?;
    let epoch_id = string(body_object, "epoch_id")?;
    let actor_id = string(body_object, "actor_id")?;
    let capability_id = string(body_object, "capability_id")?;
    let capability_certificate_digest = string(body_object, "capability_certificate_digest")?;
    let request_id = string(body_object, "request_id")?;
    if [
        library_id.as_str(),
        epoch_id.as_str(),
        actor_id.as_str(),
        capability_id.as_str(),
        capability_certificate_digest.as_str(),
        request_id.as_str(),
    ]
    .iter()
    .any(|value| !lower_hex(value, 32))
        || capability_id != capability_certificate_digest
    {
        return Err(invalid());
    }
    let query = body_object.get("query").cloned().ok_or_else(invalid)?;
    let query_object = query.as_object().ok_or_else(invalid)?;
    let query_id = query_object
        .get("queryId")
        .and_then(Value::as_str)
        .filter(|value| AGENT_QUERY_IDS.binary_search(value).is_ok())
        .map(str::to_owned)
        .ok_or_else(invalid)?;
    let body_digest = string(envelope, "agent_query_body_digest")?;
    let actor_signature = string(envelope, "actor_signature")?;
    if !lower_hex(&body_digest, 32)
        || !lower_hex(&actor_signature, 64)
        || digest_hex(body)? != body_digest
    {
        return Err(invalid());
    }
    Ok(ParsedAgentQuery {
        library_id,
        epoch,
        epoch_id,
        actor_id,
        capability_id,
        capability_certificate_digest,
        request_id,
        query_id,
        query,
        body_digest,
        actor_signature,
    })
}

pub fn execute_normalized_agent_query_v1(
    connection: &mut Connection,
    canonical_agent_query_json: &str,
) -> Result<NormalizedAgentQueryResultV1, NormalizedSqliteError> {
    let parsed = parse(canonical_agent_query_json)?;
    let authority: Option<AgentAuthorityRow> = connection
        .query_row(
            "SELECT meta.library_id, epoch.epoch_number, active.epoch_id,
                        meta.source_revision, actor.public_key, capability.actor_class,
                        capability.scope_mode, capability.certificate_digest,
                        actor.retired_at, capability.retired_at,
                        EXISTS(
                          SELECT 1 FROM library_actor_capability_queries AS grant_row
                          WHERE grant_row.capability_id = capability.capability_id
                            AND grant_row.query_id = ?3
                        )
                 FROM library_meta AS meta
                 JOIN library_active_authority AS active
                   ON active.active_key = 'active'
                  AND active.library_id = meta.library_id
                  AND active.epoch_id = meta.authority_epoch
                 JOIN library_authority_epochs AS epoch
                   ON epoch.epoch_id = active.epoch_id
                  AND epoch.library_id = active.library_id
                 JOIN library_actors AS actor
                   ON actor.actor_id = ?1
                  AND actor.authority_epoch_id = active.epoch_id
                 JOIN library_actor_capabilities AS capability
                   ON capability.capability_id = ?2
                  AND capability.actor_id = actor.actor_id
                 WHERE meta.singleton_id = 1;",
            (&parsed.actor_id, &parsed.capability_id, &parsed.query_id),
            |row| {
                Ok(AgentAuthorityRow {
                    library_id: row.get(0)?,
                    epoch: row.get(1)?,
                    epoch_id: row.get(2)?,
                    source_revision: row.get(3)?,
                    actor_public_key: row.get(4)?,
                    actor_class: row.get(5)?,
                    scope_mode: row.get(6)?,
                    capability_certificate_digest: row.get(7)?,
                    actor_retired_at: row.get(8)?,
                    capability_retired_at: row.get(9)?,
                    query_granted: row.get(10)?,
                })
            },
        )
        .optional()?;
    let Some(authority) = authority else {
        return Err(invalid());
    };
    if parsed.library_id != authority.library_id
        || parsed.epoch != authority.epoch
        || parsed.epoch_id != authority.epoch_id
        || parsed.capability_certificate_digest != authority.capability_certificate_digest
        || authority.actor_class != "agent"
        || authority.scope_mode != "library_wide"
        || authority.actor_retired_at.is_some()
        || authority.capability_retired_at.is_some()
        || authority.query_granted != 1
        || !(0..=MAX_SAFE_INTEGER).contains(&authority.source_revision)
    {
        return Err(invalid());
    }
    let signature_input = encode_signature_input(
        AGENT_QUERY_SIGNATURE_DOMAIN,
        &json!({ "agent_query_body_digest": parsed.body_digest }),
        AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
    )
    .map_err(|_| invalid())?;
    if !verify_library_core_ed25519(
        &authority.actor_public_key,
        &parsed.actor_signature,
        &signature_input,
    )
    .map_err(|_| invalid())?
    {
        return Err(invalid());
    }
    let result = query_normalized_json_v1(connection, parsed.query)?;
    Ok(NormalizedAgentQueryResultV1 {
        format: AGENT_QUERY_RESULT_FORMAT,
        library_id: authority.library_id,
        epoch_id: authority.epoch_id,
        actor_id: parsed.actor_id,
        capability_id: parsed.capability_id,
        request_id: parsed.request_id,
        query_id: parsed.query_id,
        source_revision: u64::try_from(authority.source_revision).map_err(|_| invalid())?,
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_canonical::encode_canonical_value;
    use crate::normalized_sqlite::install_normalized_schema_v1;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use rusqlite::params;
    use serde::Deserialize;

    const LIBRARY_ID: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const EPOCH_ID: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const ACTOR_ID: &str = "3333333333333333333333333333333333333333333333333333333333333333";
    const CAPABILITY_ID: &str = "4444444444444444444444444444444444444444444444444444444444444444";
    const REQUEST_ID: &str = "5555555555555555555555555555555555555555555555555555555555555555";

    #[derive(Deserialize)]
    struct AgentQueryVector {
        schema_version: u8,
        actor_seed_hex: String,
        actor_public_key_hex: String,
        canonical_agent_query_json: String,
    }

    fn vector() -> AgentQueryVector {
        serde_json::from_str(include_str!(
            "../../shared/src/library-core/agent-query-v1-vectors.json"
        ))
        .expect("shared agent query vector")
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| {
                let high = (pair[0] as char).to_digit(16).expect("hex high");
                let low = (pair[1] as char).to_digit(16).expect("hex low");
                ((high << 4) | low) as u8
            })
            .collect()
    }

    fn setup() -> (Connection, Ed25519KeyPair) {
        let connection = Connection::open_in_memory().expect("open SQLite");
        install_normalized_schema_v1(&connection).expect("install schema");
        let fixture = vector();
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&decode_hex(&fixture.actor_seed_hex))
            .expect("parse actor seed");
        let public_key = crate::lower_hex(key_pair.public_key().as_ref());
        assert_eq!(fixture.schema_version, 1);
        assert_eq!(public_key, fixture.actor_public_key_hex);
        connection
            .execute(
                "INSERT INTO library_authority_epochs
                 (epoch_id, library_id, epoch_number, authority_key_id,
                  authority_public_key, transition_certificate_digest,
                  canonical_transition_certificate, accepted_manifest_generation,
                  checkpoint_frontier_digest, materialized_state_digest, accepted_at)
                 VALUES (?1, ?2, 3, ?3, ?3, ?3, '{}', 7, ?3, ?3, 1);",
                params![EPOCH_ID, LIBRARY_ID, "aa".repeat(32)],
            )
            .expect("insert epoch");
        connection
            .execute(
                "INSERT INTO library_meta
                 (singleton_id, library_id, schema_version, authority_epoch,
                  source_revision, updated_at)
                 VALUES (1, ?1, 1, ?2, 9, 1);",
                params![LIBRARY_ID, EPOCH_ID],
            )
            .expect("insert meta");
        connection
            .execute(
                "INSERT INTO library_active_authority
                 (active_key, library_id, epoch_id, writer_id,
                  accepted_manifest_generation, activated_at)
                 VALUES ('active', ?1, ?2, ?3, 7, 1);",
                params![LIBRARY_ID, EPOCH_ID, ACTOR_ID],
            )
            .expect("insert active authority");
        connection
            .execute(
                "INSERT INTO library_materialization_generation
                 (singleton_id, generation_id) VALUES (1, ?1);",
                ["66".repeat(32)],
            )
            .expect("insert generation");
        connection
            .execute(
                "UPDATE library_change_state SET revision = 9 WHERE singleton_id = 1;",
                [],
            )
            .expect("align change revision");
        connection
            .execute(
                "INSERT INTO library_actors
                 (actor_id, authority_epoch_id, actor_kind, public_key,
                  enrollment_operation_id, enrollment_certificate_digest,
                  canonical_enrollment_certificate, chain_genesis_digest,
                  accepted_counter, accepted_operation_id, accepted_chain_digest,
                  retired_at, created_at, updated_at)
                 VALUES (?1, ?2, 'agent', ?3, 'actor-enrolled:test', ?4, '{}',
                         ?4, 0, NULL, ?4, NULL, 1, 1);",
                params![ACTOR_ID, EPOCH_ID, public_key, "77".repeat(32)],
            )
            .expect("insert actor");
        connection
            .execute(
                "INSERT INTO library_actor_capabilities
                 (capability_id, actor_id, certificate_version, actor_class,
                  scope_mode, scope_kind, scope_id, issuance_identity,
                  retirement_identity, certificate_digest, canonical_certificate,
                  issued_at, retired_at, retirement_certificate_digest)
                 VALUES (?1, ?2, 2, 'agent', 'library_wide', NULL, NULL, ?3,
                         ?4, ?1, '{}', 1, NULL, NULL);",
                params![CAPABILITY_ID, ACTOR_ID, "88".repeat(32), "99".repeat(32)],
            )
            .expect("insert capability");
        connection
            .execute(
                "INSERT INTO library_actor_capability_queries
                 (capability_id, query_id) VALUES (?1, 'item_detail_v1');",
                [CAPABILITY_ID],
            )
            .expect("insert query grant");
        (connection, key_pair)
    }

    fn signed_query(key_pair: &Ed25519KeyPair, query_id: &str) -> String {
        let query = if query_id == "item_detail_v1" {
            json!({ "globalId": "missing:item", "queryId": query_id, "schemaVersion": 1 })
        } else {
            json!({ "queryId": query_id })
        };
        let body = json!({
            "format": AGENT_QUERY_FORMAT,
            "library_id": LIBRARY_ID,
            "epoch": 3,
            "epoch_id": EPOCH_ID,
            "actor_id": ACTOR_ID,
            "capability_id": CAPABILITY_ID,
            "capability_certificate_digest": CAPABILITY_ID,
            "request_id": REQUEST_ID,
            "query": query,
            "signature_algorithm": "ed25519"
        });
        let body_digest = digest_hex(&body).expect("digest query body");
        let signature_input = encode_signature_input(
            AGENT_QUERY_SIGNATURE_DOMAIN,
            &json!({ "agent_query_body_digest": body_digest }),
            AGENT_QUERY_MAXIMUM_CANONICAL_BYTES,
        )
        .expect("encode signature input");
        let envelope = json!({
            "agent_query_body": body,
            "agent_query_body_digest": body_digest,
            "actor_signature": crate::lower_hex(key_pair.sign(&signature_input).as_ref())
        });
        String::from_utf8(
            encode_canonical_value(&envelope, AGENT_QUERY_MAXIMUM_CANONICAL_BYTES)
                .expect("encode envelope"),
        )
        .expect("canonical UTF-8")
    }

    #[test]
    fn admits_a_signed_registered_query_and_returns_revision_bound_result() {
        let (mut connection, key_pair) = setup();
        assert_eq!(
            signed_query(&key_pair, "item_detail_v1"),
            vector().canonical_agent_query_json
        );
        let receipt = execute_normalized_agent_query_v1(
            &mut connection,
            &signed_query(&key_pair, "item_detail_v1"),
        )
        .expect("execute signed query");
        assert_eq!(receipt.format, AGENT_QUERY_RESULT_FORMAT);
        assert_eq!(receipt.library_id, LIBRARY_ID);
        assert_eq!(receipt.epoch_id, EPOCH_ID);
        assert_eq!(receipt.actor_id, ACTOR_ID);
        assert_eq!(receipt.capability_id, CAPABILITY_ID);
        assert_eq!(receipt.request_id, REQUEST_ID);
        assert_eq!(receipt.query_id, "item_detail_v1");
        assert_eq!(receipt.source_revision, 9);
    }

    #[test]
    fn refuses_ungranted_scope_retirement_and_signature_changes() {
        let (mut connection, key_pair) = setup();
        assert!(execute_normalized_agent_query_v1(
            &mut connection,
            &signed_query(&key_pair, "search_page_v1")
        )
        .is_err());

        connection
            .execute(
                "UPDATE library_actor_capabilities
                 SET scope_mode = 'bounded', scope_kind = 'provider', scope_id = 'rss';",
                [],
            )
            .expect("bound scope");
        assert!(execute_normalized_agent_query_v1(
            &mut connection,
            &signed_query(&key_pair, "item_detail_v1")
        )
        .is_err());
        connection
            .execute_batch(
                "UPDATE library_actor_capabilities
                 SET scope_mode = 'library_wide', scope_kind = NULL, scope_id = NULL;
                 UPDATE library_actors SET retired_at = 2;",
            )
            .expect("retire actor");
        assert!(execute_normalized_agent_query_v1(
            &mut connection,
            &signed_query(&key_pair, "item_detail_v1")
        )
        .is_err());

        connection
            .execute("UPDATE library_actors SET retired_at = NULL;", [])
            .expect("restore actor for signature check");
        let mut changed_value: Value =
            serde_json::from_str(&signed_query(&key_pair, "item_detail_v1"))
                .expect("decode signed query");
        changed_value["actor_signature"] = Value::String("00".repeat(64));
        let changed = String::from_utf8(
            encode_canonical_value(&changed_value, AGENT_QUERY_MAXIMUM_CANONICAL_BYTES)
                .expect("encode changed query"),
        )
        .expect("changed query UTF-8");
        assert!(execute_normalized_agent_query_v1(&mut connection, &changed).is_err());
    }
}
