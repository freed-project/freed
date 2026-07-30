//! Bounded copy from a receipt-verified Automerge scratch projection into one
//! immutable SQLite generation.
//!
//! The scratch snapshot and destination generation are distinct databases.
//! Native memory retains only one bounded page. Automerge remains the active
//! authority while the startup migration uses this bridge to publish a derived
//! immutable read generation.

use crate::automerge_external_sqlite_stage::{
    materialize_feed_item_projection, open_feed_item_projection_snapshot, ExternalSqliteStageError,
};
use crate::projection_coordinator::{
    apply_projection_batch, begin_or_resume_projection, ProjectionCoordinatorError,
};
use crate::shadow_store::{
    ProjectionRebuildState, ProjectionSourceV1, MAX_PROJECTION_BATCH_BYTES,
    MAX_PROJECTION_BATCH_ITEMS,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub(super) enum ExternalProjectionPopulationError {
    Stage(ExternalSqliteStageError),
    Coordinator(ProjectionCoordinatorError),
    IncompleteSource,
}

impl From<ExternalSqliteStageError> for ExternalProjectionPopulationError {
    fn from(error: ExternalSqliteStageError) -> Self {
        Self::Stage(error)
    }
}

impl From<ProjectionCoordinatorError> for ExternalProjectionPopulationError {
    fn from(error: ProjectionCoordinatorError) -> Self {
        Self::Coordinator(error)
    }
}

impl fmt::Display for ExternalProjectionPopulationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Stage(error) => write!(formatter, "projection source failed: {error}"),
            Self::Coordinator(error) => write!(formatter, "projection destination failed: {error}"),
            Self::IncompleteSource => {
                formatter.write_str("projection source ended before its receipted row count")
            }
        }
    }
}

impl std::error::Error for ExternalProjectionPopulationError {}

pub(super) type PopulationResult<T> = Result<T, ExternalProjectionPopulationError>;

/// Populates or resumes one exact derived projection generation.
///
/// A response-loss retry reopens the destination rebuild, derives the source
/// cursor from its committed projected-row count, and continues with the next
/// deterministic page. The scratch transaction pins one verified source
/// snapshot for the complete call.
pub(super) fn populate_projection_generation_from_external_stage(
    source_connection: &mut Connection,
    destination_staging_path: &Path,
    rebuild_id: &str,
    source: &ProjectionSourceV1,
) -> PopulationResult<ProjectionRebuildState> {
    populate_projection_generation(
        source_connection,
        destination_staging_path,
        rebuild_id,
        source,
        MAX_PROJECTION_BATCH_ITEMS,
        MAX_PROJECTION_BATCH_BYTES,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn populate_projection_generation(
    source_connection: &mut Connection,
    destination_staging_path: &Path,
    rebuild_id: &str,
    source: &ProjectionSourceV1,
    maximum_rows: usize,
    maximum_bytes: usize,
    maximum_batches: Option<usize>,
) -> PopulationResult<ProjectionRebuildState> {
    let receipt = materialize_feed_item_projection(source_connection)?;
    let total_rows = usize::try_from(receipt.feed_item_count)
        .map_err(|_| ExternalProjectionPopulationError::IncompleteSource)?;
    let mut state =
        begin_or_resume_projection(destination_staging_path, rebuild_id, source, total_rows)?;
    if state.complete {
        return Ok(state);
    }

    let snapshot = open_feed_item_projection_snapshot(source_connection)?;
    if snapshot.receipt() != &receipt {
        return Err(ExternalProjectionPopulationError::IncompleteSource);
    }
    let mut cursor = snapshot.cursor_for_projected_rows(state.projected_rows)?;
    let mut applied_batches = 0usize;
    while !state.complete {
        if maximum_batches.is_some_and(|maximum| applied_batches >= maximum) {
            break;
        }
        let page = snapshot
            .read_page(cursor, maximum_rows, maximum_bytes)?
            .ok_or(ExternalProjectionPopulationError::IncompleteSource)?;
        let projected_rows = state
            .projected_rows
            .checked_add(page.rows.len())
            .ok_or(ExternalProjectionPopulationError::IncompleteSource)?;
        let batch_id = projection_batch_id(rebuild_id, state.next_batch_index, &page.input_digest);
        state = apply_projection_batch(
            destination_staging_path,
            rebuild_id,
            source,
            total_rows,
            state.next_batch_index,
            &batch_id,
            &page.input_digest,
            projected_rows,
            page.complete,
            &page.rows,
        )?;
        cursor = Some(page.last_entity_operation_index);
        applied_batches = applied_batches.saturating_add(1);
    }
    Ok(state)
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn populate_projection_generation_with_test_limits(
    source_connection: &mut Connection,
    destination_staging_path: &Path,
    rebuild_id: &str,
    source: &ProjectionSourceV1,
    maximum_rows: usize,
    maximum_bytes: usize,
    maximum_batches: usize,
) -> PopulationResult<ProjectionRebuildState> {
    populate_projection_generation(
        source_connection,
        destination_staging_path,
        rebuild_id,
        source,
        maximum_rows,
        maximum_bytes,
        Some(maximum_batches),
    )
}

fn projection_batch_id(rebuild_id: &str, batch_index: i64, input_digest: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"freed-external-projection-batch-v1");
    hasher.update((rebuild_id.len() as u64).to_be_bytes());
    hasher.update(rebuild_id.as_bytes());
    hasher.update(batch_index.to_be_bytes());
    hasher.update(input_digest.as_bytes());
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}
