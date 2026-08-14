// The case's #1 "decisive" argument is that a Turso-FTS file is unopenable by stock
// SQLite. The probe measured a mitigation (DROP INDEX) that the case never mentions.
// Verify the mitigation is real, and time it.
import { connect } from '@tursodatabase/database';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const p = process.env.SCRATCH + '/dropmit.db';
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(p + s); } catch {} }
const rows = JSON.parse(fs.readFileSync(process.env.SCRATCH + '/rows.json', 'utf8'));
const db = await connect(p, { experimental: ['index_method'] });
await db.exec('PRAGMA journal_mode=WAL');
await db.exec('CREATE TABLE items(id TEXT PRIMARY KEY, body TEXT)');
const ins = db.prepare('INSERT INTO items VALUES(?,?)');
await db.exec('BEGIN');
for (const r of rows) await ins.run([r[0], r[7]]);
await db.exec('COMMIT');
await db.exec('CREATE INDEX items_fts ON items USING fts (body)');
await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close?.();
const probe = () => { try { return execFileSync('/usr/bin/sqlite3', [p, 'SELECT COUNT(*) FROM items;'], { encoding: 'utf8' }).trim(); }
                      catch (e) { return 'FAILED: ' + String(e.stderr || e.message).trim().slice(0, 120); } };
console.log('rows indexed        =', rows.length);
console.log('stock sqlite3 BEFORE=', probe());
const db2 = await connect(p, { experimental: ['index_method'] });
const t = Date.now();
await db2.exec('DROP INDEX items_fts');
await db2.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const dropMs = Date.now() - t;
db2.close?.();
console.log('DROP INDEX ms       =', dropMs);
console.log('stock sqlite3 AFTER =', probe());
console.log('body bytes AFTER    =', (() => { try { return execFileSync('/usr/bin/sqlite3', [p, 'SELECT SUM(length(body)) FROM items;'], {encoding:'utf8'}).trim(); } catch(e){ return 'FAILED'; } })());
console.log('integrity AFTER     =', (() => { try { return execFileSync('/usr/bin/sqlite3', [p, 'PRAGMA integrity_check;'], {encoding:'utf8'}).trim(); } catch(e){ return 'FAILED'; } })());
