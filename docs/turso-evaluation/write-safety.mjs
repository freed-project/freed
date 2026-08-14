// Careful verification: what happens when Turso writes to a base table that
// carries FTS5 triggers (the "roll back to a previous SQLite schema" case)?
import fs from 'node:fs';
const SCRATCH = process.env.SCRATCH;
const { connect } = await import('@tursodatabase/database');
const { DatabaseSync } = await import('node:sqlite');
const out = {};

const p = `${SCRATCH}/ws.db`;
for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });

// Build with stock SQLite: base table + external-content FTS5 + sync triggers
const s = new DatabaseSync(p);
s.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE items(id TEXT PRIMARY KEY, body TEXT);
  INSERT INTO items VALUES('a','climate change is real');
  INSERT INTO items VALUES('b','pottery and ceramics');
  CREATE VIRTUAL TABLE items_fts USING fts5(body, content='items', content_rowid='rowid');
  INSERT INTO items_fts(items_fts) VALUES('rebuild');
  CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, body) VALUES (new.rowid, new.body); END;`);
s.exec('PRAGMA wal_checkpoint(TRUNCATE)');
out.before_baseRows = s.prepare('SELECT id FROM items ORDER BY id').all().map(r => r.id);
s.close();

// Now write through Turso
const t = await connect(p, { experimental: ['index_method'] });
try {
  await t.exec("INSERT INTO items VALUES('c','a new climate document')");
  out.turso_insert = 'reported SUCCESS (no exception)';
} catch (e) { out.turso_insert = `threw: ${e.message}`; }

// read back FROM TURSO, in the same connection, before any checkpoint
out.turso_readback_sameConn = (await t.prepare('SELECT id FROM items ORDER BY id').all([])).map(r => r.id);
await t.exec('PRAGMA wal_checkpoint(TRUNCATE)');
out.turso_readback_afterCheckpoint = (await t.prepare('SELECT id FROM items ORDER BY id').all([])).map(r => r.id);
t.close?.();

// reopen in Turso fresh
const t2 = await connect(p, { experimental: ['index_method'] });
out.turso_readback_freshConn = (await t2.prepare('SELECT id FROM items ORDER BY id').all([])).map(r => r.id);
t2.close?.();

// reopen in stock SQLite
const s2 = new DatabaseSync(p);
out.sqlite_readback = s2.prepare('SELECT id FROM items ORDER BY id').all().map(r => r.id);
out.sqlite_ftsHits = s2.prepare("SELECT rowid FROM items_fts WHERE items_fts MATCH 'climate'").all().map(r => Number(r.rowid));
try {
  s2.prepare("INSERT INTO items_fts(items_fts) VALUES('integrity-check')").all();
  out.sqlite_fts5_integrityCheck = 'PASSED';
} catch (e) { out.sqlite_fts5_integrityCheck = `FAILED: ${e.message}`; }
out.sqlite_integrity = s2.prepare('PRAGMA integrity_check').all().slice(0, 2);
s2.close();

// ---- control: same insert with NO fts5 triggers present --------------------
const p2 = `${SCRATCH}/ws2.db`;
for (const x of ['', '-wal', '-shm']) fs.rmSync(p2 + x, { force: true });
const s3 = new DatabaseSync(p2);
s3.exec(`PRAGMA journal_mode=WAL; CREATE TABLE items(id TEXT PRIMARY KEY, body TEXT);
  INSERT INTO items VALUES('a','x'); INSERT INTO items VALUES('b','y');`);
s3.exec('PRAGMA wal_checkpoint(TRUNCATE)'); s3.close();
const t3 = await connect(p2, { experimental: ['index_method'] });
try { await t3.exec("INSERT INTO items VALUES('c','z')"); out.control_turso_insert = 'SUCCESS'; }
catch (e) { out.control_turso_insert = `threw: ${e.message}`; }
await t3.exec('PRAGMA wal_checkpoint(TRUNCATE)'); t3.close?.();
const s4 = new DatabaseSync(p2);
out.control_sqlite_readback = s4.prepare('SELECT id FROM items ORDER BY id').all().map(r => r.id);
s4.close();

console.log(JSON.stringify(out, null, 1));
