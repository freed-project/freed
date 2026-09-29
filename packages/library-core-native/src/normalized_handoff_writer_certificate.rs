//! Cooperative successor proof. Construction prepares bytes only; target writer
//! admission remains fenced until the cloud decision has been verified.
use crate::library_core_canonical::{decode_canonical_value, encode_canonical_value};
use crate::library_core_ed25519::verify_library_core_ed25519;
use crate::library_core_hash::lower_hex;
use crate::normalized_authority::NormalizedAuthorityStateV2;
use crate::normalized_handoff_certificate::{
    verify_handoff_authorization_v1, HandoffAuthorizationV1, HandoffPredecessorV1,
};
use crate::normalized_writer_certificate::{
    authority_key_id, digest_value, epoch_signature_input, possession_signature_input,
    WriterEpochReassignment,
};
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const FORMAT: &str = "freed_library_core_writer_epoch_handoff_v1";
const MAX_BYTES: usize = 16_384;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WriterHandoffBodyV1 {
    pub format: String,
    pub library_id: String,
    pub source_control: Value,
    pub target_epoch: i64,
    pub target_writer_id: String,
    pub target_authority_public_key: String,
    pub target_authority_key_id: String,
    pub signature_algorithm: String,
    pub handoff_authorization: HandoffAuthorizationV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WriterHandoffCertificateV1 {
    pub certificate_body: WriterHandoffBodyV1,
    pub epoch_id: String,
    pub epoch_signature: String,
    pub authority_key_possession_signature: String,
}

pub(crate) fn verify_writer_handoff_certificate_v1(
    certificate: &WriterHandoffCertificateV1,
    predecessor: &HandoffPredecessorV1<'_>,
    enrolled_actor_public_key: &str,
) -> Result<(), String> {
    let body = &certificate.certificate_body;
    let grant = &body.handoff_authorization;
    verify_handoff_authorization_v1(grant, predecessor, enrolled_actor_public_key)?;
    if body.format != FORMAT
        || body.signature_algorithm != "ed25519"
        || body.library_id != predecessor.library_id
        || u64::try_from(body.target_epoch).ok() != Some(grant.body.successor_epoch)
        || body.target_writer_id != grant.body.readiness.body.target_actor_id
        || body.target_authority_public_key != grant.body.readiness.body.target_authority_public_key
        || body.target_authority_key_id != authority_key_id(&body.target_authority_public_key)?
        || body.source_control
            != serde_json::to_value(&grant.body.source_control)
                .map_err(|error| error.to_string())?
    {
        return Err("successor certificate differs from predecessor consent".into());
    }
    let body_value = serde_json::to_value(body).map_err(|error| error.to_string())?;
    if certificate.epoch_id != digest_value("epoch-transition-certificate", &body_value)? {
        return Err("successor epoch digest is invalid".into());
    }
    for (input, signature) in [
        (
            epoch_signature_input(&certificate.epoch_id)?,
            &certificate.epoch_signature,
        ),
        (
            possession_signature_input(&certificate.epoch_id, &body.target_authority_key_id)?,
            &certificate.authority_key_possession_signature,
        ),
    ] {
        if !verify_library_core_ed25519(&body.target_authority_public_key, signature, &input)
            .map_err(|_| "successor signature is malformed")?
        {
            return Err("successor signature is invalid".into());
        }
    }
    encode_canonical_value(
        &serde_json::to_value(certificate).map_err(|error| error.to_string())?,
        MAX_BYTES,
    )
    .map_err(|_| "successor certificate exceeds its bound")?;
    Ok(())
}

/// Use an already loaded pending key. This function has no key-store or database
/// write access and cannot create a key, select an epoch or activate a writer.
pub(crate) fn prepare_writer_handoff_certificate_v1(
    current: &NormalizedAuthorityStateV2,
    predecessor_writer_id: &str,
    predecessor_certificate_digest: &str,
    canonical_authorization: &[u8],
    enrolled_actor_public_key: &str,
    pending_key: &Ed25519KeyPair,
) -> Result<WriterEpochReassignment, String> {
    let decoded = decode_canonical_value(canonical_authorization, MAX_BYTES)
        .map_err(|_| "successor consent is not bounded canonical data")?;
    let grant: HandoffAuthorizationV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "successor consent has an unsupported shape")?;
    if encode_canonical_value(
        &serde_json::to_value(&grant).map_err(|error| error.to_string())?,
        MAX_BYTES,
    )
    .map_err(|_| "successor consent encoding is invalid")?
        != canonical_authorization
    {
        return Err("successor consent bytes are not canonical".into());
    }
    let predecessor = HandoffPredecessorV1 {
        library_id: &current.library_id,
        epoch_id: &current.epoch_id,
        epoch: u64::try_from(current.epoch)
            .map_err(|_| "successor predecessor epoch is invalid")?,
        authority_public_key: &current.authority_public_key,
        certificate_digest: predecessor_certificate_digest,
        writer_id: predecessor_writer_id,
    };
    verify_handoff_authorization_v1(&grant, &predecessor, enrolled_actor_public_key)?;
    let public_key = lower_hex(pending_key.public_key().as_ref());
    if public_key != grant.body.readiness.body.target_authority_public_key
        || current.observed_frontier.len() > 1_000
    {
        return Err("successor key or predecessor frontier is invalid".into());
    }
    let body = WriterHandoffBodyV1 {
        format: FORMAT.into(),
        library_id: current.library_id.clone(),
        source_control: serde_json::to_value(&grant.body.source_control)
            .map_err(|error| error.to_string())?,
        target_epoch: i64::try_from(grant.body.successor_epoch)
            .map_err(|_| "successor epoch is invalid")?,
        target_writer_id: grant.body.readiness.body.target_actor_id.clone(),
        target_authority_key_id: authority_key_id(&public_key)?,
        target_authority_public_key: public_key,
        signature_algorithm: "ed25519".into(),
        handoff_authorization: grant,
    };
    let epoch_id = digest_value(
        "epoch-transition-certificate",
        &serde_json::to_value(&body).map_err(|error| error.to_string())?,
    )?;
    let certificate = WriterHandoffCertificateV1 {
        epoch_signature: lower_hex(
            pending_key
                .sign(&epoch_signature_input(&epoch_id)?)
                .as_ref(),
        ),
        authority_key_possession_signature: lower_hex(
            pending_key
                .sign(&possession_signature_input(
                    &epoch_id,
                    &body.target_authority_key_id,
                )?)
                .as_ref(),
        ),
        certificate_body: body,
        epoch_id: epoch_id.clone(),
    };
    verify_writer_handoff_certificate_v1(&certificate, &predecessor, enrolled_actor_public_key)?;
    let value = serde_json::to_value(&certificate).map_err(|error| error.to_string())?;
    let canonical = encode_canonical_value(&value, MAX_BYTES)
        .map_err(|_| "successor certificate exceeds its bound")?;
    Ok(WriterEpochReassignment {
        authority: NormalizedAuthorityStateV2 {
            library_id: current.library_id.clone(),
            epoch: certificate.certificate_body.target_epoch,
            epoch_id,
            authority_key_id: certificate.certificate_body.target_authority_key_id.clone(),
            authority_public_key: certificate
                .certificate_body
                .target_authority_public_key
                .clone(),
            observed_frontier: current.observed_frontier.clone(),
        },
        canonical_certificate_json: String::from_utf8(canonical)
            .map_err(|_| "successor certificate encoding is invalid")?,
        transition_certificate_digest: digest_value("epoch-transition-certificate", &value)?,
    })
}

