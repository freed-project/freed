// Head-to-head full-text search benchmark: SQLite FTS5 vs Turso FTS (Tantivy).
// usage: node fts.mjs <sqlite|turso> <scale> [variant]
//   sqlite variants: unicode61 | porter | trigram
//   turso  variants: default
import fs from 'node:fs';
import path from 'node:path';

const SCRATCH = process.env.SCRATCH;
const ENGINE = process.argv[2];
const SCALE = Number(process.argv[3] || 1);
const VARIANT = process.argv[4] || (ENGINE === 'sqlite' ? 'unicode61' : 'default');
const mb = b => +(b / 1048576).toFixed(1);
const now = () => Number(process.hrtime.bigint()) / 1e6; // ms float

const dir = `${SCRATCH}/ftsdb-${ENGINE}-${VARIANT}-${SCALE}`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const dbPath = `${dir}/db.db`;

function footprint() {
  let total = 0;
  const walk = p => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else total += fs.statSync(f).size;
    }
  };
  walk(dir);
  return total;
}
function listing() {
  const out = [];
  const walk = (p, rel) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(f, r);
      else out.push([r, fs.statSync(f).size]);
    }
  };
  walk(dir, '');
  return out.sort((a, b) => b[1] - a[1]);
}

// ---- engine adapter --------------------------------------------------------
let db, exec, all, run, close;
if (ENGINE === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(dbPath);
  exec = async s => db.exec(s);
  all = async (sql, args = []) => db.prepare(sql).all(...args);
  run = sql => { const st = db.prepare(sql); return async args => st.run(...args); };
  close = () => db.close();
} else {
  const { connect } = await import('@tursodatabase/database');
  db = await connect(dbPath, { experimental: ['index_method'] });
  exec = async s => { await db.exec(s); };
  all = async (sql, args = []) => await db.prepare(sql).all(args);
  run = sql => { const st = db.prepare(sql); return async args => await st.run(args); };
  close = () => db.close?.();
}

const result = { engine: ENGINE, variant: VARIANT, scale: SCALE };

await exec('PRAGMA journal_mode=WAL');
await exec('CREATE TABLE items(id TEXT PRIMARY KEY, publishedAt INTEGER, platform TEXT, author TEXT, archived INTEGER, saved INTEGER, readAt INTEGER, body TEXT)');

// ---- load corpus -----------------------------------------------------------
const rows = JSON.parse(fs.readFileSync(`${SCRATCH}/rows.json`, 'utf8'));
let bodyChars = 0;
const tIns = now();
const ins = run('INSERT INTO items VALUES(?,?,?,?,?,?,?,?)');
await exec('BEGIN');
let n = 0;
for (let copy = 0; copy < SCALE; copy++) {
  for (const r of rows) {
    const id = copy === 0 ? r[0] : `c${copy}:${r[0]}`;
    await ins([id, r[1], r[2], r[3], r[4], r[5], r[6], r[7]]);
    if (copy === 0) bodyChars += (r[7] || '').length;
    n++;
  }
}
await exec('COMMIT');
result.rows = n;
result.insertMs = Math.round(now() - tIns);
result.corpusTextMB = mb(bodyChars * SCALE);

await exec('PRAGMA wal_checkpoint(TRUNCATE)');
const baseBytes = footprint();
result.baseFootprintMB = mb(baseBytes);

// ---- build the FTS index ---------------------------------------------------
// RSS sampling from a worker thread: the main thread blocks inside native
// code during index build, so an in-thread setInterval never fires.
const { Worker } = await import('node:worker_threads');
const sab = new SharedArrayBuffer(3 * 8);
const shared = new Float64Array(sab);
const rssWorker = new Worker(new URL('./rss-sampler.mjs', import.meta.url), { workerData: { sab } });
await new Promise(r => rssWorker.once('message', r));
const rssBefore = process.memoryUsage().rss;
shared[0] = rssBefore;

const tIdx = now();
let indexError = null;
try {
  if (ENGINE === 'sqlite') {
    const tok = VARIANT === 'porter' ? ", tokenize='porter unicode61'"
      : VARIANT === 'trigram' ? ", tokenize='trigram'"
        : '';
    // external-content FTS5: index only, body stays in `items`
    await exec(`CREATE VIRTUAL TABLE items_fts USING fts5(body, content='items', content_rowid='rowid'${tok})`);
    await exec(`INSERT INTO items_fts(items_fts) VALUES('rebuild')`);
  } else {
    const tk = (VARIANT === 'default' || VARIANT === 'unicode61') ? '' : ` WITH (tokenizer='${VARIANT}')`;
    await exec(`CREATE INDEX items_fts ON items USING fts (body)${tk}`);
  }
} catch (e) {
  indexError = `${e.constructor?.name}: ${e.message}`;
}
result.indexBuildMs = Math.round(now() - tIdx);
shared[2] = 1;
await rssWorker.terminate();
result.indexBuildRssBeforeMB = mb(rssBefore);
result.indexBuildPeakRssMB = mb(shared[0]);
result.indexBuildRssDeltaMB = mb(shared[0] - rssBefore);
result.rssSamples = shared[1];
if (indexError) {
  result.indexError = indexError;
  console.log(JSON.stringify(result, null, 2));
  close();
  process.exit(0);
}

