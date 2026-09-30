//! Dormant migration implementation, compiled only for contract tests until lifecycle activation.
use crate::normalized_query::{NormalizedPreferenceLeafV1, NormalizedPreferenceValueRequestV1};
use crate::normalized_sqlite::{install_normalized_schema_v1, NormalizedSqliteError};
use crate::sqlite_contract_generated::*;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

fn invalid(message: &'static str) -> NormalizedSqliteError {
    NormalizedSqliteError::InvalidRequest(message)
}

fn verify_catalog(connection: &Connection, sql: &str) -> Result<(), NormalizedSqliteError> {
    for declaration in sql.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        let words = declaration.split_whitespace().take(3).collect::<Vec<_>>();
        if words.len() != 3 || words[0] != "CREATE" || !matches!(words[1], "TABLE" | "INDEX") {
            return Err(invalid("pending preference catalog declaration is invalid"));
        }
        let stored: String = connection.query_row(
            "SELECT sql FROM sqlite_schema WHERE type=?1 AND name=?2;",
            params![words[1].to_lowercase(), words[2]],
            |row| row.get(0),
        )?;
        if stored != declaration {
            return Err(invalid("pending preference catalog changed"));
        }
    }
    Ok(())
}

fn verify_storage(connection: &Connection) -> Result<(), NormalizedSqliteError> {
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application: u32 =
        connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let matches: bool = connection.query_row(
        "SELECT contract_version=?1 AND schema_version=?2 AND protocol_version=?3 AND schema_sha256=?4 FROM library_storage_meta WHERE singleton_id=1;",
        params![SQLITE_CONTRACT_VERSION,PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,SQLITE_PROTOCOL_VERSION,PENDING_PREFERENCE_SCHEMA_SHA256], |row|row.get(0),
    )?;
    if version != PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION
        || application != SQLITE_APPLICATION_ID
        || !matches
    {
        return Err(invalid("pending preference storage identity changed"));
    }
    verify_catalog(connection, NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL)?;
    verify_catalog(connection, PENDING_PREFERENCE_SCHEMA_EXTENSION_SQL)
}

/// This owns the complete transaction; no successful return can expose only half a migration.
fn migrate(connection: &mut Connection) -> Result<(), NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "pending preference migration requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: u32 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version == PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION {
        verify_storage(&tx)?;
        let context = crate::normalized_follower_mutation_context_v1(&tx)?;
        let matches: bool = tx.query_row("SELECT actor_id=?1 AND target_counter<=?2 FROM library_local_preference_projection WHERE singleton_id=1;",
            params![context.actor_id,context.next_counter-1],|r|r.get(0))?;
        if !matches {
            return Err(invalid("pending preference migration actor changed"));
        }
        tx.commit()?;
        return Ok(());
    }
    if ![SQLITE_SCHEMA_VERSION, NATIVE_STORAGE_SCHEMA_VERSION].contains(&version) {
        return Err(invalid(
            "pending preference migration source is unsupported",
        ));
    }
    install_normalized_schema_v1(&tx)?;
    let context = crate::normalized_follower_mutation_context_v1(&tx)?;
    crate::normalized_handoff::require_handoff_follower_edit_admission_v1(&tx)?;
    let old_digest = if version == SQLITE_SCHEMA_VERSION {
        tx.execute_batch(NORMALIZED_NATIVE_SCHEMA_EXTENSION_SQL)?;
        NORMALIZED_SCHEMA_SHA256
    } else {
        NORMALIZED_NATIVE_SCHEMA_SHA256
    };
    tx.execute_batch(PENDING_PREFERENCE_SCHEMA_EXTENSION_SQL)?;
    tx.execute("INSERT INTO library_local_preference_projection(singleton_id,actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest) SELECT 1,actor_id,0,?2,NULL,chain_genesis_digest FROM library_actors WHERE actor_id=?1;",
        params![context.actor_id,context.next_counter-1])?;
    if tx.execute("UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2 WHERE singleton_id=1 AND schema_version=?3 AND schema_sha256=?4;",
        params![PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,PENDING_PREFERENCE_SCHEMA_SHA256,version,old_digest])? != 1 {
        return Err(invalid("pending preference migration source changed"));
    }
    tx.pragma_update(
        None,
        "user_version",
        PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,
    )?;
    verify_storage(&tx)?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VisiblePreferenceSource {
    generation_id: String,
    source_revision: i64,
    local_sequence: i64,
    actor_id: String,
    actor_counter: i64,
}

fn visible_source_in_transaction(
    tx: &rusqlite::Transaction<'_>,
) -> Result<VisiblePreferenceSource, NormalizedSqliteError> {
    verify_storage(tx)?;
    let context = crate::normalized_follower_mutation_context_v1(tx)?;
    let sql = PENDING_PREFERENCE_QUERY_PROGRAMS
        .iter()
        .find(|(name, _)| *name == "source_v1")
        .ok_or(invalid("visible preference source program is absent"))?
        .1;
    let source = tx.query_row(sql, [], |r| {
        Ok(VisiblePreferenceSource {
            generation_id: r.get(0)?,
            source_revision: r.get(1)?,
            local_sequence: r.get(2)?,
            actor_id: r.get(3)?,
            actor_counter: r.get(4)?,
        })
    })?;
    if source.actor_id != context.actor_id
        || source.actor_counter != context.next_counter - 1
        || [&source.generation_id, &source.actor_id].iter().any(|v| {
            v.len() != 64
                || !v
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        || [
            source.source_revision,
            source.local_sequence,
            source.actor_counter,
        ]
        .iter()
        .any(|v| !(0..=9_007_199_254_740_991).contains(v))
    {
        return Err(invalid("visible preference source is invalid"));
    }
    Ok(source)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VisiblePreferenceValue {
    path: Vec<String>,
    kind: String,
    rows: Vec<NormalizedPreferenceLeafV1>,
    source: VisiblePreferenceSource,
}

fn pending_program(id: &str) -> Result<&'static str, NormalizedSqliteError> {
    PENDING_PREFERENCE_QUERY_PROGRAMS
        .iter()
        .find(|(name, _)| *name == id)
        .map(|(_, sql)| *sql)
        .ok_or(invalid("pending preference program is missing"))
}

fn pending_node(
    row: &rusqlite::Row<'_>,
    offset: usize,
    base: &str,
) -> rusqlite::Result<NormalizedPreferenceLeafV1> {
    let path: String = row.get(offset)?;
    let kind: String = row.get(offset + 1)?;
    let prefix = match kind.as_str() {
        "object" => "o:",
        "array" => "a:",
        "value" => "v:",
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    let suffix = path
        .strip_prefix(base)
        .ok_or(rusqlite::Error::InvalidQuery)?;
    Ok(NormalizedPreferenceLeafV1 {
        path: format!("{prefix}$._{suffix}"),
        value_type: row.get(offset + 2)?,
        boolean_value: row.get(offset + 3)?,
        integer_value: row.get(offset + 4)?,
        real_value: row.get(offset + 5)?,
        text_value: row.get(offset + 6)?,
        updated_at: row.get(offset + 7)?,
    })
}

// The assigning member identifies the complete replacement subtree for an array.
type ResolvedPreferenceNode = (Option<NormalizedPreferenceLeafV1>, Option<(String, i64)>);

/// Dormant consumer reader. Canonical archive comparisons keep their existing route.
fn read_visible_value(
    connection: &mut Connection,
    path: Vec<String>,
    expected: &VisiblePreferenceSource,
) -> Result<VisiblePreferenceValue, NormalizedSqliteError> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let source = visible_source_in_transaction(&tx)?;
    if source != *expected {
        return Err(invalid("CURSOR_STALE"));
    }
    let value = read_visible_value_in_transaction(&tx, path, source)?;
    tx.commit()?;
    Ok(value)
}

#[derive(serde::Serialize)]
struct VisiblePreferenceScope {
    results: Vec<VisiblePreferenceValue>,
    source: VisiblePreferenceSource,
}

/// Pin all selected values to one canonical and local snapshot.
fn read_visible_scope(
    connection: &mut Connection,
    paths: Vec<Vec<String>>,
    expected: &VisiblePreferenceSource,
) -> Result<VisiblePreferenceScope, NormalizedSqliteError> {
    if paths.is_empty()
        || paths.len() > 64
        || paths.iter().collect::<std::collections::HashSet<_>>().len() != paths.len()
    {
        return Err(invalid("visible preference scope paths are invalid"));
    }
    if serde_json::to_vec(&serde_json::json!({"paths":paths,"source":expected}))
        .map_err(|_| invalid("invalid visible preference scope"))?
        .len()
        > 128 * 1024
    {
        return Err(invalid(
            "visible preference scope request exceeds its byte bound",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let source = visible_source_in_transaction(&tx)?;
    if source != *expected {
        return Err(invalid("CURSOR_STALE"));
    }
    let mut results = Vec::with_capacity(paths.len());
    let mut bytes = 0;
    for path in paths {
        crate::normalized_query_control::check_current_query().map_err(invalid)?;
        let value = read_visible_value_in_transaction(&tx, path, source.clone())?;
        bytes += serde_json::to_vec(&value)
            .map_err(|_| invalid("invalid visible preference value"))?
            .len();
        if bytes > 2 * 1048576 {
            return Err(invalid("visible preference scope exceeds its byte bound"));
        }
        results.push(value);
    }
    let response = VisiblePreferenceScope { results, source };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("invalid visible preference scope"))?
        .len()
        > 2 * 1048576
    {
        return Err(invalid("visible preference scope exceeds its byte bound"));
    }
    tx.commit()?;
    Ok(response)
}

fn read_visible_value_in_transaction(
    tx: &rusqlite::Transaction<'_>,
    path: Vec<String>,
    source: VisiblePreferenceSource,
) -> Result<VisiblePreferenceValue, NormalizedSqliteError> {
    if path.is_empty()
        || path.len() > 32
        || serde_json::to_vec(&path)
            .map_err(|_| invalid("invalid preference path"))?
            .len()
            > 8192
    {
        return Err(invalid("invalid preference path"));
    }
    let program = SQLITE_QUERY_PROGRAMS
        .iter()
        .find(|p| p.query_id == "preference_value_v1")
        .ok_or(invalid("preference value program is missing"))?;
    let variant = |id| {
        program
            .variants
            .iter()
            .find(|v| v.variant_id == id)
            .map(|v| v.sql)
            .ok_or(invalid("preference value variant is missing"))
    };
    let mut selection = serde_json::Value::Null;
    for key in path.iter().rev() {
        selection = serde_json::json!({key:selection});
    }
    let selection =
        serde_json::to_string(&selection).map_err(|_| invalid("invalid preference selection"))?;
    let selected: String = tx.query_row(variant("selection_path")?, [&selection], |r| r.get(0))?;
    if selected.len() + 2 > 4096 {
        return Err(invalid("preference selection exceeds its bound"));
    }
    let ancestors = tx
        .prepare(pending_program("selection_ancestors_v1")?)?
        .query_map([&selection], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if ancestors.len() >= 32 {
        return Err(invalid("preference ancestor path exceeds its bound"));
    }
    let barrier = |parents: &[String]| -> Result<i64, NormalizedSqliteError> {
        let mut maximum = 0;
        for parent in parents {
            crate::normalized_query_control::check_current_query().map_err(invalid)?;
            let counter: Option<i64> = tx
                .query_row(
                    pending_program("replacement_barrier_v1")?,
                    params![source.actor_id, parent],
                    |r| r.get(0),
                )
                .optional()?;
            maximum = maximum.max(counter.unwrap_or(0));
        }
        Ok(maximum)
    };
    let canonical_rows = |sql: &str,
                          bind: &[&dyn rusqlite::ToSql]|
     -> Result<Vec<NormalizedPreferenceLeafV1>, NormalizedSqliteError> {
        Ok(tx
            .prepare(sql)?
            .query_map(bind, |r| {
                crate::normalized_query::decode_generated_query_row(r, "preference_value_v1")
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    };
    let resolve = |fullkey: &str,
                   parents: &[String]|
     -> Result<ResolvedPreferenceNode, NormalizedSqliteError> {
        let minimum = barrier(parents)?;
        let pending = tx
            .query_row(
                pending_program("latest_node_v1")?,
                params![source.actor_id, fullkey],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                        pending_node(r, 3, fullkey)?,
                    ))
                },
            )
            .optional()?;
        if let Some((transaction, member, counter, node)) = pending {
            if counter >= minimum {
                return Ok((Some(node), Some((transaction, member))));
            }
        }
        if minimum > 0 {
            return Ok((None, None));
        }
        let mut roots = canonical_rows(program.sql, &[&fullkey])?;
        if roots.len() > 1 {
            return Err(invalid("preference selection has conflicting roots"));
        }
        Ok((roots.pop(), None))
    };
    let (root, pending) = resolve(&selected, &ancestors)?;
    let mut nodes: Vec<_> = root.clone().into_iter().collect();
    if root.as_ref().is_some_and(|r| r.path.starts_with("a:")) {
        if let Some((transaction, member)) = pending {
            let array_nodes =
                |lower: &str,
                 upper: &str|
                 -> Result<Vec<NormalizedPreferenceLeafV1>, NormalizedSqliteError> {
                    Ok(tx
                        .prepare(pending_program("array_nodes_v1")?)?
                        .query_map(
                            params![
                                transaction,
                                member,
                                format!("{selected}{lower}"),
                                format!("{selected}{upper}")
                            ],
                            |r| pending_node(r, 0, &selected),
                        )?
                        .collect::<rusqlite::Result<Vec<_>>>()?)
                };
            if !array_nodes(".", "/")?.is_empty() {
                return Err(invalid(
                    "visible preference array has invalid object children",
                ));
            }
            nodes.extend(array_nodes("[", "\\")?);
        } else {
            for prefix in ["a:", "o:", "v:"] {
                for (lower, upper) in [(".", "/"), ("[", "\\")] {
                    let remaining = 513 - nodes.len();
                    if remaining > 0 {
                        nodes.extend(canonical_rows(
                            variant("descendants")?,
                            &[
                                &selected,
                                &format!("{prefix}{selected}{lower}"),
                                &format!("{prefix}{selected}{upper}"),
                                &(remaining as i64),
                            ],
                        )?);
                    }
                }
            }
        }
    } else if root.as_ref().is_some_and(|r| r.path.starts_with("o:")) {
        let mut parents = ancestors.clone();
        parents.push(selected.clone());
        let (bits, _) = resolve(&format!("{selected}.bits"), &parents)?;
        let (codec, _) = resolve(&format!("{selected}.codec"), &parents)?;
        if let (Some(mut bits), Some(mut codec)) = (bits, codec) {
            let candidate = serde_json::json!({"bits":bits.text_value,"codec":codec.text_value});
            if bits.path.starts_with("v:")
                && codec.path.starts_with("v:")
                && bits.value_type == "text"
                && codec.value_type == "text"
                && crate::normalized_preference_policy::is_binary64_wrapper(&candidate)
            {
                let minimum = barrier(&parents)?;
                let mut extra = tx
                    .query_row(
                        pending_program("pending_object_extras_v1")?,
                        params![source.actor_id, selected, minimum],
                        |_| Ok(()),
                    )
                    .optional()?
                    .is_some();
                if !extra && minimum == 0 {
                    for prefix in ["a:", "o:", "v:"] {
                        if tx
                            .query_row(
                                pending_program("canonical_object_extras_v1")?,
                                params![prefix, selected],
                                |_| Ok(()),
                            )
                            .optional()?
                            .is_some()
                        {
                            extra = true;
                            break;
                        }
                    }
                }
                if !extra {
                    bits.path = "v:$._.bits".into();
                    codec.path = "v:$._.codec".into();
                    nodes.extend([bits, codec]);
                }
            }
        }
    }
    let request = NormalizedPreferenceValueRequestV1 {
        schema_version: 1,
        path,
        generation_id: source.generation_id.clone(),
        source_revision: source.source_revision,
    };
    let canonical = crate::normalized_query::finish_preference_value(
        request,
        nodes,
        source.generation_id.clone(),
        source.source_revision,
    )?;
    let response = VisiblePreferenceValue {
        path: canonical.path,
        kind: canonical.kind,
        rows: canonical.rows,
        source,
    };
    if serde_json::to_vec(&response)
        .map_err(|_| invalid("invalid visible preference response"))?
        .len()
        > 2 * 1048576
    {
        return Err(invalid(
            "visible preference response exceeds its byte bound",
        ));
    }
    Ok(response)
}

fn replace_projected_successor_checkpoint(
    connection: &mut Connection,
    stage_id: &str,
    receipt: &crate::NormalizedFollowerCheckpointReceiptV2,
) -> Result<crate::NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "projected successor requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    verify_storage(&tx)?;
    let retained_tip = |db: &Connection| -> Result<(), NormalizedSqliteError> {
        let ready: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM library_local_preference_projection p
          JOIN library_intent_actors a ON a.actor_id=p.actor_id
          JOIN library_follower_actor_request r ON r.actor_id=p.actor_id
          WHERE p.singleton_id=1 AND p.last_counter=p.target_counter AND p.target_counter=a.next_counter-1
            AND p.previous_operation_id IS a.previous_operation_id AND p.previous_chain_digest=a.previous_chain_digest)
          AND NOT EXISTS(SELECT 1 FROM library_local_preference_nodes n
            WHERE n.actor_id<>(SELECT actor_id FROM library_follower_actor_request WHERE singleton_id=1));", [], |r| r.get(0))?;
        if !ready {
            return Err(invalid(
                "projected successor requires the retained completed actor tip",
            ));
        }
        Ok(())
    };
    retained_tip(&tx)?;
    let successor: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_checkpoint_stages s
      JOIN library_meta m ON m.singleton_id=1 AND m.library_id=s.library_id
      JOIN library_follower_actor_request r ON r.singleton_id=1 AND r.library_id=s.library_id
      WHERE s.stage_id=?1 AND s.authority_epoch<>r.authority_epoch_id);",
        [stage_id],
        |r| r.get(0),
    )?;
    if !successor {
        return Err(invalid(
            "projected successor requires a different enrollment epoch",
        ));
    }
    // The production importer checks this before replacing authority rows for
    // schema2. Schema3 admission must preserve the same cancellation boundary.
    let cancelled: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM library_local_handoff WHERE singleton_id=1 AND installation_role='target' AND phase='cancelled');", [], |r| r.get(0))?;
    if cancelled {
        crate::normalized_handoff_cancellation::verify_cancelled_target_history_v1(&tx)
            .map_err(NormalizedSqliteError::Transport)?;
    }
    let tables = [
        "library_local_preference_projection",
        "library_local_preference_nodes",
    ];
    for table in tables {
        tx.execute_batch(&format!(
            "CREATE TABLE main.checkpoint_retained_{table} AS SELECT * FROM {table};"
        ))?;
    }
    let installed = crate::normalized_import::install_checkpoint_with_version_admission(
        &tx,
        stage_id,
        true,
        Some(receipt),
        None,
        |db, digest, receipt| {
            verify_storage(db).map_err(|e| e.to_string())?;
            let has_handoff: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM library_local_handoff);",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if has_handoff {
                crate::normalized_handoff_certificate::verify_existing_handoff_checkpoint_install_v1(
                    db, digest, receipt,
                )
            } else {
                Ok(())
            }
        },
    )?;
    for table in tables {
        let count: i64 =
            tx.query_row(&format!("SELECT count(*) FROM {table};"), [], |r| r.get(0))?;
        if count != 0 {
            return Err(invalid("projected successor did not clear derived rows"));
        }
        tx.execute_batch(&format!(
            "INSERT INTO {table} SELECT * FROM main.checkpoint_retained_{table};"
        ))?;
        let changed: bool = tx.query_row(&format!("SELECT EXISTS(SELECT * FROM {table} EXCEPT SELECT * FROM main.checkpoint_retained_{table}) OR EXISTS(SELECT * FROM main.checkpoint_retained_{table} EXCEPT SELECT * FROM {table});"), [], |r| r.get(0))?;
        if changed {
            return Err(invalid(
                "projected successor changed retained preference rows",
            ));
        }
        tx.execute_batch(&format!("DROP TABLE main.checkpoint_retained_{table};"))?;
    }
    retained_tip(&tx)?;
    tx.commit()?;
    Ok(installed)
}

