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

#[cfg(feature = "isolated-preview-data-root")]
fn preview_keyring_service(config: Option<&str>) -> Result<String, String> {
    let Some(config) = config else {
        return Ok(KEYRING_SERVICE.to_string());
    };
    let value: serde_json::Value = serde_json::from_str(config)
        .map_err(|_| "invalid isolated Library Core configuration".to_string())?;
    let identifier = value
        .get("identifier")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing isolated Library Core identifier".to_string())?;
    if identifier.len() > 128
        || !identifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
        || !(identifier == "wtf.freed.desktop.sqlite-native-preview"
            || identifier
                .strip_prefix("wtf.freed.desktop.preview.")
                .is_some_and(|suffix| !suffix.is_empty()))
    {
        return Err("invalid isolated Library Core identifier".to_string());
    }
    // Never retarget an existing preview: that would orphan its private keys.
    // The fresh acceptance bundle has a fresh data root and must also keep all
    // subject and legacy account reads inside its own vault namespace.
    if identifier == "wtf.freed.desktop.preview.transfer-acceptance-isolated" {
        return Ok(format!("{KEYRING_SERVICE}.{identifier}"));
    }
    // Measurement candidates retain their existing distinct services.
    if let Some(suffix) = identifier.strip_prefix("wtf.freed.desktop.preview.measurement.") {
        if suffix.is_empty() {
            return Err("missing measurement identity".to_string());
        }
        return Ok(format!("{KEYRING_SERVICE}.{identifier}"));
    }
    Ok(KEYRING_SERVICE.to_string())
}

