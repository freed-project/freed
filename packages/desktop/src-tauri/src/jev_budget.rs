//! Device-local conservative reservations, never provider billing evidence or Library state.
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
pub const MAX_REQUEST_NANO_USD: i64 = 2_752_512; // Conservative interpretation of published64k input tokens × $0.042/M; output free.
const ERROR: &str =
    "Jev spending history is unavailable. Requests are blocked; preserve the ledger.";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub daily_nano_usd: i64,
    pub monthly_nano_usd: i64,
    pub total_nano_usd: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub limits: Limits,
    pub daily_reserved_nano_usd: i64,
    pub monthly_reserved_nano_usd: i64,
    pub total_reserved_nano_usd: i64,
}
fn now() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|n| n.as_secs() as i64)
        .map_err(|_| ERROR.into())
}
fn open(root: &Path, initialize: bool) -> Result<Connection, String> {
    if std::fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(ERROR.into());
    }
    let file = root.join("ledger.sqlite");
    let marker = root.join("history-established");
    if !file.exists() && (marker.exists() || !initialize) {
        return Err(ERROR.into());
    }
    if initialize && !root.exists() {
        std::fs::create_dir_all(root).map_err(|_| ERROR)?;
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_NOFOLLOW
        | if initialize {
            OpenFlags::SQLITE_OPEN_CREATE
        } else {
            OpenFlags::empty()
        };
    let db = Connection::open_with_flags(
        root.canonicalize()
            .map_err(|_| ERROR)?
            .join("ledger.sqlite"),
        flags,
    )
    .map_err(|_| ERROR)?;
    db.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| ERROR)?;
    db.execute_batch("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;")
        .map_err(|_| ERROR)?;
    if initialize && !marker.exists() {
        db.execute_batch("CREATE TABLE IF NOT EXISTS limits (id INTEGER PRIMARY KEY CHECK(id=1),daily INTEGER NOT NULL,monthly INTEGER NOT NULL,total INTEGER,last_time INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY,day TEXT NOT NULL,month TEXT NOT NULL,cost INTEGER NOT NULL CHECK(cost>0));").map_err(|_| ERROR)?;
        // Sentinel prevents ordinary file loss from silently establishing new zero history.
        if !marker.exists() {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(marker)
                .and_then(|f| f.sync_all())
                .map_err(|_| ERROR)?;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| ERROR)?;
        for name in ["ledger.sqlite", "history-established"] {
            if root.join(name).exists() {
                std::fs::set_permissions(root.join(name), std::fs::Permissions::from_mode(0o600))
                    .map_err(|_| ERROR)?;
            }
        }
    }
    Ok(db)
}
pub fn configure(root: &Path, limits: Limits) -> Result<Status, String> {
    if limits.daily_nano_usd <= 0
        || limits.monthly_nano_usd <= 0
        || limits.total_nano_usd.is_some_and(|n| n <= 0)
        || limits.daily_nano_usd > 1_000_000_000_000
        || limits.monthly_nano_usd > 1_000_000_000_000
        || limits.total_nano_usd.is_some_and(|n| n > 1_000_000_000_000)
    {
        return Err("Enter positive Jev limits up to $1,000.".into());
    }
    let db = open(root, true)?;
    let time = now()?;
    db.execute("INSERT INTO limits VALUES(1,?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET daily=excluded.daily,monthly=excluded.monthly,total=excluded.total",params![limits.daily_nano_usd,limits.monthly_nano_usd,limits.total_nano_usd,time]).map_err(|_| ERROR)?;
    status_at(&db, time)
}
fn status_at(db: &Connection, time: i64) -> Result<Status, String> {
    let (limits, last): (Limits, i64) = db
        .query_row(
            "SELECT daily,monthly,total,last_time FROM limits WHERE id=1",
            [],
            |r| {
                Ok((
                    Limits {
                        daily_nano_usd: r.get(0)?,
                        monthly_nano_usd: r.get(1)?,
                        total_nano_usd: r.get(2)?,
                    },
                    r.get(3)?,
                ))
            },
        )
        .map_err(|_| "Save Jev spending limits before making a request.")?;
    if time < last {
        return Err("Device clock moved backwards. Jev is blocked until time catches up.".into());
    }
    let (day, month): (String, String) = db
        .query_row(
            "SELECT strftime('%Y-%m-%d',?1,'unixepoch'),strftime('%Y-%m',?1,'unixepoch')",
            [time],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| ERROR)?;
    let sums:(i64,i64,i64)=db.query_row("SELECT coalesce(sum(CASE WHEN day=?1 THEN cost ELSE 0 END),0),coalesce(sum(CASE WHEN month=?2 THEN cost ELSE 0 END),0),coalesce(sum(cost),0) FROM reservations",params![day,month],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|ERROR)?;
    Ok(Status {
        limits,
        daily_reserved_nano_usd: sums.0,
        monthly_reserved_nano_usd: sums.1,
        total_reserved_nano_usd: sums.2,
    })
}
pub fn status(root: &Path) -> Result<Option<Status>, String> {
    if !root.join("ledger.sqlite").exists() && !root.join("history-established").exists() {
        return Ok(None);
    }
    status_at(&open(root, false)?, now()?).map(Some)
}
pub fn reserve(root: &Path, id: &str) -> Result<(), String> {
    reserve_at(root, id, now()?)
}
fn reserve_at(root: &Path, id: &str, time: i64) -> Result<(), String> {
    let mut db = open(root, false)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ERROR)?;
    let status = status_at(&tx, time)?;
    if status
        .daily_reserved_nano_usd
        .checked_add(MAX_REQUEST_NANO_USD)
        .is_none_or(|n| n > status.limits.daily_nano_usd)
        || status
            .monthly_reserved_nano_usd
            .checked_add(MAX_REQUEST_NANO_USD)
            .is_none_or(|n| n > status.limits.monthly_nano_usd)
        || status.limits.total_nano_usd.is_some_and(|limit| {
            status
                .total_reserved_nano_usd
                .checked_add(MAX_REQUEST_NANO_USD)
                .is_none_or(|n| n > limit)
        })
    {
        return Err(
            "Jev spending limit reached. Use local GLiClass when available, or adjust your limits in AI settings."
                .into(),
        );
    }
    let count: i64 = tx
        .query_row("SELECT count(*) FROM reservations", [], |r| r.get(0))
        .map_err(|_| ERROR)?;
    if count >= 100_000 {
        return Err(
            "Jev reservation history is full. Requests are blocked; preserve the ledger.".into(),
        );
    }
    let duplicate: Option<i64> = tx
        .query_row("SELECT 1 FROM reservations WHERE id=?1", [id], |r| r.get(0))
        .optional()
        .map_err(|_| ERROR)?;
    if duplicate.is_some() {
        return Err("This Jev request was already reserved. It will not be sent again.".into());
    }
    tx.execute("INSERT INTO reservations SELECT ?1,strftime('%Y-%m-%d',?2,'unixepoch'),strftime('%Y-%m',?2,'unixepoch'),?3",params![id,time,MAX_REQUEST_NANO_USD]).map_err(|_|ERROR)?;
    tx.execute("UPDATE limits SET last_time=?1 WHERE id=1", [time])
        .map_err(|_| ERROR)?;
    tx.commit().map_err(|_| ERROR.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        // Wall-clock nanoseconds are not unique on every supported host. Reserve
        // the directory atomically so parallel tests cannot share spending history.
        let p = tempfile::Builder::new()
            .prefix("freed-budget-")
            .tempdir()
            .unwrap()
            .keep();
        configure(
            &p,
            Limits {
                daily_nano_usd: MAX_REQUEST_NANO_USD,
                monthly_nano_usd: MAX_REQUEST_NANO_USD * 2,
                total_nano_usd: Some(MAX_REQUEST_NANO_USD * 2),
            },
        )
        .unwrap();
        p
    }
    #[test]
    fn concurrent_fixtures_have_independent_spending_history() {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
        let handles: Vec<_> = (0..16)
            .map(|_| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let p = fixture();
                    reserve(&p, "same-request-id").unwrap();
                    assert_eq!(
                        status(&p).unwrap().unwrap().total_reserved_nano_usd,
                        MAX_REQUEST_NANO_USD
                    );
                    p
                })
            })
            .collect();
        let paths: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(
            paths.iter().collect::<std::collections::HashSet<_>>().len(),
            16
        );
        for p in paths {
            std::fs::remove_dir_all(p).unwrap();
        }
    }
    #[test]
    fn missing_corrupt_and_lost_history_fail_closed() {
        let p = fixture();
        std::fs::remove_file(p.join("ledger.sqlite")).unwrap();
        assert!(configure(
            &p,
            Limits {
                daily_nano_usd: 1,
                monthly_nano_usd: 1,
                total_nano_usd: None
            }
        )
        .is_err());
        assert!(reserve(&p, "x").is_err());
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn concurrent_requests_cannot_overrun_and_restart_preserves_spend() {
        let p = fixture();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let p = p.clone();
                std::thread::spawn(move || reserve(&p, &format!("request-{i}")))
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .filter(Result::is_ok)
                .count(),
            1
        );
        assert_eq!(
            status(&p).unwrap().unwrap().daily_reserved_nano_usd,
            MAX_REQUEST_NANO_USD
        );
        assert!(reserve(&p, "later").is_err());
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn retries_failed_outcomes_and_limit_changes_never_refund() {
        let p = fixture();
        reserve(&p, "network-cancelled").unwrap();
        assert!(reserve(&p, "network-cancelled").is_err());
        configure(
            &p,
            Limits {
                daily_nano_usd: MAX_REQUEST_NANO_USD * 3,
                monthly_nano_usd: MAX_REQUEST_NANO_USD * 3,
                total_nano_usd: None,
            },
        )
        .unwrap();
        assert_eq!(
            status(&p).unwrap().unwrap().total_reserved_nano_usd,
            MAX_REQUEST_NANO_USD
        );
        assert!(reserve(&p, "network-cancelled").is_err());
        reserve(&p, "explicit-new-attempt").unwrap();
        assert_eq!(
            status(&p).unwrap().unwrap().total_reserved_nano_usd,
            MAX_REQUEST_NANO_USD * 2
        );
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_existing_database_is_not_reinitialized() {
        let p = fixture();
        std::fs::write(p.join("ledger.sqlite"), b"corrupt").unwrap();
        assert!(status(&p).is_err());
        assert!(reserve(&p, "x").is_err());
        assert!(configure(
            &p,
            Limits {
                daily_nano_usd: 1,
                monthly_nano_usd: 1,
                total_nano_usd: None
            }
        )
        .is_err());
        assert_eq!(std::fs::read(p.join("ledger.sqlite")).unwrap(), b"corrupt");
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn unconfigured_and_distinct_profiles_are_independent() {
        let p = fixture();
        let other = p.with_extension("fresh-preview");
        assert!(status(&other).unwrap().is_none());
        assert!(reserve(&other, "x").is_err());
        reserve(&p, "x").unwrap();
        assert!(status(&other).unwrap().is_none());
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn utc_rollover_month_and_lifetime_are_independent() {
        let p = fixture();
        let db = open(&p, false).unwrap();
        db.execute("UPDATE limits SET last_time=0", []).unwrap();
        drop(db);
        reserve_at(&p, "jan", 1738367999).unwrap();
        assert!(reserve_at(&p, "same-day", 1738367999).is_err());
        reserve_at(&p, "feb", 1738368000).unwrap();
        assert!(reserve_at(&p, "march", 1740787200).is_err());
        assert!(reserve_at(&p, "backwards", 1738367999).is_err());
        std::fs::remove_dir_all(p).unwrap();
    }
}