/// Exercise a second real transfer after migrating an enrolled consumer with a
/// signed pending assignment. This module has no production callers.
pub(crate) fn check_migrated_repeated_successor(
    source: &Connection,
    stage_id: &str,
    receipt: &crate::NormalizedFollowerCheckpointReceiptV2,
    actor_store: &dyn crate::ActorKeyStore,
    witness: &str,
    certificate: &[u8],
) {
    let mut db = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(source, &mut db)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    let old_archive: String = db
        .query_row(
            "SELECT recovery_id FROM library_local_recovery_archives;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let archive_rows = |db: &Connection| {
        db.prepare("SELECT canonical_row FROM library_local_recovery_rows WHERE recovery_id=?1 ORDER BY table_key,row_ordinal;").unwrap()
            .query_map([&old_archive], |r|r.get::<_,Vec<u8>>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
    };
    let retained_archive = archive_rows(&db);
    let (authority, _, _, _) =
        crate::normalized_writer_reassignment::current_authority(&db).unwrap();
    let verified =
        crate::normalized_enrollment_verifier::verify_actor_enrollment(certificate, &authority)
            .unwrap();
    let key = crate::library_core_actor_enrollment::load_actor_key_pair(
        actor_store,
        &authority.library_id,
    )
    .unwrap();
    let context = crate::normalized_follower_mutation_context_v1(&db).unwrap();
    let patch = serde_json::json!({"updates":{"display":{"showEngagementCounts":false}}});
    let edit =
        crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(
            &key,
            &verified,
            "repeated:migrated",
            context.next_counter,
            context.previous_operation_id.as_deref(),
            &context.previous_chain_digest,
            &[("preferences", 2390)],
            "preferences_leaf_assignment",
            Some(&patch),
        );
    crate::enqueue_normalized_follower_intent_v1(&mut db, &edit, 2390).unwrap();
    migrate(&mut db).unwrap();
    while !backfill_step(&mut db).unwrap() {}
    // Read retained history directly after succession: mutation context must
    // reject the old actor even though its exact tip remains preserved.
    let stored_tip = |db: &Connection| {
        db.query_row(
        "SELECT next_counter,previous_operation_id,previous_chain_digest FROM library_intent_actors WHERE actor_id=?1;",
        [&context.actor_id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?)),
    ).unwrap()
    };
    let retained_tip = stored_tip(&db);
    let members = |db: &Connection| {
        db.prepare("SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;")
            .unwrap()
            .query_map([], |r| r.get::<_, Vec<u8>>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let retained_members = members(&db);
    let nodes: i64 = db
        .query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(nodes >= 2);
    db.execute_batch("CREATE TEMP TRIGGER repeated_projection_fault AFTER INSERT ON library_local_preference_nodes BEGIN SELECT RAISE(ABORT,'repeated projection fault'); END;").unwrap();
    assert!(
        replace_projected_successor_checkpoint(&mut db, stage_id, receipt)
            .unwrap_err()
            .to_string()
            .contains("repeated projection fault")
    );
    assert_eq!(stored_tip(&db), retained_tip);
    assert_eq!(members(&db), retained_members);
    assert_eq!(archive_rows(&db), retained_archive);
    db.execute_batch("DROP TRIGGER repeated_projection_fault;")
        .unwrap();
    replace_projected_successor_checkpoint(&mut db, stage_id, receipt).unwrap();
    assert_eq!(stored_tip(&db), retained_tip);
    assert_eq!(members(&db), retained_members);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        nodes
    );
    assert!(crate::normalized_follower_mutation_context_v1(&db).is_err());
    let archive = crate::normalized_consumer_recovery::archive_consumer_recovery_with_admission(
        &mut db,
        actor_store,
        2400,
        |db| {
            verify_storage(db).map_err(|e| e.to_string())?;
            Ok(true)
        },
        |db| verify_storage(db).map_err(|e| e.to_string()),
    )
    .unwrap();
    assert_ne!(archive, old_archive);
    let prepared =
        crate::normalized_consumer_recovery::prepare_consumer_reenrollment_with_admission(
            &mut db,
            &archive,
            witness,
            actor_store,
            2401,
            |db| verify_storage(db).map_err(|e| e.to_string()),
        )
        .unwrap();
    assert_eq!(
        commit_projected_reenrollment(&mut db, &archive, witness, actor_store, 2402).unwrap(),
        prepared
    );
    assert_eq!(
        commit_projected_reenrollment(&mut db, &archive, witness, actor_store, 2403).unwrap(),
        prepared
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(archive_rows(&db), retained_archive);
    assert!(crate::normalized_follower_mutation_context_v1(&db).is_err());
    assert!(crate::normalized_primary_mutation_context_v1(&db).is_err());
    assert!(crate::require_normalized_provider_handoff_admission_v2(&db).is_err());
}

pub(crate) fn check_projected_successor_checkpoint(
    source: &Connection,
    stage_id: &str,
    receipt: &crate::NormalizedFollowerCheckpointReceiptV2,
    actor_store: &dyn crate::ActorKeyStore,
    witness: &str,
) {
    let mut db = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(source, &mut db)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
    tx.execute_batch(PENDING_PREFERENCE_SCHEMA_EXTENSION_SQL)
        .unwrap();
    tx.execute(
        "UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2;",
        params![
            PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,
            PENDING_PREFERENCE_SCHEMA_SHA256
        ],
    )
    .unwrap();
    tx.pragma_update(
        None,
        "user_version",
        PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,
    )
    .unwrap();
    // Opaque predecessor intents and synthetic effects test preservation only.
    // The surrounding fixture supplies the real predecessor-signed handoff.
    tx.execute_batch("INSERT INTO library_intent_members
      SELECT transaction_id,actor_id,0,ending_operation_id,last_counter,'feed_item_read_assignment','FeedItem','rss:archived',canonical_transaction,transaction_digest
      FROM library_intent_transactions;
      UPDATE library_intent_actors SET next_counter=(SELECT last_counter+1 FROM library_intent_transactions),
        previous_operation_id=(SELECT ending_operation_id FROM library_intent_transactions),
        previous_chain_digest=(SELECT ending_chain_digest FROM library_intent_transactions);").unwrap();
    tx.execute_batch("INSERT INTO library_local_preference_projection SELECT 1,actor_id,next_counter-1,next_counter-1,previous_operation_id,previous_chain_digest FROM library_intent_actors;
      INSERT INTO library_local_preference_nodes(transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,boolean_value,updated_at)
      SELECT transaction_id,member_index,actor_id,actor_counter,'$.display.showEngagementCounts','value','boolean',0,1 FROM library_intent_members;").unwrap();
    tx.commit().unwrap();
    let before: (String, Vec<u8>) = db.query_row("SELECT m.authority_epoch,i.canonical_member FROM library_meta m,library_intent_members i;", [], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
    db.execute_batch("CREATE TEMP TRIGGER projected_successor_fault BEFORE INSERT ON library_local_preference_nodes BEGIN SELECT RAISE(ABORT,'projected successor restore fault'); END;").unwrap();
    assert!(
        replace_projected_successor_checkpoint(&mut db, stage_id, receipt)
            .unwrap_err()
            .to_string()
            .contains("projected successor restore fault")
    );
    let after: (String, Vec<u8>) = db.query_row("SELECT m.authority_epoch,i.canonical_member FROM library_meta m,library_intent_members i;", [], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(before, after);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%';",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    db.execute_batch("DROP TRIGGER projected_successor_fault;")
        .unwrap();
    let installed = replace_projected_successor_checkpoint(&mut db, stage_id, receipt).unwrap();
    assert_ne!(installed.authority_epoch, before.0);
    assert_eq!(
        db.query_row(
            "SELECT canonical_member FROM library_intent_members;",
            [],
            |r| r.get::<_, Vec<u8>>(0)
        )
        .unwrap(),
        before.1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert!(crate::normalized_follower::normalized_follower_mutation_context_v1(&db).is_err());
    let archive = |db: &mut Connection| {
        crate::normalized_consumer_recovery::archive_consumer_recovery_with_admission(
            db,
            actor_store,
            120,
            |db| {
                verify_storage(db).map_err(|e| e.to_string())?;
                Ok(true)
            },
            |db| verify_storage(db).map_err(|e| e.to_string()),
        )
    };
    let old_fence: i64 = db
        .query_row("SELECT count(*) FROM library_local_handoff;", [], |r| {
            r.get(0)
        })
        .unwrap();
    db.execute_batch("CREATE TEMP TRIGGER projected_archive_fault BEFORE INSERT ON library_local_recovery_rows BEGIN SELECT RAISE(ABORT,'projected archive fault'); END;").unwrap();
    assert!(archive(&mut db)
        .unwrap_err()
        .contains("projected archive fault"));
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_recovery_archives;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM library_local_handoff;", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        old_fence
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    db.execute_batch("DROP TRIGGER projected_archive_fault;")
        .unwrap();
    let recovery_id = archive(&mut db).unwrap();
    let saved: Vec<(String,i64,Vec<u8>)> = db.prepare("SELECT table_key,row_ordinal,canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;").unwrap()
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert!(!saved.is_empty());
    assert_eq!(archive(&mut db).unwrap(), recovery_id);
    let retry: Vec<(String,i64,Vec<u8>)> = db.prepare("SELECT table_key,row_ordinal,canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;").unwrap()
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(saved, retry);
    assert_eq!(db.query_row("SELECT count(*) FROM library_local_recovery_rows WHERE table_key LIKE 'library_local_preference%';",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    let prepare = |db: &mut Connection, at| {
        crate::normalized_consumer_recovery::prepare_consumer_reenrollment_with_admission(
            db,
            &recovery_id,
            witness,
            actor_store,
            at,
            |db| verify_storage(db).map_err(|e| e.to_string()),
        )
    };
    db.execute_batch("CREATE TEMP TRIGGER projected_request_fault BEFORE UPDATE OF reenrollment_receipt ON library_local_recovery_archives BEGIN SELECT RAISE(ABORT,'projected request fault'); END;").unwrap();
    assert!(prepare(&mut db, 121)
        .unwrap_err()
        .contains("projected request fault"));
    assert!(db
        .query_row(
            "SELECT reenrollment_receipt FROM library_local_recovery_archives;",
            [],
            |r| r.get::<_, Option<Vec<u8>>>(0)
        )
        .unwrap()
        .is_none());
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    db.execute_batch("DROP TRIGGER projected_request_fault;")
        .unwrap();
    let prepared = prepare(&mut db, 121).unwrap();
    assert_eq!(prepare(&mut db, 122).unwrap(), prepared);
    assert!(crate::normalized_follower::normalized_follower_mutation_context_v1(&db).is_err());
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        commit_projected_reenrollment(&mut db, &recovery_id, witness, actor_store, 125).unwrap(),
        prepared
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_projection;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert!(crate::normalized_follower::normalized_follower_mutation_context_v1(&db).is_err());
    assert_eq!(
        commit_projected_reenrollment(&mut db, &recovery_id, witness, actor_store, 126).unwrap(),
        prepared
    );
    let committed_archive: Vec<(String,i64,Vec<u8>)> = db.prepare("SELECT table_key,row_ordinal,canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;").unwrap()
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(committed_archive, saved);
}

/// Same-epoch consumer checkpoint replacement retains derived rows on SQLite
/// scratch pages. Recovery archives deliberately keep their existing table set.
fn replace_projected_checkpoint(
    connection: &mut Connection,
    stage_id: &str,
    receipt: &crate::NormalizedFollowerCheckpointReceiptV2,
) -> Result<crate::NormalizedCheckpointActivationReceiptV2, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "projected checkpoint requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let before = visible_source_in_transaction(&tx)?;
    let same_epoch:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM library_checkpoint_stages s JOIN library_meta m ON m.singleton_id=1
        WHERE s.stage_id=?1 AND s.library_id=m.library_id AND s.authority_epoch=m.authority_epoch AND s.source_revision>=m.source_revision);",[stage_id],|r|r.get(0))?;
    if !same_epoch {
        return Err(invalid("projected checkpoint requires the selected epoch"));
    }
    let tables = [
        "library_local_preference_projection",
        "library_local_preference_nodes",
    ];
    for table in tables {
        tx.execute_batch(&format!(
            "CREATE TABLE main.checkpoint_retained_{table} AS SELECT * FROM {table};"
        ))?;
    }
    let installed = crate::normalized_import::install_checkpoint_with_version_admission(
        &tx,
        stage_id,
        true,
        Some(receipt),
        None,
        |db, digest, receipt| {
            verify_storage(db).map_err(|error| error.to_string())?;
            let has_handoff: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM library_local_handoff);",
                    [],
                    |r| r.get(0),
                )
                .map_err(|error| error.to_string())?;
            if has_handoff {
                crate::normalized_handoff_certificate::verify_existing_handoff_checkpoint_install_v1(
                    db, digest, receipt,
                )
            } else {
                Ok(())
            }
        },
    )?;
    for table in tables {
        let count: i64 =
            tx.query_row(&format!("SELECT count(*) FROM {table};"), [], |r| r.get(0))?;
        if count != 0 {
            return Err(invalid("projected checkpoint did not clear old local rows"));
        }
        tx.execute_batch(&format!("INSERT INTO {table} SELECT * FROM main.checkpoint_retained_{table}; DROP TABLE main.checkpoint_retained_{table};"))?;
    }
    let after = visible_source_in_transaction(&tx)?;
    if after.actor_id != before.actor_id
        || after.actor_counter != before.actor_counter
        || after.local_sequence < before.local_sequence
    {
        return Err(invalid(
            "projected checkpoint changed local actor continuity",
        ));
    }
    settle_covered_projection_in_transaction(&tx)?;
    tx.commit()?;
    Ok(installed)
}

// One complete signed transaction per step bounds memory and restart work.
fn backfill_step(connection: &mut Connection) -> Result<bool, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "pending preference backfill requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let complete = backfill_in_transaction(&tx)?;
    tx.commit()?;
    Ok(complete)
}

fn backfill_in_transaction(tx: &rusqlite::Transaction<'_>) -> Result<bool, NormalizedSqliteError> {
    verify_storage(tx)?;
    let context = crate::normalized_follower_mutation_context_v1(tx)?;
    let (actor,last,target,previous,chain):(String,i64,i64,Option<String>,String)=tx.query_row(
        "SELECT actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest FROM library_local_preference_projection WHERE singleton_id=1;",
        [],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    if actor != context.actor_id || target != context.next_counter - 1 {
        return Err(invalid("pending preference projection source changed"));
    }
    if last == target {
        if previous != context.previous_operation_id || chain != context.previous_chain_digest {
            return Err(invalid("pending preference projection tip changed"));
        }
        return Ok(true);
    }
    let transaction_id: String = tx.query_row(
        "SELECT transaction_id FROM library_intent_members WHERE actor_id=?1 AND actor_counter=?2;",
        params![actor, last + 1],
        |r| r.get(0),
    )?;
    let (digest,first_counter,last_counter,member_count,declared_bytes,state):(String,i64,i64,i64,i64,String)=tx.query_row(
        "SELECT transaction_digest,first_counter,last_counter,member_count,canonical_member_bytes,state FROM library_intent_transactions WHERE transaction_id=?1 AND actor_id=?2;",
        params![transaction_id,actor],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
    if first_counter != last + 1
        || last_counter > target
        || !(1..=1000).contains(&member_count)
        || !(1..=4194304).contains(&declared_bytes)
    {
        return Err(invalid("pending preference transaction bounds changed"));
    }
    // Count and length metadata are bounded before any envelope blob is allocated.
    let lengths=tx.prepare("SELECT length(canonical_member) FROM library_intent_members WHERE transaction_id=?1 ORDER BY member_index LIMIT 1001;")?
        .query_map([&transaction_id],|r|r.get::<_,i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if lengths.len() != member_count as usize
        || lengths.iter().any(|n| !(1..=4194304).contains(n))
        || lengths.iter().sum::<i64>() != declared_bytes
    {
        return Err(invalid("pending preference transaction bytes changed"));
    }
    let envelopes=tx.prepare("SELECT canonical_member FROM library_intent_members WHERE transaction_id=?1 ORDER BY member_index LIMIT 1000;")?
        .query_map([&transaction_id],|r|r.get::<_,Vec<u8>>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    // Historical reconstruction authenticates already retained bytes. Current
    // admission changes do not retroactively alter their signed contents.
    let (verified, _current_admission) =
        crate::normalized_operation_verifier::verify_operation_transaction_for_resolution(
            &envelopes,
            |identity| {
                let mut state = crate::normalized_mutation::actor_state_at(tx, identity)?;
                state.next_sequence = last + 1;
                state.previous_operation_id = previous.clone();
                state.previous_chain_digest = chain.clone();
                Ok(state)
            },
        )
        .map_err(|_| invalid("pending preference transaction verification failed"))?;
    let first = verified
        .members
        .first()
        .ok_or(invalid("pending preference transaction is empty"))?;
    let ending = verified
        .members
        .last()
        .ok_or(invalid("pending preference transaction is empty"))?;
    if verified.transaction_id != transaction_id
        || verified.transaction_digest != digest
        || verified.actor_id != actor
        || verified.library_id != context.library_id
        || verified.epoch_id != context.epoch_id
        || verified.epoch != context.epoch
        || first.actor_sequence != first_counter
        || ending.actor_sequence != last_counter
        || first.previous_actor_operation_id != previous
        || first.previous_actor_chain_digest != chain
        || verified.canonical_envelope_bytes != declared_bytes as usize
    {
        return Err(invalid("pending preference transaction identity changed"));
    }
    let visible = retains_effects(tx, &verified, &state)?;
    if visible {
        for (index, member) in verified.members.iter().enumerate() {
            crate::normalized_query_control::check_current_query()
                .map_err(|_| invalid("pending preference backfill cancelled"))?;
            if member.operation_type != "preferences_leaf_assignment" {
                continue;
            }
            let patch = member
                .structured_payload_json
                .as_deref()
                .ok_or(invalid("pending preference patch is absent"))?;
            tx.execute("INSERT INTO library_local_preference_nodes(transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,boolean_value,integer_value,real_value,text_value,updated_at)
                SELECT ?1,?2,?3,?4,fullkey,CASE type WHEN 'object' THEN 'object' WHEN 'array' THEN 'array' ELSE 'value' END,
                CASE WHEN type IN ('true','false') THEN 'boolean' WHEN type IN ('integer','array') THEN 'integer' WHEN type='real' THEN 'real' WHEN type='text' THEN 'text' ELSE 'null' END,
                CASE WHEN type IN ('true','false') THEN atom END,CASE WHEN type='integer' THEN atom WHEN type='array' THEN json_array_length(value) END,
                CASE WHEN type='real' THEN atom END,CASE WHEN type='text' THEN atom END,?5 FROM json_tree(?6) WHERE fullkey<>'$';",
                params![transaction_id,index as i64,actor,member.actor_sequence,member.created_at_ms,patch])?;
        }
    }
    if visible
        && verified
            .members
            .iter()
            .any(|member| member.operation_type == "preferences_leaf_assignment")
    {
        let program = SQLITE_LOCAL_RECONCILIATION_PROGRAMS
            .iter()
            .find(|(name, _)| *name == "pending_preferences_added_v1")
            .ok_or(invalid("pending preference notification program is absent"))?;
        tx.execute_batch(program.1)?;
    }
    if last_counter == target
        && (Some(&ending.operation_id) != context.previous_operation_id.as_ref()
            || ending.actor_chain_digest != context.previous_chain_digest)
    {
        return Err(invalid("pending preference projection final tip changed"));
    }
    if tx.execute("UPDATE library_local_preference_projection SET last_counter=?1,previous_operation_id=?2,previous_chain_digest=?3 WHERE singleton_id=1 AND last_counter=?4 AND actor_id=?5;",
        params![last_counter,ending.operation_id,ending.actor_chain_digest,last,actor])?!=1 { return Err(invalid("pending preference projection cursor changed")); }
    Ok(last_counter == target)
}

/// Clear old derived state only with the exact archived recovery commit. An
/// already committed retry must preserve the new actor's later projection.
fn commit_projected_reenrollment(
    connection: &mut Connection,
    recovery_id: &str,
    witness: &str,
    actor_store: &dyn crate::ActorKeyStore,
    committed_at: u64,
) -> Result<crate::NormalizedFollowerActorRequestV2, String> {
    let had_nodes = std::cell::Cell::new(false);
    crate::normalized_consumer_recovery::commit_consumer_reenrollment_with_admission(
        connection,
        recovery_id,
        witness,
        actor_store,
        committed_at,
        |db| {
            verify_storage(db).map_err(|e| e.to_string())?;
            if db
                .pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))
                .map_err(|e| e.to_string())?
                != 1
            {
                return Err("projected recovery requires foreign keys".into());
            }
            had_nodes.set(
                db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM library_local_preference_nodes);",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?,
            );
            Ok(())
        },
        |db, fresh| {
            crate::normalized_handoff::require_existing_handoff_follower_edit_admission(db)
                .map_err(|e| e.to_string())?;
            if fresh {
                let empty: bool = db.query_row("SELECT NOT EXISTS(SELECT 1 FROM library_local_preference_nodes) AND NOT EXISTS(SELECT 1 FROM library_local_preference_projection);", [], |r|r.get(0)).map_err(|e|e.to_string())?;
                if !empty {
                    return Err("projected recovery retained old actor state".into());
                }
                if had_nodes.get() {
                    let program = SQLITE_LOCAL_RECONCILIATION_PROGRAMS
                        .iter()
                        .find(|(name, _)| *name == "pending_preferences_removed_v1")
                        .ok_or("pending preference notification is missing")?;
                    db.execute_batch(program.1).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        },
    )
}

/// Dormant enrollment adapter. Initialization and the verified enrollment share
/// one durable commit; a response-loss retry never resets an existing projection.
fn install_projected_enrollment(
    connection: &mut Connection,
    certificate: &[u8],
) -> Result<crate::NormalizedFollowerActorEnrollmentV2, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "projected enrollment requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    verify_storage(&tx)?;
    let enrollment = crate::normalized_follower::install_follower_actor_enrollment_in_transaction(
        &tx,
        certificate,
    )?;
    let has_handoff: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_local_handoff);",
        [],
        |r| r.get(0),
    )?;
    if has_handoff {
        crate::normalized_handoff::require_existing_handoff_follower_edit_admission(&tx)?;
    }
    let context = crate::normalized_follower_mutation_context_v1(&tx)?;
    let existing: Option<bool> = tx
        .query_row(
            "SELECT actor_id=?1 AND last_counter=target_counter AND target_counter=?2
          AND previous_operation_id IS ?3 AND previous_chain_digest=?4
         FROM library_local_preference_projection WHERE singleton_id=1;",
            params![
                context.actor_id,
                context.next_counter - 1,
                context.previous_operation_id,
                context.previous_chain_digest
            ],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(matches) = existing {
        if !matches {
            return Err(invalid(
                "projected enrollment cursor is not ready for this actor",
            ));
        }
    } else {
        let empty: bool = tx.query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM library_intent_transactions)
                AND NOT EXISTS(SELECT 1 FROM library_local_preference_nodes);",
            [],
            |r| r.get(0),
        )?;
        let genesis: String = tx.query_row(
            "SELECT chain_genesis_digest FROM library_actors WHERE actor_id=?1;",
            [&context.actor_id],
            |r| r.get(0),
        )?;
        if !empty
            || context.next_counter != 1
            || context.previous_operation_id.is_some()
            || context.previous_chain_digest != genesis
        {
            return Err(invalid(
                "projected enrollment cannot discard local edit history",
            ));
        }
        tx.execute(
            "INSERT INTO library_local_preference_projection
             (singleton_id,actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest)
             VALUES(1,?1,0,0,NULL,?2);", params![context.actor_id, genesis],
        )?;
    }
    tx.commit()?;
    Ok(enrollment)
}

// Dormant wrapper. Production storage adapters still refuse physical schema3.
fn enqueue_projected_intent(
    connection: &mut Connection,
    envelopes: &[Vec<u8>],
    enqueued_at: i64,
) -> Result<crate::NormalizedFollowerIntentCommitReceiptV1, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "projected intent requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    verify_storage(&tx)?;
    let context = crate::normalized_follower_mutation_context_v1(&tx)?;
    let ready:bool=tx.query_row("SELECT actor_id=?1 AND last_counter=target_counter AND target_counter=?2 AND previous_operation_id IS ?3 AND previous_chain_digest=?4 FROM library_local_preference_projection WHERE singleton_id=1;",
        params![context.actor_id,context.next_counter-1,context.previous_operation_id,context.previous_chain_digest],|r|r.get(0))?;
    if !ready {
        return Err(invalid("pending preference backfill is incomplete"));
    }
    let receipt = crate::normalized_follower::enqueue_follower_intent_with_admission(
        &tx,
        envelopes,
        enqueued_at,
        |db| {
            verify_storage(db)?;
            let has_handoff: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM library_local_handoff);",
                [],
                |r| r.get(0),
            )?;
            if has_handoff {
                crate::normalized_handoff::require_existing_handoff_follower_edit_admission(db)?;
            }
            Ok(())
        },
    )?;
    let after = crate::normalized_follower_mutation_context_v1(&tx)?;
    tx.execute("UPDATE library_local_preference_projection SET target_counter=?1 WHERE singleton_id=1 AND actor_id=?2;",params![after.next_counter-1,after.actor_id])?;
    if !backfill_in_transaction(&tx)? {
        return Err(invalid("projected intent did not complete its transaction"));
    }
    tx.commit()?;
    Ok(receipt)
}

