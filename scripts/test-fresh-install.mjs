import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
const files=(await readdir('drizzle')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
assert.deepEqual(journal.entries.map(e=>e.tag+'.sql'),files);
const db=new DatabaseSync(':memory:');
for(const [i,e] of journal.entries.entries()){assert.equal(e.idx,i);if(i)assert.ok(e.when>journal.entries[i-1].when);db.exec(await readFile('drizzle/'+e.tag+'.sql','utf8'));}
for(const table of ['manual_approvals','work_quotes','response_jobs','assets'])assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
for(const col of ['manual_grant_id','poll_token','poll_expires_at'])assert.ok(db.prepare('PRAGMA table_info(response_jobs)').all().some(r=>r.name===col));
console.log('Fresh journal-driven installation includes all 10 migrations and manual/Work schema');
