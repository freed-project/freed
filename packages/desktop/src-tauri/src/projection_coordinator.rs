//! Replay-safe orchestration for derived Library Core projection generations.
//!
//! This module composes the already isolated rebuild, publication, registry,
//! selection, bounded retention, and reader contracts. The startup migration
//! bridge reaches it through the shadow runtime, but it assigns no product
//! reader or Automerge authority.

use crate::projection_generation_reader::{
    ProjectionGenerationReader, ProjectionGenerationReaderError,
};
use crate::projection_generation_registry::{
    ProjectionGenerationRegistry, ProjectionGenerationRegistryError,
};
use crate::shadow_store::{
    FeedItemRow, FeedPage, PageCursor, ProjectionRebuildState, ProjectionSourceV1, ShadowStore,
    ShadowStoreError,
};
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub(super) enum ProjectionCoordinatorError {
    Store(ShadowStoreError),
    Registry(ProjectionGenerationRegistryError),
    Reader(ProjectionGenerationReaderError),
    Io(std::io::Error),
    AmbiguousPublication,
}

impl From<ShadowStoreError> for ProjectionCoordinatorError {
    fn from(error: ShadowStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<ProjectionGenerationRegistryError> for ProjectionCoordinatorError {
    fn from(error: ProjectionGenerationRegistryError) -> Self {
        Self::Registry(error)
    }
}

impl From<ProjectionGenerationReaderError> for ProjectionCoordinatorError {
    fn from(error: ProjectionGenerationReaderError) -> Self {
        Self::Reader(error)
    }
}

impl From<std::io::Error> for ProjectionCoordinatorError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl fmt::Display for ProjectionCoordinatorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Store(error) => write!(formatter, "projection store error: {error}"),
            Self::Registry(error) => write!(formatter, "projection registry error: {error}"),
            Self::Reader(error) => write!(formatter, "projection reader error: {error}"),
            Self::Io(error) => write!(formatter, "projection file error: {error}"),
            Self::AmbiguousPublication => formatter.write_str(
                "projection staging and immutable destination both exist after publication",
            ),
        }
    }
}

impl std::error::Error for ProjectionCoordinatorError {}

pub(super) type CoordinatorResult<T> = Result<T, ProjectionCoordinatorError>;

pub(super) struct ProjectionReadSession {
    reader: ProjectionGenerationReader,
}

impl ProjectionReadSession {
    pub(super) fn generation_id(&self) -> &str {
        self.reader.generation_id()
    }

    pub(super) fn transition_sequence(&self) -> i64 {
        self.reader.transition_sequence()
    }

    pub(super) fn projection_revision(&self) -> i64 {
        self.reader.projection_revision()
    }

    pub(super) fn source(&self) -> ProjectionSourceV1 {
        self.reader.source()
    }

    pub(super) fn feed_page(
        &self,
        cursor: Option<&PageCursor>,
        limit: u32,
    ) -> CoordinatorResult<FeedPage> {
        self.reader.feed_page(cursor, limit).map_err(Into::into)
    }

    pub(super) fn item_detail(&self, global_id: &str) -> CoordinatorResult<Option<FeedItemRow>> {
        self.reader.item_detail(global_id).map_err(Into::into)
    }
}

/// Opens the exact generation selected by the durable projection registry.
///
/// The reader authenticates and pins the selected immutable file before this
/// session is returned. It does not create a registry, select a generation, or
/// change Automerge authority.
pub(super) fn open_selected_projection(
    registry_path: &Path,
    generation_root: &Path,
) -> CoordinatorResult<ProjectionReadSession> {
    Ok(ProjectionReadSession {
        // Two concurrent interactive sessions at 2 MiB each leave the shared
        // 16 MiB snapshot pool room for bounded response DTOs and connection
        // overhead. Rebuild verification keeps the larger default cache.
        reader: ProjectionGenerationReader::open_with_cache_kib(
            registry_path,
            generation_root,
            -2 * 1024,
        )?,
    })
}

