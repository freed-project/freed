//! Freed Desktop path and identity adapter for the native process lease.

use std::path::{Path, PathBuf};

#[cfg(not(feature = "isolated-preview-data-root"))]
const FREED_DESKTOP_IDENTIFIER: &str = "wtf.freed.desktop";
#[cfg(feature = "isolated-preview-data-root")]
const FREED_DESKTOP_IDENTIFIER: &str = "wtf.freed.desktop.sqlite-native-preview";
const LIBRARY_CORE_DIRECTORY: &str = "library-core";
const DESKTOP_IDENTITY: freed_library_core::ProcessLeaseIdentity<'static> =
    freed_library_core::ProcessLeaseIdentity::new(
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
    );

/// Resolve the same pre-Tauri data root used by Tauri's path resolver.
pub fn freed_desktop_library_core_data_root() -> std::io::Result<PathBuf> {
    dirs::data_dir()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "operating system data directory is unavailable",
            )
        })
        .and_then(|root| {
            Ok(root
                .join(preview_identifier()?)
                .join(LIBRARY_CORE_DIRECTORY))
        })
}

fn preview_identifier() -> std::io::Result<String> {
    #[cfg(feature = "isolated-preview-data-root")]
    if let Some(config) = option_env!("TAURI_CONFIG") {
        return identifier_from_preview_config(config);
    }
    Ok(FREED_DESKTOP_IDENTIFIER.to_owned())
}

#[cfg(feature = "isolated-preview-data-root")]
fn identifier_from_preview_config(config: &str) -> std::io::Result<String> {
    let config: serde_json::Value = serde_json::from_str(config).map_err(|error| {
        std::io::Error::other(format!("Invalid compiled preview config: {error}"))
    })?;
    let Some(identifier) = config.get("identifier").and_then(serde_json::Value::as_str) else {
        return Ok(FREED_DESKTOP_IDENTIFIER.to_owned());
    };
    let allowed = identifier == FREED_DESKTOP_IDENTIFIER
        || identifier
            .strip_prefix("wtf.freed.desktop.preview.")
            .is_some_and(|suffix| !suffix.is_empty());
    if !allowed
        || identifier.len() > 128
        || !identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
    {
        return Err(std::io::Error::other(
            "Isolated preview refuses a non-preview identifier",
        ));
    }
    Ok(identifier.to_owned())
}

/// Desktop-owned lease wrapper held for the complete Tauri process lifetime.
pub struct LibraryCoreProcessLease {
    #[cfg(unix)]
    installed: bool,
    #[cfg(not(unix))]
    _lease: freed_library_core::LibraryCoreProcessLease,
}

impl LibraryCoreProcessLease {
    pub fn acquire(
        requested_data_root: &Path,
    ) -> Result<Self, freed_library_core::LibraryCoreProcessLeaseError> {
        #[cfg(unix)]
        {
            let app_root = requested_data_root.parent().ok_or_else(|| {
                binding_error(
                    requested_data_root,
                    "Freed Desktop Library Core data root has no app root",
                )
            })?;
            let binding =
                freed_library_core::LibraryCoreDesktopBinding::open(app_root, DESKTOP_IDENTITY)
                    .map_err(|error| binding_error(app_root, &error.to_string()))?;
            freed_library_core::install_desktop_binding(binding)
                .map_err(|error| binding_error(app_root, &error.to_string()))?;
            Ok(Self { installed: true })
        }
        #[cfg(not(unix))]
        {
            let app_root = requested_data_root.parent().ok_or_else(|| {
                freed_library_core::LibraryCoreProcessLeaseError::Storage {
                    operation: "bind",
                    path: requested_data_root.to_path_buf(),
                    source: std::io::Error::other(
                        "Freed Desktop Library Core data root has no app root",
                    ),
                }
            })?;
            let lease =
                freed_library_core::LibraryCoreProcessLease::acquire(app_root, DESKTOP_IDENTITY)?;
            // Same pre-Tauri app root and normalized path used by the runtime.
            // Keep this lease alive through every bounded slice and after READY.
            let database = app_root.join("library-sqlite").join("library-core.sqlite");
            freed_library_core::initialize_owned_normalized_sqlite_database_v1(&database, false)
                .map_err(
                    |error| freed_library_core::LibraryCoreProcessLeaseError::Storage {
                        operation: "annotation startup",
                        path: database,
                        source: std::io::Error::other(error.to_string()),
                    },
                )?;
            Ok(Self { _lease: lease })
        }
    }

    pub fn owns_lock(&self) -> bool {
        #[cfg(unix)]
        {
            self.installed
        }
        #[cfg(not(unix))]
        {
            self._lease.owns_lock()
        }
    }
}

#[cfg(unix)]
fn binding_error(path: &Path, detail: &str) -> freed_library_core::LibraryCoreProcessLeaseError {
    freed_library_core::LibraryCoreProcessLeaseError::Storage {
        operation: "bind",
        path: path.to_path_buf(),
        source: std::io::Error::other(detail.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(not(feature = "isolated-preview-data-root"))]
    fn desktop_data_root_matches_tauri_path_resolution() {
        use tauri::Manager;

        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("build mock app from the checked-in Tauri context");
        let tauri_data_root = app
            .path()
            .app_data_dir()
            .expect("resolve Tauri app data root")
            .join(LIBRARY_CORE_DIRECTORY);
        assert_eq!(
            freed_desktop_library_core_data_root().expect("resolve pre-Tauri data root"),
            tauri_data_root
        );
    }

    #[test]
    #[cfg(feature = "isolated-preview-data-root")]
    fn isolated_preview_uses_a_closed_nonproduction_data_root() {
        assert_eq!(
            freed_desktop_library_core_data_root().expect("resolve preview data root"),
            dirs::data_dir()
                .expect("resolve operating system data directory")
                .join(preview_identifier().expect("compiled preview identifier"))
                .join(LIBRARY_CORE_DIRECTORY)
        );
    }
    #[test]
    #[cfg(feature = "isolated-preview-data-root")]
    fn preview_config_accepts_fresh_profiles_and_refuses_primary_or_path_injection() {
        assert_eq!(
            identifier_from_preview_config(
                r#"{"identifier":"wtf.freed.desktop.preview.gliclass20261002"}"#
            )
            .unwrap(),
            "wtf.freed.desktop.preview.gliclass20261002"
        );
        for identifier in [
            "wtf.freed.desktop",
            "other.app",
            "wtf.freed.desktop.preview.",
            "wtf.freed.desktop.preview../primary",
            "wtf.freed.desktop.preview.a/../../primary",
        ] {
            assert!(identifier_from_preview_config(
                &serde_json::json!({"identifier": identifier}).to_string()
            )
            .is_err());
        }
        assert!(identifier_from_preview_config("not-json").is_err());
    }
}
