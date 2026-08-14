// Measure the two mitigations the pro-Turso case depends on:
//  (1) FTS sidecar rebuild-and-swap at real scale — does it bound the 313 ms/row incremental cost,
//      and can search stay online during a rebuild?
//  (2) Is a Turso-ONLY database (never touched by fts5) safe under heavy mixed DML?
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
const SCRATCH = process.env.SCRATCH;
const { connect } = await import('@tursodatabase/database');
const { DatabaseSync } = await import('node:sqlite');
const rm = p => { for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(p + s); } catch {} } };
const MB = b => +(b / 1048576).toFixed(1);
const out = {};

// ---- peak-RSS sampler (worker thread; main thread blocks inside native code) ----
async function withPeak(fn) {
  const sab = new SharedArrayBuffer(24);
  const buf = new Float64Array(sab);
  buf[0] = process.memoryUsage.rss();
  const w = new Worker(new URL('./rss-sampler.mjs', import.meta.url), { workerData: { sab } });
  await new Promise(r => w.once('message', r));
  const before = process.memoryUsage.rss();
  const t = Date.now();
  const val = await fn();
  const ms = Date.now() - t;
  buf[2] = 1; await new Promise(r => w.once('exit', r));
  return { val, ms, beforeMB: MB(before), peakMB: MB(buf[0]), deltaMB: MB(buf[0] - before), samples: buf[1] };
}

const rows = JSON.parse(fs.readFileSync(`${SCRATCH}/rows.json`, 'utf8'));
const SCALE = 7;
const bodyRows = [];
for (let c = 0; c < SCALE; c++) for (const r of rows) bodyRows.push([c === 0 ? r[0] : `c${c}:${r[0]}`, r[7]]);
out.corpusRows = bodyRows.length;
out.corpusTextMB = MB(bodyRows.reduce((a, r) => a + (r[1]?.length || 0), 0));

// ---------- (1a) Sidecar FTS rebuild from scratch at full scale ----------
const sideA = `${SCRATCH}/mit-side-a.db`;
rm(sideA);
out.sidecarBuild = await withPeak(async () => {
  const db = await connect(sideA, { experimental: ['index_method'] });
  await db.exec('PRAGMA journal_mode=WAL');
  await db.exec('CREATE TABLE fts_src(id TEXT PRIMARY KEY, body TEXT)');
  const ins = db.prepare('INSERT INTO fts_src VALUES(?,?)');
  const tCopy = Date.now();
  await db.exec('BEGIN');
  for (const r of bodyRows) await ins.run(r);
  await db.exec('COMMIT');
  const copyMs = Date.now() - tCopy;
  const tIdx = Date.now();
  await db.exec('CREATE INDEX fts_idx ON fts_src USING fts (body)');
  const indexMs = Date.now() - tIdx;
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const hits = await db.prepare("SELECT COUNT(*) c FROM fts_src WHERE fts_match(body,'climate')").all([]);
  db.close?.();
  return { copyMs, indexMs, climateHits: hits[0].c, sidecarMB: MB(fs.statSync(sideA).size) };
});

// ---------- (1b) Query latency on the finished sidecar ----------
{
  const db = await connect(sideA, { experimental: ['index_method'] });
  const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)];
  const q = async (term) => {
    const st = db.prepare(`SELECT id FROM fts_src WHERE fts_match(body,'${term}') LIMIT 10`);
    for (let i = 0; i < 5; i++) await st.all([]);
    const s = [];
    for (let i = 0; i < 40; i++) { const t = process.hrtime.bigint(); await st.all([]); s.push(Number(process.hrtime.bigint() - t) / 1e6); }
    return { p50: +pct(s, 0.5).toFixed(2), p95: +pct(s, 0.95).toFixed(2) };
  };
  out.sidecarQuery = { climate: await q('climate'), that: await q('that'), zzznotfound: await q('zzznotfound') };
  db.close?.();
}