/// Begins a fresh rebuild or resumes its exact durable state.
pub(super) fn begin_or_resume_projection(
    staging_path: &Path,
    rebuild_id: &str,
    source: &ProjectionSourceV1,
    total_rows: usize,
) -> CoordinatorResult<ProjectionRebuildState> {
    let mut store = ShadowStore::open(staging_path)?;
    store
        .begin_projection_rebuild(rebuild_id, source, total_rows)
        .map_err(Into::into)
}

/// Applies one bounded sequential rebuild batch with exact response-loss retry.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_projection_batch(
    staging_path: &Path,
    rebuild_id: &str,
    source: &ProjectionSourceV1,
    total_rows: usize,
    batch_index: i64,
    batch_id: &str,
    input_digest: &str,
    projected_rows: usize,
    complete: bool,
    rows: &[FeedItemRow],
) -> CoordinatorResult<ProjectionRebuildState> {
    let mut store = ShadowStore::open(staging_path)?;
    store
        .apply_projection_rebuild_batch(
            rebuild_id,
            source,
            total_rows,
            batch_index,
            batch_id,
            input_digest,
            projected_rows,
            complete,
            rows,
        )
        .map(|commit| commit.state)
        .map_err(Into::into)
}

/// Publishes, registers, selects, and opens one complete immutable generation.
///
/// The exact operation is recoverable after response loss at any later step.
/// If immutable publication already completed, the missing staging pathname
/// and exact destination are treated as the publication receipt. If both paths
/// exist, the state is ambiguous and fails closed.
#[allow(clippy::too_many_arguments)]
pub(super) fn finalize_and_open_projection(
    staging_path: &Path,
    destination: &Path,
    registry_path: &Path,
    generation_root: &Path,
    rebuild_id: &str,
    source: &ProjectionSourceV1,
    total_rows: usize,
    transition_id: &str,
    expected_current_generation_id: Option<&str>,
) -> CoordinatorResult<ProjectionReadSession> {
    let staging_exists = staging_path.try_exists()?;
    let destination_exists = destination.try_exists()?;
    let published = match (staging_exists, destination_exists) {
        (true, false) => ShadowStore::open(staging_path)?.publish_complete_projection_generation(
            destination,
            rebuild_id,
            source,
            total_rows,
        )?,
        (false, true) => ShadowStore::inspect_published_projection_generation(
            destination,
            rebuild_id,
            source,
            total_rows,
        )?,
        (true, true) => return Err(ProjectionCoordinatorError::AmbiguousPublication),
        (false, false) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "projection staging and immutable destination are both absent",
            )
            .into())
        }
    };

    let mut registry = ProjectionGenerationRegistry::open(registry_path, generation_root)?;
    let generation = registry.register(&published)?;
    registry.select(
        transition_id,
        expected_current_generation_id,
        &generation.generation_id,
    )?;
    registry.prune_unselected_generations()?;
    drop(registry);

    Ok(ProjectionReadSession {
        reader: ProjectionGenerationReader::open(registry_path, generation_root)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        generation_root: PathBuf,
        staging_path: PathBuf,
        destination: PathBuf,
        registry_path: PathBuf,
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
                    "freed-projection-coordinator-{label}-{}-{nonce}",
                    std::process::id()
                ));
            let generation_root = root.join("generations");
            std::fs::create_dir_all(&generation_root).expect("generation root");
            Self {
                staging_path: generation_root.join("staging.sqlite"),
                destination: generation_root.join("generation.sqlite"),
                registry_path: root.join("registry.sqlite"),
                generation_root,
                root,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn source() -> ProjectionSourceV1 {
        ProjectionSourceV1 {
            document_id: "freed-library".to_string(),
            heads_digest: "1".repeat(64),
            head_count: 2,
            storage_generation: 3,
            storage_save_revision: 4,
        }
    }

    fn row(index: usize) -> FeedItemRow {
        FeedItemRow {
            global_id: format!("x:{index}"),
            platform: Some("x".to_string()),
            content_type: Some("post".to_string()),
            published_at: Some(1_780_000_000_000 - index as i64),
            captured_at: Some(1_780_000_000_000),
            author_id: None,
            author_display_name: None,
            author_handle: None,
            source_url: None,
            hidden: Some(0),
            saved: Some(0),
            archived: Some(0),
            read_at: None,
            archived_at: None,
            liked_at: None,
            tags: Some("[]".to_string()),
            content_blob: Some("{\"text\":\"body\"}".to_string()),
            preserved_blob: None,
            rest: "{}".to_string(),
        }
    }

    #[test]
    fn composes_rebuild_publication_selection_and_bounded_reads() {
        let fixture = Fixture::new("complete");
        let source = source();
        let begun = begin_or_resume_projection(&fixture.staging_path, "rebuild-1", &source, 2)
            .expect("begin");
        assert_eq!(begun.next_batch_index, 0);

        let first = apply_projection_batch(
            &fixture.staging_path,
            "rebuild-1",
            &source,
            2,
            0,
            "batch-0",
            &"2".repeat(64),
            1,
            false,
            &[row(0)],
        )
        .expect("first batch");
        assert_eq!(first.projected_rows, 1);
        let replay = apply_projection_batch(
            &fixture.staging_path,
            "rebuild-1",
            &source,
            2,
            0,
            "batch-0",
            &"2".repeat(64),
            1,
            false,
            &[row(0)],
        )
        .expect("replay first batch");
        assert_eq!(replay, first);

        let completed = apply_projection_batch(
            &fixture.staging_path,
            "rebuild-1",
            &source,
            2,
            1,
            "batch-1",
            &"3".repeat(64),
            2,
            true,
            &[row(1)],
        )
        .expect("final batch");
        assert!(completed.complete);

        let session = finalize_and_open_projection(
            &fixture.staging_path,
            &fixture.destination,
            &fixture.registry_path,
            &fixture.generation_root,
            "rebuild-1",
            &source,
            2,
            "select-1",
            None,
        )
        .expect("finalize");
        assert_eq!(session.transition_sequence(), 1);
        let page = session.feed_page(None, 50).expect("page");
        assert_eq!(page.total_count, 2);
        assert_eq!(page.rows.len(), 2);
    }

    #[test]
    fn exact_finalize_retry_recovers_after_publication_and_selection_response_loss() {
        let fixture = Fixture::new("retry");
        let source = source();
        begin_or_resume_projection(&fixture.staging_path, "rebuild-2", &source, 0)
            .expect("begin empty rebuild");
        let first = finalize_and_open_projection(
            &fixture.staging_path,
            &fixture.destination,
            &fixture.registry_path,
            &fixture.generation_root,
            "rebuild-2",
            &source,
            0,
            "select-2",
            None,
        )
        .expect("first finalize");
        let generation_id = first.generation_id().to_string();
        drop(first);

        let recovered = finalize_and_open_projection(
            &fixture.staging_path,
            &fixture.destination,
            &fixture.registry_path,
            &fixture.generation_root,
            "rebuild-2",
            &source,
            0,
            "select-2",
            None,
        )
        .expect("recover finalize");
        assert_eq!(recovered.generation_id(), generation_id);
        assert_eq!(recovered.transition_sequence(), 1);
        assert_eq!(recovered.feed_page(None, 1).expect("page").total_count, 0);
    }

    #[test]
    fn ambiguous_publication_state_fails_closed() {
        let fixture = Fixture::new("ambiguous");
        let source = source();
        begin_or_resume_projection(&fixture.staging_path, "rebuild-3", &source, 0)
            .expect("begin empty rebuild");
        std::fs::write(&fixture.destination, b"not a generation").expect("destination");

        assert!(matches!(
            finalize_and_open_projection(
                &fixture.staging_path,
                &fixture.destination,
                &fixture.registry_path,
                &fixture.generation_root,
                "rebuild-3",
                &source,
                0,
                "select-3",
                None,
            ),
            Err(ProjectionCoordinatorError::AmbiguousPublication)
        ));
    }
}
