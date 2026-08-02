//! Generation-pinned read adapter for immutable Library Core projections.
//!
//! This module is deliberately dormant. It proves that a selected projection
//! can be authenticated and served through bounded SQLite queries, but no
//! Tauri command or production caller activates it yet.

use crate::projection_generation_registry::{
    ProjectionGenerationReaderSelection, ProjectionGenerationRegistry,
    ProjectionGenerationRegistryError,
};
use crate::shadow_store::{
    FeedItemRow, FeedPage, FriendSourceKey, FriendsActivityWindow, FriendsGraphActivity,
    ItemScanPage, LibraryFacetSummary, LibrarySavedAnalytics, LibrarySurface, PageCursor,
    ProjectionSourceV1, SavedAnalyticsWindow, ShadowStore, ShadowStoreError,
};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

const HASH_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
pub(super) enum ProjectionGenerationReaderError {
    Registry(ProjectionGenerationRegistryError),
    Store(ShadowStoreError),
    Io(std::io::Error),
    InvalidRoot,
    InvalidGenerationFile,
    GenerationDigestMismatch,
    GenerationReceiptMismatch,
    SelectionChanged,
}

impl From<ProjectionGenerationRegistryError> for ProjectionGenerationReaderError {
    fn from(error: ProjectionGenerationRegistryError) -> Self {
        Self::Registry(error)
    }
}

impl From<ShadowStoreError> for ProjectionGenerationReaderError {
    fn from(error: ShadowStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<std::io::Error> for ProjectionGenerationReaderError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for ProjectionGenerationReaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Registry(error) => write!(formatter, "registry error: {error}"),
            Self::Store(error) => write!(formatter, "projection error: {error}"),
            Self::Io(error) => write!(formatter, "projection file error: {error}"),
            Self::InvalidRoot => {
                formatter.write_str("projection generation root is not a stable physical directory")
            }
            Self::InvalidGenerationFile => {
                formatter.write_str("selected projection generation is not a stable regular file")
            }
            Self::GenerationDigestMismatch => {
                formatter.write_str("selected projection generation digest does not match registry")
            }
            Self::GenerationReceiptMismatch => formatter
                .write_str("selected projection generation receipt does not match registry"),
            Self::SelectionChanged => {
                formatter.write_str("projection generation selection changed while opening")
            }
        }
    }
}

impl std::error::Error for ProjectionGenerationReaderError {}

pub(super) type ReaderResult<T> = Result<T, ProjectionGenerationReaderError>;

pub(super) struct ProjectionGenerationReader {
    selection: ProjectionGenerationReaderSelection,
    store: ShadowStore,
    // Pin the exact inode for the lifetime of the SQLite connection. A later
    // pathname replacement cannot silently turn this session into another
    // generation.
    _generation_file: File,
    _generation_root: PathBuf,
}

impl ProjectionGenerationReader {
    pub(super) fn open(registry_path: &Path, generation_root: &Path) -> ReaderResult<Self> {
        Self::open_with_cache_kib(registry_path, generation_root, -32 * 1024)
    }

    pub(super) fn open_with_cache_kib(
        registry_path: &Path,
        generation_root: &Path,
        cache_kib: i64,
    ) -> ReaderResult<Self> {
        if !registry_path.is_absolute() || !generation_root.is_absolute() {
            return Err(ProjectionGenerationReaderError::InvalidRoot);
        }
        let canonical_root = generation_root.canonicalize()?;
        if canonical_root != generation_root {
            return Err(ProjectionGenerationReaderError::InvalidRoot);
        }
        let root_before = std::fs::symlink_metadata(generation_root)?;
        if !root_before.file_type().is_dir() {
            return Err(ProjectionGenerationReaderError::InvalidRoot);
        }

        let selection = ProjectionGenerationRegistry::read_selected_generation(registry_path)?;
        let generation_path = generation_root.join(&selection.generation.file_name);
        if generation_path.parent() != Some(generation_root) {
            return Err(ProjectionGenerationReaderError::InvalidGenerationFile);
        }

        let mut generation_file = open_generation_file(&generation_path)?;
        let opened_metadata = generation_file.metadata()?;
        let path_before = std::fs::symlink_metadata(&generation_path)?;
        if !opened_metadata.is_file()
            || !path_before.file_type().is_file()
            || !same_fs_entry(&opened_metadata, &path_before)
            || opened_metadata.len() != selection.generation.byte_length
        {
            return Err(ProjectionGenerationReaderError::InvalidGenerationFile);
        }
        if digest_open_file(&mut generation_file)? != selection.generation.generation_id {
            return Err(ProjectionGenerationReaderError::GenerationDigestMismatch);
        }

        let source = ProjectionSourceV1 {
            document_id: selection.generation.source_document_id.clone(),
            heads_digest: selection.generation.source_heads_digest.clone(),
            head_count: selection.generation.source_head_count,
            storage_generation: selection.generation.source_generation,
            storage_save_revision: selection.generation.source_save_revision,
        };
        let (store, published) =
            ShadowStore::open_published_projection_generation_read_only_with_cache_kib(
                &generation_path,
                &selection.generation.rebuild_id,
                &source,
                selection.generation.total_rows,
                cache_kib,
            )?;
        if published.path != generation_path
            || published.rebuild_id != selection.generation.rebuild_id
            || published.source != source
            || published.total_rows != selection.generation.total_rows
            || published.projection_revision != selection.generation.projection_revision
            || published.byte_length != selection.generation.byte_length
        {
            return Err(ProjectionGenerationReaderError::GenerationReceiptMismatch);
        }

        let path_after = std::fs::symlink_metadata(&generation_path)?;
        let root_after = std::fs::symlink_metadata(generation_root)?;
        if !same_fs_entry(&opened_metadata, &path_after)
            || !same_fs_entry(&root_before, &root_after)
        {
            return Err(ProjectionGenerationReaderError::InvalidGenerationFile);
        }
        let confirmed = ProjectionGenerationRegistry::read_selected_generation(registry_path)?;
        if confirmed != selection {
            return Err(ProjectionGenerationReaderError::SelectionChanged);
        }

        Ok(Self {
            selection,
            store,
            _generation_file: generation_file,
            _generation_root: canonical_root,
        })
    }