/// Pin succession to this replica's accepted predecessor, never to keys supplied
/// by the incoming checkpoint. The caller must still preserve local edit state.
pub(crate) fn verify_writer_handoff_against_local_v1(
    connection: &rusqlite::Connection,
    canonical: &[u8],
) -> Result<WriterHandoffCertificateV1, String> {
    let decoded = decode_canonical_value(canonical, MAX_BYTES)
        .map_err(|_| "successor proof is not bounded canonical data")?;
    let certificate: WriterHandoffCertificateV1 = serde_json::from_value(decoded.into_value())
        .map_err(|_| "successor proof has an unsupported shape")?;
    if encode_canonical_value(
        &serde_json::to_value(&certificate).map_err(|e| e.to_string())?,
        MAX_BYTES,
    )
    .map_err(|_| "successor proof encoding is invalid")?
        != canonical
    {
        return Err("successor proof bytes are not canonical".into());
    }
    let (library, epoch_id, epoch, digest, key, writer): (String, String, u64, String, String, String) = connection.query_row(
        "SELECT meta.library_id, old.epoch_id, old.epoch_number, old.transition_certificate_digest,
                old.authority_public_key, (SELECT actor_id FROM library_actors WHERE authority_epoch_id = old.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL)
         FROM library_meta AS meta JOIN library_active_authority AS active
           ON active.library_id = meta.library_id AND active.epoch_id = meta.authority_epoch
         JOIN library_authority_epochs AS old ON old.epoch_id = active.epoch_id
         WHERE meta.singleton_id = 1 AND active.active_key = 'active'
           AND (SELECT count(*) FROM library_actors WHERE authority_epoch_id = old.epoch_id AND actor_kind = 'desktop' AND retired_at IS NULL) = 1;", [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    ).map_err(|_| "successor proof requires the accepted predecessor")?;
    let actor_key: String = connection.query_row(
        "SELECT public_key FROM library_actors WHERE actor_id = ?1 AND authority_epoch_id = ?2 AND retired_at IS NULL;",
        rusqlite::params![certificate.certificate_body.target_writer_id, epoch_id], |r| r.get(0),
    ).map_err(|_| "successor target is not enrolled in the accepted predecessor")?;
    verify_writer_handoff_certificate_v1(
        &certificate,
        &HandoffPredecessorV1 {
            library_id: &library,
            epoch_id: &epoch_id,
            epoch,
            certificate_digest: &digest,
            authority_public_key: &key,
            writer_id: &writer,
        },
        &actor_key,
    )?;
    Ok(certificate)
}

#[cfg(test)]
mod parity_tests {
    use super::*;

    #[test]
    fn shared_handoff_vector_matches_native_verification() {
        let vector: Value = serde_json::from_str(include_str!(
            "../../shared/src/library-core/handoff-certificate-vectors-v1.json"
        ))
        .unwrap();
        let mut vectors: Vec<Value> = serde_json::from_str(include_str!(
            "../../shared/src/library-core/handoff-chain-vectors-v1.json"
        ))
        .unwrap();
        assert_eq!(
            vectors[0]["expected"]["epochId"],
            vectors[1]["predecessor"]["epochId"]
        );
        assert_eq!(
            vectors[0]["expected"]["certificateDigest"],
            vectors[1]["predecessor"]["certificateDigest"]
        );
        assert_eq!(
            vectors[0]["expected"]["authorityPublicKey"],
            vectors[1]["predecessor"]["authorityPublicKey"]
        );
        vectors.push(vector);
        vectors.push(
            serde_json::from_str(include_str!(
                "../../shared/src/library-core/recovered-enrollment-vector-v1.json"
            ))
            .unwrap(),
        );
        for vector in vectors {
            let pin = &vector["predecessor"];
            let predecessor = HandoffPredecessorV1 {
                library_id: pin["libraryId"].as_str().unwrap(),
                epoch_id: pin["epochId"].as_str().unwrap(),
                epoch: pin["epoch"].as_u64().unwrap(),
                certificate_digest: pin["certificateDigest"].as_str().unwrap(),
                authority_public_key: pin["authorityPublicKey"].as_str().unwrap(),
                writer_id: pin["writerId"].as_str().unwrap(),
            };
            let canonical = vector["canonicalCertificate"].as_str().unwrap().as_bytes();
            let value = decode_canonical_value(canonical, MAX_BYTES)
                .unwrap()
                .into_value();
            assert_eq!(
                encode_canonical_value(&value, MAX_BYTES).unwrap(),
                canonical
            );
            let certificate: WriterHandoffCertificateV1 =
                serde_json::from_value(value.clone()).unwrap();
            let actor = vector["enrolledActorPublicKey"].as_str().unwrap();
            verify_writer_handoff_certificate_v1(&certificate, &predecessor, actor).unwrap();
            assert_eq!(
                certificate.epoch_id,
                vector["expected"]["epochId"].as_str().unwrap()
            );
            assert_eq!(
                digest_value("epoch-transition-certificate", &value).unwrap(),
                vector["expected"]["certificateDigest"].as_str().unwrap()
            );
            assert_eq!(
                certificate.certificate_body.target_authority_key_id,
                vector["expected"]["authorityKeyId"].as_str().unwrap()
            );
            assert_eq!(
                certificate.certificate_body.target_authority_public_key,
                vector["expected"]["authorityPublicKey"].as_str().unwrap()
            );
            for signature in 0..5 {
                let mut changed = certificate.clone();
                let target = match signature {
                    0 => {
                        &mut changed
                            .certificate_body
                            .handoff_authorization
                            .body
                            .readiness
                            .actor_signature
                    }
                    1 => {
                        &mut changed
                            .certificate_body
                            .handoff_authorization
                            .body
                            .readiness
                            .authority_possession_signature
                    }
                    2 => {
                        &mut changed
                            .certificate_body
                            .handoff_authorization
                            .predecessor_signature
                    }
                    3 => &mut changed.epoch_signature,
                    _ => &mut changed.authority_key_possession_signature,
                };
                *target = "00".repeat(64);
                assert!(
                    verify_writer_handoff_certificate_v1(&changed, &predecessor, actor).is_err()
                );
            }
        }
    }
}