await exec('PRAGMA wal_checkpoint(TRUNCATE)');
const afterBytes = footprint();
result.afterFootprintMB = mb(afterBytes);
result.indexSizeMB = mb(afterBytes - baseBytes);
result.indexOverheadPctOfText = +((afterBytes - baseBytes) / (bodyChars * SCALE) * 100).toFixed(1);
result.files = listing().slice(0, 12).map(([f, s]) => `${f} ${mb(s)}MB`);

// ---- query battery ---------------------------------------------------------
// Each entry: label, sqlite MATCH expression, turso fts_match query string.
const QUERIES = [
  ['single-veryhigh-freq', 'that', 'that'],           // ~246k postings at scale 7
  ['single-common', 'climate', 'climate'],
  ['single-rare', 'tantivy', 'tantivy'],
  ['multi-term-default', 'climate change', 'climate change'],
  ['multi-term-AND', 'climate AND change', 'climate AND change'],
  ['phrase', '"climate change"', '"climate change"'],
  ['prefix', 'democr*', 'democr*'],
  ['typo-missing-letter', 'climat', 'climat'],
  ['typo-transposed', 'cimate', 'cimate'],
  ['stem-run', 'run', 'run'],
  ['three-term', 'climate change policy', 'climate change policy'],
];

const REPS = Number(process.env.REPS || 11);
const p = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return +s[Math.floor(s.length * q)].toFixed(2); };

function sqliteSql(kind) {
  if (kind === 'count') return `SELECT COUNT(*) c FROM items_fts WHERE items_fts MATCH ?`;
  return `SELECT i.id, bm25(items_fts) AS score FROM items_fts JOIN items i ON i.rowid = items_fts.rowid WHERE items_fts MATCH ? ORDER BY rank LIMIT 10`;
}
function tursoSql(kind) {
  if (kind === 'count') return `SELECT COUNT(*) c FROM items WHERE fts_match(body, ?)`;
  // NOTE: fts_score() with a BOUND PARAMETER returns 0 (measured bug), so an
  // explicit ORDER BY fts_score(body, ?) is a no-op sort. The realistic app
  // path is to rely on fts_match's own relevance order + LIMIT.
  return `SELECT id FROM items WHERE fts_match(body, ?) LIMIT 10`;
}
// Same query with the score inlined as a literal, which is the only way to get
// a non-zero score out of Turso today.
function tursoSqlLiteralScore(q) {
  const lit = q.replace(/'/g, "''");
  return `SELECT id, fts_score(body, '${lit}') AS score FROM items WHERE fts_match(body, '${lit}') ORDER BY score DESC LIMIT 10`;
}

result.queries = [];
for (const [label, sq, tq] of QUERIES) {
  const q = ENGINE === 'sqlite' ? sq : tq;
  const entry = { label, query: q };

  // count
  try {
    const times = [];
    let c = null;
    for (let i = 0; i < REPS; i++) {
      const t = now();
      const r = await all(ENGINE === 'sqlite' ? sqliteSql('count') : tursoSql('count'), [q]);
      times.push(now() - t);
      c = r[0]?.c ?? r[0]?.['COUNT(*)'] ?? null;
    }
    entry.hits = Number(c);
    entry.countP50ms = p(times, 0.5);
    entry.countMinMs = +Math.min(...times).toFixed(2);
    entry.countMaxMs = +Math.max(...times).toFixed(2);
  } catch (e) {
    entry.countError = e.message;
  }

  // top-10 ranked (the realistic search-UI path for each engine)
  try {
    const times = [];
    let top = null;
    for (let i = 0; i < REPS; i++) {
      const t = now();
      const r = ENGINE === 'sqlite'
        ? await all(sqliteSql('top'), [q])
        : await all(tursoSql('top'), [q]);
      times.push(now() - t);
      top = r;
    }
    entry.topP50ms = p(times, 0.5);
    entry.topMinMs = +Math.min(...times).toFixed(2);
    entry.topIds = top.slice(0, 5).map(r => `${r.id}|${typeof r.score === 'number' ? r.score.toFixed(3) : ''}`);
  } catch (e) {
    entry.topError = e.message;
  }

  // Turso only: explicit BM25 sort with a literal query string
  if (ENGINE === 'turso') {
    try {
      const times = [];
      let top = null;
      for (let i = 0; i < REPS; i++) {
        const t = now();
        top = await all(tursoSqlLiteralScore(q));
        times.push(now() - t);
      }
      entry.topLiteralScoreP50ms = p(times, 0.5);
      entry.topLiteralScoreIds = top.slice(0, 5).map(r => `${r.id}|${r.score?.toFixed?.(3)}`);
    } catch (e) {
      entry.topLiteralScoreError = e.message;
    }
  }

  result.queries.push(entry);
}

// baseline: what a LIKE scan costs for the same single term
try {
  const times = [];
  let c = 0;
  for (let i = 0; i < 3; i++) {
    const t = now();
    const r = await all(`SELECT COUNT(*) c FROM items WHERE body LIKE '%climate%'`);
    times.push(now() - t);
    c = r[0].c;
  }
  result.likeScanP50ms = p(times, 0.5);
  result.likeScanHits = Number(c);
} catch (e) { result.likeScanError = e.message; }

console.log(JSON.stringify(result, null, 2));
close();
