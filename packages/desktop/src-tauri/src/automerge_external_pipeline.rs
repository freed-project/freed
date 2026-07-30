//! Bounded assembly of the verified Automerge decoder into one SQLite projection.
//!
//! This module is the production orchestrator that keeps the source snapshot,
//! decoded token runs, reconstructed rows, scratch graph, and destination
//! generation receipt-bound without ever hydrating the Automerge document.

use crate::automerge_external_change_rows::{
    write_external_change_rows, ExternalChangeColumns, ExternalChangeRowLimits,
    ExternalChangeRowSummary, ExternalPrimitiveChangeColumn, ExternalScalarChangeColumn,
    ACTOR_SPECIFICATION, DEPENDENCY_COUNT_SPECIFICATION, DEPENDENCY_INDEX_SPECIFICATION,
    EXTRA_METADATA_SPECIFICATION, EXTRA_RAW_SPECIFICATION, MAX_OPERATION_SPECIFICATION,
    MESSAGE_SPECIFICATION, SEQUENCE_SPECIFICATION, TIMESTAMP_SPECIFICATION,
};
use crate::automerge_external_column::{
    with_verified_column_decode_session, ExternalColumnDecodeLimits, ExternalColumnDecodeSession,
    ExternalColumnDecodeSummary, ExternalColumnInput,
};
use crate::automerge_external_decoder::{
    verify_chunk, write_verified_chunk_index, AutomergeChunkKind, ExternalDecoderLimits,
};
use crate::automerge_external_document::{
    write_verified_document_layout, ExternalDocumentLayoutLimits,
};
use crate::automerge_external_document_run::{
    read_verified_document_layout, ExternalDocumentLayoutRunLimits, ExternalVerifiedDocumentLayout,
};
use crate::automerge_external_operation_rows::{
    write_external_operation_rows, ExternalOperationColumns, ExternalOperationRowLimits,
    ExternalOperationRowSummary, ExternalPrimitiveOperationColumn, ExternalScalarOperationColumn,
    ACTION_SPECIFICATION, EXPAND_SPECIFICATION, ID_ACTOR_SPECIFICATION, ID_COUNTER_SPECIFICATION,
    INSERT_SPECIFICATION, KEY_ACTOR_SPECIFICATION, KEY_COUNTER_SPECIFICATION,
    KEY_STRING_SPECIFICATION, MARK_NAME_SPECIFICATION, OBJECT_ACTOR_SPECIFICATION,
    OBJECT_COUNTER_SPECIFICATION, SUCCESSOR_ACTOR_SPECIFICATION, SUCCESSOR_COUNTER_SPECIFICATION,
    SUCCESSOR_COUNT_SPECIFICATION, VALUE_METADATA_SPECIFICATION, VALUE_RAW_SPECIFICATION,
};
use crate::automerge_external_projection_population::populate_projection_generation_from_external_stage;
use crate::automerge_external_row_run::ExternalRowRunLimits;
use crate::automerge_external_sqlite_stage::{
    derive_projection_source, seal_staged_graph, stage_verified_change_rows,
    stage_verified_operation_rows, ExternalGraphStageReceipt,
};
use crate::automerge_external_value::{
    write_decoded_value_tokens, ExternalValueDecodeLimits, ExternalValueDecodeSummary,
};
use crate::shadow_store::{ProjectionRebuildState, ProjectionSourceV1};
use rusqlite::Connection;
use std::error::Error;
use std::fs::File;
use std::path::Path;
use tempfile::NamedTempFile;

const MAX_SOURCE_BYTES: u64 = 8 * 1_024 * 1_024 * 1_024;
const MAX_CHANGES: u64 = 16_000_000;
const MAX_OPERATIONS: u64 = 250_000_000;
const MAX_COLUMN_TOKENS: u64 = 250_000_000;
const MAX_DECODED_RUN_BYTES: u64 = 16 * 1_024 * 1_024 * 1_024;
const MAX_SCALAR_BYTES: u64 = 64 * 1_024 * 1_024;
const MAX_ROW_LINE_BYTES: usize = 8 * 1_024 * 1_024;

