//! Generation-pinned read adapter for immutable feed browse databases.
//!
//! The adapter authenticates the selected registry row, pins the exact file
//! identity, opens SQLite read-only with a bounded cache, and confirms that the
//! registry selection did not change during the open. It remains dormant:
//! there is no Tauri command or product caller.

use crate::library_core_feed_browse_registry::{
    FeedBrowseGenerationReaderSelection, FeedBrowseGenerationRegistry,
    FeedBrowseGenerationRegistryError,
};
use crate::library_core_feed_browse_store::{
    FeedBrowseCursor, FeedBrowseGenerationBinding, FeedBrowseGenerationStore, FeedBrowsePage,
    FeedBrowseReadDirection, FeedBrowseStoreError,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

const DEFAULT_READER_CACHE_KIB: i64 = -2 * 1_024;
const HASH_BUFFER_BYTES: usize = 1_048_576;

#[derive(Debug)]
pub(super) enum FeedBrowseGenerationReaderError {
    Registry(FeedBrowseGenerationRegistryError),
    Store(FeedBrowseStoreError),
    Io(std::io::Error),
    InvalidRoot,
    InvalidGenerationFile,
    GenerationDigestMismatch,
    SelectionChanged,
}

impl From<FeedBrowseGenerationRegistryError> for FeedBrowseGenerationReaderError {
    fn from(error: FeedBrowseGenerationRegistryError) -> Self {
        Self::Registry(error)
    }
}

impl From<FeedBrowseStoreError> for FeedBrowseGenerationReaderError {
    fn from(error: FeedBrowseStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<std::io::Error> for FeedBrowseGenerationReaderError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for FeedBrowseGenerationReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Registry(error) => write!(formatter, "registry error: {error}"),
            Self::Store(error) => write!(formatter, "feed browse store error: {error}"),
            Self::Io(error) => write!(formatter, "feed browse file error: {error}"),
            Self::InvalidRoot => formatter
                .write_str("feed browse generation root is not a stable physical directory"),
            Self::InvalidGenerationFile => {
                formatter.write_str("selected feed browse generation is not a stable regular file")
            }
            Self::GenerationDigestMismatch => formatter
                .write_str("selected feed browse generation digest does not match the registry"),
            Self::SelectionChanged => {
                formatter.write_str("feed browse generation selection changed while opening")
            }
        }
    }
}

impl std::error::Error for FeedBrowseGenerationReaderError {}

type ReaderResult<T> = Result<T, FeedBrowseGenerationReaderError>;

pub(super) struct FeedBrowseGenerationReader {
    selection: FeedBrowseGenerationReaderSelection,
    store: FeedBrowseGenerationStore,
    // Hold both resources for the complete reader lifetime. A pathname swap
    // cannot retarget the already-open SQLite connection or the pinned inode.
    _generation_file: File,
    _generation_root: PathBuf,
}

impl FeedBrowseGenerationReader {
    pub(super) fn open(registry_path: &Path, generation_root: &Path) -> ReaderResult<Self> {
        Self::open_with_cache_kib(registry_path, generation_root, DEFAULT_READER_CACHE_KIB)
    }

