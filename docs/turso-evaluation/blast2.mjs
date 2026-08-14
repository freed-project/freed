// Follow-up: is index maintenance *entirely* disabled when an fts5 vtab is in the
// file, or is it an edge case? And does the damage spread into the fts5 shadow btrees?
import fs from 'node:fs';
const SCRATCH = process.env.SCRATCH;
const { connect } = await import('@tursodatabase/database');
const { DatabaseSync } = await import('node:sqlite');
const out = {};

const p = `${SCRATCH}/blast2.db`;
for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
const s = new DatabaseSync(p);
s.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE items(id INTEGER PRIMARY KEY, tag TEXT, n INTEGER);
  CREATE INDEX idx_tag ON items(tag);
  CREATE INDEX idx_n ON items(n);
  CREATE VIRTUAL TABLE docs USING fts5(body);
  INSERT INTO docs(body) VALUES('unrelated corpus about climate policy');`);
for (let i = 1; i <= 100; i++) s.prepare('INSERT INTO items VALUES(?,?,?)').run(i, `t${i}`, i);
s.exec('PRAGMA wal_checkpoint(TRUNCATE)');
out.sqliteSeeded = s.prepare('SELECT COUNT(*) c FROM items').all()[0].c;
out.seedIntegrity = s.prepare('PRAGMA integrity_check').all().map(x => x.integrity_check).slice(0, 3);
s.close();

// Turso: 500 inserts, 100 updates, 50 deletes
const t = await connect(p, { experimental: ['index_method'] });
const ins = t.prepare('INSERT INTO items VALUES(?,?,?)');
await t.exec('BEGIN');
for (let i = 101; i <= 600; i++) await ins.run([i, `t${i}`, i]);
await t.exec('COMMIT');
const upd = t.prepare('UPDATE items SET tag=? WHERE id=?');
await t.exec('BEGIN');
for (let i = 1; i <= 100; i++) await upd.run([`u${i}`, i]);
await t.exec('COMMIT');
const del = t.prepare('DELETE FROM items WHERE id=?');
await t.exec('BEGIN');
for (let i = 201; i <= 250; i++) await del.run([i]);
await t.exec('COMMIT');
out.tursoCount = (await t.prepare('SELECT COUNT(*) c FROM items').all([]))[0].c;
try { out.tursoIntegrity = JSON.stringify((await t.prepare('PRAGMA integrity_check').all([])).slice(0, 3)); }
catch (e) { out.tursoIntegrity = 'ERR ' + e.message.slice(0, 80); }
await t.exec('PRAGMA wal_checkpoint(TRUNCATE)');
t.close?.();

const s2 = new DatabaseSync(p);
const one = sql => { try { return s2.prepare(sql).all(); } catch (e) { return 'ERR ' + e.message.slice(0, 90); } };
out.sqlite_tableScanCount = one('SELECT COUNT(*) c FROM (SELECT id FROM items NOT INDEXED)');
out.sqlite_viaIdxTagCount = one("SELECT COUNT(*) c FROM items INDEXED BY idx_tag WHERE tag > ''");
out.sqlite_viaIdxNCount = one('SELECT COUNT(*) c FROM items INDEXED BY idx_n WHERE n > 0');
out.sqlite_updatedRowVisibleViaIndex = one("SELECT COUNT(*) c FROM items INDEXED BY idx_tag WHERE tag LIKE 'u%'");
out.sqlite_staleTagStillIndexed = one("SELECT COUNT(*) c FROM items INDEXED BY idx_tag WHERE tag LIKE 't%' AND id<=100");
out.integrity = one('PRAGMA integrity_check');
if (Array.isArray(out.integrity)) out.integrity = out.integrity.map(x => x.integrity_check).slice(0, 8);
// did Turso scribble into the fts5 shadow btrees?
out.fts5_query = one("SELECT rowid FROM docs WHERE docs MATCH 'climate'");
try { s2.prepare("INSERT INTO docs(docs) VALUES('integrity-check')").all(); out.fts5_integrity = 'PASSED'; }
catch (e) { out.fts5_integrity = 'FAILED: ' + e.message.slice(0, 90); }
s2.close();

console.log(JSON.stringify(out, null, 1));