#[cfg(test)]
pub(super) const FEED_ITEM_DOCUMENT_HEX: &str = "856f4a839e68141600fc03011001010101010101010101010101010101013e51a68e38f2846c54df4fd795d798e51419127002cd2aa19d02712512a0092a080102030213032303350b4003430256020a0104020e1dbc0121022320340142155620575c800102020002017e08157e00017e04696e6974046974656d7e00017f0002070006170000067f0102060a090310031404182d8e3b4e0341104425b4ec97cb903a2341da840438407bbad633d2fcd4dd63e1db33b61c5505f54acfcde45c69d9743900de0d498704a3a942b464ddaae080203be82caa9f7da56f4a57f0c9a0767a5fb9b896906de7e9daa150f248cd7c91d551b526e00f9b5cc9d637db337f6e15f3259633c59de71ac98e2269abed1c83fa3bb16869e2f02b71b45283d3a529e4dbc8b071d08edcbe2861f49439e225f09ac081eec7ba3c6a477530fcd94ce27ce8c6a30fccc8af0ffdc1e8a2ff1d006e047d057d027d077e01087d07787e0103010e027b027f7f06027f7c067e01021d070002017d00010005017e02000301020204017f0207007686021400240076c6015624e602020002667f860102007f5602017e0200706970656c696e652d6669787475726501e80761727469636c6573617665643a746573743a317361766564840768747470733a2f2f6578616d706c652e746573742f31417574686f72617574686f72617574686f722d3168656c6c6f1d0001";

type PipelineResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ExternalProjectionMigrationReceipt {
    pub source: ProjectionSourceV1,
    pub graph: ExternalGraphStageReceipt,
    pub projection: ProjectionRebuildState,
}

pub(super) struct ExternalStagedProjection {
    pub connection: Connection,
    pub source: ProjectionSourceV1,
    pub graph: ExternalGraphStageReceipt,
}

struct DecodedPrimitive {
    summary: ExternalColumnDecodeSummary,
    run: NamedTempFile,
}

struct DecodedScalar {
    summary: ExternalValueDecodeSummary,
    run: NamedTempFile,
    payload: NamedTempFile,
}

struct DecodedChangeRuns {
    summary: ExternalChangeRowSummary,
    rows: NamedTempFile,
    dependencies: NamedTempFile,
    extra_payload: NamedTempFile,
}

