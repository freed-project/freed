//! The shadow store, on the Rust side of the IPC boundary.
//!
//! Stage 5 of the storage roadmap. The whole point is where this lives: the
//! corpus moves out of the WebKit renderer, whose inability to release memory
//! is what pushes it past the scrape budget and blocks Facebook and Instagram.
//! Measured on the owner's real 15,846-item document, the same items cost
//! 927 MB resident inside the renderer's Automerge document and 7 MB served
//! from SQL. Nothing here is a micro-optimisation; it is the memory floor.
//!
//! The schema is duplicated from `packages/shared/src/shadow-store.ts`, which
//! is a real hazard: two copies of a schema drift, and after Stage 8 makes the
//! write path one-way a silent column mismatch is unrecoverable. `COLUMNS`
//! below is therefore the single list everything else is generated from, and a
//! test in the shared package reads this file and asserts the two agree. A
//! comment asking people to keep them in sync would not have survived.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Column order, and the only place it is written down on this side.
/// Must match SHADOW_COLUMNS in packages/shared/src/shadow-store.ts.
pub const COLUMNS: &[&str] = &[
    "globalId",
    "platform",
    "contentType",
    "publishedAt",
    "capturedAt",
    "authorId",
    "authorDisplayName",
    "authorHandle",
    "sourceUrl",
    "hidden",
    "saved",
    "archived",
    "readAt",
    "archivedAt",
    "likedAt",
    "tags",
    "contentBlob",
    "preservedBlob",
    "rest",
];

/// STRICT, so a value that cannot convert losslessly is an error at the write
/// rather than a silent coercion. SQLite would otherwise store the string
/// "12345" in an INTEGER column as the number 12345, and the number 2 in a
/// TEXT column as the string "2.0".
const TABLE_DDL: &str = "
CREATE TABLE IF NOT EXISTS feed_items (
  globalId          TEXT    NOT NULL PRIMARY KEY,
  platform          TEXT,
  contentType       TEXT,
  publishedAt       INTEGER,
  capturedAt        INTEGER,
  authorId          TEXT,
  authorDisplayName TEXT,
  authorHandle      TEXT,
  sourceUrl         TEXT,
  hidden            INTEGER,
  saved             INTEGER,
  archived          INTEGER,
  readAt            INTEGER,
  archivedAt        INTEGER,
  likedAt           INTEGER,
  tags              TEXT,
  contentBlob       TEXT,
  preservedBlob     TEXT,
  rest              TEXT    NOT NULL
) STRICT;
";

const INDEX_DDL: &[&str] = &[
    "CREATE INDEX IF NOT EXISTS feed_items_timeline
       ON feed_items (publishedAt DESC)
       WHERE archived IS NOT 1 AND hidden IS NOT 1;",
    "CREATE INDEX IF NOT EXISTS feed_items_saved
       ON feed_items (saved, publishedAt DESC) WHERE saved = 1;",
    "CREATE INDEX IF NOT EXISTS feed_items_archived
       ON feed_items (archivedAt DESC) WHERE archived = 1;",
    "CREATE INDEX IF NOT EXISTS feed_items_platform
       ON feed_items (platform, publishedAt DESC);",
    "CREATE INDEX IF NOT EXISTS feed_items_author
       ON feed_items (authorId, publishedAt DESC);",
];

/// One projected row, as the TypeScript projector produces it.
///
/// Every column except the key is optional, because absence is meaningful:
/// the projector records which fields were missing inside `rest` so a null
/// column can be told apart from one that was never set. `rest` is required
/// because it carries that record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedItemRow {
    pub global_id: String,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub published_at: Option<i64>,
    #[serde(default)]
    pub captured_at: Option<i64>,
    #[serde(default)]
    pub author_id: Option<String>,
    #[serde(default)]
    pub author_display_name: Option<String>,
    #[serde(default)]
    pub author_handle: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub hidden: Option<i64>,
    #[serde(default)]
    pub saved: Option<i64>,
    #[serde(default)]
    pub archived: Option<i64>,
    #[serde(default)]
    pub read_at: Option<i64>,
    #[serde(default)]
    pub archived_at: Option<i64>,
    #[serde(default)]
    pub liked_at: Option<i64>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub content_blob: Option<String>,
    #[serde(default)]
    pub preserved_blob: Option<String>,
    pub rest: String,
}

