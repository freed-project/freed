#[cfg(unix)]
mod unix {
    // Offline recovery tooling: no network, credentials, runtime startup or source row writes.
    // Capture requires the same process lease as Desktop, so the app must first quit.
    use freed_library_core::{
        create_normalized_local_snapshot_v1, inspect_normalized_local_snapshot_source_v1,
        install_normalized_schema_v1, verify_normalized_local_snapshot_in_empty_database_v1,
        verify_normalized_local_snapshot_v1, LibraryCoreProcessLease,
        NormalizedLocalSnapshotReasonV1, ProcessLeaseIdentity,
    };
    use rusqlite::{Connection, OpenFlags};
    use serde_json::json;
    use std::ffi::CString;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    const RESERVE: u64 = 10 * 1024 * 1024 * 1024;
    const OVERHEAD: u64 = 128 * 1024 * 1024;

    #[allow(clippy::unnecessary_cast)] // statvfs field widths differ across Unix targets.
    fn free_bytes(path: &Path) -> Result<u64, Box<dyn std::error::Error>> {
        use std::os::unix::ffi::OsStrExt;
        let path = CString::new(path.as_os_str().as_bytes())?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let stat = unsafe { stat.assume_init() };
        Ok((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
    }

    // A predecessor can expose export records through an unindexed UNION ALL
    // view. Paging that view sorts/scans the whole corpus for every page. Copy
    // it once into a private capped WITHOUT ROWID tree; never migrate the source.
    fn readonly_file_uri(path: &Path) -> String {
        use std::os::unix::ffi::OsStrExt;
        let mut uri = String::from("file:");
        for &byte in path.as_os_str().as_bytes() {
            if byte.is_ascii_alphanumeric() || b"/._-".contains(&byte) {
                uri.push(char::from(byte));
            } else {
                uri.push_str(&format!("%{byte:02X}"));
            }
        }
        uri.push_str("?mode=ro");
        uri
    }

    fn project_legacy_export(
        source_path: &Path,
        projection_path: &Path,
        budget: u64,
    ) -> Result<Connection, Box<dyn std::error::Error>> {
        if budget < 4096 {
            return Err("legacy export projection has no page budget".into());
        }
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(projection_path)?;
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        drop(file);
        let projection_path = std::fs::canonicalize(projection_path)?;
        let mut target = Connection::open_with_flags(
            &projection_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NOFOLLOW
                | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                | OpenFlags::SQLITE_OPEN_URI,
        )?;
        target.pragma_update(None, "page_size", 4096)?;
        target.pragma_update(None, "max_page_count", budget / 4096)?;
        target.pragma_update(None, "journal_mode", "DELETE")?;
        target.pragma_update(None, "synchronous", "FULL")?;
        target.pragma_update(None, "cache_size", -16_384)?;
        target.execute(
            "ATTACH DATABASE ?1 AS legacy_source;",
            [readonly_file_uri(source_path)],
        )?;
        // Every source table and record is read under this one attached-source
        // transaction. This file is an export staging object, never a Library.
        let transaction = target.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE library_meta AS SELECT * FROM legacy_source.library_meta;
             CREATE TABLE library_authority_epochs AS SELECT * FROM legacy_source.library_authority_epochs;
             CREATE TABLE library_active_authority AS SELECT * FROM legacy_source.library_active_authority;
             CREATE TABLE library_actors AS SELECT * FROM legacy_source.library_actors;
             CREATE TABLE library_checkpoint_export (
               registry_key TEXT NOT NULL,
               primary_key_json TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               chunk_bytes BLOB,
               PRIMARY KEY (registry_key, primary_key_json)
             ) WITHOUT ROWID;
             INSERT INTO library_checkpoint_export
               SELECT registry_key, primary_key_json, payload_json, chunk_bytes
               FROM legacy_source.library_checkpoint_export;
             CREATE VIEW library_feed_items AS
               SELECT primary_key_json FROM library_checkpoint_export
               WHERE registry_key = '10_feed_item';",
        )?;
        transaction.commit()?;
        target.execute_batch("DETACH DATABASE legacy_source;")?;
        target.pragma_update(None, "query_only", true)?;
        Ok(target)
    }

    fn run() -> Result<(), Box<dyn std::error::Error>> {
        let args: Vec<String> = std::env::args().collect();
        let usage = "usage: snapshot_recovery capture <database> <new-private-archive-directory> | verify <archive-directory> <snapshot-id> | reconstruct <archive-directory> <snapshot-id> <new-private-target-directory>";
        let mode = args.get(1).ok_or(usage)?;
        match mode.as_str() {
            "capture" if args.len() == 4 => {
                let requested = Path::new(&args[2]);
                if std::fs::symlink_metadata(requested)?
                    .file_type()
                    .is_symlink()
                {
                    return Err("source database must not be a symlink".into());
                }
                let database = std::fs::canonicalize(requested)?;
                let root = database.parent().ok_or("database parent missing")?;
                let output = PathBuf::from(&args[3]);
                if output.exists() {
                    return Err("capture output directory must be new".into());
                }
                let parent =
                    std::fs::canonicalize(output.parent().ok_or("output parent missing")?)?;
                let _lease = LibraryCoreProcessLease::acquire(
                    root,
                    ProcessLeaseIdentity::new("freed-snapshot-recovery", env!("CARGO_PKG_VERSION")),
                )?;
                let mut original_source = Connection::open_with_flags(
                    &database,
                    OpenFlags::SQLITE_OPEN_READ_ONLY
                        | OpenFlags::SQLITE_OPEN_NOFOLLOW
                        | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                        | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                )?;
                // For an existing supported schema this verifies the catalog only.
                // A zero/foreign schema cannot be initialized on this read-only handle.
                install_normalized_schema_v1(&original_source)?;
                let legacy: bool = original_source.query_row(
                    "SELECT type = 'view' FROM main.sqlite_master WHERE name = 'library_checkpoint_export';",
                    [], |row| row.get(0),
                )?;
                let projection_path = output.join(".legacy-checkpoint-export.sqlite");
                let projection_budget = free_bytes(&parent)?.saturating_sub(RESERVE + OVERHEAD) / 3;
                let mut projection = if legacy {
                    if projection_budget < 4096 {
                        return Err("legacy capture has no storage budget above reserve".into());
                    }
                    std::fs::create_dir(&output)?;
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o700))?;
                    eprintln!(
                        "legacy export projection started; pageBudgetBytes={projection_budget}"
                    );
                    Some(project_legacy_export(
                        &database,
                        &projection_path,
                        projection_budget,
                    )?)
                } else {
                    None
                };
                let projection_bytes = if legacy {
                    std::fs::metadata(&projection_path)?.len()
                } else {
                    0
                };
                let source = projection.as_mut().unwrap_or(&mut original_source);
                eprintln!("snapshot sizing started; legacyProjectionBytes={projection_bytes}");
                let (descriptor, digest, canonical_bytes) =
                    inspect_normalized_local_snapshot_source_v1(source)?;
                let bound = canonical_bytes
                    .checked_add(descriptor.record_count as u64)
                    .and_then(|n| n.checked_add(65_537))
                    .ok_or("archive size overflow")?;
                let available = free_bytes(&parent)?;
                let required = RESERVE
                    .checked_add(OVERHEAD)
                    .and_then(|n| n.checked_add(bound))
                    .ok_or("capture budget overflow")?;
                if available < required {
                    return Err(format!("capture needs {} additional bytes: available={available}, archiveUpperBound={bound}, reserve={RESERVE}, overhead={OVERHEAD}", required - available).into());
                }
                if !legacy {
                    std::fs::create_dir(&output)?;
                }
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o700))?;
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)?
                    .as_millis()
                    .try_into()?;
                eprintln!("snapshot archive started; archiveUpperBoundBytes={bound}");
                let snapshot = create_normalized_local_snapshot_v1(
                    source,
                    &output,
                    now,
                    NormalizedLocalSnapshotReasonV1::Manual,
                )?;
                if snapshot.checkpoint_digest != digest
                    || snapshot.source_revision != descriptor.source_revision
                {
                    return Err("offline source frontier changed".into());
                }
                eprintln!("snapshot canonical verification started");
                let verified = verify_normalized_local_snapshot_v1(&output, &snapshot.snapshot_id)?;
                drop(projection);
                if legacy {
                    std::fs::remove_file(&projection_path)?;
                }
                println!(
                    "{}",
                    json!({"mode":"capture","snapshot":verified,"archiveUpperBoundBytes":bound,"freeBytesAfter":free_bytes(&output)?,"reserveBytes":RESERVE,"sourceOpenedReadOnly":true,"legacyProjectionBytes":projection_bytes,"legacyProjectionPageBudgetBytes":if legacy {Some(projection_budget)} else {None},"legacyProjectionRemoved":legacy})
                );
            }
            "verify" if args.len() == 4 => {
                let summary = verify_normalized_local_snapshot_v1(Path::new(&args[2]), &args[3])?;
                println!("{}", json!({"mode":"verify","snapshot":summary}));
            }
            "reconstruct" if args.len() == 5 => {
                let summary = verify_normalized_local_snapshot_v1(Path::new(&args[2]), &args[3])?;
                let output = PathBuf::from(&args[4]);
                if output.exists() {
                    return Err("reconstruction target directory must be new".into());
                }
                let parent =
                    std::fs::canonicalize(output.parent().ok_or("target parent missing")?)?;
                let available = free_bytes(&parent)?;
                let budget = available.saturating_sub(RESERVE + OVERHEAD) / 2;
                // Stage rows alone contain the canonical bytes. Index and normalized
                // rows need more; the hard page cap, not this lower bound, fences growth.
                if budget < summary.canonical_record_bytes {
                    return Err(format!("isolated reconstruction needs at least {} additional bytes at the two-file safety cap; canonicalBytes={}, available={available}, reserve={RESERVE}, overhead={OVERHEAD}; indexes need additional room", (summary.canonical_record_bytes - budget) * 2, summary.canonical_record_bytes).into());
                }
                std::fs::create_dir(&output)?;
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o700))?;
                let database = output.join("verification.sqlite");
                let _file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&database)?;
                let mut target = Connection::open_with_flags(
                    &database,
                    OpenFlags::SQLITE_OPEN_READ_WRITE
                        | OpenFlags::SQLITE_OPEN_NOFOLLOW
                        | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE,
                )?;
                let _lease = LibraryCoreProcessLease::acquire(
                    &output,
                    ProcessLeaseIdentity::new(
                        "freed-snapshot-verification",
                        env!("CARGO_PKG_VERSION"),
                    ),
                )?;
                target.pragma_update(None, "page_size", 4096)?;
                target.pragma_update(None, "max_page_count", budget / 4096)?;
                target.pragma_update(None, "journal_mode", "DELETE")?;
                target.pragma_update(None, "synchronous", "FULL")?;
                install_normalized_schema_v1(&target)?;
                let result = verify_normalized_local_snapshot_in_empty_database_v1(
                    &mut target,
                    Path::new(&args[2]),
                    &args[3],
                )?;
                println!(
                    "{}",
                    json!({"mode":"isolated_checkpoint_reconstruction","snapshot":result,"databasePageBudgetBytes":budget,"freeBytesAfter":free_bytes(&output)?,"reserveBytes":RESERVE,"newAuthorityKeys":false,"signedSuccessorRestore":false})
                );
            }
            _ => return Err(usage.into()),
        }
        Ok(())
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use freed_library_core::{
            prepare_fresh_normalized_desktop_library_v1, ActorKeyStore, AuthorityKeyStore,
        };
        use ring::{rand::SystemRandom, signature::Ed25519KeyPair};
        use tempfile::tempdir;

        struct Keys(Vec<u8>);
        impl ActorKeyStore for Keys {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(self.0.clone()))
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("fixture only".into())
            }
        }
        impl AuthorityKeyStore for Keys {
            fn load(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
                Ok(Some(self.0.clone()))
            }
            fn store(&self, _: &str, _: &[u8]) -> Result<(), String> {
                Err("fixture only".into())
            }
        }
        fn keys() -> Keys {
            Keys(
                Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                    .unwrap()
                    .as_ref()
                    .to_vec(),
            )
        }
        fn fixture(path: &Path) -> Connection {
            let mut source = Connection::open(path).unwrap();
            install_normalized_schema_v1(&source).unwrap();
            prepare_fresh_normalized_desktop_library_v1(
                &mut source,
                &"5".repeat(64),
                &keys(),
                &keys(),
                1_000,
            )
            .unwrap();
            for n in 0..64 {
                source.execute("INSERT INTO library_preferences (path,value_type,text_value,updated_at) VALUES (?1,'text','before',1100);", [format!("v:$.fixture.{n}")]).unwrap();
            }
            let kind: String = source
                .query_row(
                    "SELECT type FROM sqlite_master WHERE name='library_checkpoint_export'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            if kind == "table" {
                source.execute_batch("ALTER TABLE library_checkpoint_export RENAME TO fixture_export; CREATE VIEW library_checkpoint_export AS SELECT * FROM fixture_export;").unwrap();
            }
            source
        }

        #[test]
        fn legacy_projection_preserves_digest_and_uses_an_index() {
            let dir = tempdir().unwrap();
            let path = dir.path().join("source with # and ?.sqlite");
            let mut source = fixture(&path);
            let before = std::fs::read(&path).unwrap();
            let expected = inspect_normalized_local_snapshot_source_v1(&mut source).unwrap();
            let mut projected = project_legacy_export(
                &std::fs::canonicalize(&path).unwrap(),
                &dir.path().join("projection.sqlite"),
                16 * 1024 * 1024,
            )
            .unwrap();
            assert_eq!(
                inspect_normalized_local_snapshot_source_v1(&mut projected).unwrap(),
                expected
            );
            let plan: Vec<String> = projected.prepare("EXPLAIN QUERY PLAN SELECT registry_key,primary_key_json,payload_json,chunk_bytes FROM library_checkpoint_export WHERE (registry_key,primary_key_json)>(?1,?2) ORDER BY registry_key,primary_key_json LIMIT 32").unwrap().query_map(["", ""], |r| r.get(3)).unwrap().collect::<Result<_,_>>().unwrap();
            assert!(
                plan.iter()
                    .any(|s| s.contains("SEARCH") && s.contains("PRIMARY KEY")),
                "{plan:?}"
            );
            assert!(!plan.iter().any(|s| s.contains("TEMP B-TREE")), "{plan:?}");
            assert_eq!(std::fs::read(&path).unwrap(), before);
            projected.pragma_update(None, "query_only", false).unwrap();
            projected
                .execute(
                    "ATTACH DATABASE ?1 AS probe",
                    [readonly_file_uri(&std::fs::canonicalize(&path).unwrap())],
                )
                .unwrap();
            let error = projected
                .execute("UPDATE probe.library_meta SET source_revision=999", [])
                .unwrap_err();
            assert_eq!(
                error.sqlite_error_code(),
                Some(rusqlite::ErrorCode::ReadOnly)
            );
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }

        #[test]
        fn projection_remains_at_one_frontier_after_source_advances() {
            let dir = tempdir().unwrap();
            let path = dir.path().join("source.sqlite");
            let source = fixture(&path);
            let mut projected = project_legacy_export(
                &std::fs::canonicalize(&path).unwrap(),
                &dir.path().join("projection.sqlite"),
                16 * 1024 * 1024,
            )
            .unwrap();
            let before = inspect_normalized_local_snapshot_source_v1(&mut projected).unwrap();
            source.execute_batch("UPDATE library_preferences SET text_value='after'; UPDATE library_meta SET source_revision=source_revision+1;").unwrap();
            assert_eq!(
                inspect_normalized_local_snapshot_source_v1(&mut projected).unwrap(),
                before
            );
            let snapshot = create_normalized_local_snapshot_v1(
                &mut projected,
                &dir.path().join("archives"),
                2_000,
                NormalizedLocalSnapshotReasonV1::Manual,
            )
            .unwrap();
            assert_eq!(snapshot.source_revision, before.0.source_revision);
            assert_eq!(snapshot.checkpoint_digest, before.1);
            let mut restored = Connection::open(dir.path().join("reconstructed.sqlite")).unwrap();
            install_normalized_schema_v1(&restored).unwrap();
            verify_normalized_local_snapshot_in_empty_database_v1(
                &mut restored,
                &dir.path().join("archives"),
                &snapshot.snapshot_id,
            )
            .unwrap();
            assert_eq!(
                inspect_normalized_local_snapshot_source_v1(&mut restored).unwrap(),
                before
            );
        }

        #[test]
        fn projection_page_cap_refuses_without_changing_source() {
            let dir = tempdir().unwrap();
            let path = dir.path().join("source.sqlite");
            let _source = fixture(&path);
            let before = std::fs::read(&path).unwrap();
            let projection = dir.path().join("projection.sqlite");
            let error =
                project_legacy_export(&std::fs::canonicalize(&path).unwrap(), &projection, 4096)
                    .err()
                    .unwrap();
            assert_eq!(
                error
                    .downcast_ref::<rusqlite::Error>()
                    .and_then(|e| e.sqlite_error_code()),
                Some(rusqlite::ErrorCode::DiskFull)
            );
            assert!(std::fs::metadata(&projection).unwrap().len() <= 4096);
            assert_eq!(std::fs::read(&path).unwrap(), before);
        }
    }

    pub fn run_cli() {
        if let Err(error) = run() {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
#[cfg(unix)]
fn main() {
    unix::run_cli();
}
#[cfg(not(unix))]
fn main() {
    eprintln!("Offline snapshot recovery currently requires Unix process leases.");
    std::process::exit(1);
}
