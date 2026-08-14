// Can stock SQLite still open and read a database that Turso wrote an FTS
// index into? And can Turso read a database containing an FTS5 virtual table?
import fs from 'node:fs';
const SCRATCH = process.env.SCRATCH;
const tursoDb = `${SCRATCH}/ftsdb-turso-default-7/db.db`;
const sqliteDb = `${SCRATCH}/ftsdb-sqlite-unicode61-7/db.db`;
const out = {};

// ---- stock SQLite reading Turso's file -------------------------------------
{
  const copy = `${SCRATCH}/crossread-turso-copy.db`;
  fs.copyFileSync(tursoDb, copy);
  const o = { file: tursoDb, sizeMB: +(fs.statSync(tursoDb).size / 1048576).toFixed(1) };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(copy, { readOnly: true });
    o.opened = true;
    o.schema = db.prepare("SELECT type, name FROM sqlite_master ORDER BY type, name").all()
      .map(r => `${r.type}:${r.name}`);
    o.rowCount = Number(db.prepare('SELECT COUNT(*) c FROM items').all()[0].c);
    o.sampleRow = db.prepare('SELECT id, publishedAt, length(body) len FROM items ORDER BY publishedAt DESC LIMIT 1').all()[0];
    o.integrityCheck = db.prepare('PRAGMA integrity_check').all().slice(0, 3);
    try {
      o.ftsQueryFromSqlite = db.prepare("SELECT COUNT(*) c FROM items WHERE fts_match(body,'climate')").all();
    } catch (e) { o.ftsQueryFromSqlite = `ERR: ${e.message}`; }
    try {
      o.indexedRangeScan = Number(db.prepare("SELECT COUNT(*) c FROM items WHERE body LIKE '%climate%'").all()[0].c);
    } catch (e) { o.indexedRangeScan = `ERR: ${e.message}`; }
    db.close();
  } catch (e) {
    o.opened = false;
    o.error = `${e.constructor?.name}: ${e.message}`;
  }
  out.stockSqlite_reading_tursoFile = o;
  fs.rmSync(copy, { force: true });
}

// ---- Turso reading a stock SQLite FTS5 file --------------------------------
{
  const copy = `${SCRATCH}/crossread-sqlite-copy.db`;
  fs.copyFileSync(sqliteDb, copy);
  const o = { file: sqliteDb, sizeMB: +(fs.statSync(sqliteDb).size / 1048576).toFixed(1) };
  try {
    const { connect } = await import('@tursodatabase/database');
    const db = await connect(copy, { experimental: ['index_method'] });
    o.opened = true;
    o.rowCount = Number((await db.prepare('SELECT COUNT(*) c FROM items').all([]))[0].c);
    o.sampleRow = (await db.prepare('SELECT id, publishedAt, length(body) len FROM items ORDER BY publishedAt DESC LIMIT 1').all([]))[0];
    try {
      o.fts5QueryFromTurso = await db.prepare("SELECT COUNT(*) c FROM items_fts WHERE items_fts MATCH 'climate'").all([]);
    } catch (e) { o.fts5QueryFromTurso = `ERR: ${e.message}`; }
    try {
      o.canReadFts5Shadow = Number((await db.prepare('SELECT COUNT(*) c FROM items_fts_data').all([]))[0].c);
    } catch (e) { o.canReadFts5Shadow = `ERR: ${e.message}`; }
    db.close?.();
  } catch (e) {
    o.opened = false;
    o.error = `${e.constructor?.name}: ${e.message}`;
  }
  out.turso_reading_sqliteFts5File = o;
  fs.rmSync(copy, { force: true });
}

console.log(JSON.stringify(out, null, 1));
