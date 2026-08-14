// Re-verify the two remaining adoption-gate items first-hand on the installed build:
// working prefix search, and fts_score() with a BOUND parameter.
import fs from 'node:fs';
const SCRATCH = process.env.SCRATCH;
const { connect } = await import('@tursodatabase/database');
const p = `${SCRATCH}/gate.db`;
for (const s of ['', '-wal', '-shm']) fs.rmSync(p + s, { force: true });
const db = await connect(p, { experimental: ['index_method'] });
await db.exec('CREATE TABLE d(id INTEGER PRIMARY KEY, body TEXT)');
await db.exec(`INSERT INTO d VALUES
  (1,'democracy is fragile'),(2,'democratic norms erode'),(3,'running and runner'),(4,'climate policy update')`);
await db.exec('CREATE INDEX d_fts ON d USING fts (body)');
const out = {};
const q = async (label, sql, args = []) => {
  try { out[label] = JSON.stringify(await db.prepare(sql).all(args)); }
  catch (e) { out[label] = 'THREW: ' + e.message.slice(0, 110); }
};
await q('sanity_exact', "SELECT id FROM d WHERE fts_match(body,'democracy')");
await q('prefix_star', "SELECT id FROM d WHERE fts_match(body,'democr*')");
await q('prefix_bound', 'SELECT id FROM d WHERE fts_match(body,?)', ['democr*']);
await q('stem_run', "SELECT id FROM d WHERE fts_match(body,'run')");
await q('fuzzy_tilde', "SELECT id FROM d WHERE fts_match(body,'climat~1')");
await q('score_literal', "SELECT id, fts_score(body,'climate') s FROM d WHERE fts_match(body,'climate')");
await q('score_bound_param', 'SELECT id, fts_score(body,?) s FROM d WHERE fts_match(body,?)', ['climate', 'climate']);
await q('score_bound_match_literal', "SELECT id, fts_score(body,?) s FROM d WHERE fts_match(body,'climate')", ['climate']);
console.log(JSON.stringify(out, null, 1));
db.close?.();
