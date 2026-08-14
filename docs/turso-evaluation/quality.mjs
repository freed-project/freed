// Controlled-corpus FTS quality comparison. Each doc contains exactly one
// surface form so stemming/prefix/fuzzy claims can be tested unambiguously.
// usage: node quality.mjs <sqlite|turso> [variant]
const ENGINE = process.argv[2];
const VARIANT = process.argv[3] || (ENGINE === 'sqlite' ? 'unicode61' : 'default');

const DOCS = [
  [1, 'the athletes were running quickly through the park'],       // only "running"
  [2, 'she organizes community meetings every week'],              // only "organizes"
  [3, 'a report on democracy in modern nations'],                  // only "democracy"
  [4, 'global climate policy needs urgent attention'],             // only "climate"
  [5, 'the connection between weather and farming'],               // only "connection"
  [6, 'nationalization of the railways was debated'],              // only "nationalization"
  [7, 'climate change is the defining issue of our era'],          // climate + change
  [8, 'a change of scenery does everyone good'],                   // change only
  [9, 'climate climate climate climate climate climate'],          // term-frequency outlier
  [10, 'pottery and ceramics have a long history'],                // control, no keywords
];

let exec, all, close;
if (ENGINE === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  exec = s => db.exec(s);
  all = (sql, args = []) => db.prepare(sql).all(...args);
  close = () => db.close();
} else {
  const { connect } = await import('@tursodatabase/database');
  const db = await connect(':memory:', { experimental: ['index_method'] });
  exec = async s => { await db.exec(s); };
  all = async (sql, args = []) => await db.prepare(sql).all(args);
  close = () => db.close?.();
}

await exec('CREATE TABLE d(id INTEGER PRIMARY KEY, body TEXT)');
for (const [id, body] of DOCS) await exec(`INSERT INTO d VALUES(${id}, '${body}')`);

if (ENGINE === 'sqlite') {
  const tok = VARIANT === 'porter' ? ", tokenize='porter unicode61'"
    : VARIANT === 'trigram' ? ", tokenize='trigram'" : '';
  await exec(`CREATE VIRTUAL TABLE d_fts USING fts5(body, content='d', content_rowid='rowid'${tok})`);
  await exec(`INSERT INTO d_fts(d_fts) VALUES('rebuild')`);
} else {
  const tk = VARIANT === 'default' ? '' : ` WITH (tokenizer='${VARIANT}')`;
  await exec(`CREATE INDEX d_fts ON d USING fts (body)${tk}`);
}

const search = async q => {
  try {
    const rows = ENGINE === 'sqlite'
      ? await all('SELECT rowid AS id FROM d_fts WHERE d_fts MATCH ? ORDER BY rank', [q])
      : await all('SELECT id FROM d WHERE fts_match(body, ?)', [q]);
    return rows.map(r => Number(r.id));
  } catch (e) {
    return `ERR: ${e.message.slice(0, 90)}`;
  }
};

const CASES = [
  ['exact term', 'climate', 'baseline: docs 4,7,9'],
  ['stem: run -> running', 'run', 'doc 1 only if stemming'],
  ['stem: organize -> organizes', 'organize', 'doc 2 only if stemming'],
  ['stem: national -> nationalization', 'national', 'doc 6 only if aggressive stemming'],
  ['prefix: democr*', 'democr*', 'doc 3 if prefix supported'],
  ['prefix: conn*', 'conn*', 'doc 5 if prefix supported'],
  ['typo: climat (drop e)', 'climat', 'docs 4,7,9 if fuzzy'],
  ['typo: cimate (transpose)', 'cimate', 'docs 4,7,9 if fuzzy'],
  ['typo w/ ~1', 'climat~1', 'Tantivy fuzzy syntax'],
  ['multi-term default', 'climate change', 'AND=>7 ; OR=>4,7,8,9'],
  ['explicit AND', 'climate AND change', 'doc 7'],
  ['phrase', '"climate change"', 'doc 7'],
  ['negation', 'climate NOT change', 'docs 4,9'],
  ['negation dash', 'climate -change', 'docs 4,9'],
  ['substring: limat', 'limat', 'only trigram/ngram can do this'],
];

const out = { engine: ENGINE, variant: VARIANT, cases: [] };
for (const [label, q, expect] of CASES) {
  out.cases.push({ case: label, query: q, expect, got: await search(q) });
}

// ---- ranking check: is the result order actually relevance-ordered? --------
// doc 9 has "climate" x6 and is short => must rank first under BM25.
if (ENGINE === 'sqlite') {
  out.ranking = {
    withOrderByRank: (await all("SELECT rowid AS id, bm25(d_fts) s FROM d_fts WHERE d_fts MATCH 'climate' ORDER BY rank")).map(r => `${r.id}:${r.s.toFixed(3)}`),
    noOrderBy: (await all("SELECT rowid AS id FROM d_fts WHERE d_fts MATCH 'climate'")).map(r => Number(r.id)),
  };
} else {
  out.ranking = {
    scoreLiteral: (await all("SELECT id, fts_score(body,'climate') s FROM d WHERE fts_match(body,'climate')")).map(r => `${r.id}:${r.s.toFixed(3)}`),
    scoreBoundParam: (await all('SELECT id, fts_score(body,?) s FROM d WHERE fts_match(body,?)', ['climate', 'climate'])).map(r => `${r.id}:${r.s.toFixed(3)}`),
    noOrderBy: (await all("SELECT id FROM d WHERE fts_match(body,'climate')")).map(r => Number(r.id)),
    orderByScoreLiteral: (await all("SELECT id FROM d WHERE fts_match(body,'climate') ORDER BY fts_score(body,'climate') DESC")).map(r => Number(r.id)),
  };
}

console.log(JSON.stringify(out, null, 1));
close();
