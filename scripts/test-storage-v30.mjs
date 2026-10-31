import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFile,readdir} from 'node:fs/promises';import {storeInputAsset} from '../worker/asset-storage.mjs';
const sql=new DatabaseSync(':memory:');for(const f of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())sql.exec(await readFile('drizzle/'+f,'utf8'));
let fail='before',puts=0,deletes=0,delay=null,entered=null;const objects=new Map();
const db={prepare(q){return {bind(...a){return {async first(){return sql.prepare(q).get(...a)},async run(){if(q.startsWith("UPDATE assets SET storage_state='active'")&&fail){const mode=fail;fail=null;if(mode==='after')sql.prepare(q).run(...a);throw Error('injected activation '+mode);}return {meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}}}}}};
const env={DB:db,BUCKET:{async put(k,b){puts++;if(delay){entered?.();await delay;}objects.set(k,b.slice())},async get(k){return objects.has(k)?{body:objects.get(k)}:null},async delete(k){deletes++;objects.delete(k)}}};
const args={id:'same',hash:'samehash',width:1,height:1,bytes:new Uint8Array([1]),mime:'image/png'};
await assert.rejects(storeInputAsset(env,'owner',args),/activation before/);assert.equal(sql.prepare('SELECT storage_state FROM assets').get().storage_state,'writing');
const recovered=await storeInputAsset(env,'owner',args);assert.equal(recovered.storage_state,'active');assert.equal(puts,1);assert.equal(deletes,0);
fail='after';const uncertain=await storeInputAsset(env,'owner',{...args,id:'unknown-commit'});assert.equal(uncertain.storage_state,'active');assert.equal(deletes,0);
// Crash-before-put: an expired reservation can be claimed by exactly one new immutable key.
sql.prepare("INSERT INTO assets(id,owner,hash,width,height,bytes,mime,storage_key,storage_state,write_expires) VALUES(?,?,?,?,?,?,?,?,?,?)").run('crash','owner','samehash',1,1,1,'image/png','files/old','writing',0);
const retries=await Promise.allSettled([storeInputAsset(env,'owner',{...args,id:'crash'}),storeInputAsset(env,'owner',{...args,id:'crash'})]);assert.ok(retries.some(x=>x.status==='fulfilled'));assert.equal(sql.prepare("SELECT storage_state FROM assets WHERE id='crash'").get().storage_state,'active');
// Slow expired writer loses its key; it cannot activate or remove the replacement.
let release;delay=new Promise(r=>release=r);let signal;const began=new Promise(r=>signal=r);entered=signal;const old=storeInputAsset(env,'owner',{...args,id:'fenced'});await began;sql.prepare("UPDATE assets SET write_expires=0 WHERE id='fenced'").run();delay=null;const replacement=await storeInputAsset(env,'owner',{...args,id:'fenced'});release();await assert.rejects(old,e=>e.status===409);assert.ok(objects.has(replacement.storage_key));assert.equal(sql.prepare("SELECT storage_key FROM assets WHERE id='fenced'").get().storage_key,replacement.storage_key);
// Both deleting and absent targets must reject references, including cross-owner targets.
for(const state of ['deleting','missing']){
 if(state==='deleting')sql.prepare("UPDATE assets SET storage_state='deleting' WHERE id='same'").run();else sql.prepare("DELETE FROM assets WHERE id='same'").run();
 assert.throws(()=>sql.prepare('INSERT INTO manual_approvals VALUES(?,?,?,?,?,?,?,?)').run('q'+state,'g','owner','fp',JSON.stringify({asset_id:'same'}),'p',Date.now()+1000,'[]'),/not available/);
 await assert.rejects(storeInputAsset(env,'owner',{...args,id:'parent'+state,normalizedId:'same'}),/not available/);
 assert.throws(()=>sql.prepare('INSERT INTO response_jobs(id,owner,idem,fingerprint,state,input_asset) VALUES(?,?,?,?,?,?)').run('r'+state,'owner','r'+state,'fp','queued','same'),/not available/);
}
assert.throws(()=>sql.prepare('INSERT INTO manual_approvals VALUES(?,?,?,?,?,?,?,?)').run('cross','g','other','fp',JSON.stringify({asset_id:'crash'}),'p',Date.now()+1000,'[]'),/not available/);
console.log('PASS v30 storage: activation failure recovery with no re-PUT; committed-but-response-lost active retained; expired crash recovery and fencing; deleting/missing/cross-owner quote and normalized/response references rejected. No network.');
