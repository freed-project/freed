//! One process-wide accessor for private keys held in the platform vault.
//!
//! Every Library Core private key lives in the operating system credential
//! vault under its own account, wrapped in a versioned envelope that names the
//! subject it belongs to. Reading a key must never raise an interactive
//! prompt, so on macOS the read runs with Keychain user interaction disabled.
//!
//! That policy is process-global state, not per-entry state, which is why this
//! module exists at all. A second copy of the keyring plumbing would carry its
//! own mutex, and two mutexes guarding one global would serialize neither: one
//! caller could restore interaction while another was still relying on it
//! being off. Every vault account goes through the lock below.
//!
//! Keys are never synchronized, exported, or written outside the vault.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use keyring::Entry;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::sync::{LazyLock, Mutex};

#[cfg(not(feature = "isolated-preview-data-root"))]
pub(crate) const KEYRING_SERVICE: &str = "wtf.freed.library-core";
#[cfg(feature = "isolated-preview-data-root")]
pub(crate) const KEYRING_SERVICE: &str = "wtf.freed.library-core.sqlite-native-preview";
const MAXIMUM_SUBJECT_BYTES: usize = 128;

/// One named private key: which vault account holds it, and how its envelope
/// is tagged. Both are stable identifiers, so changing either orphans the key
/// already stored under the old pair rather than reading it as something else.
pub(crate) struct PlatformKeyVault {
    pub(crate) account: &'static str,
    pub(crate) envelope_format: &'static str,
    /// Names the key in operator-facing errors, lowercase, e.g. "migration
    /// signing". Errors never include the subject or any key material.
    pub(crate) description: &'static str,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PlatformKeyEnvelopeV1 {
    format: String,
    subject: String,
    pkcs8_base64: String,
}

/// The identity a stored key is bound to, so a key minted for one subject is
/// never handed back for another.
pub(crate) fn validate_subject(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAXIMUM_SUBJECT_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err("invalid Library Core key subject".to_string());
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn keyring_entry(vault: &PlatformKeyVault) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, vault.account)
        .map_err(|_| "Library Core could not open the platform credential vault".to_string())
}

#[cfg(target_os = "macos")]
static KEYRING_INTERACTION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[cfg(any(test, target_os = "macos"))]
fn with_user_interaction_policy<T, Guard>(
    interaction_allowed: impl FnOnce() -> Result<bool, String>,
    disable_interaction: impl FnOnce() -> Result<Guard, String>,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let interaction_was_allowed = interaction_allowed()?;
    let _interaction_guard = if interaction_was_allowed {
        Some(disable_interaction()?)
    } else {
        None
    };
    operation()
}

#[cfg(target_os = "macos")]
fn with_keyring_user_interaction_disabled<T>(
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    use security_framework::os::macos::keychain::SecKeychain;

    let _operation_guard = KEYRING_INTERACTION_LOCK
        .lock()
        .map_err(|_| "Library Core credential-vault access is unavailable".to_string())?;
    with_user_interaction_policy(
        || {
            SecKeychain::user_interaction_allowed().map_err(|_| {
                "Library Core could not inspect Keychain interaction policy".to_string()
            })
        },
        || {
            SecKeychain::disable_user_interaction()
                .map_err(|_| "Library Core could not disable Keychain user interaction".to_string())
        },
        operation,
    )
}

#[cfg(target_os = "windows")]
fn with_keyring_user_interaction_disabled<T>(
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    operation()
}

fn encode_envelope(
    vault: &PlatformKeyVault,
    subject: &str,
    bytes: &[u8],
) -> Result<Vec<u8>, String> {
    validate_subject(subject)?;
    let envelope = PlatformKeyEnvelopeV1 {
        format: vault.envelope_format.to_string(),
        subject: subject.to_string(),
        pkcs8_base64: BASE64_STANDARD.encode(bytes),
    };
    serde_json::to_vec(&envelope)
        .map_err(|_| format!("Library Core {} key envelope is invalid", vault.description))
}

fn decode_envelope(
    vault: &PlatformKeyVault,
    subject: &str,
    bytes: &[u8],
) -> Result<Option<Vec<u8>>, String> {
    validate_subject(subject)?;
    let envelope: PlatformKeyEnvelopeV1 = serde_json::from_slice(bytes)
        .map_err(|_| format!("Library Core {} key envelope is corrupt", vault.description))?;
    if envelope.format != vault.envelope_format {
        return Err(format!(
            "Library Core {} key format is unsupported",
            vault.description
        ));
    }
    validate_subject(&envelope.subject)?;
    // A key stored for a different subject is absent, not corrupt: the caller
    // mints a fresh one rather than signing with someone else's key.
    if envelope.subject != subject {
        return Ok(None);
    }
    BASE64_STANDARD
        .decode(envelope.pkcs8_base64)
        .map(Some)
        .map_err(|_| format!("Library Core {} key is corrupt", vault.description))
}

pub(crate) fn load_platform_key(
    vault: &PlatformKeyVault,
    subject: &str,
) -> Result<Option<Vec<u8>>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        with_keyring_user_interaction_disabled(|| match keyring_entry(vault)?.get_secret() {
            Ok(bytes) => decode_envelope(vault, subject, &bytes),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(format!(
                "Library Core could not read its {} key",
                vault.description
            )),
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (vault, subject);
        Err(unsupported_vault())
    }
}