    pub(super) fn generation_id(&self) -> &str {
        &self.selection.generation.generation_id
    }

    pub(super) fn transition_sequence(&self) -> i64 {
        self.selection.transition_sequence
    }

    pub(super) fn projection_revision(&self) -> i64 {
        self.selection.generation.projection_revision
    }

    pub(super) fn source(&self) -> ProjectionSourceV1 {
        ProjectionSourceV1 {
            document_id: self.selection.generation.source_document_id.clone(),
            heads_digest: self.selection.generation.source_heads_digest.clone(),
            head_count: self.selection.generation.source_head_count,
            storage_generation: self.selection.generation.source_generation,
            storage_save_revision: self.selection.generation.source_save_revision,
        }
    }

    pub(super) fn feed_page(
        &self,
        cursor: Option<&PageCursor>,
        limit: u32,
    ) -> ReaderResult<FeedPage> {
        self.store.feed_page(cursor, limit).map_err(Into::into)
    }

    pub(super) fn item_detail(&self, global_id: &str) -> ReaderResult<Option<FeedItemRow>> {
        self.store.item_detail(global_id).map_err(Into::into)
    }

    pub(super) fn facet_summary(&self) -> ReaderResult<LibraryFacetSummary> {
        self.store.facet_summary().map_err(Into::into)
    }

    pub(super) fn saved_analytics(
        &self,
        daily_windows: &[SavedAnalyticsWindow; 7],
        hourly_windows: &[SavedAnalyticsWindow; 24],
    ) -> ReaderResult<LibrarySavedAnalytics> {
        self.store
            .saved_analytics(daily_windows, hourly_windows)
            .map_err(Into::into)
    }

    pub(super) fn friends_graph_activity(
        &self,
        sources: &[FriendSourceKey],
        rss_feed_urls: &[String],
        recent_window: FriendsActivityWindow,
    ) -> ReaderResult<FriendsGraphActivity> {
        self.store
            .friends_graph_activity(sources, rss_feed_urls, recent_window)
            .map_err(Into::into)
    }

    pub(super) fn person_timeline(
        &self,
        sources: &[FriendSourceKey],
        cursor: Option<&PageCursor>,
        limit: u32,
    ) -> ReaderResult<FeedPage> {
        self.store
            .person_timeline(sources, cursor, limit)
            .map_err(Into::into)
    }

    pub(super) fn surface_items(
        &self,
        surface: LibrarySurface,
        limit: u32,
    ) -> ReaderResult<Vec<FeedItemRow>> {
        self.store.surface_items(surface, limit).map_err(Into::into)
    }

    pub(super) fn item_scan_page(
        &self,
        after_global_id: Option<&str>,
        limit: u32,
    ) -> ReaderResult<ItemScanPage> {
        self.store
            .item_scan_page(after_global_id, limit)
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
    use crate::projection_generation_registry::ProjectionGenerationRegistry;
    use crate::shadow_store::{
        FriendSourceKey, ProjectionSourceV1, PublishedProjectionGeneration, ShadowStore,
    };
    use rusqlite::Connection;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        generation_root: PathBuf,
        registry_path: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::fs::canonicalize(std::env::temp_dir())
                .expect("temp root")
                .join(format!(
                    "freed-projection-reader-{}-{nonce}-{:032x}",
                    std::process::id(),
                    rand::random::<u128>()
                ));
            let generation_root = root.join("generations");
            std::fs::create_dir_all(&generation_root).expect("generation root");
            let registry_path = root.join("projection-generations.sqlite");
            Self {
                root,
                generation_root,
                registry_path,
            }
        }

