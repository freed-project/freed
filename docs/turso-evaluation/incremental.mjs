// Incremental FTS maintenance: build an index over 6 copies of the corpus, then
// ingest the 7th copy in batches (as a scraper would) and time each batch.
// SQLite external-content FTS5 needs triggers to stay in sync; Turso's index
// method claims to maintain itself. Both paths are exercised here.
// usage: node incremental.mjs <sqlite|turso>
import fs from 'node:fs';
import path from 'node:path';

const SCRATCH = process.env.SCRATCH;
const ENGINE = process.argv[2];
const BASE_COPIES = 6;
const BATCH = 500;
const mb = b => +(b / 1048576).toFixed(1);
const now = () => Number(process.hrtime.bigint()) / 1e6;

const dir = `${SCRATCH}/inc-${ENGINE}`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const dbPath = `${dir}/db.db`;
const footprint = () => {
  let t = 0;
  const walk = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else t += fs.statSync(f).size; } };
  walk(dir); return t;
};

let exec, all, run, close;
if (ENGINE === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  exec = async s => db.exec(s);
  all = async (sql, a = []) => db.prepare(sql).all(...a);
  run = sql => { const st = db.prepare(sql); return async a => st.run(...a); };
  close = () => db.close();
} else {
  const { connect } = await import('@tursodatabase/database');
  const db = await connect(dbPath, { experimental: ['index_method'] });
  exec = async s => { await db.exec(s); };
  all = async (sql, a = []) => await db.prepare(sql).all(a);
  run = sql => { const st = db.prepare(sql); return async a => await st.run(a); };
  close = () => db.close?.();
}

const out = { engine: ENGINE, baseCopies: BASE_COPIES, batchSize: BATCH };
await exec('PRAGMA journal_mode=WAL');
await exec('CREATE TABLE items(id TEXT PRIMARY KEY, publishedAt INTEGER, platform TEXT, author TEXT, archived INTEGER, saved INTEGER, readAt INTEGER, body TEXT)');

const rows = JSON.parse(fs.readFileSync(`${SCRATCH}/rows.json`, 'utf8'));
const ins = run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?)');

// ---- base corpus -----------------------------------------------------------
await exec('BEGIN');
for (let c = 0; c < BASE_COPIES; c++) {
  for (const r of rows) await ins([c === 0 ? r[0] : `c${c}:${r[0]}`, r[1], r[2], r[3], r[4], r[5], r[6], r[7]]);
}
await exec('COMMIT');
out.baseRows = BASE_COPIES * rows.length;

// ---- index + auto-maintenance ---------------------------------------------
const tI = now();
if (ENGINE === 'sqlite') {
  await exec(`CREATE VIRTUAL TABLE items_fts USING fts5(body, content='items', content_rowid='rowid')`);
  await exec(`INSERT INTO items_fts(items_fts) VALUES('rebuild')`);
  // external-content FTS5 does NOT self-maintain; triggers are the documented pattern
  await exec(`CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, body) VALUES (new.rowid, new.body); END;`);
  await exec(`CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, body) VALUES('delete', old.rowid, old.body); END;`);
  await exec(`CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, body) VALUES('delete', old.rowid, old.body);
      INSERT INTO items_fts(rowid, body) VALUES (new.rowid, new.body); END;`);
} else {
  await exec('CREATE INDEX items_fts ON items USING fts (body)');
}
out.baseIndexBuildMs = Math.round(now() - tI);
await exec('PRAGMA wal_checkpoint(TRUNCATE)');
out.footprintAfterBaseMB = mb(footprint());

const searchTop = async q => {
  const t = now();
  const r = ENGINE === 'sqlite'
    ? await all(`SELECT i.id FROM items_fts JOIN items i ON i.rowid=items_fts.rowid WHERE items_fts MATCH ? ORDER BY rank LIMIT 10`, [q])
    : await all(`SELECT id FROM items WHERE fts_match(body, ?) LIMIT 10`, [q]);
  return [now() - t, r.length];
};
const med = a => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(2); };
const probe = async () => {
  const ts = [];
  for (let i = 0; i < 9; i++) ts.push((await searchTop('climate change'))[0]);
  return med(ts);
};
out.queryP50BeforeIngestMs = await probe();
out.hitsBefore = Number((await all(ENGINE === 'sqlite'
  ? `SELECT COUNT(*) c FROM items_fts WHERE items_fts MATCH 'climate'`
  : `SELECT COUNT(*) c FROM items WHERE fts_match(body,'climate')`))[0].c);

// ---- incremental ingest of copy #6 in batches ------------------------------
const batches = [];
const copy = BASE_COPIES;
const MAX_BATCHES = Number(process.env.MAX_BATCHES || 1e9);
for (let start = 0; start < rows.length && batches.length < MAX_BATCHES; start += BATCH) {
  const slice = rows.slice(start, start + BATCH);
  const t = now();
  await exec('BEGIN');
  for (const r of slice) await ins([`c${copy}:${r[0]}`, r[1], r[2], r[3], r[4], r[5], r[6], r[7]]);
  await exec('COMMIT');
  const dt = now() - t;
  batches.push(dt);
  process.stderr.write(`batch ${batches.length} rows=${slice.length} ${dt.toFixed(0)}ms (${(dt / slice.length).toFixed(2)} ms/row)\n`);
}
out.batchCount = batches.length;
out.ingestTotalMs = Math.round(batches.reduce((a, b) => a + b, 0));
out.ingestPerRowMs = +(out.ingestTotalMs / (batches.length * BATCH)).toFixed(3);
out.batchP50Ms = med(batches);
out.batchMinMs = +Math.min(...batches).toFixed(1);
out.batchMaxMs = +Math.max(...batches).toFixed(1);
out.batchFirst3Ms = batches.slice(0, 3).map(x => +x.toFixed(1));
out.batchLast3Ms = batches.slice(-3).map(x => +x.toFixed(1));

await exec('PRAGMA wal_checkpoint(TRUNCATE)');
out.footprintAfterIngestMB = mb(footprint());
out.queryP50AfterIngestMs = await probe();
out.hitsAfter = Number((await all(ENGINE === 'sqlite'
  ? `SELECT COUNT(*) c FROM items_fts WHERE items_fts MATCH 'climate'`
  : `SELECT COUNT(*) c FROM items WHERE fts_match(body,'climate')`))[0].c);
out.indexStayedInSync = out.hitsAfter > out.hitsBefore;

// ---- deletion ---------------------------------------------------------------
const tD = now();
await exec(`DELETE FROM items WHERE id LIKE 'c${copy}:%'`);
out.deleteMs = Math.round(now() - tD);
out.hitsAfterDelete = Number((await all(ENGINE === 'sqlite'
  ? `SELECT COUNT(*) c FROM items_fts WHERE items_fts MATCH 'climate'`
  : `SELECT COUNT(*) c FROM items WHERE fts_match(body,'climate')`))[0].c);
await exec('PRAGMA wal_checkpoint(TRUNCATE)');
out.footprintAfterDeleteMB = mb(footprint());

console.log(JSON.stringify(out, null, 1));
close();