fn require_ready_result_projection(
    tx: &rusqlite::Transaction<'_>,
) -> Result<(), NormalizedSqliteError> {
    verify_storage(tx)?;
    let context = crate::normalized_follower_mutation_context_v1(tx)?;
    let ready:bool=tx.query_row("SELECT actor_id=?1 AND last_counter=target_counter AND target_counter=?2 AND previous_operation_id IS ?3 AND previous_chain_digest=?4 FROM library_local_preference_projection WHERE singleton_id=1;",
        params![context.actor_id,context.next_counter-1,context.previous_operation_id,context.previous_chain_digest],|r|r.get(0))?;
    if !ready {
        return Err(invalid(
            "projected result import requires completed backfill",
        ));
    }
    Ok(())
}

fn import_projected_operation_page(
    connection: &mut Connection,
    input: &crate::NormalizedOperationImportPageV2,
) -> Result<crate::NormalizedOperationImportReceiptV2, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "projected operation import requires FULL durability and foreign keys",
        ));
    }
    {
        let tx = connection.transaction()?;
        require_ready_result_projection(&tx)?;
        tx.commit()?;
    }
    crate::normalized_replication_import::import_operations_with_reconciliation(
        connection,
        input,
        &|tx| {
            require_ready_result_projection(tx)?;
            settle_covered_projection_in_transaction(tx)?;
            Ok(())
        },
    )
}

