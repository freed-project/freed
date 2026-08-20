//! Freed Desktop path and identity adapter for the native process lease.

use std::path::{Path, PathBuf};

const FREED_DESKTOP_IDENTIFIER: &str = "wtf.freed.desktop";
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
        .map(|root| {
            root.join(FREED_DESKTOP_IDENTIFIER)
                .join(LIBRARY_CORE_DIRECTORY)
        })
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
            freed_library_core::LibraryCoreProcessLease::acquire(
                requested_data_root,
                DESKTOP_IDENTITY,
            )
            .map(|lease| Self { _lease: lease })
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
}