struct DecodedOperationRuns {
    summary: ExternalOperationRowSummary,
    rows: NamedTempFile,
    successors: NamedTempFile,
    value_payload: NamedTempFile,
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn populate_projection_from_external_snapshot(
    source_file: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    storage_generation: i64,
    storage_save_revision: i64,
    scratch_path: &Path,
    destination_staging_path: &Path,
    rebuild_id: &str,
) -> PipelineResult<ExternalProjectionMigrationReceipt> {
    let mut staged = stage_external_snapshot(
        source_file,
        source_byte_length,
        source_sha256,
        storage_generation,
        storage_save_revision,
        scratch_path,
    )?;
    populate_staged_projection(&mut staged, destination_staging_path, rebuild_id)
}

pub(super) fn stage_external_snapshot(
    source_file: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    storage_generation: i64,
    storage_save_revision: i64,
    scratch_path: &Path,
) -> PipelineResult<ExternalStagedProjection> {
    if source_byte_length == 0 || source_byte_length > MAX_SOURCE_BYTES {
        return Err("external Automerge source exceeds the admitted bytes".into());
    }

    let layout = verified_layout(source_file, source_byte_length, source_sha256)?;
    let mut changes = decode_change_rows(source_file, source_byte_length, source_sha256, &layout)?;
    let mut operations =
        decode_operation_rows(source_file, source_byte_length, source_sha256, &layout)?;
    let mut scratch = Connection::open(scratch_path)?;

    stage_verified_change_rows(
        &mut scratch,
        changes.rows.as_file_mut(),
        changes.dependencies.as_file_mut(),
        changes.extra_payload.as_file_mut(),
        source_byte_length,
        source_sha256,
        &layout,
        &changes.summary,
        change_row_limits(),
        row_run_limits(),
    )?;
    stage_verified_operation_rows(
        &mut scratch,
        operations.rows.as_file_mut(),
        operations.successors.as_file_mut(),
        operations.value_payload.as_file_mut(),
        source_byte_length,
        source_sha256,
        &layout,
        &operations.summary,
        operation_row_limits(),
        row_run_limits(),
    )?;
    let graph = seal_staged_graph(&mut scratch)?;
    let source = derive_projection_source(&mut scratch, storage_generation, storage_save_revision)?;
    Ok(ExternalStagedProjection {
        connection: scratch,
        source,
        graph,
    })
}

pub(super) fn populate_staged_projection(
    staged: &mut ExternalStagedProjection,
    destination_staging_path: &Path,
    rebuild_id: &str,
) -> PipelineResult<ExternalProjectionMigrationReceipt> {
    let projection = populate_projection_generation_from_external_stage(
        &mut staged.connection,
        destination_staging_path,
        rebuild_id,
        &staged.source,
    )?;
    Ok(ExternalProjectionMigrationReceipt {
        source: staged.source.clone(),
        graph: staged.graph.clone(),
        projection,
    })
}

fn verified_layout(
    source: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
) -> PipelineResult<ExternalVerifiedDocumentLayout> {
    let mut chunk_index = NamedTempFile::new()?;
    let chunk_summary = write_verified_chunk_index(
        source,
        source_byte_length,
        source_sha256,
        ExternalDecoderLimits {
            max_chunk_count: 1,
            max_decompressed_chunk_bytes: MAX_SOURCE_BYTES,
        },
        chunk_index.as_file_mut(),
    )?;
    if chunk_summary.chunk_count != 1
        || chunk_summary.document_chunk_count != 1
        || chunk_summary.change_chunk_count != 0
        || chunk_summary.compressed_change_chunk_count != 0
    {
        return Err("external Automerge export is not one canonical document chunk".into());
    }
    let descriptor = verify_chunk(source, 0, 0, source_byte_length, MAX_SOURCE_BYTES)?;
    if descriptor.kind != AutomergeChunkKind::Document
        || u64::from(descriptor.header_byte_length) + descriptor.data_byte_length
            != source_byte_length
    {
        return Err("external Automerge document framing is incomplete".into());
    }

    let mut layout_run = NamedTempFile::new()?;
    let layout_summary = write_verified_document_layout(
        source,
        source_byte_length,
        source_sha256,
        &descriptor,
        layout_limits(),
        layout_run.as_file_mut(),
    )?;
    layout_run.as_file_mut().sync_all()?;
    Ok(read_verified_document_layout(
        layout_run.as_file_mut(),
        source_byte_length,
        source_sha256,
        &descriptor,
        &layout_summary,
        layout_limits(),
        layout_run_limits(),
    )?)
}

fn decode_primitive(
    session: &mut ExternalColumnDecodeSession<'_>,
    input: Option<ExternalColumnInput>,
) -> PipelineResult<Option<DecodedPrimitive>> {
    input
        .map(|input| {
            let mut run = NamedTempFile::new()?;
            let summary =
                session.write_decoded_column_tokens(input, column_limits(), run.as_file_mut())?;
            Ok(DecodedPrimitive { summary, run })
        })
        .transpose()
}

fn decode_scalar(
    session: &mut ExternalColumnDecodeSession<'_>,
    metadata_input: Option<ExternalColumnInput>,
    raw_input: Option<ExternalColumnInput>,
) -> PipelineResult<Option<DecodedScalar>> {
    let Some(metadata_input) = metadata_input else {
        return Ok(None);
    };
    let mut metadata_run = NamedTempFile::new()?;
    let metadata_summary = session.write_decoded_column_tokens(
        metadata_input,
        column_limits(),
        metadata_run.as_file_mut(),
    )?;
    let mut run = NamedTempFile::new()?;
    let mut payload = NamedTempFile::new()?;
    let summary = write_decoded_value_tokens(
        session,
        metadata_input,
        &metadata_summary,
        metadata_run.as_file_mut(),
        raw_input,
        value_limits(),
        payload.as_file_mut(),
        run.as_file_mut(),
    )?;
    Ok(Some(DecodedScalar {
        summary,
        run,
        payload,
    }))
}

fn primitive_operation_column(
    decoded: &mut Option<DecodedPrimitive>,
) -> Option<ExternalPrimitiveOperationColumn<'_>> {
    decoded
        .as_mut()
        .map(|decoded| ExternalPrimitiveOperationColumn {
            summary: &decoded.summary,
            run: decoded.run.as_file_mut(),
        })
}