fn import_projected_result_segment(
    connection: &mut Connection,
    publication: &crate::NormalizedFollowerResultTransportImportV2,
) -> Result<crate::NormalizedFollowerResultTransportImportReceiptV2, NormalizedSqliteError> {
    crate::normalized_follower::import_result_transport_with_reconciliation(
        connection,
        publication,
        |tx| {
            if tx.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
                || tx.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
            {
                return Err(invalid(
                    "projected result segment requires FULL durability and foreign keys",
                ));
            }
            require_ready_result_projection(tx)?;
            for record in &publication.records {
                settle_in_transaction(tx, record)?;
            }
            Ok(())
        },
    )
}

/// Import the signed result page and retire covered effects in one commit.
/// Acceptance ahead of local canonical coverage keeps its optimistic values.
fn import_projected_result_page(
    connection: &mut Connection,
    records: &[crate::NormalizedFollowerResultRecordV1],
    received_at: i64,
) -> Result<crate::NormalizedFollowerResultImportReceiptV1, NormalizedSqliteError> {
    if connection.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || connection.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "projected result import requires FULL durability and foreign keys",
        ));
    }
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    require_ready_result_projection(&tx)?;
    let receipt =
        crate::normalized_follower::import_normalized_follower_result_page_in_transaction_v1(
            &tx,
            records,
            received_at,
        )?;
    for record in records {
        settle_in_transaction(&tx, record)?;
    }
    tx.commit()?;
    Ok(receipt)
}

/// Caller commits imported result/canonical rows and this removal together.
fn settle_in_transaction(
    tx: &rusqlite::Transaction<'_>,
    record: &crate::normalized_mutation::NormalizedFollowerResultRecordV1,
) -> Result<bool, NormalizedSqliteError> {
    if tx.pragma_query_value(None, "synchronous", |r| r.get::<_, u32>(0))? < 2
        || tx.pragma_query_value(None, "foreign_keys", |r| r.get::<_, u32>(0))? != 1
    {
        return Err(invalid(
            "pending preference settlement requires FULL durability and foreign keys",
        ));
    }
    verify_storage(tx)?;
    let library: String = tx.query_row(
        "SELECT library_id FROM library_meta WHERE singleton_id=1;",
        [],
        |r| r.get(0),
    )?;
    crate::normalized_follower::verify_normalized_follower_result_record_v1(tx, record, &library)?;
    let matches: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_intent_transactions t JOIN library_intent_results r ON r.transaction_id=t.transaction_id
          JOIN library_local_preference_projection p ON p.singleton_id=1 AND p.actor_id=t.actor_id
          WHERE t.transaction_id=?1 AND t.transaction_digest=?2 AND t.actor_id=?3 AND t.intent_epoch_id=?4
          AND r.canonical_result=?5 AND r.result_digest=?6 AND r.status=?7
          AND r.actor_id=?3 AND r.authority_epoch_id=?8 AND r.intent_epoch_id=?4
          AND r.result_sequence=?9 AND r.previous_result_digest IS ?10 AND r.authoritative_source_revision=?11
          AND t.state=CASE WHEN r.status='rejected' THEN 'rejected' ELSE 'accepted' END);",
        params![record.transaction_id,record.transaction_digest,record.actor_id,record.intent_epoch_id,
            record.canonical_result_json.as_bytes(),record.result_digest,record.status,
            record.authority_epoch_id,record.result_sequence,record.previous_result_digest,record.authoritative_source_revision], |r|r.get(0))?;
    if !matches {
        return Err(invalid("pending preference settlement result changed"));
    }
    let covered: bool = tx.query_row(
        "SELECT authority_epoch=?1 AND source_revision>=?2 FROM library_meta WHERE singleton_id=1;",
        params![
            record.authority_epoch_id,
            record.authoritative_source_revision
        ],
        |r| r.get(0),
    )?;
    if record.status != "rejected" && !covered {
        return Ok(false);
    }
    let removed = tx.execute(
        "DELETE FROM library_local_preference_nodes WHERE transaction_id=?1 AND actor_id=?2;",
        params![record.transaction_id, record.actor_id],
    )?;
    if removed == 0 {
        return Ok(false);
    }
    let program = SQLITE_LOCAL_RECONCILIATION_PROGRAMS
        .iter()
        .find(|(name, _)| *name == "pending_preferences_removed_v1")
        .ok_or(invalid(
            "pending preference settlement notification is absent",
        ))?;
    tx.execute_batch(program.1)?;
    Ok(true)
}

/// Read one retained result only after checking its byte bound. Verification is
/// performed by the caller against the current authority and exact intent.
fn load_retained_result(
    connection: &Connection,
    transaction_id: &str,
    transaction_digest: &str,
    actor_id: &str,
) -> Result<crate::normalized_mutation::NormalizedFollowerResultRecordV1, NormalizedSqliteError> {
    let length: i64 = connection.query_row(
        "SELECT length(canonical_result) FROM library_intent_results WHERE transaction_id=?1;",
        [transaction_id],
        |r| r.get(0),
    )?;
    if !(1..=131072).contains(&length) {
        return Err(invalid("pending preference result exceeds its byte bound"));
    }
    let (epoch,intent_epoch,sequence,previous,digest,status,revision,bytes,received):(String,String,i64,Option<String>,String,String,i64,Vec<u8>,i64)=connection.query_row(
        "SELECT authority_epoch_id,intent_epoch_id,result_sequence,previous_result_digest,result_digest,status,authoritative_source_revision,canonical_result,received_at FROM library_intent_results WHERE transaction_id=?1 AND actor_id=?2;",
        params![transaction_id,actor_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?)))?;
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| invalid("pending preference result is invalid"))?;
    let record = crate::normalized_mutation::NormalizedFollowerResultRecordV1 {
        transaction_id: transaction_id.to_owned(),
        transaction_digest: transaction_digest.to_owned(),
        actor_id: actor_id.to_owned(),
        authority_epoch_id: epoch,
        intent_epoch_id: intent_epoch,
        result_sequence: sequence,
        previous_result_digest: previous,
        result_digest: digest,
        status,
        rejection_reason: json["rejection_reason"].as_str().map(str::to_owned),
        original_result_digest: json["original_result_digest"].as_str().map(str::to_owned),
        authoritative_source_revision: revision,
        canonical_result_json: String::from_utf8(bytes)
            .map_err(|_| invalid("pending preference result is invalid"))?,
        enqueued_at: received,
    };
    Ok(record)
}

