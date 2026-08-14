// Does incremental FTS write cost scale with the size of the existing index?
// Build an index over N base rows, then time appending 50 rows in one commit,
// and 5 rows in one commit, for several N.
// usage: node inc-scaling.mjs <sqlite|turso>
import fs from 'node:fs';
const SCRATCH = process.env.SCRATCH;
const ENGINE = process.argv[2];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const rows = JSON.parse(fs.readFileSync(`${SCRATCH}/rows.json`, 'utf8'));

const BASES = (process.env.BASES || '500,2000,8000,15846').split(',').map(Number);
const out = [];

for (const N of BASES) {
  const p = `${SCRATCH}/incs-${ENGINE}-${N}.db`;
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });

  let exec, run, close;
  if (ENGINE === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(p);
    exec = async s => db.exec(s);
    run = sql => { const st = db.prepare(sql); return async a => st.run(...a); };
    close = () => db.close();
  } else {
    const { connect } = await import('@tursodatabase/database');
    const db = await connect(p, { experimental: ['index_method'] });
    exec = async s => { await db.exec(s); };
    run = sql => { const st = db.prepare(sql); return async a => await st.run(a); };
    close = () => db.close?.();
  }

  await exec('PRAGMA journal_mode=WAL');
  await exec('CREATE TABLE items(id TEXT PRIMARY KEY, body TEXT)');
  const ins = run('INSERT INTO items VALUES(?,?)');
  await exec('BEGIN');
  for (let i = 0; i < N; i++) await ins([rows[i][0], rows[i][7]]);
  await exec('COMMIT');

  const tB = now();
  if (ENGINE === 'sqlite') {
    await exec(`CREATE VIRTUAL TABLE items_fts USING fts5(body, content='items', content_rowid='rowid')`);
    await exec(`INSERT INTO items_fts(items_fts) VALUES('rebuild')`);
    await exec(`CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, body) VALUES (new.rowid, new.body); END;`);
  } else {
    await exec('CREATE INDEX items_fts ON items USING fts (body)');
  }
  const buildMs = Math.round(now() - tB);

  const append = async (label, count, tag) => {
    const t = now();
    await exec('BEGIN');
    for (let i = 0; i < count; i++) {
      const r = rows[(i + 100) % rows.length];
      await ins([`${tag}:${i}:${r[0]}`, r[7]]);
    }
    await exec('COMMIT');
    return +(now() - t).toFixed(1);
  };

  const add50 = await append('add50', 50, `x${N}a`);
  const add50b = await append('add50b', 50, `x${N}b`);
  const add5 = await append('add5', 5, `x${N}c`);
  const add1 = await append('add1', 1, `x${N}d`);

  out.push({
    engine: ENGINE, baseRows: N, buildMs,
    append50Ms: add50, append50Ms_2nd: add50b, append5Ms: add5, append1Ms: add1,
    msPerRow_at50: +(add50b / 50).toFixed(2),
    dbMB: +(fs.statSync(p).size / 1048576).toFixed(1),
  });
  console.log(JSON.stringify(out[out.length - 1]));
  close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
}