// ---------- (1c) Rebuild-and-swap: can search stay online during a rebuild? ----------
{
  const live = `${SCRATCH}/mit-live.db`, next = `${SCRATCH}/mit-next.db`;
  rm(live); rm(next);
  fs.copyFileSync(sideA, live);
  const liveDb = await connect(live, { experimental: ['index_method'] });
  const probe = liveDb.prepare("SELECT id FROM fts_src WHERE fts_match(body,'climate') LIMIT 10");
  await probe.all([]);

  let served = 0, failed = 0, maxLatency = 0, stop = false;
  const reader = (async () => {
    while (!stop) {
      const t = process.hrtime.bigint();
      try { await probe.all([]); served++; } catch { failed++; }
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      if (ms > maxLatency) maxLatency = ms;
      await new Promise(r => setImmediate(r));
    }
  })();

  const rebuild = await withPeak(async () => {
    const db = await connect(next, { experimental: ['index_method'] });
    await db.exec('PRAGMA journal_mode=WAL');
    await db.exec('CREATE TABLE fts_src(id TEXT PRIMARY KEY, body TEXT)');
    const ins = db.prepare('INSERT INTO fts_src VALUES(?,?)');
    await db.exec('BEGIN');
    for (const r of bodyRows) await ins.run(r);
    // simulate a scrape burst: 500 new items appended before the index is built
    for (let i = 0; i < 500; i++) await ins.run([`new${i}`, `fresh capture ${i} climate policy update from the burst`]);
    await db.exec('COMMIT');
    await db.exec('CREATE INDEX fts_idx ON fts_src USING fts (body)');
    await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close?.();
    return 'built';
  });
  stop = true; await reader;

  // atomic swap
  const tSwap = Date.now();
  liveDb.close?.();
  fs.renameSync(next, live);
  const swapped = await connect(live, { experimental: ['index_method'] });
  const after = await swapped.prepare("SELECT COUNT(*) c FROM fts_src WHERE fts_match(body,'climate')").all([]);
  const burst = await swapped.prepare("SELECT COUNT(*) c FROM fts_src WHERE fts_match(body,'burst')").all([]);
  const swapMs = Date.now() - tSwap;
  swapped.close?.();

  out.rebuildAndSwap = {
    rebuildMs: rebuild.ms, rebuildPeakDeltaMB: rebuild.deltaMB,
    queriesServedDuringRebuild: served, queriesFailedDuringRebuild: failed,
    maxQueryLatencyDuringRebuildMs: +maxLatency.toFixed(2),
    swapMs, climateHitsAfterSwap: after[0].c, burstHitsAfterSwap: burst[0].c,
  };
}

// ---------- (2) Pure-Turso database under heavy mixed DML ----------
{
  const p = `${SCRATCH}/mit-pure.db`; rm(p);
  const db = await connect(p);
  await db.exec('PRAGMA journal_mode=WAL');
  await db.exec('CREATE TABLE items(id TEXT PRIMARY KEY, publishedAt INTEGER, platform TEXT, readAt INTEGER, body TEXT)');
  await db.exec('CREATE INDEX idx_pub ON items(publishedAt DESC)');
  await db.exec('CREATE INDEX idx_plat ON items(platform, publishedAt DESC)');
  const ins = db.prepare('INSERT INTO items VALUES(?,?,?,?,?)');
  const upd = db.prepare('UPDATE items SET readAt=?, body=? WHERE id=?');
  const del = db.prepare('DELETE FROM items WHERE id=?');
  const t = Date.now();
  await db.exec('BEGIN');
  for (let i = 0; i < 40000; i++) await ins.run([`k${i}`, 1700000000 + i, ['rss', 'x', 'facebook', 'instagram'][i % 4], 0, `body ${i} ` + 'text '.repeat(20)]);
  await db.exec('COMMIT');
  await db.exec('BEGIN');
  for (let i = 0; i < 15000; i++) await upd.run([Date.now(), `updated body ${i} ` + 'text '.repeat(25), `k${i * 2 % 40000}`]);
  await db.exec('COMMIT');
  await db.exec('BEGIN');
  for (let i = 0; i < 8000; i++) await del.run([`k${i * 5 % 40000}`]);
  await db.exec('COMMIT');
  const dmlMs = Date.now() - t;
  const cnt = await db.prepare('SELECT COUNT(*) c FROM items').all([]);
  const ic = await db.prepare('PRAGMA integrity_check').all([]);
  await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close?.();

  const s = new DatabaseSync(p, { readOnly: true });
  const sCnt = s.prepare('SELECT COUNT(*) c FROM items').all()[0].c;
  const sScan = s.prepare('SELECT COUNT(*) c FROM (SELECT id FROM items)').all()[0].c;
  const sPk = s.prepare("SELECT COUNT(*) c FROM items WHERE id='k1'").all()[0].c;
  const sIdx = s.prepare('SELECT COUNT(*) c FROM items WHERE publishedAt > 0').all()[0].c;
  const sIc = s.prepare('PRAGMA integrity_check').all();
  s.close();

  out.pureTursoDML = {
    dmlMs, tursoCount: cnt[0].c, tursoIntegrity: JSON.stringify(ic[0]),
    sqliteCount: sCnt, sqliteFullScanCount: sScan, sqliteIndexScanCount: sIdx, sqlitePkProbe: sPk,
    sqliteIntegrity: JSON.stringify(sIc.slice(0, 3)),
    AGREE: cnt[0].c === sCnt && sCnt === sScan && sScan === sIdx,
  };
}

console.log(JSON.stringify(out, null, 1));