    pub(super) fn open_with_cache_kib(
        registry_path: &Path,
        generation_root: &Path,
        cache_kib: i64,
    ) -> ReaderResult<Self> {
        if !registry_path.is_absolute() || !generation_root.is_absolute() {
            return Err(FeedBrowseGenerationReaderError::InvalidRoot);
        }
        let canonical_root = generation_root.canonicalize()?;
        if canonical_root != generation_root {
            return Err(FeedBrowseGenerationReaderError::InvalidRoot);
        }
        let root_before = std::fs::symlink_metadata(generation_root)?;
        if !root_before.file_type().is_dir() {
            return Err(FeedBrowseGenerationReaderError::InvalidRoot);
        }

        let selection = FeedBrowseGenerationRegistry::read_selected_generation(registry_path)?;
        let generation_path = generation_root.join(&selection.generation.file_name);
        if generation_path.parent() != Some(generation_root) {
            return Err(FeedBrowseGenerationReaderError::InvalidGenerationFile);
        }

        let mut generation_file = open_generation_file(&generation_path)?;
        let opened_metadata = generation_file.metadata()?;
        let path_before = std::fs::symlink_metadata(&generation_path)?;
        if !opened_metadata.is_file()
            || !path_before.file_type().is_file()
            || !same_fs_entry(&opened_metadata, &path_before)
            || opened_metadata.len() != selection.generation.byte_length
        {
            return Err(FeedBrowseGenerationReaderError::InvalidGenerationFile);
        }
        if digest_open_file(&mut generation_file)? != selection.generation.file_digest {
            return Err(FeedBrowseGenerationReaderError::GenerationDigestMismatch);
        }

        let store = FeedBrowseGenerationStore::open_sealed_read_only_with_cache_kib(
            &generation_path,
            &selection.generation.binding,
            cache_kib,
        )?;

        let path_after = std::fs::symlink_metadata(&generation_path)?;
        let root_after = std::fs::symlink_metadata(generation_root)?;
        if !same_fs_entry(&opened_metadata, &path_after)
            || !same_fs_entry(&root_before, &root_after)
        {
            return Err(FeedBrowseGenerationReaderError::InvalidGenerationFile);
        }
        let confirmed = FeedBrowseGenerationRegistry::read_selected_generation(registry_path)?;
        if confirmed != selection {
            return Err(FeedBrowseGenerationReaderError::SelectionChanged);
        }

        Ok(Self {
            selection,
            store,
            _generation_file: generation_file,
            _generation_root: canonical_root,
        })
    }

    pub(super) fn generation_id(&self) -> &str {
        &self.selection.generation.binding.generation_id
    }

    pub(super) fn binding(&self) -> &FeedBrowseGenerationBinding {
        &self.selection.generation.binding
    }

    pub(super) fn selection_sequence(&self) -> i64 {
        self.selection.transition_sequence
    }

    pub(super) fn read_page(
        &self,
        cursor: Option<&FeedBrowseCursor>,
        limit: usize,
    ) -> ReaderResult<FeedBrowsePage> {
        self.store.read_page(cursor, limit).map_err(Into::into)
    }

    pub(super) fn read_page_in_direction(
        &self,
        cursor: Option<&FeedBrowseCursor>,
        limit: usize,
        direction: FeedBrowseReadDirection,
    ) -> ReaderResult<FeedBrowsePage> {
        self.store
            .read_page_in_direction(cursor, limit, direction)
            .map_err(Into::into)
    }
}

fn open_generation_file(path: &Path) -> ReaderResult<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
    }
    options.open(path).map_err(Into::into)
}

fn digest_open_file(file: &mut File) -> ReaderResult<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER_BYTES];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(lower_hex(&hasher.finalize()))
}

