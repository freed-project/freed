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
                let mut source = Connection::open_with_flags(
                    database,
                    OpenFlags::SQLITE_OPEN_READ_ONLY
                        | OpenFlags::SQLITE_OPEN_NOFOLLOW
                        | OpenFlags::SQLITE_OPEN_PRIVATE_CACHE
                        | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                )?;
                // For an existing supported schema this verifies the catalog only.
                // A zero/foreign schema cannot be initialized on this read-only handle.
                install_normalized_schema_v1(&source)?;
                let (descriptor, digest, canonical_bytes) =
                    inspect_normalized_local_snapshot_source_v1(&mut source)?;
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
                std::fs::create_dir(&output)?;
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o700))?;
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)?
                    .as_millis()
                    .try_into()?;
                let snapshot = create_normalized_local_snapshot_v1(
                    &mut source,
                    &output,
                    now,
                    NormalizedLocalSnapshotReasonV1::Manual,
                )?;
                if snapshot.checkpoint_digest != digest
                    || snapshot.source_revision != descriptor.source_revision
                {
                    return Err("offline source frontier changed".into());
                }
                let verified = verify_normalized_local_snapshot_v1(&output, &snapshot.snapshot_id)?;
                println!(
                    "{}",
                    json!({"mode":"capture","snapshot":verified,"archiveUpperBoundBytes":bound,"freeBytesAfter":free_bytes(&output)?,"reserveBytes":RESERVE,"sourceOpenedReadOnly":true})
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