fn scalar_operation_column(
    decoded: &mut Option<DecodedScalar>,
) -> Option<ExternalScalarOperationColumn<'_>> {
    decoded
        .as_mut()
        .map(|decoded| ExternalScalarOperationColumn {
            summary: &decoded.summary,
            run: decoded.run.as_file_mut(),
            payload_spool: decoded.payload.as_file_mut(),
        })
}

fn decode_change_rows(
    source: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
) -> PipelineResult<DecodedChangeRuns> {
    let required = |specification| -> PipelineResult<ExternalColumnInput> {
        layout.change_column(specification)?.ok_or_else(|| {
            format!("required Automerge change column {specification} is absent").into()
        })
    };
    let actor_input = required(ACTOR_SPECIFICATION)?;
    let sequence_input = required(SEQUENCE_SPECIFICATION)?;
    let max_operation_input = required(MAX_OPERATION_SPECIFICATION)?;
    let timestamp_input = required(TIMESTAMP_SPECIFICATION)?;
    let message_input = layout.change_column(MESSAGE_SPECIFICATION)?;
    let dependency_count_input = required(DEPENDENCY_COUNT_SPECIFICATION)?;
    let dependency_index_input = layout.change_column(DEPENDENCY_INDEX_SPECIFICATION)?;
    let extra_metadata_input = required(EXTRA_METADATA_SPECIFICATION)?;
    let extra_raw_input = layout.change_column(EXTRA_RAW_SPECIFICATION)?;

    let mut rows = NamedTempFile::new()?;
    let mut dependencies = NamedTempFile::new()?;
    let (summary, extra_payload) = with_verified_column_decode_session(
        source,
        source_byte_length,
        source_sha256,
        |session| -> PipelineResult<(ExternalChangeRowSummary, NamedTempFile)> {
            let mut actor = decode_primitive(session, Some(actor_input))?
                .ok_or("required Automerge actor column is absent")?;
            let mut sequence = decode_primitive(session, Some(sequence_input))?
                .ok_or("required Automerge sequence column is absent")?;
            let mut max_operation = decode_primitive(session, Some(max_operation_input))?
                .ok_or("required Automerge max-operation column is absent")?;
            let mut timestamp = decode_primitive(session, Some(timestamp_input))?
                .ok_or("required Automerge timestamp column is absent")?;
            let mut message = decode_primitive(session, message_input)?;
            let mut dependency_count = decode_primitive(session, Some(dependency_count_input))?
                .ok_or("required Automerge dependency-count column is absent")?;
            let mut dependency_index = decode_primitive(session, dependency_index_input)?;
            let mut extra = decode_scalar(session, Some(extra_metadata_input), extra_raw_input)?
                .ok_or("required Automerge extra column is absent")?;

            let summary = write_external_change_rows(
                session,
                layout,
                ExternalChangeColumns {
                    actor: ExternalPrimitiveChangeColumn {
                        summary: &actor.summary,
                        run: actor.run.as_file_mut(),
                    },
                    sequence: ExternalPrimitiveChangeColumn {
                        summary: &sequence.summary,
                        run: sequence.run.as_file_mut(),
                    },
                    max_operation: ExternalPrimitiveChangeColumn {
                        summary: &max_operation.summary,
                        run: max_operation.run.as_file_mut(),
                    },
                    timestamp: ExternalPrimitiveChangeColumn {
                        summary: &timestamp.summary,
                        run: timestamp.run.as_file_mut(),
                    },
                    message: message
                        .as_mut()
                        .map(|decoded| ExternalPrimitiveChangeColumn {
                            summary: &decoded.summary,
                            run: decoded.run.as_file_mut(),
                        }),
                    dependency_count: ExternalPrimitiveChangeColumn {
                        summary: &dependency_count.summary,
                        run: dependency_count.run.as_file_mut(),
                    },
                    dependency_index: dependency_index.as_mut().map(|decoded| {
                        ExternalPrimitiveChangeColumn {
                            summary: &decoded.summary,
                            run: decoded.run.as_file_mut(),
                        }
                    }),
                    extra: ExternalScalarChangeColumn {
                        summary: &extra.summary,
                        run: extra.run.as_file_mut(),
                        payload_spool: extra.payload.as_file_mut(),
                    },
                },
                change_row_limits(),
                dependencies.as_file_mut(),
                rows.as_file_mut(),
            )?;
            Ok((summary, extra.payload))
        },
    )?;
    rows.as_file_mut().sync_all()?;
    dependencies.as_file_mut().sync_all()?;
    extra_payload.as_file().sync_all()?;
    Ok(DecodedChangeRuns {
        summary,
        rows,
        dependencies,
        extra_payload,
    })
}

