use crate::sqlite_contract_generated::SQLITE_LOCAL_MUTATION_PROGRAMS;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::fmt;

const MAXIMUM_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAXIMUM_COORDINATE: f64 = 1_000_000_000.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "mutationId",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeviceGraphLayoutMutationV1 {
    AccountGraphPositionClearV1 {
        entity_id: String,
        schema_version: u32,
    },
    AccountGraphPositionSetV1 {
        entity_id: String,
        graph_x: f64,
        graph_y: f64,
        schema_version: u32,
        updated_at: i64,
    },
    PersonGraphPositionClearV1 {
        entity_id: String,
        schema_version: u32,
    },
    PersonGraphPositionSetV1 {
        entity_id: String,
        graph_x: f64,
        graph_y: f64,
        schema_version: u32,
        updated_at: i64,
    },
}

impl DeviceGraphLayoutMutationV1 {
    fn mutation_id(&self) -> &'static str {
        match self {
            Self::AccountGraphPositionClearV1 { .. } => "account_graph_position_clear_v1",
            Self::AccountGraphPositionSetV1 { .. } => "account_graph_position_set_v1",
            Self::PersonGraphPositionClearV1 { .. } => "person_graph_position_clear_v1",
            Self::PersonGraphPositionSetV1 { .. } => "person_graph_position_set_v1",
        }
    }

    fn entity_id(&self) -> &str {
        match self {
            Self::AccountGraphPositionClearV1 { entity_id, .. }
            | Self::AccountGraphPositionSetV1 { entity_id, .. }
            | Self::PersonGraphPositionClearV1 { entity_id, .. }
            | Self::PersonGraphPositionSetV1 { entity_id, .. } => entity_id,
        }
    }

    fn schema_version(&self) -> u32 {
        match self {
            Self::AccountGraphPositionClearV1 { schema_version, .. }
            | Self::AccountGraphPositionSetV1 { schema_version, .. }
            | Self::PersonGraphPositionClearV1 { schema_version, .. }
            | Self::PersonGraphPositionSetV1 { schema_version, .. } => *schema_version,
        }
    }

    fn coordinates(&self) -> Option<(f64, f64, i64)> {
        match self {
            Self::AccountGraphPositionSetV1 {
                graph_x,
                graph_y,
                updated_at,
                ..
            }
            | Self::PersonGraphPositionSetV1 {
                graph_x,
                graph_y,
                updated_at,
                ..
            } => Some((*graph_x, *graph_y, *updated_at)),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceGraphLayoutMutationResultV1 {
    pub changed: bool,
    pub layout_revision: i64,
    pub mutation_id: String,
    pub schema_version: u32,
}

#[derive(Debug)]
pub enum DeviceGraphLayoutError {
    Invalid(&'static str),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for DeviceGraphLayoutError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => formatter.write_str(message),
            Self::Sqlite(error) => write!(formatter, "SQLite device graph layout failure: {error}"),
        }
    }
}

impl std::error::Error for DeviceGraphLayoutError {}

impl From<rusqlite::Error> for DeviceGraphLayoutError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

pub fn mutate_device_graph_layout_v1(
    connection: &mut Connection,
    mutation: &DeviceGraphLayoutMutationV1,
) -> Result<DeviceGraphLayoutMutationResultV1, DeviceGraphLayoutError> {
    let entity_id = mutation.entity_id();
    if mutation.schema_version() != 1 || entity_id.is_empty() || entity_id.len() > 2_048 {
        return Err(DeviceGraphLayoutError::Invalid(
            "device graph layout mutation identity is invalid",
        ));
    }
    if mutation.coordinates().is_some_and(|(x, y, updated_at)| {
        !x.is_finite()
            || x.abs() > MAXIMUM_COORDINATE
            || !y.is_finite()
            || y.abs() > MAXIMUM_COORDINATE
            || !(0..=MAXIMUM_SAFE_INTEGER).contains(&updated_at)
    }) {
        return Err(DeviceGraphLayoutError::Invalid(
            "device graph layout mutation coordinates are invalid",
        ));
    }
    let program = SQLITE_LOCAL_MUTATION_PROGRAMS
        .iter()
        .find(|program| program.0 == mutation.mutation_id())
        .ok_or(DeviceGraphLayoutError::Invalid(
            "device graph layout mutation program is missing",
        ))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let target_exists = transaction
        .query_row(program.3, params![entity_id], |row| row.get::<_, i64>(0))
        .optional()?
        == Some(1);
    if !target_exists {
        return Err(DeviceGraphLayoutError::Invalid(
            "device graph layout target is unavailable",
        ));
    }
    let changed = match mutation.coordinates() {
        Some((graph_x, graph_y, updated_at)) => {
            transaction.execute(program.4, params![entity_id, graph_x, graph_y, updated_at])?
        }
        None => transaction.execute(program.4, params![entity_id])?,
    };
    if changed > program.1 {
        return Err(DeviceGraphLayoutError::Invalid(
            "device graph layout mutation exceeded its row bound",
        ));
    }
    if changed == 1 {
        let advanced = transaction.execute(
            "UPDATE library_device_graph_layout_state
             SET revision = revision + 1
             WHERE singleton_id = 1 AND revision < 9007199254740991;",
            [],
        )?;
        if advanced != 1 {
            return Err(DeviceGraphLayoutError::Invalid(
                "device graph layout revision cannot advance",
            ));
        }
    }
    let layout_revision = transaction.query_row(
        "SELECT revision FROM library_device_graph_layout_state WHERE singleton_id = 1;",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.commit()?;
    Ok(DeviceGraphLayoutMutationResultV1 {
        changed: changed == 1,
        layout_revision,
        mutation_id: mutation.mutation_id().to_owned(),
        schema_version: 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_normalized_schema_v1;

    #[test]
    fn local_layout_mutations_are_idempotent_and_do_not_advance_authority() {
        let mut connection = Connection::open_in_memory().expect("database");
        install_normalized_schema_v1(&connection).expect("schema");
        connection
            .execute_batch(&format!(
                "INSERT INTO library_meta
                   (singleton_id, library_id, schema_version, authority_epoch,
                    source_revision, updated_at)
                   VALUES (1, '{}', 1, 'epoch-1', 7, 1000);
                 INSERT INTO library_materialization_generation
                   SELECT 1, library_id FROM library_meta;
                 UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
                 INSERT INTO library_persons
                   (id, name, relationship_status, care_level, created_at, updated_at)
                   VALUES ('person-1', 'Ada', 'friend', 5, 50, 200);",
                "a".repeat(64)
            ))
            .expect("fixture");
        let set = DeviceGraphLayoutMutationV1::PersonGraphPositionSetV1 {
            entity_id: "person-1".to_owned(),
            graph_x: 12.5,
            graph_y: -8.25,
            schema_version: 1,
            updated_at: 300,
        };
        assert!(
            mutate_device_graph_layout_v1(&mut connection, &set)
                .expect("set")
                .changed
        );
        let retry = mutate_device_graph_layout_v1(&mut connection, &set).expect("exact retry");
        assert!(!retry.changed);
        assert_eq!(retry.layout_revision, 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT graph_x, graph_y, updated_at FROM library_device_person_graph_layout WHERE person_id = 'person-1';",
                    [],
                    |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?, row.get::<_, i64>(2)?)),
                )
                .expect("layout"),
            (12.5, -8.25, 300)
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT source_revision FROM library_meta WHERE singleton_id = 1;",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("revision"),
            7
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM library_replication_outbox;",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .expect("outbox"),
            0
        );
        let clear = DeviceGraphLayoutMutationV1::PersonGraphPositionClearV1 {
            entity_id: "person-1".to_owned(),
            schema_version: 1,
        };
        assert!(
            mutate_device_graph_layout_v1(&mut connection, &clear)
                .expect("clear")
                .changed
        );
        assert!(
            !mutate_device_graph_layout_v1(&mut connection, &clear)
                .expect("clear retry")
                .changed
        );
    }

    #[test]
    fn local_layout_mutation_json_is_closed_and_matches_the_shared_shape() {
        let parsed: DeviceGraphLayoutMutationV1 = serde_json::from_str(
            r#"{"entityId":"person-1","graphX":12.5,"graphY":-8.25,"mutationId":"person_graph_position_set_v1","schemaVersion":1,"updatedAt":42}"#,
        )
        .expect("shared mutation JSON");
        assert_eq!(
            parsed,
            DeviceGraphLayoutMutationV1::PersonGraphPositionSetV1 {
                entity_id: "person-1".to_owned(),
                graph_x: 12.5,
                graph_y: -8.25,
                schema_version: 1,
                updated_at: 42,
            }
        );
        assert!(serde_json::from_str::<DeviceGraphLayoutMutationV1>(
            r#"{"entityId":"person-1","extra":true,"mutationId":"person_graph_position_clear_v1","schemaVersion":1}"#,
        )
        .is_err());
    }
}
