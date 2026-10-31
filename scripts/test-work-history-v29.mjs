import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {createWorker} from '../worker/index.js';import {retainHistory,historyView} from '../worker/history.mjs';import {backgroundPublic,createBackgroundAdapter} from '../worker/responses-background.mjs';import {storeInputAsset} from '../worker/asset-storage.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden')};
function store(){
 const sql=new DatabaseSync(':memory:');
 const db={prepare(q){return {bind(...a){return {
  async first(){return sql.prepare(q).get(...a)},
  async all(){return {results:sql.prepare(q).all(...a)}},
  async run(){return {meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}
 };}};}};
 return {sql,db};
}
const {sql,db}=store();for(const f of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort())sql.exec(await readFile('drizzle/'+f,'utf8'));
const objects=new Map(),deleted=[];let deletionFail=false;const bucket={async put(k,b){objects.set(k,typeof b==='string'?new TextEncoder().encode(b):b)},async get(k,o){const b=objects.get(k);return b?{body:o?.range?b.subarray(o.range.offset,o.range.offset+o.range.length):b}:null},async delete(k){if(deletionFail)throw Error('R2 delete failed');deleted.push(k);objects.delete(k)}};
const env={DB:db,BUCKET:bucket,LIVE_ENABLED:'true',POLL_ENABLED:'true',OPENAI_API_KEY:'FAKE',MANUAL_MODE:'per_order',MANUAL_MODE_ID:'browser',MANUAL_TRIAL_OWNER:'owner',MANUAL_ACK_UNKNOWN_IDS:'[]'};
let posts=0,gets=0,lose=false;const app=createWorker(async(u,o)=>{if(o.method==='POST'){posts++;if(lose)throw Error('lost')}else gets++;return Response.json({id:'resp_work',status:'queued',model:'gpt-6.1-terra',output:[]})});
const call=(path,body,user='owner')=>app.fetch(new Request('https://test.local'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://test.local','oai-authenticated-user-id':user},body:body===undefined?undefined:JSON.stringify(body)}),env);
const mcp=async(name,args={},user='owner')=>{const r=await(await call('/mcp',{id:1,method:'tools/call',params:{name,arguments:args}},user)).json();return r.result.isError?{error:r.result.content[0].text}:JSON.parse(r.result.content[0].text)};
const bytes=await readFile('scripts/fixtures-v27/orientation-1.jpg');const up=await app.fetch(new Request('https://test.local/api/files',{method:'POST',headers:{origin:'https://test.local','oai-authenticated-user-id':'owner'},body:bytes}),env);const input=await up.json();assert.equal(up.status,200);const args={asset_id:input.id,prompt:'Enhance stars only',preserve:'Keep identity and composition',scale:2};
assert.match((await mcp('canvas_prepare_order',args)).error,/not enabled/);assert.equal(posts,0);
Object.assign(env,{WORK_ENABLED:'true',WORK_MODE_ID:'v1'});
const q=await mcp('canvas_prepare_order',args);assert.ok(q.quote_hash);assert.equal(q.summary.original_sha256,input.sha256);assert.equal(q.summary.plan.main_model,'gpt-6.1-terra');assert.equal(posts,0);
const confirmation={approval_id:q.approval_id,quote_hash:q.quote_hash,confirmation_text:q.confirmation_text,user_confirmation:'I approve this one image at the shown usage-based fee.'};
assert.ok((await mcp('canvas_confirm_order',{...confirmation,approved:true})).error);assert.ok((await mcp('canvas_confirm_order',{...confirmation,quote_hash:'wrong'})).error);assert.ok((await mcp('canvas_confirm_order',confirmation,'other')).error);assert.equal(posts,0);
assert.equal((await call('/api/manual/submit',{approval_id:q.approval_id,approved:true})).status,409);
const web=await(await call('/api/manual/prepare',args)).json();assert.ok((await mcp('canvas_confirm_order',{...confirmation,approval_id:web.approval_id})).error);
const pair=await Promise.all([mcp('canvas_confirm_order',confirmation),mcp('canvas_confirm_order',confirmation)]);assert.equal(posts,1);assert.ok(pair.some(x=>x.state==='queued'));await mcp('canvas_confirm_order',confirmation);assert.equal(posts,1);
const polled=await mcp('canvas_poll_background',{idempotency_key:q.idempotency_key});assert.equal(polled.state,'queued');assert.equal(gets,1);assert.ok((await mcp('canvas_submit_background',{...args,approved:true,idempotency_key:'bypass'})).error);
sql.exec("UPDATE response_jobs SET state='completed'");const expired=await mcp('canvas_prepare_order',args);sql.prepare('UPDATE manual_approvals SET expires_at=0 WHERE token=?').run(expired.approval_id);assert.ok((await mcp('canvas_confirm_order',{...confirmation,approval_id:expired.approval_id,quote_hash:expired.quote_hash,confirmation_text:expired.confirmation_text})).error);
const unknown=await mcp('canvas_prepare_order',args);lose=true;const unknownC={...confirmation,approval_id:unknown.approval_id,quote_hash:unknown.quote_hash,confirmation_text:unknown.confirmation_text};const lost=await mcp('canvas_confirm_order',unknownC);assert.equal(lost.state,'submission_unknown');const n=posts;await mcp('canvas_confirm_order',unknownC);assert.equal(posts,n);assert.ok((await mcp('canvas_prepare_order',args)).error);assert.equal((await call('/api/manual/prepare',args)).status,409);
console.log('PASS Work: off by default, snapshot, exact quote, web/Work/cross-owner isolation, expiry, one POST, same-key replay, GET poll, shared unknown block, legacy denial. Fake only.');
// Independent owner with 51 fixtures, two protected unknown/active tasks, shared and normalized assets.
const owner='retention';function asset(id,normalized=null){sql.prepare('INSERT INTO assets(id,owner,hash,width,height,bytes,mime,normalized_id) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,id,1,1,3,'image/png',normalized);objects.set('files/'+id,new Uint8Array([1,2,3]));}
asset('upright');asset('shared');asset('old-input','upright');asset('old-output');asset('new-output');
function job(i,state='completed',inputId='shared',output='new-output'){sql.prepare('INSERT INTO response_jobs(id,owner,idem,fingerprint,state,created_at,updated_at,input_asset,result_asset,original_asset,original_prompt,receipt,response_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('h'+i,owner,'h'+i,'fp'+i,state,i,i,inputId,output,output,'private old text','{}','resp_'+i);}
job(0,'completed','old-input','old-output');for(let i=1;i<51;i++)job(i);job(-2,'submission_unknown','shared',null);job(-1,'in_progress','shared',null);
assert.equal((await historyView(env,owner,backgroundPublic)).storage.media_bytes,15);assert.equal((await retainHistory(env,owner,{newly_created:true})).executed,false);assert.equal(deleted.length,0);
env.HISTORY_RETENTION_ENABLED='true';assert.equal((await retainHistory(env,owner,{})).executed,false);
const cleaned=await retainHistory(env,owner,{newly_created:true});assert.equal(cleaned.retired,3);assert.equal(sql.prepare('SELECT COUNT(*) n FROM response_jobs WHERE owner=? AND retired_at IS NULL').get(owner).n,50);
assert.ok(deleted.includes('files/old-input'));assert.ok(deleted.includes('files/old-output'));assert.ok(deleted.includes('files/upright'));assert.ok(objects.has('files/shared'));assert.ok(objects.has('files/new-output'));assert.equal(sql.prepare("SELECT retired_at FROM response_jobs WHERE id='h-2'").get().retired_at,null);
const ledger=sql.prepare("SELECT * FROM response_jobs WHERE id='h0'").get();assert.ok(ledger.retired_at);assert.equal(ledger.original_prompt,null);assert.equal(ledger.input_asset,null);assert.equal(ledger.fingerprint,'fp0');assert.equal(backgroundPublic(ledger).state,'expired');
let accidental=0;const adapter=createBackgroundAdapter({db,bucket,api:{kind:'fake',async create(){accidental++;throw Error('never')}},liveEnabled:false});assert.equal((await adapter.submit(owner,'h0',{approved:true,prompt:'changed',asset_id:'deleted'})).id,'h0');assert.equal(accidental,0);
// New quote reference freezes media from GC. Deleting state rejects late new references atomically.
asset('quoted');sql.prepare('INSERT INTO media_gc VALUES(?,?)').run(owner,'quoted');sql.prepare('INSERT INTO manual_approvals VALUES(?,?,?,?,?,?,?,?)').run('pin','pin',owner,'fp',JSON.stringify({asset_id:'quoted'}),'price',Date.now()+60000,'[]');await retainHistory(env,owner,{newly_created:true});assert.ok(objects.has('files/quoted'));
sql.prepare('UPDATE manual_approvals SET expires_at=0 WHERE token=?').run('pin');deletionFail=true;await assert.rejects(retainHistory(env,owner,{newly_created:true}));assert.equal(sql.prepare("SELECT storage_state FROM assets WHERE id='quoted'").get().storage_state,'deleting');assert.throws(()=>sql.prepare('INSERT INTO manual_approvals VALUES(?,?,?,?,?,?,?,?)').run('late','late',owner,'fp',JSON.stringify({asset_id:'quoted'}),'p',Date.now()+60000,'[]'),/not available/);
deletionFail=false;await retainHistory(env,owner,{newly_created:true});assert.ok(!objects.has('files/quoted'));
// A delayed delete of an old key cannot remove replacement bytes at a fresh key.
const replacement=await storeInputAsset(env,owner,{id:'quoted',hash:'new',width:1,height:1,bytes:new Uint8Array([7]),mime:'image/png'});assert.notEqual(replacement.storage_key,'files/quoted');await bucket.delete('files/quoted');assert.ok(objects.has(replacement.storage_key));
const view=await historyView(env,owner,backgroundPublic);assert.equal(view.items.length,50);assert.equal(view.storage.media_bytes,7);
assert.equal((await mcp('canvas_history')).items.length,(await(await call('/api/history')).json()).items.length);
console.log('PASS retention: default/read/replay no deletion; 51+protected ->50; actual original/output/normalized removal; shared/quote pins; retry after R2 fail; immutable object keys; old idempotency ledger no POST; owner byte totals and unified history. Fixture storage only.');