fn decode_operation_rows(
    source: &mut File,
    source_byte_length: u64,
    source_sha256: &str,
    layout: &ExternalVerifiedDocumentLayout,
) -> PipelineResult<DecodedOperationRuns> {
    let input = |specification| layout.operation_column(specification);
    let object_actor_input = input(OBJECT_ACTOR_SPECIFICATION)?;
    let object_counter_input = input(OBJECT_COUNTER_SPECIFICATION)?;
    let key_actor_input = input(KEY_ACTOR_SPECIFICATION)?;
    let key_counter_input = input(KEY_COUNTER_SPECIFICATION)?;
    let key_string_input = input(KEY_STRING_SPECIFICATION)?;
    let id_actor_input = input(ID_ACTOR_SPECIFICATION)?;
    let id_counter_input = input(ID_COUNTER_SPECIFICATION)?;
    let insert_input = input(INSERT_SPECIFICATION)?;
    let action_input = input(ACTION_SPECIFICATION)?;
    let value_metadata_input = input(VALUE_METADATA_SPECIFICATION)?;
    let value_raw_input = input(VALUE_RAW_SPECIFICATION)?;
    let successor_count_input = input(SUCCESSOR_COUNT_SPECIFICATION)?;
    let successor_actor_input = input(SUCCESSOR_ACTOR_SPECIFICATION)?;
    let successor_counter_input = input(SUCCESSOR_COUNTER_SPECIFICATION)?;
    let expand_input = input(EXPAND_SPECIFICATION)?;
    let mark_name_input = input(MARK_NAME_SPECIFICATION)?;

    let mut rows = NamedTempFile::new()?;
    let mut successors = NamedTempFile::new()?;
    let (summary, value_payload) = with_verified_column_decode_session(
        source,
        source_byte_length,
        source_sha256,
        |session| -> PipelineResult<(ExternalOperationRowSummary, NamedTempFile)> {
            let mut object_actor = decode_primitive(session, object_actor_input)?;
            let mut object_counter = decode_primitive(session, object_counter_input)?;
            let mut key_actor = decode_primitive(session, key_actor_input)?;
            let mut key_counter = decode_primitive(session, key_counter_input)?;
            let mut key_string = decode_primitive(session, key_string_input)?;
            let mut id_actor = decode_primitive(session, id_actor_input)?;
            let mut id_counter = decode_primitive(session, id_counter_input)?;
            let mut insert = decode_primitive(session, insert_input)?;
            let mut action = decode_primitive(session, action_input)?;
            let mut value = decode_scalar(session, value_metadata_input, value_raw_input)?;
            let mut successor_count = decode_primitive(session, successor_count_input)?;
            let mut successor_actor = decode_primitive(session, successor_actor_input)?;
            let mut successor_counter = decode_primitive(session, successor_counter_input)?;
            let mut expand = decode_primitive(session, expand_input)?;
            let mut mark_name = decode_primitive(session, mark_name_input)?;

            let summary = write_external_operation_rows(
                session,
                layout,
                ExternalOperationColumns {
                    object_actor: primitive_operation_column(&mut object_actor),
                    object_counter: primitive_operation_column(&mut object_counter),
                    key_actor: primitive_operation_column(&mut key_actor),
                    key_counter: primitive_operation_column(&mut key_counter),
                    key_string: primitive_operation_column(&mut key_string),
                    id_actor: primitive_operation_column(&mut id_actor),
                    id_counter: primitive_operation_column(&mut id_counter),
                    insert: primitive_operation_column(&mut insert),
                    action: primitive_operation_column(&mut action),
                    value: scalar_operation_column(&mut value),
                    successor_count: primitive_operation_column(&mut successor_count),
                    successor_actor: primitive_operation_column(&mut successor_actor),
                    successor_counter: primitive_operation_column(&mut successor_counter),
                    expand: primitive_operation_column(&mut expand),
                    mark_name: primitive_operation_column(&mut mark_name),
                },
                operation_row_limits(),
                successors.as_file_mut(),
                rows.as_file_mut(),
            )?;
            let value_payload = value
                .take()
                .ok_or("required Automerge operation value column is absent")?
                .payload;
            Ok((summary, value_payload))
        },
    )?;
    rows.as_file_mut().sync_all()?;
    successors.as_file_mut().sync_all()?;
    value_payload.as_file().sync_all()?;
    Ok(DecodedOperationRuns {
        summary,
        rows,
        successors,
        value_payload,
    })
}

