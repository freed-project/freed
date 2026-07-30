//! Shared fixed-size codecs for the dormant external-memory Automerge path.

pub(super) fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
pub(super) const OFFICIAL_NONEMPTY_DOCUMENT_HEX: &str = "856f4a8398ace1df00ce0101100123456789abcdef0123456789abcdef0196207f2939ac71a4b5c386ca6ecab557b10e884156d293eefa67adef6b3e6876060102030213022306400256020a0104020815322102230834014204560857108001027f007f017f077f99fca8d3067f007f070002050000027f0103027f0679056974656d730b707265666572656e63657305616c70686109637265617465644174026964057469746c65057468656d6507007901057c037e0103070300040103007f2402567f46fb00616c70686148656c6c6f6461726b070000";

#[cfg(test)]
pub(super) fn decode_test_hex(value: &str) -> Vec<u8> {
    assert!(value.len().is_multiple_of(2));
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16).unwrap();
            let low = (pair[1] as char).to_digit(16).unwrap();
            ((high << 4) | low) as u8
        })
        .collect()
}