#[cfg(all(test, feature = "isolated-preview-data-root"))]
mod measurement_namespace_tests {
    use super::*;
    fn service(id: &str) -> Result<String, String> {
        preview_keyring_service(Some(&serde_json::json!({"identifier": id}).to_string()))
    }
    #[test]
    fn existing_services_are_preserved() {
        assert_eq!(preview_keyring_service(None).unwrap(), KEYRING_SERVICE);
        for id in [
            "wtf.freed.desktop.sqlite-native-preview",
            "wtf.freed.desktop.preview.gliclass20261002",
            "wtf.freed.desktop.preview.transfer-acceptance",
        ] {
            assert_eq!(service(id).unwrap(), KEYRING_SERVICE);
        }
    }
    #[test]
    fn fresh_measurements_cannot_read_existing_preview_service() {
        let a = service("wtf.freed.desktop.preview.measurement.r1.a1").unwrap();
        let b = service("wtf.freed.desktop.preview.measurement.r1.a2").unwrap();
        assert_ne!(a, b);
        assert_ne!(a, KEYRING_SERVICE);
    }
    #[test]
    fn acceptance_vault_is_separate_from_legacy_previews_and_measurements() {
        let acceptance =
            preview_keyring_service(Some(include_str!("../tauri.transfer-acceptance.conf.json")))
                .unwrap();
        assert_eq!(
            acceptance,
            format!("{KEYRING_SERVICE}.wtf.freed.desktop.preview.transfer-acceptance-isolated")
        );
        assert_ne!(
            acceptance,
            service("wtf.freed.desktop.preview.transfer-acceptance").unwrap()
        );
        assert_ne!(
            acceptance,
            service("wtf.freed.desktop.preview.measurement.r1.a1").unwrap()
        );
        assert_ne!(acceptance, "wtf.freed.library-core");
    }
    #[test]
    fn invalid_configuration_fails_before_vault_access() {
        for id in [
            "wtf.freed.desktop",
            "wtf.freed.desktop.preview.",
            "wtf.freed.desktop.preview.measurement.",
            "wtf.freed.desktop.preview.measurement../x",
        ] {
            assert!(service(id).is_err());
        }
        assert!(preview_keyring_service(Some("not-json")).is_err());
        assert!(service(&format!(
            "wtf.freed.desktop.preview.measurement.{}",
            "x".repeat(128)
        ))
        .is_err());
    }
}

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
fn keyring_entry(account: &str) -> Result<Entry, String> {
    Entry::new(&keyring_service()?, account)
        .map_err(|_| "Library Core could not open the platform credential vault".to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn keyring_service() -> Result<String, String> {
    #[cfg(feature = "isolated-preview-data-root")]
    let service = preview_keyring_service(option_env!("TAURI_CONFIG"))?;
    #[cfg(not(feature = "isolated-preview-data-root"))]
    let service = KEYRING_SERVICE.to_string();
    Ok(service)
}

// A length-delimited namespace prevents account/subject boundary collisions.
// Legacy accounts remain read-only so joining another Library cannot erase keys.
fn subject_account(vault: &PlatformKeyVault, subject: &str) -> Result<String, String> {
    validate_subject(subject)?;
    Ok(format!(
        "subject-v1:{}:{}:{}",
        vault.account.len(),
        vault.account,
        subject
    ))
}

fn load_subject_key(
    vault: &PlatformKeyVault,
    subject: &str,
    mut read: impl FnMut(&str) -> Result<Option<Vec<u8>>, String>,
) -> Result<Option<Vec<u8>>, String> {
    let account = subject_account(vault, subject)?;
    if let Some(bytes) = read(&account)? {
        // A mismatched scoped entry is corruption, never permission to mint.
        return decode_envelope(vault, subject, &bytes)?
            .map(Some)
            .ok_or_else(|| {
                format!(
                    "Library Core {} key subject is inconsistent",
                    vault.description
                )
            });
    }
    match read(vault.account)? {
        Some(bytes) => decode_envelope(vault, subject, &bytes),
        None => Ok(None),
    }
}

fn store_subject_key(
    vault: &PlatformKeyVault,
    subject: &str,
    bytes: &[u8],
    write: impl FnOnce(&str, &[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let account = subject_account(vault, subject)?;
    write(&account, &encode_envelope(vault, subject, bytes)?)
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
        with_keyring_user_interaction_disabled(|| {
            load_subject_key(vault, subject, |account| {
                match keyring_entry(account)?.get_secret() {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(_) => Err(format!(
                        "Library Core could not read its {} key",
                        vault.description
                    )),
                }
            })
        })
    }
    #[cfg(target_os = "linux")]
    {
        validate_subject(subject)?;
        linux_vault::with_collection(|collection| {
            load_subject_key(vault, subject, |account| {
                linux_vault::read(collection, account)
            })
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
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
        with_keyring_user_interaction_disabled(|| {
            store_subject_key(vault, subject, bytes, |account, encoded| {
                keyring_entry(account)?.set_secret(encoded).map_err(|_| {
                    format!(
                        "Library Core could not protect its {} key",
                        vault.description
                    )
                })
            })
        })
    }
    #[cfg(target_os = "linux")]
    {
        validate_subject(subject)?;
        linux_vault::with_collection(|collection| {
            store_subject_key(vault, subject, bytes, |account, encoded| {
                linux_vault::write(collection, account, encoded)
            })
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (vault, subject, bytes);
        Err(unsupported_vault())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn unsupported_vault() -> String {
    "Library Core has no noninteractive platform credential vault on this operating system"
        .to_string()
}

/// Linux custody requires a persistent, already-unlocked desktop vault. Never
/// create or unlock a collection, fall back to session storage, or interpret
/// service failure as a missing key. A lock race also fails at the service.
#[cfg(target_os = "linux")]
mod linux_vault {
    use super::keyring_service;
    use dbus_secret_service::{Collection, EncryptionType, Item, SecretService};
    use std::collections::HashMap;

    fn unavailable(_: dbus_secret_service::Error) -> String {
        "Library Core could not access the Linux credential vault".to_string()
    }

    pub(super) fn with_collection<T>(
        operation: impl FnOnce(&Collection<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        // Zero prevents Prompt from being invoked, including during CreateItem.
        let service = SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 0)
            .map_err(unavailable)?;
        let collection = service.get_default_collection().map_err(unavailable)?;
        if collection.is_locked().map_err(unavailable)? {
            return Err(
                "Library Core requires an unlocked persistent Linux credential vault".into(),
            );
        }
        operation(&collection)
    }

    fn attributes<'a>(service: &'a str, account: &'a str) -> HashMap<&'a str, &'a str> {
        HashMap::from([
            ("service", service),
            ("username", account),
            ("target", "default"),
        ])
    }

    fn find<'a>(collection: &'a Collection<'_>, account: &str) -> Result<Option<Item<'a>>, String> {
        let service = keyring_service()?;
        let mut items = collection
            .search_items(attributes(&service, account))
            .map_err(unavailable)?;
        if items.len() > 1 {
            return Err("Library Core Linux credential entry is ambiguous".into());
        }
        let item = items.pop();
        if let Some(item) = &item {
            if item.is_locked().map_err(unavailable)? {
                return Err("Library Core Linux credential entry is locked".into());
            }
        }
        Ok(item)
    }

    pub(super) fn read(
        collection: &Collection<'_>,
        account: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        find(collection, account)?
            .map(|item| item.get_secret().map_err(unavailable))
            .transpose()
    }

    pub(super) fn write(
        collection: &Collection<'_>,
        account: &str,
        bytes: &[u8],
    ) -> Result<(), String> {
        if let Some(item) = find(collection, account)? {
            return item
                .set_secret(bytes, "application/octet-stream")
                .map_err(unavailable);
        }
        let service = keyring_service()?;
        collection
            .create_item(
                "Freed Desktop Library key",
                attributes(&service, account),
                bytes,
                true,
                "application/octet-stream",
            )
            .map_err(unavailable)?;
        Ok(())
    }
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
    fn scoped_keys_preserve_other_libraries_and_read_only_legacy_custody() {
        use std::collections::HashMap;
        let legacy = encode_envelope(&VAULT, "old-library", &[1]).unwrap();
        let mut entries = HashMap::from([(VAULT.account.to_string(), legacy.clone())]);
        for (subject, key) in [("new-library", 2), ("another-library", 3)] {
            store_subject_key(&VAULT, subject, &[key], |account, bytes| {
                entries.insert(account.to_string(), bytes.to_vec());
                Ok(())
            })
            .unwrap();
        }
        for (subject, key) in [
            ("old-library", 1),
            ("new-library", 2),
            ("another-library", 3),
        ] {
            assert_eq!(
                load_subject_key(&VAULT, subject, |account| Ok(entries.get(account).cloned()))
                    .unwrap(),
                Some(vec![key])
            );
        }
        assert_eq!(entries.get(VAULT.account), Some(&legacy));
        assert_eq!(
            load_subject_key(&VAULT, "absent", |account| Ok(entries
                .get(account)
                .cloned()))
            .unwrap(),
            None
        );
        store_subject_key(&VAULT, "old-library", &[4], |account, bytes| {
            entries.insert(account.to_string(), bytes.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            load_subject_key(&VAULT, "old-library", |account| Ok(entries
                .get(account)
                .cloned()))
            .unwrap(),
            Some(vec![4])
        );
        assert_eq!(entries.get(VAULT.account), Some(&legacy));
    }

    #[test]
    fn scoped_corruption_and_vault_errors_never_fall_back_to_legacy() {
        for bytes in [
            b"corrupt".to_vec(),
            encode_envelope(&VAULT, "wrong-subject", &[1]).unwrap(),
        ] {
            let mut reads = 0;
            assert!(load_subject_key(&VAULT, "subject", |_| {
                reads += 1;
                Ok(Some(bytes.clone()))
            })
            .is_err());
            assert_eq!(reads, 1);
        }
        let mut reads = 0;
        assert!(load_subject_key(&VAULT, "subject", |_| {
            reads += 1;
            Err("unavailable".to_string())
        })
        .is_err());
        assert_eq!(reads, 1);
        assert!(load_subject_key(&VAULT, "bad/subject", |_| panic!(
            "invalid subject reached vault"
        ))
        .is_err());
    }

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