fn column_limits() -> ExternalColumnDecodeLimits {
    ExternalColumnDecodeLimits {
        max_token_count: MAX_COLUMN_TOKENS,
        max_decoded_column_bytes: MAX_DECODED_RUN_BYTES,
        max_string_bytes: MAX_SCALAR_BYTES,
    }
}

fn value_limits() -> ExternalValueDecodeLimits {
    ExternalValueDecodeLimits {
        max_value_count: MAX_COLUMN_TOKENS,
        max_decoded_raw_bytes: MAX_DECODED_RUN_BYTES,
        max_string_bytes: MAX_SCALAR_BYTES,
        max_metadata_run_bytes: MAX_DECODED_RUN_BYTES,
        max_metadata_line_bytes: MAX_ROW_LINE_BYTES,
    }
}

fn layout_limits() -> ExternalDocumentLayoutLimits {
    ExternalDocumentLayoutLimits {
        max_actor_count: 1_000_000,
        max_actor_byte_length: 4_096,
        max_total_actor_bytes: 64 * 1_024 * 1_024,
        max_head_count: 1_000_000,
        max_columns_per_section: 1_024,
    }
}

fn layout_run_limits() -> ExternalDocumentLayoutRunLimits {
    ExternalDocumentLayoutRunLimits {
        max_run_bytes: 256 * 1_024 * 1_024,
        max_line_bytes: MAX_ROW_LINE_BYTES,
    }
}

fn change_row_limits() -> ExternalChangeRowLimits {
    ExternalChangeRowLimits {
        max_change_count: MAX_CHANGES,
        max_dependencies_per_change: 65_536,
        max_total_dependencies: MAX_OPERATIONS,
        max_message_bytes: MAX_SCALAR_BYTES,
        max_primitive_run_bytes: MAX_DECODED_RUN_BYTES,
        max_scalar_run_bytes: MAX_DECODED_RUN_BYTES,
        max_line_bytes: MAX_ROW_LINE_BYTES,
    }
}

