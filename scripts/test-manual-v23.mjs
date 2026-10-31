import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWorker} from '../worker/index.js';
import {usageReceipt} from '../worker/responses-background.mjs';
globalThis.fetch=()=>{throw Error('External network forbidden')};
const sql=new DatabaseSync(':memory:');for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(await readFile('drizzle/'+f,'utf8'));
const db={prepare(q){return {bind(...a){return {
 async first(){return sql.prepare(q).get(...a)},
 async all(){return {results:sql.prepare(q).all(...a)}},
 async run(){return {meta:{changes:Number(sql.prepare(q).run(...a).changes)}}}
};}};}};
const bytes=new Uint8Array(33),hash=createHash('sha256').update(bytes).digest('hex'),objects=new Map([['files/input',bytes]]);
sql.prepare('INSERT INTO assets(id,owner,hash,width,height,bytes) VALUES(?,?,?,?,?,?)').run('input','owner',hash,1672,941,bytes.length);
const env={DB:db,BUCKET:{async get(k){return objects.has(k)?{body:objects.get(k)}:null},async put(k,b){objects.set(k,typeof b==='string'?new TextEncoder().encode(b):b)}},LIVE_ENABLED:'true',POLL_ENABLED:'true',OPENAI_API_KEY:'FAKE',MANUAL_TRIAL_ID:'test-window',MANUAL_TRIAL_OWNER:'owner',MANUAL_TRIAL_EXPIRES_AT:String(Date.now()+600000),MANUAL_ACK_UNKNOWN_IDS:'[]'};
let posts=0,gets=0,losePost=false,hold=null;const app=createWorker(async(url,o)=>{if(o.method==='POST'){posts++;if(losePost)throw Error('Lost POST')}else{gets++;if(hold)await hold;}return Response.json({id:'resp_manual',model:'gpt-6.1-terra',service_tier:'default',status:'queued',output:[]})});
const call=(path,body,config=env,owner='owner')=>app.fetch(new Request('https://manual.test'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':owner,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),config);
const args={asset_id:'input',prompt:'Enhance background',preserve:'Keep character and composition',scale:2};
let readSecret=false;const off={...env,LIVE_ENABLED:'false',POLL_ENABLED:'false',get OPENAI_API_KEY(){readSecret=true;throw Error('must not access')}};
assert.equal((await call('/api/manual/prepare',args,off)).status,409);assert.equal(readSecret,false);assert.equal(posts,0);
assert.equal((await call('/api/manual/prepare',args,env,'other')).status,409);
assert.equal((await call('/api/manual/prepare',{...args,image_model:'gpt-image-2.5-flare'})).status,409);
assert.equal((await call('/api/manual/prepare',{...args,scale:2.29})).status,409);
assert.equal((await call('/api/background',{...args,approved:true,idempotency_key:'bypass'})).status,409);
const mcp=await (await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'canvas_submit_background',arguments:{...args,approved:true,idempotency_key:'bypass'}}})).json();assert.equal(mcp.result.isError,true);
const draft=await (await call('/api/manual/prepare',args)).json();assert.equal(draft.sha256,hash);assert.equal(draft.plan.final_size,'3344x1888');assert.equal(posts,0);
assert.equal((await call('/api/manual/submit',{approval_id:draft.approval_id,approved:false})).status,409);
assert.equal((await call('/api/manual/submit',{approval_id:'forged',approved:true})).status,409);
const confirmed={approval_id:draft.approval_id,approved:true};
const simultaneous=await Promise.all([call('/api/manual/submit',confirmed),call('/api/manual/submit',confirmed)]);assert.ok(simultaneous.every(x=>[200,409].includes(x.status)));assert.ok(simultaneous.some(x=>x.status===200));assert.equal(posts,1);
let status=await (await call('/api/status')).json();assert.equal(status.manual_trial.available,false);assert.equal(status.manual_trial.job.idempotency_key,'manual-test-window');
await call('/api/manual/submit',confirmed);assert.equal(posts,1);assert.equal((await call('/api/manual/prepare',args)).status,409);
// HTTP-body changes cannot replace the server-stored approved order.
await call('/api/manual/submit',{...confirmed,prompt:'injected',idempotency_key:'another',scale:1});assert.equal(posts,1);
let release;hold=new Promise(r=>release=r);const p1=call('/api/background/manual-test-window');while(!gets)await new Promise(r=>setTimeout(r,1));const p2=await call('/api/background/manual-test-window');assert.equal(p2.status,503);assert.equal(gets,1);release();assert.equal((await p1).status,200);hold=null;
assert.equal(sql.prepare('SELECT poll_token FROM response_jobs WHERE manual_grant_id=?').get('test-window').poll_token,null);
assert.equal((await call('/api/background/another')).status,409);
// Fence a late lease holder after another worker has acquired the expired lease.
let unlock;hold=new Promise(r=>unlock=r);const oldGets=gets,late=call('/api/background/manual-test-window');while(gets===oldGets)await new Promise(r=>setTimeout(r,1));
sql.prepare('UPDATE response_jobs SET poll_token=?,poll_expires_at=? WHERE manual_grant_id=?').run('new-holder',Date.now()+120000,'test-window');unlock();assert.equal((await late).status,503);hold=null;
assert.equal(sql.prepare('SELECT poll_token FROM response_jobs WHERE manual_grant_id=?').get('test-window').poll_token,'new-holder');
sql.prepare('UPDATE response_jobs SET poll_expires_at=0 WHERE manual_grant_id=?').run('test-window');assert.equal((await call('/api/background/manual-test-window')).status,200);

