// Where exactly is the boundary?
//  (a) Turso's OWN fts index on table B + a plain secondary index on table A:
//      does Turso maintain A's index? (this is the "Turso-only hybrid" shape)
//  (b) is it fts5 specifically, or ANY virtual table Turso can't model? (rtree/fts4)
//  (c) does creation order of the vtab matter?
import fs from 'node:fs';
const SCRATCH = process.env.SCRATCH;
const { connect } = await import('@tursodatabase/database');
const { DatabaseSync } = await import('node:sqlite');
const out = {};

// ---------- (a) Turso-only file: fts index on B, secondary index on A ----------
{
  const p = `${SCRATCH}/b3-tursoonly.db`;
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
  const t = await connect(p, { experimental: ['index_method'] });
  await t.exec('PRAGMA journal_mode=WAL');
  await t.exec('CREATE TABLE a(id INTEGER PRIMARY KEY, tag TEXT)');
  await t.exec('CREATE INDEX idx_a_tag ON a(tag)');
  await t.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, body TEXT)');
  await t.exec('CREATE INDEX b_fts ON b USING fts (body)');
  const ia = t.prepare('INSERT INTO a VALUES(?,?)');
  const ib = t.prepare('INSERT INTO b VALUES(?,?)');
  await t.exec('BEGIN');
  for (let i = 1; i <= 300; i++) { await ia.run([i, `tag${i}`]); await ib.run([i, `doc ${i} climate policy`]); }
  await t.exec('COMMIT');
  await t.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const cnt = (await t.prepare('SELECT COUNT(*) c FROM a').all([]))[0].c;
  const viaIdx = (await t.prepare("SELECT COUNT(*) c FROM a WHERE tag='tag7'").all([]))[0].c;
  t.close?.();
  const s = new DatabaseSync(p, { readOnly: true });
  const r = { tursoCount: cnt, tursoPkTagProbe: viaIdx };
  try { r.sqliteScan = s.prepare('SELECT COUNT(*) c FROM a NOT INDEXED').all()[0].c; } catch (e) { r.sqliteScan = 'ERR ' + e.message.slice(0, 80); }
  try { r.sqliteViaIdx = s.prepare("SELECT COUNT(*) c FROM a INDEXED BY idx_a_tag WHERE tag > ''").all()[0].c; } catch (e) { r.sqliteViaIdx = 'ERR ' + e.message.slice(0, 80); }
  try { r.sqliteIntegrity = s.prepare('PRAGMA integrity_check').all().map(x => x.integrity_check).slice(0, 5); } catch (e) { r.sqliteIntegrity = 'ERR ' + e.message.slice(0, 80); }
  try { r.sqliteSeesB = s.prepare("SELECT COUNT(*) c FROM b NOT INDEXED").all()[0].c; } catch (e) { r.sqliteSeesB = 'ERR ' + e.message.slice(0, 80); }
  s.close();
  out.tursoOnly_ftsOnOtherTable = r;
}

// ---------- (b) which vtab modules trip it, and (c) ordering ----------
async function vtabScenario(name, vtabSql, orderFirst) {
  const p = `${SCRATCH}/b3-${name}.db`;
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
  const r = { scenario: name };
  const s = new DatabaseSync(p);
  try {
    s.exec('PRAGMA journal_mode=WAL');
    if (orderFirst) s.exec(vtabSql);
    s.exec(`CREATE TABLE items(id INTEGER PRIMARY KEY, tag TEXT);
            CREATE INDEX idx_tag ON items(tag);
            INSERT INTO items VALUES(1,'x'),(2,'y');`);
    if (!orderFirst) s.exec(vtabSql);
    s.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) { s.close(); return { scenario: name, setup: 'UNAVAILABLE: ' + e.message.slice(0, 70) }; }
  s.close();
  const t = await connect(p, { experimental: ['index_method'] });
  try { await t.exec("INSERT INTO items VALUES(3,'z')"); r.tursoInsert = 'SUCCESS'; }
  catch (e) { r.tursoInsert = 'threw: ' + e.message.slice(0, 70); }
  await t.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  t.close?.();
  const s2 = new DatabaseSync(p);
  r.viaIndex = JSON.stringify(s2.prepare("SELECT id FROM items INDEXED BY idx_tag WHERE tag='z'").all());
  r.integrity = s2.prepare('PRAGMA integrity_check').all().map(x => x.integrity_check).slice(0, 2);
  s2.close();
  return r;
}

const vt = [];
vt.push(await vtabScenario('none', 'SELECT 1', false));
vt.push(await vtabScenario('fts5-after', "CREATE VIRTUAL TABLE d USING fts5(body); INSERT INTO d(body) VALUES('t');", false));
vt.push(await vtabScenario('fts5-before', "CREATE VIRTUAL TABLE d USING fts5(body); INSERT INTO d(body) VALUES('t');", true));
vt.push(await vtabScenario('fts4-after', "CREATE VIRTUAL TABLE d USING fts4(body);", false));
vt.push(await vtabScenario('rtree-after', "CREATE VIRTUAL TABLE d USING rtree(id, minx, maxx);", false));
out.vtabMatrix = vt;

console.log(JSON.stringify(out, null, 1));