fn operation_row_limits() -> ExternalOperationRowLimits {
    ExternalOperationRowLimits {
        max_operation_count: MAX_OPERATIONS,
        max_successors_per_operation: 65_536,
        max_total_successors: MAX_OPERATIONS,
        max_key_bytes: MAX_SCALAR_BYTES,
        max_mark_name_bytes: MAX_SCALAR_BYTES,
        max_primitive_run_bytes: MAX_DECODED_RUN_BYTES,
        max_scalar_run_bytes: MAX_DECODED_RUN_BYTES,
        max_line_bytes: MAX_ROW_LINE_BYTES,
    }
}

fn row_run_limits() -> ExternalRowRunLimits {
    ExternalRowRunLimits {
        max_run_bytes: MAX_DECODED_RUN_BYTES,
        max_line_bytes: MAX_ROW_LINE_BYTES,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automerge_external_common::{decode_test_hex, lower_hex};
    use crate::shadow_store::ShadowStore;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn migrates_one_verified_automerge_document_into_a_queryable_generation() {
        let bytes = decode_test_hex(FEED_ITEM_DOCUMENT_HEX);
        let source_sha256 = lower_hex(&Sha256::digest(&bytes));
        let directory = tempdir().unwrap();
        let mut snapshot = NamedTempFile::new_in(directory.path()).unwrap();
        snapshot.write_all(&bytes).unwrap();
        snapshot.as_file_mut().sync_all().unwrap();
        let scratch = directory.path().join("scratch.sqlite");
        let destination = directory.path().join("projection.sqlite");

        let receipt = populate_projection_from_external_snapshot(
            snapshot.as_file_mut(),
            bytes.len() as u64,
            &source_sha256,
            7,
            9,
            &scratch,
            &destination,
            "external-feed-items-v1",
        )
        .unwrap();

        assert_eq!(receipt.graph.source_sha256, source_sha256);
        assert_eq!(receipt.source.document_id, "pipeline-fixture");
        assert_eq!(receipt.source.head_count, 1);
        assert_eq!(receipt.source.storage_generation, 7);
        assert_eq!(receipt.source.storage_save_revision, 9);
        assert_eq!(receipt.source.heads_digest.len(), 64);
        assert_eq!(receipt.graph.change_count, 2);
        assert!(receipt.graph.operation_count > 1);
        assert!(receipt.projection.complete);
        assert_eq!(receipt.projection.projected_rows, 1);

        let store = ShadowStore::open(&destination).unwrap();
        let page = store.feed_page(None, 8).unwrap();
        assert_eq!(page.total_count, 1);
        assert_eq!(page.rows.len(), 1);
        drop(store);
        let projection = Connection::open(&destination).unwrap();
        let item = projection
            .query_row(
                "SELECT globalId, platform, contentType FROM feed_items;",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            item,
            (
                "saved:test:1".to_string(),
                "saved".to_string(),
                "article".to_string(),
            )
        );
    }

    #[test]
    fn rejects_changed_source_bytes_before_creating_a_projection() {
        let mut bytes = decode_test_hex(FEED_ITEM_DOCUMENT_HEX);
        let source_sha256 = lower_hex(&Sha256::digest(&bytes));
        let last = bytes.last_mut().unwrap();
        *last ^= 1;
        let directory = tempdir().unwrap();
        let mut snapshot = NamedTempFile::new_in(directory.path()).unwrap();
        snapshot.write_all(&bytes).unwrap();
        snapshot.as_file_mut().sync_all().unwrap();
        let scratch = directory.path().join("scratch.sqlite");
        let destination = directory.path().join("projection.sqlite");

        assert!(populate_projection_from_external_snapshot(
            snapshot.as_file_mut(),
            bytes.len() as u64,
            &source_sha256,
            7,
            9,
            &scratch,
            &destination,
            "external-feed-items-v1",
        )
        .is_err());
        assert!(!scratch.exists());
        assert!(!destination.exists());
    }
}