        fn publish_empty(&self, suffix: i64) -> PublishedProjectionGeneration {
            let staging = self
                .generation_root
                .join(format!(".projection-{suffix}.staging.sqlite"));
            let destination = self
                .generation_root
                .join(format!("projection-{suffix}.sqlite"));
            let source = ProjectionSourceV1 {
                document_id: format!("document-{suffix}"),
                heads_digest: format!("{suffix:064x}"),
                head_count: suffix,
                storage_generation: suffix,
                storage_save_revision: suffix,
            };
            let mut store = ShadowStore::open(&staging).expect("staging store");
            store
                .begin_projection_rebuild(&format!("rebuild-{suffix}"), &source, 0)
                .expect("empty rebuild");
            store
                .publish_complete_projection_generation(
                    &destination,
                    &format!("rebuild-{suffix}"),
                    &source,
                    0,
                )
                .expect("published generation")
        }

        fn registry(&self) -> ProjectionGenerationRegistry {
            ProjectionGenerationRegistry::open(&self.registry_path, &self.generation_root)
                .expect("registry")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn opens_only_the_selected_content_addressed_generation() {
        let fixture = Fixture::new();
        let published = fixture.publish_empty(1);
        let mut registry = fixture.registry();
        let registered = registry.register(&published).expect("register");
        registry
            .select("select-1", None, &registered.generation_id)
            .expect("select");
        drop(registry);

        let reader =
            ProjectionGenerationReader::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reader");
        assert_eq!(reader.generation_id(), registered.generation_id);
        assert_eq!(reader.transition_sequence(), 1);
        let page = reader.feed_page(None, 50).expect("bounded page");
        assert_eq!(page.revision, 0);
        assert_eq!(page.total_count, 0);
        assert!(page.rows.is_empty());
        assert!(page.next_cursor.is_none());
    }

    #[test]
    fn rejects_generation_bytes_changed_after_registration() {
        let fixture = Fixture::new();
        let published = fixture.publish_empty(2);
        let mut registry = fixture.registry();
        let registered = registry.register(&published).expect("register");
        registry
            .select("select-2", None, &registered.generation_id)
            .expect("select");
        drop(registry);
        OpenOptions::new()
            .append(true)
            .open(&published.path)
            .expect("open generation")
            .write_all(b"changed")
            .expect("change generation");

        let error = match ProjectionGenerationReader::open(
            &fixture.registry_path,
            &fixture.generation_root,
        ) {
            Ok(_) => panic!("changed generation must fail"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            ProjectionGenerationReaderError::InvalidGenerationFile
                | ProjectionGenerationReaderError::GenerationDigestMismatch
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_generation_root() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let published = fixture.publish_empty(3);
        let mut registry = fixture.registry();
        let registered = registry.register(&published).expect("register");
        registry
            .select("select-3", None, &registered.generation_id)
            .expect("select");
        drop(registry);
        let alias = fixture.root.join("generation-alias");
        symlink(&fixture.generation_root, &alias).expect("alias");

        assert!(matches!(
            ProjectionGenerationReader::open(&fixture.registry_path, &alias),
            Err(ProjectionGenerationReaderError::InvalidRoot)
        ));
    }

    #[test]
    fn a_new_reader_observes_an_exact_rollback_selection() {
        let fixture = Fixture::new();
        let mut first = fixture.publish_empty(4);
        {
            let conn = Connection::open(&first.path).expect("open prior-schema generation");
            conn.execute_batch("DROP INDEX feed_items_friends_timeline; PRAGMA user_version = 3;")
                .expect("restore exact v3 catalog");
        }
        first.byte_length = std::fs::metadata(&first.path)
            .expect("prior-schema generation metadata")
            .len();
        let second = fixture.publish_empty(5);
        let mut registry = fixture.registry();
        let first = registry.register(&first).expect("register first");
        let second = registry.register(&second).expect("register second");
        registry
            .select("select-4", None, &first.generation_id)
            .expect("select first");
        registry
            .select(
                "select-5",
                Some(&first.generation_id),
                &second.generation_id,
            )
            .expect("select second");
        registry
            .rollback(
                "rollback-4",
                Some(&second.generation_id),
                &first.generation_id,
            )
            .expect("rollback");
        drop(registry);

        let reader =
            ProjectionGenerationReader::open(&fixture.registry_path, &fixture.generation_root)
                .expect("reader");
        assert_eq!(reader.generation_id(), first.generation_id);
        assert_eq!(reader.transition_sequence(), 3);
        let page = reader
            .person_timeline(
                &[FriendSourceKey {
                    platform: "x".to_string(),
                    author_id: "author-1".to_string(),
                }],
                None,
                1,
            )
            .expect("v3 rollback timeline remains readable");
        assert_eq!(page.total_count, 0);
        assert!(page.rows.is_empty());
    }
}