fn lower_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(unix)]
fn same_fs_entry(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;

    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.mode() == right.mode()
        && left.nlink() == right.nlink()
        && left.uid() == right.uid()
        && left.gid() == right.gid()
        && left.size() == right.size()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn same_fs_entry(left: &std::fs::Metadata, right: &std::fs::Metadata) -> bool {
    left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
        && left.created().ok() == right.created().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_core_feed_browse_registry::FeedBrowseGenerationRegistry;
    use crate::library_core_feed_browse_store::{
        FeedBrowseGenerationBinding, FeedBrowseProjectedRow, PublishedFeedBrowseGeneration,
    };
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        registry_path: PathBuf,
        generation_root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::fs::canonicalize(std::env::temp_dir())
                .expect("resolve temp root")
                .join(format!(
                    "freed-feed-browse-reader-{label}-{}-{nonce}",
                    std::process::id()
                ));
            let generation_root = root.join("generations");
            std::fs::create_dir_all(&generation_root).expect("create fixture");
            Self {
                registry_path: root.join("registry.sqlite"),
                root,
                generation_root,
            }
        }

        fn binding(&self, suffix: i64, total_rows: i64) -> FeedBrowseGenerationBinding {
            FeedBrowseGenerationBinding {
                generation_id: format!("{suffix:064x}"),
                source_document_id: format!("document-{suffix}"),
                source_heads_digest: format!("{:064x}", suffix + 10),
                source_head_count: suffix,
                transition_sequence: suffix,
                projection_revision: suffix,
                filter_json: format!("{{\"suffix\":{suffix}}}"),
                ranking_clock_ms: suffix,
                recommendation_order_schema_version: 1,
                total_rows,
            }
        }

        fn publish(
            &self,
            suffix: i64,
            rows: &[FeedBrowseProjectedRow],
        ) -> PublishedFeedBrowseGeneration {
            let binding = self.binding(suffix, rows.len() as i64);
            let path = self
                .generation_root
                .join(format!("generation-{suffix}.sqlite"));
            let mut store = FeedBrowseGenerationStore::open(&path).expect("open generation");
            store.begin(&binding).expect("begin generation");
            if !rows.is_empty() {
                store.append_page(0, rows).expect("append rows");
            }
            store.finalize().expect("finalize generation");
            store.seal(&path, &binding).expect("seal generation")
        }

        fn registry(&self) -> FeedBrowseGenerationRegistry {
            FeedBrowseGenerationRegistry::open(&self.registry_path, &self.generation_root)
                .expect("open registry")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn row(id: &str) -> FeedBrowseProjectedRow {
        FeedBrowseProjectedRow {
            priority: 9,
            published_at: 8,
            source_sequence: 7,
            global_id: id.to_owned(),
            card_json: format!(r#"{{"globalId":"{id}","contentText":"bounded"}}"#),
        }
    }

    #[test]
    fn reads_only_the_selected_sealed_generation_with_a_bounded_cache() {
        let fixture = Fixture::new("selected");
        let published = fixture.publish(1, &[row("item-1")]);
        let mut registry = fixture.registry();
        let registered = registry.register(&published).expect("register");
        registry
            .select("select-1", None, &registered.binding.generation_id)
            .expect("select");
        drop(registry);

        let reader =
            FeedBrowseGenerationReader::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reader");
        assert_eq!(reader.generation_id(), registered.binding.generation_id);
        assert_eq!(reader.selection_sequence(), 1);
        let page = reader.read_page(None, 32).expect("page");
        assert_eq!(page.binding, registered.binding);
        assert_eq!(page.rows, vec![row("item-1")]);
        assert!(page.next_cursor.is_none());
    }

    #[test]
    fn rejects_changed_generation_bytes_and_a_symlinked_root() {
        let fixture = Fixture::new("fail-closed");
        let published = fixture.publish(2, &[]);
        let mut registry = fixture.registry();
        let registered = registry.register(&published).expect("register");
        registry
            .select("select-2", None, &registered.binding.generation_id)
            .expect("select");
        drop(registry);
        OpenOptions::new()
            .append(true)
            .open(&published.path)
            .expect("open generation")
            .write_all(b"changed")
            .expect("change generation");
        assert!(matches!(
            FeedBrowseGenerationReader::open(&fixture.registry_path, &fixture.generation_root),
            Err(FeedBrowseGenerationReaderError::InvalidGenerationFile)
                | Err(FeedBrowseGenerationReaderError::GenerationDigestMismatch)
        ));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let alias = fixture.root.join("generation-alias");
            symlink(&fixture.generation_root, &alias).expect("alias");
            assert!(matches!(
                FeedBrowseGenerationReader::open(&fixture.registry_path, &alias),
                Err(FeedBrowseGenerationReaderError::InvalidRoot)
            ));
        }
    }

    #[test]
    fn a_new_reader_observes_the_exact_rollback_selection() {
        let fixture = Fixture::new("rollback");
        let first = fixture.publish(3, &[]);
        let second = fixture.publish(4, &[]);
        let mut registry = fixture.registry();
        let first = registry.register(&first).expect("register first");
        let second = registry.register(&second).expect("register second");
        registry
            .select("select-3", None, &first.binding.generation_id)
            .expect("select first");
        registry
            .select(
                "select-4",
                Some(&first.binding.generation_id),
                &second.binding.generation_id,
            )
            .expect("select second");
        registry
            .rollback(
                "rollback-3",
                Some(&second.binding.generation_id),
                &first.binding.generation_id,
            )
            .expect("rollback");
        drop(registry);

        let reader =
            FeedBrowseGenerationReader::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reader");
        assert_eq!(reader.generation_id(), first.binding.generation_id);
        assert_eq!(reader.selection_sequence(), 3);
    }
}
