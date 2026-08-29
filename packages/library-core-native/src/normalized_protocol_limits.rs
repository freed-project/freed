//! Closed bounds shared by normalized authority protocol verification and storage.

pub(crate) const MAX_TRANSACTION_MEMBERS: usize = 1_000;
pub(crate) const MAX_TRANSACTION_ENVELOPE_BYTES: usize = 4_194_304;
pub(crate) const MAX_CAUSAL_TIPS_PER_OPERATION: usize = 4_096;
pub(crate) const MAX_ENTITY_ID_BYTES: usize = 4_096;
pub(crate) const MAX_OPERATION_ID_BYTES: usize = 128;
pub(crate) const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub(crate) fn is_lower_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes * 2
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn is_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_OPERATION_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}