// A later grant cannot silently bypass an in-flight task.
const next={...env,MANUAL_TRIAL_ID:'next-window'};const nextDraft=await (await call('/api/manual/prepare',args,next)).json();assert.equal((await call('/api/manual/submit',{approval_id:nextDraft.approval_id,approved:true},next)).status,409);assert.equal(posts,1);
// Explicitly acknowledged historical unknown is retained; a newly unknown manual task is not auto-retried.
sql.prepare("UPDATE response_jobs SET state='submission_unknown' WHERE manual_grant_id=?").run('test-window');const oldId=status.manual_trial.job.id;
const ack={...next,MANUAL_ACK_UNKNOWN_IDS:JSON.stringify([oldId])};const ackDraft=await (await call('/api/manual/prepare',args,ack)).json();losePost=true;const unknown=await (await call('/api/manual/submit',{approval_id:ackDraft.approval_id,approved:true},ack)).json();assert.equal(unknown.state,'submission_unknown');assert.equal(posts,2);await call('/api/manual/submit',{approval_id:ackDraft.approval_id,approved:true},ack);assert.equal(posts,2);assert.equal(sql.prepare('SELECT state FROM response_jobs WHERE id=?').get(oldId).state,'submission_unknown');
assert.equal((await call('/api/manual/submit',confirmed,{...env,MANUAL_TRIAL_EXPIRES_AT:'1'})).status,409);
const receipt=usageReceipt({model:'gpt-6.1-terra',service_tier:'default',status:'completed',usage:{input_tokens:1000,input_tokens_details:{},output_tokens:0},tool_usage:{image_gen:{input_tokens:10,input_tokens_details:{image_tokens:10,text_tokens:0},output_tokens:1,output_tokens_details:{image_tokens:1,text_tokens:0}}}});const part=receipt.parts.find(p=>p.name==='main_input_cache_unknown');assert.equal(part.usd_min,.00005);assert.equal(part.usd_max,.00125);assert.equal(receipt.amount,null);assert.ok(receipt.missing.includes('main_cache_breakdown'));
console.log('PASS v23 manual: closed-before-secret, owner/model/size scopes, no legacy/MCP bypass, prepare-confirm binding, same-grant atomic one POST, restore status, lease single GET, active-owner block, explicit historical-unknown acknowledgement, unknown no repeat, expiry, model-specific cache bounds. Fake transport only.');