/// Reconcile transactions with visible effects and retained results against the
/// selected canonical state. Authenticate before trusting stored coverage fields.
fn settle_covered_projection_in_transaction(
    tx: &rusqlite::Transaction<'_>,
) -> Result<usize, NormalizedSqliteError> {
    verify_storage(tx)?;
    let mut settled = 0;
    let mut after = String::new();
    loop {
        let next:Option<(String,String,String)>=tx.query_row(
            "SELECT i.transaction_id,i.transaction_digest,i.actor_id
             FROM library_intent_transactions i JOIN library_intent_results r USING(transaction_id)
             JOIN library_local_preference_projection p ON p.singleton_id=1 AND p.actor_id=i.actor_id
             WHERE i.transaction_id>?1 AND EXISTS(SELECT 1 FROM library_local_preference_nodes n WHERE n.transaction_id=i.transaction_id)
             ORDER BY i.transaction_id LIMIT 1;",[&after],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let Some((transaction, digest, actor)) = next else {
            break;
        };
        let record = load_retained_result(tx, &transaction, &digest, &actor)?;
        if settle_in_transaction(tx, &record)? {
            settled += 1;
        }
        after = transaction;
    }
    Ok(settled)
}

fn retains_effects(
    connection: &Connection,
    verified: &crate::normalized_operation::VerifiedOperationTransaction,
    state: &str,
) -> Result<bool, NormalizedSqliteError> {
    if matches!(state, "pending" | "published") {
        let has_result: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_intent_results WHERE transaction_id=?1);",
            [&verified.transaction_id],
            |r| r.get(0),
        )?;
        if has_result {
            return Err(invalid("pending preference unresolved state has a result"));
        }
        return Ok(true);
    }
    if !matches!(state, "accepted" | "rejected") {
        return Err(invalid("pending preference state is invalid"));
    }
    let record = load_retained_result(
        connection,
        &verified.transaction_id,
        &verified.transaction_digest,
        &verified.actor_id,
    )?;
    crate::normalized_follower::verify_normalized_follower_result_record_v1(
        connection,
        &record,
        &verified.library_id,
    )?;
    if (state == "rejected") != (record.status == "rejected")
        || record.intent_epoch_id != verified.epoch_id
    {
        return Err(invalid("pending preference result state changed"));
    }
    if state == "rejected" {
        return Ok(false);
    }
    if !matches!(record.status.as_str(), "accepted" | "already_applied") {
        return Err(invalid("pending preference result status changed"));
    }
    let covered: bool = connection.query_row(
        "SELECT authority_epoch=?1 AND source_revision>=?2 FROM library_meta WHERE singleton_id=1;",
        params![
            record.authority_epoch_id,
            record.authoritative_source_revision
        ],
        |r| r.get(0),
    )?;
    Ok(!covered)
}