pub(crate) fn store_platform_key(
    vault: &PlatformKeyVault,
    subject: &str,
    bytes: &[u8],
) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let encoded = encode_envelope(vault, subject, bytes)?;
        with_keyring_user_interaction_disabled(|| {
            keyring_entry(vault)?.set_secret(&encoded).map_err(|_| {
                format!(
                    "Library Core could not protect its {} key",
                    vault.description
                )
            })
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (vault, subject, bytes);
        Err(unsupported_vault())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn unsupported_vault() -> String {
    "Library Core has no noninteractive platform credential vault on this operating system"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VAULT: PlatformKeyVault = PlatformKeyVault {
        account: "test-account",
        envelope_format: "freed_library_core_test_key_v1",
        description: "test",
    };

    #[test]
    fn an_envelope_round_trips_only_for_its_own_subject() {
        let encoded = encode_envelope(&VAULT, "subject-a", &[1, 2, 3]).unwrap();

        assert_eq!(
            decode_envelope(&VAULT, "subject-a", &encoded).unwrap(),
            Some(vec![1, 2, 3])
        );
        // A key minted for another subject reads as absent, never as this
        // subject's key.
        assert_eq!(
            decode_envelope(&VAULT, "subject-b", &encoded).unwrap(),
            None
        );
    }

    #[test]
    fn a_foreign_envelope_format_is_refused_rather_than_reinterpreted() {
        const OTHER: PlatformKeyVault = PlatformKeyVault {
            account: "test-account",
            envelope_format: "freed_library_core_other_key_v1",
            description: "other",
        };
        let encoded = encode_envelope(&OTHER, "subject-a", &[1, 2, 3]).unwrap();

        let error = decode_envelope(&VAULT, "subject-a", &encoded).unwrap_err();

        assert!(error.contains("format is unsupported"), "{error}");
    }

    #[test]
    fn subjects_outside_the_closed_alphabet_are_refused() {
        for subject in ["", "has space", "has/slash", "has\u{0}nul"] {
            assert!(validate_subject(subject).is_err(), "{subject:?}");
        }
        assert!(validate_subject(&"a".repeat(MAXIMUM_SUBJECT_BYTES)).is_ok());
        assert!(validate_subject(&"a".repeat(MAXIMUM_SUBJECT_BYTES + 1)).is_err());
        assert!(validate_subject("desktop-installation-1.0_a:b-c").is_ok());
    }

    #[test]
    fn a_corrupt_envelope_is_an_error_rather_than_an_absent_key() {
        let error = decode_envelope(&VAULT, "subject-a", b"not json").unwrap_err();

        assert!(error.contains("envelope is corrupt"), "{error}");
    }

    /// Moved here with the plumbing it covers. The operation must run only
    /// while interaction is disabled, and the policy must be restored after.
    #[test]
    fn a_credential_operation_runs_only_while_interaction_is_disabled() {
        use std::cell::RefCell;
        use std::rc::Rc;

        struct FakeInteractionGuard(Rc<RefCell<Vec<&'static str>>>);

        impl Drop for FakeInteractionGuard {
            fn drop(&mut self) {
                self.0.borrow_mut().push("restore");
            }
        }

        let events = Rc::new(RefCell::new(Vec::new()));
        let inspect_events = events.clone();
        let disable_events = events.clone();
        let operation_events = events.clone();
        with_user_interaction_policy(
            move || {
                inspect_events.borrow_mut().push("inspect");
                Ok(true)
            },
            move || {
                disable_events.borrow_mut().push("disable");
                Ok(FakeInteractionGuard(disable_events.clone()))
            },
            move || {
                operation_events.borrow_mut().push("credential-operation");
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            *events.borrow(),
            ["inspect", "disable", "credential-operation", "restore"]
        );
    }

    /// The interaction policy this module serializes is process-global, so the
    /// guard has to restore the previous policy even when the operation fails.
    #[test]
    fn the_interaction_guard_restores_the_previous_policy_after_a_failure() {
        struct RestoreOnDrop<'a>(&'a std::cell::Cell<bool>);
        impl Drop for RestoreOnDrop<'_> {
            fn drop(&mut self) {
                self.0.set(true);
            }
        }

        let allowed = std::cell::Cell::new(true);
        let restored = std::cell::Cell::new(false);

        let result: Result<(), String> = with_user_interaction_policy(
            || Ok(allowed.get()),
            || Ok(RestoreOnDrop(&restored)),
            || Err("operation failed".to_string()),
        );

        assert_eq!(result.unwrap_err(), "operation failed");
        assert!(
            restored.get(),
            "the policy guard must run on the error path"
        );
    }

    #[test]
    fn no_guard_is_taken_when_interaction_was_already_disabled() {
        let disable_calls = std::cell::Cell::new(0_u32);

        let result: Result<u32, String> = with_user_interaction_policy(
            || Ok(false),
            || {
                disable_calls.set(disable_calls.get() + 1);
                Ok(())
            },
            || Ok(7),
        );

        assert_eq!(result.unwrap(), 7);
        assert_eq!(disable_calls.get(), 0);
    }

    #[test]
    #[cfg(feature = "isolated-preview-data-root")]
    fn isolated_preview_never_opens_the_production_keyring_service() {
        assert_eq!(
            KEYRING_SERVICE,
            "wtf.freed.library-core.sqlite-native-preview"
        );
    }
}
