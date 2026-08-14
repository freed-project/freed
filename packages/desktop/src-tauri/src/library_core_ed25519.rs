use ring::signature::{UnparsedPublicKey, ED25519};

const MAX_SIGNATURE_INPUT_BYTES: usize = 4_194_304;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Ed25519VerificationError {
    InvalidPublicKeyEncoding,
    InvalidSignatureEncoding,
    MessageTooLarge,
}

fn decode_lowercase_hex<const N: usize>(
    value: &str,
    invalid: Ed25519VerificationError,
) -> Result<[u8; N], Ed25519VerificationError> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid);
    }
    let mut output = [0_u8; N];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = (pair[0] as char).to_digit(16).expect("validated hex");
        let low = (pair[1] as char).to_digit(16).expect("validated hex");
        output[index] = ((high << 4) | low) as u8;
    }
    Ok(output)
}

pub(crate) fn verify_library_core_ed25519(
    public_key_hex: &str,
    signature_hex: &str,
    message: &[u8],
) -> Result<bool, Ed25519VerificationError> {
    if message.len() > MAX_SIGNATURE_INPUT_BYTES {
        return Err(Ed25519VerificationError::MessageTooLarge);
    }
    let public_key_bytes = decode_lowercase_hex::<32>(
        public_key_hex,
        Ed25519VerificationError::InvalidPublicKeyEncoding,
    )?;
    let signature_bytes = decode_lowercase_hex::<64>(
        signature_hex,
        Ed25519VerificationError::InvalidSignatureEncoding,
    )?;
    Ok(UnparsedPublicKey::new(&ED25519, public_key_bytes)
        .verify(message, &signature_bytes)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct VerificationVectors {
        schema_version: u8,
        algorithm: String,
        vectors: Vec<VerificationVector>,
    }

    #[derive(Deserialize)]
    struct VerificationVector {
        id: String,
        public_key_hex: String,
        message_hex: String,
        signature_hex: String,
    }

    fn decode_message_hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let high = (pair[0] as char).to_digit(16).expect("fixture hex");
                let low = (pair[1] as char).to_digit(16).expect("fixture hex");
                ((high << 4) | low) as u8
            })
            .collect()
    }

    fn vectors() -> VerificationVectors {
        serde_json::from_str(include_str!(
            "../../../shared/src/library-core/ed25519-verification-vectors.json"
        ))
        .expect("shared Ed25519 vectors")
    }

    #[test]
    fn verifies_shared_rfc_vector_and_rejects_tampering() {
        let fixtures = vectors();
        assert_eq!(fixtures.schema_version, 1);
        assert_eq!(fixtures.algorithm, "ed25519");
        let vector = &fixtures.vectors[0];
        assert_eq!(vector.id, "rfc-8032-test-vector-1");
        let message = decode_message_hex(&vector.message_hex);

        assert_eq!(
            verify_library_core_ed25519(&vector.public_key_hex, &vector.signature_hex, &message),
            Ok(true)
        );

        let mut altered_signature = vector.signature_hex.clone();
        altered_signature.replace_range(126..128, "00");
        assert_eq!(
            verify_library_core_ed25519(&vector.public_key_hex, &altered_signature, &message),
            Ok(false)
        );
        assert_eq!(
            verify_library_core_ed25519(&vector.public_key_hex, &vector.signature_hex, &[1]),
            Ok(false)
        );
        assert_eq!(
            verify_library_core_ed25519(&"00".repeat(32), &vector.signature_hex, &message),
            Ok(false)
        );
    }

    #[test]
    fn rejects_malformed_encodings_and_oversized_messages() {
        let vector = &vectors().vectors[0];
        assert_eq!(
            verify_library_core_ed25519("invalid", &vector.signature_hex, &[]),
            Err(Ed25519VerificationError::InvalidPublicKeyEncoding)
        );
        assert_eq!(
            verify_library_core_ed25519(&vector.public_key_hex, "INVALID", &[]),
            Err(Ed25519VerificationError::InvalidSignatureEncoding)
        );
        assert_eq!(
            verify_library_core_ed25519(
                &vector.public_key_hex,
                &vector.signature_hex,
                &vec![0; MAX_SIGNATURE_INPUT_BYTES + 1]
            ),
            Err(Ed25519VerificationError::MessageTooLarge)
        );
    }
}