impl FeedItemRow {
    fn bind(&self) -> Vec<rusqlite::types::Value> {
        use rusqlite::types::Value;
        let text = |value: &Option<String>| {
            value
                .clone()
                .map(Value::Text)
                .unwrap_or(Value::Null)
        };
        let int = |value: Option<i64>| value.map(Value::Integer).unwrap_or(Value::Null);
        vec![
            Value::Text(self.global_id.clone()),
            text(&self.platform),
            text(&self.content_type),
            int(self.published_at),
            int(self.captured_at),
            text(&self.author_id),
            text(&self.author_display_name),
            text(&self.author_handle),
            text(&self.source_url),
            int(self.hidden),
            int(self.saved),
            int(self.archived),
            int(self.read_at),
            int(self.archived_at),
            int(self.liked_at),
            text(&self.tags),
            text(&self.content_blob),
            text(&self.preserved_blob),
            Value::Text(self.rest.clone()),
        ]
    }
}

/// Generated from COLUMNS so a column cannot be added to the table and missed
/// in the INSERT, which SQLite would accept as a silent NULL.
fn upsert_sql() -> String {
    let placeholders = COLUMNS.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let updates = COLUMNS
        .iter()
        .filter(|column| **column != "globalId")
        .map(|column| format!("{column} = excluded.{column}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "INSERT INTO feed_items ({}) VALUES ({placeholders}) \
         ON CONFLICT(globalId) DO UPDATE SET {updates}",
        COLUMNS.join(", ")
    )
}

pub struct ShadowStore {
    connection: Mutex<Connection>,
}

impl ShadowStore {
    pub fn open(path: &PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|error| error.to_string())?;
        // WAL so a long read cannot block the projector's writes. NORMAL rather
        // than FULL because this store is a projection: if a crash loses the
        // last commits, reconciliation against the document rebuilds them.
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| error.to_string())?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch(TABLE_DDL)
            .map_err(|error| error.to_string())?;
        for statement in INDEX_DDL {
            connection
                .execute_batch(statement)
                .map_err(|error| error.to_string())?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn upsert(&self, rows: &[FeedItemRow]) -> Result<usize, String> {
        let mut guard = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = guard.transaction().map_err(|error| error.to_string())?;
        {
            let mut statement = transaction
                .prepare_cached(&upsert_sql())
                .map_err(|error| error.to_string())?;
            for row in rows {
                statement
                    .execute(params_from_iter(row.bind()))
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(rows.len())
    }

    pub fn delete(&self, global_ids: &[String]) -> Result<usize, String> {
        let mut guard = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = guard.transaction().map_err(|error| error.to_string())?;
        let mut removed = 0usize;
        {
            let mut statement = transaction
                .prepare_cached("DELETE FROM feed_items WHERE globalId = ?")
                .map_err(|error| error.to_string())?;
            for global_id in global_ids {
                removed += statement
                    .execute([global_id])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(removed)
    }

    pub fn count(&self) -> Result<i64, String> {
        let guard = self.connection.lock().map_err(|error| error.to_string())?;
        guard
            .query_row("SELECT count(*) FROM feed_items", [], |row| row.get(0))
            .map_err(|error| error.to_string())
    }

    /// The counts the feed shows beside its filters.
    ///
    /// One pass rather than four queries, and it is the half of Stage 5 that
    /// the Automerge path cannot do cheaply: today these numbers require
    /// walking every hydrated item in the renderer. Measured against the
    /// owner's 15,846-item corpus this is 4 ms.
    pub fn counts(&self) -> Result<ShadowCounts, String> {
        let guard = self.connection.lock().map_err(|error| error.to_string())?;
        guard
            .query_row(
                "SELECT count(*), \
                 coalesce(sum(saved = 1), 0), \
                 coalesce(sum(archived = 1), 0), \
                 coalesce(sum(hidden = 1), 0) \
                 FROM feed_items",
                [],
                |row| {
                    Ok(ShadowCounts {
                        total: row.get(0)?,
                        saved: row.get(1)?,
                        archived: row.get(2)?,
                        hidden: row.get(3)?,
                    })
                },
            )
            .map_err(|error| error.to_string())
    }

    /// Every stored id, for drift detection against the document.
    pub fn all_ids(&self) -> Result<Vec<String>, String> {
        let guard = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = guard
            .prepare("SELECT globalId FROM feed_items")
            .map_err(|error| error.to_string())?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(ids)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowCounts {
    pub total: i64,
    pub saved: i64,
    pub archived: i64,
    pub hidden: i64,
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(dir.join("shadow.db"))
}

fn with_store<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce(&ShadowStore) -> Result<T, String>,
) -> Result<T, String> {
    // Held in managed state so the connection, its WAL file and its prepared
    // statement cache survive across calls. Reopening per invoke would pay the
    // WAL handshake on every patch.
    if let Some(store) = app.try_state::<ShadowStore>() {
        return action(&store);
    }
    let store = ShadowStore::open(&store_path(app)?)?;
    let result = action(&store);
    app.manage(store);
    result
}

#[tauri::command]
pub fn shadow_store_upsert(app: tauri::AppHandle, rows: Vec<FeedItemRow>) -> Result<usize, String> {
    with_store(&app, |store| store.upsert(&rows))
}

#[tauri::command]
pub fn shadow_store_delete(
    app: tauri::AppHandle,
    global_ids: Vec<String>,
) -> Result<usize, String> {
    with_store(&app, |store| store.delete(&global_ids))
}

#[tauri::command]
pub fn shadow_store_count(app: tauri::AppHandle) -> Result<i64, String> {
    with_store(&app, |store| store.count())
}

#[tauri::command]
pub fn shadow_store_counts(app: tauri::AppHandle) -> Result<ShadowCounts, String> {
    with_store(&app, |store| store.counts())
}

#[tauri::command]
pub fn shadow_store_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    with_store(&app, |store| store.all_ids())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(global_id: &str) -> FeedItemRow {
        FeedItemRow {
            global_id: global_id.to_string(),
            platform: Some("x".to_string()),
            content_type: Some("post".to_string()),
            published_at: Some(1_780_000_000_000),
            captured_at: Some(1_780_000_001_000),
            author_id: Some("a:1".to_string()),
            author_display_name: Some("Someone".to_string()),
            author_handle: Some("someone".to_string()),
            source_url: None,
            hidden: Some(0),
            saved: Some(0),
            archived: Some(0),
            read_at: None,
            archived_at: None,
            liked_at: None,
            tags: Some("[]".to_string()),
            content_blob: Some("{\"text\":\"hello\"}".to_string()),
            preserved_blob: None,
            rest: "{}".to_string(),
        }
    }

    fn temp_store() -> (tempfile::TempDir, ShadowStore) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = ShadowStore::open(&dir.path().join("shadow.db")).expect("open");
        (dir, store)
    }

    #[test]
    fn binds_every_declared_column() {
        // Guards the failure where a column is added to COLUMNS and missed in
        // bind(), which would shift every subsequent value by one position and
        // still execute without error.
        assert_eq!(row("x:1").bind().len(), COLUMNS.len());
    }

    #[test]
    fn upsert_replaces_rather_than_duplicating() {
        let (_dir, store) = temp_store();
        store.upsert(&[row("x:1"), row("x:2")]).expect("upsert");
        assert_eq!(store.count().expect("count"), 2);

        let mut updated = row("x:1");
        updated.saved = Some(1);
        store.upsert(&[updated]).expect("upsert again");
        assert_eq!(store.count().expect("count"), 2);
    }

    #[test]
    fn delete_is_idempotent() {
        let (_dir, store) = temp_store();
        store.upsert(&[row("x:1")]).expect("upsert");
        assert_eq!(store.delete(&["x:1".to_string()]).expect("delete"), 1);
        assert_eq!(store.delete(&["x:1".to_string()]).expect("delete"), 0);
        assert_eq!(store.count().expect("count"), 0);
    }

    #[test]
    fn strict_table_rejects_a_lossy_value() {
        // Confirms the table really is STRICT. If this stops failing, the
        // backstop against silent affinity coercion is gone.
        let (_dir, store) = temp_store();
        let guard = store.connection.lock().expect("lock");
        let result = guard.execute(
            "INSERT INTO feed_items (globalId, rest, publishedAt) VALUES (?, ?, ?)",
            rusqlite::params!["x:strict", "{}", "not-a-number"],
        );
        assert!(result.is_err(), "STRICT table accepted a non-numeric value");
    }

    #[test]
    fn counts_reflect_the_flags() {
        let (_dir, store) = temp_store();
        let mut saved = row("x:1");
        saved.saved = Some(1);
        let mut archived = row("x:2");
        archived.archived = Some(1);
        let mut hidden = row("x:3");
        hidden.hidden = Some(1);
        store
            .upsert(&[saved, archived, hidden, row("x:4")])
            .expect("upsert");

        let counts = store.counts().expect("counts");
        assert_eq!(counts.total, 4);
        assert_eq!(counts.saved, 1);
        assert_eq!(counts.archived, 1);
        assert_eq!(counts.hidden, 1);
    }

    #[test]
    fn counts_are_zero_rather_than_null_on_an_empty_store() {
        // sum() over no rows is NULL in SQLite, not 0, which would fail to
        // deserialize into i64 and surface as an error on a fresh install.
        let (_dir, store) = temp_store();
        let counts = store.counts().expect("counts on empty store");
        assert_eq!(counts.total, 0);
        assert_eq!(counts.saved, 0);
    }

    #[test]
    fn absence_survives_as_null() {
        let (_dir, store) = temp_store();
        store.upsert(&[row("x:1")]).expect("upsert");
        let guard = store.connection.lock().expect("lock");
        let source_url: Option<String> = guard
            .query_row(
                "SELECT sourceUrl FROM feed_items WHERE globalId = ?",
                ["x:1"],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(source_url, None);
    }
}