pub(crate) fn check_projected_recovery_commit(
    source: &Connection,
    recovery_id: &str,
    witness: &str,
    actor_store: &dyn crate::ActorKeyStore,
    certificate: &[u8],
) {
    let mut db = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(source, &mut db)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    // Synthetic derived rows exercise FK cleanup with the existing real handoff
    // and new enrollment proof. This does not claim migration through handoff.
    db.execute_batch(PENDING_PREFERENCE_SCHEMA_EXTENSION_SQL)
        .unwrap();
    db.execute(
        "UPDATE library_storage_meta SET schema_version=?1,schema_sha256=?2;",
        params![
            PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,
            PENDING_PREFERENCE_SCHEMA_SHA256
        ],
    )
    .unwrap();
    db.pragma_update(
        None,
        "user_version",
        PENDING_PREFERENCE_STORAGE_SCHEMA_VERSION,
    )
    .unwrap();
    db.execute_batch("INSERT INTO library_local_preference_projection
        SELECT 1,actor_id,next_counter-1,next_counter-1,previous_operation_id,previous_chain_digest FROM library_intent_actors;
        INSERT INTO library_local_preference_nodes
        (transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,boolean_value,updated_at)
        SELECT transaction_id,member_index,actor_id,actor_counter,'$.display.showEngagementCounts','value','boolean',0,1
        FROM library_intent_members LIMIT 1;").unwrap();
    let archive: Vec<(String,i64,Vec<u8>)> = db.prepare("SELECT table_key,row_ordinal,canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;").unwrap()
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    let before_sequence: i64 = db
        .query_row(
            "SELECT sequence FROM library_local_change_state;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    db.execute_batch(
        "CREATE TEMP TRIGGER refuse_projected_recovery AFTER INSERT ON library_local_invalidations
        WHEN NEW.topic='preferences' BEGIN SELECT RAISE(ABORT,'projected recovery fault'); END;",
    )
    .unwrap();
    assert!(
        commit_projected_reenrollment(&mut db, recovery_id, witness, actor_store, 125)
            .unwrap_err()
            .contains("projected recovery fault")
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_projection;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT sequence FROM library_local_change_state;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        before_sequence
    );
    assert!(db.query_row("SELECT reenrollment_committed_at IS NULL FROM library_local_recovery_archives WHERE recovery_id=?1;",[recovery_id],|r|r.get::<_,bool>(0)).unwrap());
    db.execute_batch("DROP TRIGGER refuse_projected_recovery;")
        .unwrap();
    let request =
        commit_projected_reenrollment(&mut db, recovery_id, witness, actor_store, 125).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_projection;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert!(crate::normalized_follower_mutation_context_v1(&db).is_err());
    let after_sequence: i64 = db
        .query_row(
            "SELECT sequence FROM library_local_change_state;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(after_sequence > before_sequence);
    assert_eq!(
        commit_projected_reenrollment(&mut db, recovery_id, witness, actor_store, 126).unwrap(),
        request
    );
    assert_eq!(
        db.query_row(
            "SELECT sequence FROM library_local_change_state;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        after_sequence
    );
    let installed = install_projected_enrollment(&mut db, certificate).unwrap();
    assert_eq!(installed.actor_id, request.actor_id);
    let (authority, _, _, _) =
        crate::normalized_writer_reassignment::current_authority(&db).unwrap();
    let verified =
        crate::normalized_enrollment_verifier::verify_actor_enrollment(certificate, &authority)
            .unwrap();
    let key = crate::library_core_actor_enrollment::load_actor_key_pair(
        actor_store,
        &authority.library_id,
    )
    .unwrap();
    let context = crate::normalized_follower_mutation_context_v1(&db).unwrap();
    let patch = serde_json::json!({"updates":{"display":{"showEngagementCounts":false}}});
    let edit =
        crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(
            &key,
            &verified,
            "recovered:projected",
            context.next_counter,
            context.previous_operation_id.as_deref(),
            &context.previous_chain_digest,
            &[("preferences", 128)],
            "preferences_leaf_assignment",
            Some(&patch),
        );
    enqueue_projected_intent(&mut db, &edit, 128).unwrap();
    let new_tip = context_tip(&db);
    let new_sequence: i64 = db
        .query_row(
            "SELECT sequence FROM library_local_change_state;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        commit_projected_reenrollment(&mut db, recovery_id, witness, actor_store, 127).unwrap(),
        request
    );
    assert_eq!(context_tip(&db), new_tip);
    assert_eq!(
        db.query_row(
            "SELECT sequence FROM library_local_change_state;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        new_sequence
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    assert_eq!(
        db.query_row(
            "SELECT actor_id FROM library_local_preference_projection;",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        request.actor_id
    );
    assert_eq!(db.prepare("SELECT table_key,row_ordinal,canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;").unwrap()
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,Vec<u8>>(2)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap(),archive);

    // Unlike the synthetic predecessor catalog above, this starts at schema2,
    // commits real recovery and installs the verified successor certificate.
    // A real signed offline edit then crosses the actual migration/backfill.
    let mut recovered = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(source, &mut recovered)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    recovered
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    crate::commit_consumer_epoch_reenrollment_v1(
        &mut recovered,
        recovery_id,
        witness,
        actor_store,
        125,
    )
    .unwrap();
    crate::install_normalized_follower_actor_enrollment_v2(&mut recovered, certificate).unwrap();
    crate::enqueue_normalized_follower_intent_v1(&mut recovered, &edit, 128).unwrap();
    let tip_before = context_tip(&recovered);
    recovered.execute_batch("CREATE TEMP TRIGGER recovered_migration_fault BEFORE UPDATE OF schema_version ON library_storage_meta WHEN NEW.schema_version=3 BEGIN SELECT RAISE(ABORT,'recovered migration fault'); END;").unwrap();
    assert!(migrate(&mut recovered)
        .unwrap_err()
        .to_string()
        .contains("recovered migration fault"));
    assert_eq!(
        recovered
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        2
    );
    assert_eq!(recovered.query_row("SELECT count(*) FROM sqlite_schema WHERE name='library_local_preference_projection';",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(context_tip(&recovered), tip_before);
    recovered
        .execute_batch("DROP TRIGGER recovered_migration_fault;")
        .unwrap();
    migrate(&mut recovered).unwrap();
    assert!(backfill_step(&mut recovered).unwrap());
    assert_eq!(context_tip(&recovered), tip_before);
    assert_eq!(
        recovered
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    assert_eq!(
        recovered
            .query_row(
                "SELECT canonical_member FROM library_intent_members;",
                [],
                |r| r.get::<_, Vec<u8>>(0)
            )
            .unwrap(),
        edit[0]
    );
    assert_eq!(recovered.prepare("SELECT table_key,row_ordinal,canonical_row FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;").unwrap()
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,Vec<u8>>(2)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap(),archive);
    migrate(&mut recovered).unwrap();
    assert!(backfill_step(&mut recovered).unwrap());
    assert_eq!(context_tip(&recovered), tip_before);
    // The same wire vectors used by browser scoped reads must remain exact
    // when unrelated signed pending preferences are also present.
    let vector: serde_json::Value = serde_json::from_str(include_str!(
        "../../shared/src/library-core/preference-value-query-vector-v1.json"
    ))
    .unwrap();
    let sql = vector["setupSql"].as_str().unwrap();
    let start = sql.find("INSERT INTO library_preferences").unwrap();
    recovered.execute_batch(&sql[start..]).unwrap();
    let source = {
        let tx = recovered.transaction().unwrap();
        let value = visible_source_in_transaction(&tx).unwrap();
        tx.commit().unwrap();
        value
    };
    let source_json = serde_json::json!({"generationId":source.generation_id,"sourceRevision":source.source_revision,
      "localSequence":source.local_sequence,"actorId":source.actor_id,"actorCounter":source.actor_counter});
    let cases = vector["cases"].as_array().unwrap();
    let paths = cases
        .iter()
        .map(|case| serde_json::from_value(case["path"].clone()).unwrap())
        .collect();
    let response = read_visible_scope(&mut recovered, paths, &source).unwrap();
    let expected:Vec<_>=cases.iter().map(|case|serde_json::json!({"path":case["path"],"kind":case["kind"],"rows":case["expectedRows"],"source":source_json})).collect();
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        serde_json::json!({"results":expected,"source":source_json})
    );
}

pub(crate) fn check_dormant_migration_contract(source: &Connection) {
    for start_at_schema_two in [false, true] {
        let mut connection = Connection::open_in_memory().unwrap();
        rusqlite::backup::Backup::new(source, &mut connection)
            .unwrap()
            .run_to_completion(128, std::time::Duration::ZERO, None)
            .unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
            .unwrap();
        if start_at_schema_two {
            // Synthetic supported catalog fixture; this does not assert a completed handoff.
            let tx = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            crate::normalized_sqlite::migrate_native_handoff_schema_v2(&tx).unwrap();
            tx.commit().unwrap();
        }
        let prior: u32 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        let prior_hash: String = connection
            .query_row("SELECT schema_sha256 FROM library_storage_meta", [], |r| {
                r.get(0)
            })
            .unwrap();
        connection.execute_batch("CREATE TRIGGER preference_migration_fault BEFORE UPDATE ON library_storage_meta WHEN NEW.schema_version=3 BEGIN SELECT RAISE(ABORT,'migration fault'); END;").unwrap();
        assert!(migrate(&mut connection).is_err());
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                .unwrap(),
            prior
        );
        assert_eq!(
            connection
                .query_row("SELECT schema_sha256 FROM library_storage_meta", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            prior_hash
        );
        assert_eq!(connection.query_row("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'library_local_preference%';",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        connection
            .execute_batch("DROP TRIGGER preference_migration_fault;")
            .unwrap();
        if start_at_schema_two {
            // A catalog without a valid handoff/recovery admission record is fenced.
            // Do not weaken that fence merely to exercise a migration fixture.
            assert!(migrate(&mut connection).is_err());
            assert_eq!(
                connection
                    .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
                    .unwrap(),
                prior
            );
            continue;
        }
        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();
        verify_storage(&connection).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT target_counter FROM library_local_preference_projection",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            crate::normalized_follower_mutation_context_v1(source)
                .unwrap()
                .next_counter
                - 1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT last_counter FROM library_local_preference_projection",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let expected = context_tip(source);
        if expected.0 == 1 {
            let certificate: Vec<u8> = connection
                .query_row(
                    "SELECT CAST(canonical_enrollment_certificate AS BLOB) FROM library_follower_actor_request;",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            // Return only installation-local enrollment to its pending state.
            // The canonical actor remains an authentic admitted checkpoint actor.
            connection.execute_batch("DELETE FROM library_local_preference_projection;
                DELETE FROM library_intent_actors;
                UPDATE library_follower_actor_request SET enrollment_certificate_digest=NULL,
                    canonical_enrollment_certificate=NULL,actor_chain_genesis=NULL,enrolled_at=NULL;
                CREATE TRIGGER enrollment_projection_fault BEFORE INSERT ON library_local_preference_projection
                BEGIN SELECT RAISE(ABORT,'enrollment projection fault'); END;").unwrap();
            assert!(install_projected_enrollment(&mut connection, &certificate).is_err());
            assert_eq!(
                connection
                    .query_row("SELECT count(*) FROM library_intent_actors;", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert!(connection.query_row("SELECT enrollment_certificate_digest IS NULL FROM library_follower_actor_request;", [], |r|r.get::<_,bool>(0)).unwrap());
            connection
                .execute_batch("DROP TRIGGER enrollment_projection_fault;")
                .unwrap();
            let installed = install_projected_enrollment(&mut connection, &certificate).unwrap();
            assert_eq!(
                install_projected_enrollment(&mut connection, &certificate).unwrap(),
                installed
            );
            assert_eq!(context_tip(&connection), expected);
        }
        while !backfill_step(&mut connection).unwrap() {}
        assert!(backfill_step(&mut connection).unwrap());
        assert_eq!(context_tip(&connection), expected);
        // The unchanged ordinary opener still refuses dormant version 3 without downgrading it.
        assert!(install_normalized_schema_v1(&connection).is_err());
        verify_storage(&connection).unwrap();
        connection
            .execute_batch("DROP INDEX library_local_preference_replacement_lookup;")
            .unwrap();
        assert!(migrate(&mut connection).is_err());
    }
}

fn context_tip(connection: &Connection) -> (i64, Option<String>, String) {
    let c = crate::normalized_follower_mutation_context_v1(connection).unwrap();
    (
        c.next_counter,
        c.previous_operation_id,
        c.previous_chain_digest,
    )
}

fn check_projected_checkpoint(
    source: &Connection,
    canonical: Option<&Connection>,
    expected_nodes: Option<i64>,
    expected_values: &[&str],
) {
    let mut db = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(source, &mut db)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
      UPDATE library_replication_outbox SET acknowledged_at=4000;
      UPDATE library_follower_result_outbox SET acknowledged_at=4000;
      INSERT OR IGNORE INTO library_feed_items(global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at)
      VALUES('rss:item:1','rss','article',800,700,'author-1','ada','Ada',0,0,0,800),('rss:item:2','rss','article',801,701,'author-1','ada','Ada',0,0,0,801);").unwrap();
    db.execute("INSERT OR IGNORE INTO library_materialization_generation(singleton_id,generation_id) VALUES(1,?1);",["a".repeat(64)]).unwrap();
    let checkpoint_source = canonical.unwrap_or(&db);
    let descriptor = crate::describe_normalized_checkpoint_export_v2(checkpoint_source).unwrap();
    let page = crate::export_normalized_checkpoint_page_v2(
        checkpoint_source,
        &crate::NormalizedCheckpointExportRequestV2::default(),
    )
    .unwrap();
    assert!(page.done);
    crate::begin_normalized_checkpoint_stage_v2(
        &db,
        &crate::BeginNormalizedCheckpointStageV2 {
            stage_id: "projected-checkpoint".into(),
            library_id: descriptor.library_id,
            authority_epoch: descriptor.authority_epoch,
            source_revision: descriptor.source_revision,
            expected_record_count: page.records.len(),
            created_at: 4000,
        },
    )
    .unwrap();
    crate::append_normalized_checkpoint_stage_page_v2(
        &mut db,
        "projected-checkpoint",
        &page.records,
    )
    .unwrap();
    let receipt = crate::NormalizedFollowerCheckpointReceiptV2 {
        checkpoint_generation: 1,
        writer_actor_id: descriptor.writer_id,
        manifest_object_key: "projected-manifest".into(),
        manifest_transport_object_id: "projected-object".into(),
        manifest_content_digest: "9".repeat(64),
        control_revision: "projected-control".into(),
        installed_at: 4001,
    };
    let count = |db: &Connection| {
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes;",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
    };
    let originals = |db: &Connection| {
        db.prepare("SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;")
            .unwrap()
            .query_map([], |r| r.get::<_, Vec<u8>>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let before = count(&db);
    let bytes = originals(&db);
    let tip = context_tip(&db);
    db.execute_batch("CREATE TEMP TRIGGER projected_checkpoint_fault BEFORE INSERT ON library_local_preference_nodes BEGIN SELECT RAISE(ABORT,'projected restore fault'); END;").unwrap();
    assert!(replace_projected_checkpoint(&mut db, "projected-checkpoint", &receipt).is_err());
    assert_eq!(count(&db), before);
    assert_eq!(originals(&db), bytes);
    assert_eq!(context_tip(&db), tip);
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%';",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM library_checkpoint_stages WHERE stage_id='projected-checkpoint';",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    db.execute_batch("DROP TRIGGER projected_checkpoint_fault;")
        .unwrap();
    if expected_nodes == Some(0) {
        let revision = crate::describe_normalized_checkpoint_export_v2(&db)
            .unwrap()
            .source_revision;
        db.execute_batch("CREATE TEMP TRIGGER checkpoint_settlement_fault BEFORE INSERT ON library_local_invalidations WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'checkpoint settlement fault'); END;").unwrap();
        let failure =
            replace_projected_checkpoint(&mut db, "projected-checkpoint", &receipt).unwrap_err();
        assert!(failure.to_string().contains("checkpoint settlement fault"));
        assert_eq!(
            crate::describe_normalized_checkpoint_export_v2(&db)
                .unwrap()
                .source_revision,
            revision
        );
        assert_eq!(count(&db), before);
        assert_eq!(originals(&db), bytes);
        assert_eq!(context_tip(&db), tip);
        db.execute_batch("DROP TRIGGER checkpoint_settlement_fault;")
            .unwrap();
    }
    replace_projected_checkpoint(&mut db, "projected-checkpoint", &receipt).unwrap();
    assert_eq!(count(&db), expected_nodes.unwrap_or(before));
    assert_eq!(originals(&db), bytes);
    assert_eq!(context_tip(&db), tip);
    let tx = db.transaction().unwrap();
    let visible = visible_source_in_transaction(&tx).unwrap();
    tx.commit().unwrap();
    let value = read_visible_value(
        &mut db,
        vec!["friendSuggestions".into(), "dismissedSuggestionIds".into()],
        &visible,
    )
    .unwrap();
    assert_eq!(
        value
            .rows
            .iter()
            .filter_map(|r| r.text_value.as_deref())
            .collect::<Vec<_>>(),
        expected_values
    );
}

pub(crate) fn check_pending_preference_backfill(
    source: &Connection,
    key: &ring::signature::Ed25519KeyPair,
    enrollment: &crate::normalized_operation::VerifiedActorEnrollment,
) {
    let mut connection = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(source, &mut connection)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    let mut originals = Vec::new();
    for (id, values) in [
        ("backfill:first", vec!["a"]),
        ("backfill:second", vec!["a", "b"]),
    ] {
        let context = crate::normalized_follower_mutation_context_v1(&connection).unwrap();
        let patch =
            serde_json::json!({"updates":{"friendSuggestions":{"dismissedSuggestionIds":values}}});
        let envelopes=crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(key,enrollment,id,
            context.next_counter,context.previous_operation_id.as_deref(),&context.previous_chain_digest,&[("preferences",2202)],"preferences_leaf_assignment",Some(&patch));
        crate::enqueue_normalized_follower_intent_v1(&mut connection, &envelopes, 2203).unwrap();
        originals.push(envelopes[0].clone());
    }
    let tip = context_tip(&connection);
    let initial_sequence: i64 = connection
        .query_row(
            "SELECT sequence FROM library_local_change_state WHERE singleton_id=1;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    migrate(&mut connection).unwrap();
    // The fixture's earlier read transaction advances the cursor without preference effects.
    assert!(!backfill_step(&mut connection).unwrap());
    connection.execute_batch("CREATE TRIGGER preference_cursor_fault BEFORE UPDATE ON library_local_preference_projection BEGIN SELECT RAISE(ABORT,'cursor fault'); END;").unwrap();
    assert!(backfill_step(&mut connection).is_err());
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT last_counter FROM library_local_preference_projection",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT sequence FROM library_local_change_state WHERE singleton_id=1;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        initial_sequence
    );
    connection
        .execute_batch("DROP TRIGGER preference_cursor_fault;")
        .unwrap();
    connection
        .execute("DELETE FROM library_local_change_state;", [])
        .unwrap();
    assert!(backfill_step(&mut connection).is_err());
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    connection
        .execute(
            "INSERT INTO library_local_change_state(singleton_id,sequence) VALUES(1,?1);",
            [initial_sequence],
        )
        .unwrap();
    assert!(!backfill_step(&mut connection).unwrap());
    let retained_count = connection
        .query_row(
            "SELECT count(*) FROM library_local_preference_nodes",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(retained_count, 3);
    let mut corrupted = originals[1].clone();
    let marker = b"\"signature\":\"";
    let position = corrupted
        .windows(marker.len())
        .position(|bytes| bytes == marker)
        .unwrap()
        + marker.len();
    corrupted[position] = if corrupted[position] == b'0' {
        b'1'
    } else {
        b'0'
    };
    connection.execute("UPDATE library_intent_members SET canonical_member=?1 WHERE transaction_id='backfill:second';",[&corrupted]).unwrap();
    assert!(backfill_step(&mut connection).is_err());
    assert_eq!(
        connection
            .query_row(
                "SELECT last_counter FROM library_local_preference_projection",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        3
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        retained_count
    );
    connection.execute("UPDATE library_intent_members SET canonical_member=?1 WHERE transaction_id='backfill:second';",[&originals[1]]).unwrap();
    let mut reopened = Connection::open_in_memory().unwrap();
    rusqlite::backup::Backup::new(&connection, &mut reopened)
        .unwrap()
        .run_to_completion(128, std::time::Duration::ZERO, None)
        .unwrap();
    reopened
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .unwrap();
    assert!(backfill_step(&mut reopened).unwrap());
    assert!(backfill_step(&mut reopened).unwrap());
    assert_eq!(
        reopened
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        7
    );
    assert_eq!(reopened.query_row("SELECT integer_value FROM library_local_preference_nodes WHERE path='$.friendSuggestions.dismissedSuggestionIds' ORDER BY actor_counter DESC LIMIT 1;",[],|r|r.get::<_,i64>(0)).unwrap(),2);
    assert_eq!(context_tip(&reopened), tip);
    assert_eq!(
        reopened
            .query_row(
                "SELECT sequence FROM library_local_change_state WHERE singleton_id=1;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        initial_sequence + 2
    );
    assert_eq!(reopened.query_row("SELECT count(*) FROM library_local_invalidations WHERE topic='preferences' AND reason='optimistic_added';", [], |r|r.get::<_,i64>(0)).unwrap(), 2);

    for (id, bytes) in ["backfill:first", "backfill:second"].iter().zip(originals) {
        assert_eq!(
            reopened
                .query_row(
                    "SELECT canonical_member FROM library_intent_members WHERE transaction_id=?1;",
                    [id],
                    |r| r.get::<_, Vec<u8>>(0)
                )
                .unwrap(),
            bytes
        );
    }
    reopened.execute("INSERT OR IGNORE INTO library_materialization_generation(singleton_id,generation_id) VALUES(1,?1);",["a".repeat(64)]).unwrap();
    let before_source = {
        let tx = reopened.transaction().unwrap();
        let source = visible_source_in_transaction(&tx).unwrap();
        tx.commit().unwrap();
        source
    };
    let context = crate::normalized_follower_mutation_context_v1(&reopened).unwrap();
    let patch = serde_json::json!({"updates":{"friendSuggestions":{"dismissedSuggestionIds":["a","b","c"]}}});
    let fresh =
        crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(
            key,
            enrollment,
            "projected:fresh",
            context.next_counter,
            context.previous_operation_id.as_deref(),
            &context.previous_chain_digest,
            &[("preferences", 3000)],
            "preferences_leaf_assignment",
            Some(&patch),
        );
    reopened
        .execute(
            "UPDATE library_local_preference_projection SET last_counter=last_counter-1;",
            [],
        )
        .unwrap();
    assert!(enqueue_projected_intent(&mut reopened, &fresh, 3001).is_err());
    reopened
        .execute(
            "UPDATE library_local_preference_projection SET last_counter=last_counter+1;",
            [],
        )
        .unwrap();
    reopened.execute("INSERT INTO library_local_handoff(singleton_id,handoff_id,library_id,installation_role,phase,predecessor_epoch_id,target_writer_id,target_authority_public_key,canonical_readiness,created_at,updated_at) VALUES(1,?1,?2,'target','preparing',?3,?4,?5,X'7b7d',1,1);",
        params!["1".repeat(64),context.library_id,context.epoch_id,context.actor_id,context.actor_public_key]).unwrap();
    assert!(enqueue_projected_intent(&mut reopened, &fresh, 3001).is_err());
    reopened
        .execute("DELETE FROM library_local_handoff;", [])
        .unwrap();
    reopened.execute_batch("CREATE TEMP TRIGGER projected_cursor_fault BEFORE UPDATE OF last_counter ON library_local_preference_projection WHEN NEW.last_counter>OLD.last_counter BEGIN SELECT RAISE(ABORT,'projected cursor fault'); END;").unwrap();
    assert!(enqueue_projected_intent(&mut reopened, &fresh, 3001).is_err());
    assert_eq!(context_tip(&reopened), tip);
    assert_eq!(reopened.query_row("SELECT count(*) FROM library_intent_transactions WHERE transaction_id='projected:fresh';",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(
        reopened
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        7
    );
    assert_eq!(
        reopened
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        initial_sequence + 2
    );
    reopened
        .execute_batch("DROP TRIGGER projected_cursor_fault;")
        .unwrap();
    let receipt = enqueue_projected_intent(&mut reopened, &fresh, 3001).unwrap();
    assert_eq!(
        enqueue_projected_intent(&mut reopened, &fresh, 3002).unwrap(),
        receipt
    );
    assert_eq!(
        crate::normalized_follower_mutation_context_v1(&reopened)
            .unwrap()
            .next_counter,
        context.next_counter + 1
    );
    assert_eq!(
        reopened
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        12
    );
    assert_eq!(
        reopened
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        initial_sequence + 3
    );
    // Replaying the original enrollment after new edits must preserve the exact
    // cursor, signed history, effects and invalidation sequence.
    let enrollment_certificate: Vec<u8> = reopened
        .query_row(
            "SELECT CAST(canonical_enrollment_certificate AS BLOB) FROM library_follower_actor_request;",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let prior_tip = context_tip(&reopened);
    install_projected_enrollment(&mut reopened, &enrollment_certificate).unwrap();
    assert_eq!(context_tip(&reopened), prior_tip);
    assert_eq!(
        reopened
            .query_row(
                "SELECT count(*) FROM library_local_preference_nodes;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        12
    );
    assert_eq!(
        reopened
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        initial_sequence + 3
    );
    {
        let tx = reopened.transaction().unwrap();
        tx.execute("DELETE FROM library_local_preference_projection;", [])
            .unwrap();
        tx.commit().unwrap();
    }
    assert!(install_projected_enrollment(&mut reopened, &enrollment_certificate).is_err());
    assert_eq!(context_tip(&reopened), prior_tip);
    // Restore the exact cursor from the durable actor tip for the remainder of
    // this fixture only. Production enrollment refuses the damaged state above.
    reopened.execute("INSERT INTO library_local_preference_projection
        (singleton_id,actor_id,last_counter,target_counter,previous_operation_id,previous_chain_digest)
        SELECT 1,actor_id,next_counter-1,next_counter-1,previous_operation_id,previous_chain_digest
        FROM library_intent_actors;", []).unwrap();
    let after_source = {
        let tx = reopened.transaction().unwrap();
        let source = visible_source_in_transaction(&tx).unwrap();
        tx.commit().unwrap();
        source
    };
    assert_eq!(after_source.source_revision, before_source.source_revision);
    assert_eq!(after_source.generation_id, before_source.generation_id);
    assert_eq!(
        after_source.local_sequence,
        before_source.local_sequence + 1
    );
    assert_eq!(after_source.actor_counter, before_source.actor_counter + 1);
    check_projected_checkpoint(&reopened, None, None, &["a", "b", "c"]);
    let selected_path = vec!["friendSuggestions".into(), "dismissedSuggestionIds".into()];
    assert!(read_visible_value(&mut reopened, selected_path.clone(), &before_source).is_err());
    let value = read_visible_value(&mut reopened, selected_path.clone(), &after_source).unwrap();
    let scope_paths = vec![selected_path.clone(), vec!["missing".into()]];
    let scope = read_visible_scope(&mut reopened, scope_paths.clone(), &after_source).unwrap();
    assert_eq!(scope.results[0].rows, value.rows);
    assert_eq!(scope.results[1].kind, "absent");
    assert!(scope
        .results
        .iter()
        .all(|value| value.source == after_source));
    assert!(read_visible_scope(&mut reopened, scope_paths, &before_source).is_err());
    assert!(read_visible_scope(
        &mut reopened,
        vec![selected_path.clone(), selected_path.clone()],
        &after_source
    )
    .is_err());
    let maximum_paths: Vec<_> = (0..64)
        .map(|index| vec!["unassigned".into(), index.to_string()])
        .collect();
    assert_eq!(
        read_visible_scope(&mut reopened, maximum_paths.clone(), &after_source)
            .unwrap()
            .results
            .len(),
        64
    );
    let mut too_many = maximum_paths;
    too_many.push(vec!["overflow".into()]);
    assert!(read_visible_scope(&mut reopened, too_many, &after_source).is_err());
    let vector: serde_json::Value = serde_json::from_str(include_str!(
        "../../shared/src/library-core/preference-value-query-vector-v1.json"
    ))
    .unwrap();
    reopened
        .execute_batch(vector["scopeOverflowSql"].as_str().unwrap())
        .unwrap();
    assert!(read_visible_scope(
        &mut reopened,
        (0..32).map(|i| vec![format!("scope{i}")]).collect(),
        &after_source
    )
    .is_err());

    assert_eq!(value.kind, "value");
    assert_eq!(
        value
            .rows
            .iter()
            .filter_map(|r| r.text_value.as_deref())
            .collect::<Vec<_>>(),
        vec!["a", "b", "c"]
    );
    assert_eq!(
        read_visible_value(
            &mut reopened,
            vec!["friendSuggestions".into()],
            &after_source
        )
        .unwrap()
        .kind,
        "object_group"
    );
    assert_eq!(
        read_visible_value(&mut reopened, vec!["missing".into()], &after_source)
            .unwrap()
            .kind,
        "absent"
    );
    reopened.execute_batch("INSERT INTO library_preferences(path,value_type,integer_value,updated_at) VALUES('v:$.canonicalSetting','integer',42,1);
      INSERT INTO library_preferences(path,value_type,updated_at) VALUES('o:$.fraction','null',1);
      INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES
      ('v:$.fraction.bits','text','3fe0000000000000',1),('v:$.fraction.codec','text','ieee754_binary64_hex_v1',1),
      ('v:$.friendSuggestions.dismissedSuggestionIds.old','text','hidden',1);").unwrap();
    assert_eq!(
        read_visible_value(
            &mut reopened,
            vec!["canonicalSetting".into()],
            &after_source
        )
        .unwrap()
        .rows[0]
            .integer_value,
        Some(42)
    );
    assert_eq!(
        read_visible_value(&mut reopened, vec!["fraction".into()], &after_source)
            .unwrap()
            .kind,
        "value"
    );
    assert_eq!(
        read_visible_value(&mut reopened, vec!["fraction".into()], &after_source)
            .unwrap()
            .rows
            .len(),
        3
    );
    assert_eq!(
        read_visible_value(
            &mut reopened,
            vec![
                "friendSuggestions".into(),
                "dismissedSuggestionIds".into(),
                "old".into()
            ],
            &after_source
        )
        .unwrap()
        .kind,
        "absent"
    );
    reopened.execute("INSERT INTO library_preferences(path,value_type,integer_value,updated_at) VALUES('v:$.fraction.extra','integer',1,1);",[]).unwrap();
    assert_eq!(
        read_visible_value(&mut reopened, vec!["fraction".into()], &after_source)
            .unwrap()
            .kind,
        "object_group"
    );
    reopened.execute("INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES(?1,'text','literal',1);",[r#"v:$."雪.key"."quote\"key""#]).unwrap();
    assert_eq!(
        read_visible_value(
            &mut reopened,
            vec!["雪.key".into(), "quote\"key".into()],
            &after_source
        )
        .unwrap()
        .rows[0]
            .text_value
            .as_deref(),
        Some("literal")
    );
    reopened.execute("INSERT INTO library_local_preference_nodes(transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,integer_value,updated_at)
      VALUES('projected:fresh',0,?1,?2,'$.friendSuggestions.dismissedSuggestionIds.invalid','value','integer',9,3000);",params![context.actor_id,context.next_counter]).unwrap();
    assert!(read_visible_value(&mut reopened, selected_path, &after_source).is_err());
    reopened.execute("DELETE FROM library_local_preference_nodes WHERE path='$.friendSuggestions.dismissedSuggestionIds.invalid';",[]).unwrap();

    {
        let tx = reopened
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        tx.execute(
            "UPDATE library_local_preference_projection SET last_counter=last_counter-1;",
            [],
        )
        .unwrap();
        assert!(visible_source_in_transaction(&tx).is_err());
        tx.rollback().unwrap();
    }
    let program = |id| {
        PENDING_PREFERENCE_QUERY_PROGRAMS
            .iter()
            .find(|(name, _)| *name == id)
            .unwrap()
            .1
    };
    let path = "$.friendSuggestions.dismissedSuggestionIds";
    let (transaction, member, counter): (String, i64, i64) = reopened
        .query_row(
            program("latest_node_v1"),
            params![context.actor_id, path],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(counter, context.next_counter);
    let values = reopened
        .prepare(program("array_nodes_v1"))
        .unwrap()
        .query_map(
            params![transaction, member, format!("{path}["), format!("{path}\\")],
            |r| r.get::<_, String>(6),
        )
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(values, vec!["a", "b", "c"]);
}

// Exercise real authority-signed outcomes, independently of cursor fault injection.
pub(crate) fn check_backfill_outcomes(
    source: &Connection,
    key: &ring::signature::Ed25519KeyPair,
    enrollment: &crate::normalized_operation::VerifiedActorEnrollment,
    authority_key: &ring::signature::Ed25519KeyPair,
) {
    fn copy(source: &Connection) -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        rusqlite::backup::Backup::new(source, &mut db)
            .unwrap()
            .run_to_completion(128, std::time::Duration::ZERO, None)
            .unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
            .unwrap();
        db
    }
    fn project(db: &mut Connection) -> i64 {
        migrate(db).unwrap();
        while !backfill_step(db).unwrap() {}
        db.query_row(
            "SELECT count(*) FROM library_local_preference_nodes",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }
    for reject in [false, true] {
        let mut follower = copy(source);
        let context = crate::normalized_follower_mutation_context_v1(&follower).unwrap();
        let patch = serde_json::json!({"updates":{"friendSuggestions":{"dismissedSuggestionIds":["outcome"]}}});
        let envelopes = crate::normalized_operation_test_fixtures::tests::signed_envelopes_from_tip_with_payload(
            key, enrollment, "backfill:outcome", context.next_counter,
            context.previous_operation_id.as_deref(), &context.previous_chain_digest,
            &[("preferences", 2302)], "preferences_leaf_assignment", Some(&patch));
        crate::enqueue_normalized_follower_intent_v1(&mut follower, &envelopes, 2303).unwrap();
        let page = crate::export_normalized_follower_intent_page_v1(
            &follower,
            &crate::NormalizedFollowerIntentPageRequestV1 {
                actor_id: context.actor_id.clone(),
                cursor: None,
                maximum_records: 128,
                maximum_response_bytes: 1_048_576,
            },
        )
        .unwrap();
        assert!(page.done);
        let staged = crate::NormalizedFollowerIntentStagePageV1 {
            records: page
                .records
                .into_iter()
                .map(|r| crate::NormalizedFollowerIntentStageRecordV1 {
                    actor_counter: r.actor_counter,
                    actor_id: r.actor_id,
                    canonical_envelope_json: r.canonical_envelope_json,
                    intent_epoch: r.intent_epoch,
                    intent_epoch_id: r.intent_epoch_id,
                    member_count: r.member_count,
                    member_index: r.member_index,
                    operation_id: r.operation_id,
                    state: r.state,
                    transaction_digest: r.transaction_digest,
                    transaction_id: r.transaction_id,
                })
                .collect(),
        };
        let mut primary = copy(&follower);
        primary.execute_batch("INSERT INTO library_feed_items
            (global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at)
            VALUES ('rss:item:1','rss','article',800,700,'author-1','ada','Ada',0,0,0,800),
                   ('rss:item:2','rss','article',801,701,'author-1','ada','Ada',0,0,0,801);").unwrap();
        if reject {
            primary
                .execute(
                    "UPDATE library_actors SET retired_at=2400 WHERE actor_id=?1;",
                    [&context.actor_id],
                )
                .unwrap();
        }
        crate::ingest_normalized_follower_intent_page_v1(
            &mut primary,
            &staged,
            authority_key,
            2500,
        )
        .unwrap();
        let results = crate::export_normalized_follower_result_page_v1(
            &primary,
            &crate::NormalizedFollowerResultPageRequestV1 {
                actor_id: context.actor_id.clone(),
                after: None,
                maximum_records: 128,
                maximum_response_bytes: 1_048_576,
            },
        )
        .unwrap();
        let result = results
            .records
            .iter()
            .find(|r| r.transaction_id == "backfill:outcome")
            .unwrap();
        assert_eq!(
            result.status,
            if reject { "rejected" } else { "accepted" },
            "{result:?}"
        );
        let mut segment_import = copy(&follower);
        assert_eq!(project(&mut segment_import), 3);
        let mut publication = crate::NormalizedFollowerResultTransportImportV2 {
            actor_id: context.actor_id.clone(),
            library_id: context.library_id.clone(),
            object_key: "preference-result-object".into(),
            previous_segment_digest: None,
            received_at: 2600,
            records: results.records.clone(),
            semantic_segment_digest: "8".repeat(64),
            stored_segment_digest: "9".repeat(64),
            storage_epoch_id: context.epoch_id.clone(),
            transport_object_id: "preference-result-transport".into(),
        };
        publication.semantic_segment_digest =
            crate::normalized_follower::normalized_result_segment_digest_v2(&publication).unwrap();
        segment_import
            .execute(
                "UPDATE library_local_preference_projection SET target_counter=target_counter+1;",
                [],
            )
            .unwrap();
        assert!(
            import_projected_result_segment(&mut segment_import, &publication)
                .unwrap_err()
                .to_string()
                .contains("completed backfill")
        );
        assert_eq!(
            segment_import
                .query_row(
                    "SELECT count(*) FROM library_result_transport_heads;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        segment_import
            .execute(
                "UPDATE library_local_preference_projection SET target_counter=target_counter-1;",
                [],
            )
            .unwrap();
        if reject {
            segment_import.execute_batch("CREATE TEMP TRIGGER segment_preference_fault BEFORE INSERT ON library_local_invalidations WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'segment preference fault'); END;").unwrap();
            assert!(
                import_projected_result_segment(&mut segment_import, &publication)
                    .unwrap_err()
                    .to_string()
                    .contains("segment preference fault")
            );
            for table in [
                "library_result_transport_heads",
                "library_result_transport_segments",
                "library_intent_results",
                "library_intent_result_cursors",
            ] {
                assert_eq!(
                    segment_import
                        .query_row(&format!("SELECT count(*) FROM {table};"), [], |r| r
                            .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
            }
            assert_eq!(
                segment_import
                    .query_row(
                        "SELECT count(*) FROM library_local_preference_nodes;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                3
            );
            segment_import
                .execute_batch("DROP TRIGGER segment_preference_fault;")
                .unwrap();
        }
        let segment_receipt =
            import_projected_result_segment(&mut segment_import, &publication).unwrap();
        assert_eq!(
            segment_import
                .query_row(
                    "SELECT count(*) FROM library_local_preference_nodes;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            if reject { 0 } else { 3 }
        );
        let segment_sequence: i64 = segment_import
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            import_projected_result_segment(&mut segment_import, &publication).unwrap(),
            segment_receipt
        );
        assert_eq!(
            segment_import
                .query_row(
                    "SELECT sequence FROM library_local_change_state;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            segment_sequence
        );
        let mut atomic_import = copy(&follower);
        assert_eq!(project(&mut atomic_import), 3);
        let initial_tip = context_tip(&atomic_import);
        let initial_sequence: i64 = atomic_import
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        if reject {
            // This fires only at the preference removal, after ordinary result
            // rows, FeedItem reconciliation and result cursor writes have run.
            atomic_import.execute_batch("CREATE TEMP TRIGGER result_preference_fault BEFORE INSERT ON library_local_invalidations WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'result preference fault'); END;").unwrap();
            assert!(
                import_projected_result_page(&mut atomic_import, &results.records, 2600)
                    .unwrap_err()
                    .to_string()
                    .contains("result preference fault")
            );
            assert_eq!(
                atomic_import
                    .query_row("SELECT count(*) FROM library_intent_results;", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                atomic_import
                    .query_row(
                        "SELECT count(*) FROM library_intent_result_cursors;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                0
            );
            assert_eq!(
                atomic_import
                    .query_row(
                        "SELECT count(*) FROM library_local_preference_nodes;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                3
            );
            assert_eq!(
                atomic_import
                    .query_row(
                        "SELECT sequence FROM library_local_change_state;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                initial_sequence
            );
            assert_eq!(context_tip(&atomic_import), initial_tip);
            atomic_import
                .execute_batch("DROP TRIGGER result_preference_fault;")
                .unwrap();
        }
        import_projected_result_page(&mut atomic_import, &results.records, 2600).unwrap();
        assert_eq!(
            atomic_import
                .query_row(
                    "SELECT count(*) FROM library_local_preference_nodes;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            if reject { 0 } else { 3 }
        );
        let settled_sequence: i64 = atomic_import
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        import_projected_result_page(&mut atomic_import, &results.records, 2601).unwrap();
        assert_eq!(
            atomic_import
                .query_row(
                    "SELECT sequence FROM library_local_change_state;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            settled_sequence
        );
        assert_eq!(context_tip(&atomic_import), initial_tip);
        if !reject {
            let mut incremental = copy(&atomic_import);
            incremental.execute_batch("DELETE FROM library_writer_admission;
                INSERT INTO library_feed_items(global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at)
                VALUES ('rss:item:1','rss','article',800,700,'author-1','ada','Ada',0,0,0,800),('rss:item:2','rss','article',801,701,'author-1','ada','Ada',0,0,0,801);").unwrap();
            let snapshot =
                crate::normalized_replication::describe_normalized_operation_export_v2(&primary)
                    .unwrap();
            let starting_revision: i64 = incremental
                .query_row("SELECT source_revision FROM library_meta;", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let local_tip = context_tip(&incremental);
            let mut after = None;
            let mut injected = false;
            loop {
                let page = crate::normalized_replication::export_normalized_operation_page_v2(
                    &primary,
                    &crate::normalized_replication::NormalizedOperationExportRequestV2 {
                        snapshot: snapshot.clone(),
                        after,
                        after_source_revision: starting_revision,
                        maximum_records: 1,
                        maximum_response_bytes: 1_048_576,
                    },
                )
                .unwrap();
                let done = page.done;
                after = page.next_cursor.clone();
                let preference_member = page.records.iter().any(|record| {
                    record.transaction_id == "backfill:outcome" && record.member_index == 0
                });
                let input = crate::NormalizedOperationImportPageV2 {
                    snapshot: snapshot.clone(),
                    page,
                    received_at: 2700,
                };
                if preference_member {
                    let revision: i64 = incremental
                        .query_row("SELECT source_revision FROM library_meta;", [], |r| {
                            r.get(0)
                        })
                        .unwrap();
                    let sequence: i64 = incremental
                        .query_row(
                            "SELECT sequence FROM library_local_change_state;",
                            [],
                            |r| r.get(0),
                        )
                        .unwrap();
                    incremental.execute_batch("CREATE TEMP TRIGGER canonical_projection_fault BEFORE INSERT ON library_local_invalidations WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'canonical projection fault'); END;").unwrap();
                    assert!(import_projected_operation_page(&mut incremental, &input)
                        .unwrap_err()
                        .to_string()
                        .contains("canonical projection fault"));
                    assert_eq!(
                        incremental
                            .query_row("SELECT source_revision FROM library_meta;", [], |r| r
                                .get::<_, i64>(0))
                            .unwrap(),
                        revision
                    );
                    assert_eq!(
                        incremental
                            .query_row(
                                "SELECT sequence FROM library_local_change_state;",
                                [],
                                |r| r.get::<_, i64>(0)
                            )
                            .unwrap(),
                        sequence
                    );
                    assert_eq!(
                        incremental
                            .query_row(
                                "SELECT count(*) FROM library_local_preference_nodes;",
                                [],
                                |r| r.get::<_, i64>(0)
                            )
                            .unwrap(),
                        3
                    );
                    assert_eq!(incremental.query_row("SELECT count(*) FROM library_operation_replication_stages WHERE transaction_id='backfill:outcome';",[],|r|r.get::<_,i64>(0)).unwrap(),1);
                    assert_eq!(
                        incremental
                            .query_row("SELECT count(*) FROM library_preferences;", [], |r| r
                                .get::<_, i64>(0))
                            .unwrap(),
                        0
                    );
                    incremental
                        .execute_batch("DROP TRIGGER canonical_projection_fault;")
                        .unwrap();
                    injected = true;
                }
                import_projected_operation_page(&mut incremental, &input).unwrap();
                let sequence: i64 = incremental
                    .query_row(
                        "SELECT sequence FROM library_local_change_state;",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    import_projected_operation_page(&mut incremental, &input)
                        .unwrap()
                        .applied_transaction_count,
                    0
                );
                assert_eq!(
                    incremental
                        .query_row(
                            "SELECT sequence FROM library_local_change_state;",
                            [],
                            |r| r.get::<_, i64>(0)
                        )
                        .unwrap(),
                    sequence
                );
                if done {
                    break;
                }
            }
            assert!(injected);
            assert_eq!(context_tip(&incremental), local_tip);
            assert_eq!(
                incremental
                    .query_row("SELECT source_revision FROM library_meta;", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                snapshot.source_revision
            );
            assert_eq!(
                incremental
                    .query_row(
                        "SELECT count(*) FROM library_local_preference_nodes;",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                0
            );
            assert_eq!(incremental.query_row("SELECT text_value FROM library_preferences WHERE path='v:$.friendSuggestions.dismissedSuggestionIds[0]';",[],|r|r.get::<_,String>(0)).unwrap(),"outcome");
        }
        let mut settlement = copy(&follower);
        assert_eq!(project(&mut settlement), 3);
        crate::import_normalized_follower_result_page_v1(&mut settlement, &results.records, 2600)
            .unwrap();
        if !reject {
            check_projected_checkpoint(&settlement, Some(&primary), Some(0), &["outcome"]);
            let tx = settlement
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            assert!(
                settle_covered_projection_in_transaction(&tx).unwrap() == 0,
                "ahead receipt must retain visible edit"
            );
            tx.commit().unwrap();
            // Isolate the settlement coverage predicate; actual canonical materialization
            // is separately proved by the Primary backfill case below.
            settlement
                .execute(
                    "UPDATE library_meta SET source_revision=?1;",
                    [result.authoritative_source_revision],
                )
                .unwrap();
        }
        let sequence: i64 = settlement
            .query_row(
                "SELECT sequence FROM library_local_change_state;",
                [],
                |r| r.get(0),
            )
            .unwrap();
        {
            let tx = settlement
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            tx.execute("UPDATE library_intent_results SET authoritative_source_revision=authoritative_source_revision+1000000 WHERE transaction_id=?1;", [&result.transaction_id]).unwrap();
            // A tampered future revision must not escape authentication by being
            // prefiltered as an otherwise legitimate ahead-of-checkpoint result.
            assert!(settle_covered_projection_in_transaction(&tx).is_err());
            tx.rollback().unwrap();
        }
        settlement.execute_batch("CREATE TEMP TRIGGER settlement_notification_fault BEFORE INSERT ON library_local_invalidations WHEN NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'settlement notification fault'); END;").unwrap();
        {
            let tx = settlement
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            assert!(settle_covered_projection_in_transaction(&tx).is_err());
            tx.rollback().unwrap();
        }
        assert_eq!(
            settlement
                .query_row(
                    "SELECT count(*) FROM library_local_preference_nodes;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            3
        );
        assert_eq!(
            settlement
                .query_row(
                    "SELECT sequence FROM library_local_change_state;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            sequence
        );
        settlement
            .execute_batch("DROP TRIGGER settlement_notification_fault;")
            .unwrap();
        {
            let tx = settlement
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            assert_eq!(settle_covered_projection_in_transaction(&tx).unwrap(), 1);
            assert!(!settle_in_transaction(&tx, result).unwrap());
            tx.commit().unwrap();
        }
        assert_eq!(
            settlement
                .query_row(
                    "SELECT count(*) FROM library_local_preference_nodes;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        assert_eq!(
            settlement
                .query_row(
                    "SELECT sequence FROM library_local_change_state;",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            sequence + 1
        );
        crate::import_normalized_follower_result_page_v1(&mut follower, &results.records, 2600)
            .unwrap();
        let tip = context_tip(&follower);
        assert_eq!(project(&mut follower), if reject { 0 } else { 3 });
        assert_eq!(context_tip(&follower), tip);
        if !reject {
            // The Primary copy has actually materialized the signed edit. Import
            // its signed receipt into the retained local journal before migration.
            crate::import_normalized_follower_result_page_v1(&mut primary, &results.records, 2600)
                .unwrap();
            assert_eq!(
                project(&mut primary),
                0,
                "canonical coverage retires pending effects"
            );
        }
    }
}
