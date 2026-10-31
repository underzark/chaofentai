import {isolatedAdapter} from './isolated-adapter.mjs';
const otherIsolate=await isolatedAdapter();
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createBackgroundAdapter,usageReceipt,receiptView} from '../worker/responses-background.mjs';
globalThis.fetch=()=>{throw Error('Network forbidden in review regression')};
const usage={input_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens:10};
const image_gen={input_tokens:10,input_tokens_details:{image_tokens:10,text_tokens:0},output_tokens:0,output_tokens_details:{image_tokens:0,text_tokens:0}};
for(const extra of [{status:'completed'},{status:'incomplete'},{status:'completed',output:[{type:'image_generation_call'},{type:'image_generation_call'}]},{status:'completed',service_tier:'unrecognized-tier'}]){
 const before=usageReceipt({id:'resp_test',model:'gpt-6.1-terra',service_tier:'default',usage,tool_usage:{image_gen},...extra}),after=receiptView(JSON.stringify(before));
 assert.equal(before.amount,null);assert.equal(after.amount,null);assert.equal(after.accounting_status,'usage_incomplete');for(const flag of before.missing)assert.ok(after.missing.includes(flag));
}
const legacy=receiptView(JSON.stringify({actual_main_model:'gpt-6.1-terra',service_tier:'default',main_usage:usage,image_usage:image_gen}));assert.equal(legacy.amount,null);assert.ok(legacy.missing.includes('historical_completion_evidence_missing'));
for(const tier of [undefined,'priority','flex','unrecognized-tier'])assert.ok(usageReceipt({model:'gpt-6.1-terra',service_tier:tier,usage,tool_usage:{image_gen}}).missing.includes('service_tier_pricing_unverified'));
const sql=new DatabaseSync(':memory:');for(const p of ['0000_canvas','0001_probes','0002_responses','0003_response_live','0004_response_diagnostics','0005_job_plan','0006_manual_trial','0007_input_formats','0008_work_history','0009_storage_recovery'])sql.exec(await readFile('drizzle/'+p+'.sql','utf8'));
let failUpdate=false;
const db={prepare(q){return {bind(...a){return {async first(){return sql.prepare(q).get(...a)},async all(){return {results:sql.prepare(q).all(...a)}},async run(){if(failUpdate&&q.startsWith('UPDATE')){failUpdate=false;throw Error('D1 unavailable')}return sql.prepare(q).run(...a)}}}}}};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
const plan={version:2,output_mode:'original',image_model:'gpt-image-2.5-sunburst',generation_width:1,generation_height:1};
const done=()=>({id:'resp_test',status:'completed',model:'gpt-6.1-terra',service_tier:'default',usage,tool_usage:{image_gen:{...image_gen,output_tokens:1,output_tokens_details:{image_tokens:1,text_tokens:0}}},output:[{type:'image_generation_call',status:'completed',result:png.toString('base64')}]});
let count=0;const objects=new Map();let failR2=false;
const bucket={async put(k,b){if(failR2)throw Error('R2 unavailable');objects.set(k,b)},async get(k){return objects.has(k)?{body:objects.get(k)}:null}};
function seed(){const key='key'+count++;sql.prepare('INSERT INTO response_jobs(id,owner,idem,fingerprint,state,response_id,plan_json) VALUES(?,?,?,?,?,?,?)').run(key,'owner',key,'fp','in_progress','resp_test',JSON.stringify(plan));return key;}
const row=key=>sql.prepare('SELECT * FROM response_jobs WHERE idem=?').get(key);
for(const newer of ['failed','completed'])for(const old of ['in_progress','queued','error','completed']){
 const key=seed();let release,start,calls=0;const gate=new Promise(r=>release=r),started=new Promise(r=>start=r);
 const api={kind:'fake',async retrieve(){if(++calls===1){start();await gate;if(old==='error')throw Error('late GET');return old==='completed'?done():{id:'resp_test',status:old}}return newer==='completed'?done():{id:'resp_test',status:newer}}};
 const a=createBackgroundAdapter({db,bucket,api}),pending=a.poll('owner',key);await started;await otherIsolate({db,bucket,api}).poll('owner',key);const before=row(key);assert.equal(before.state,newer);release();await pending;const after=row(key);assert.equal(after.state,newer);assert.equal(after.result_asset,before.result_asset);assert.equal(after.original_asset,before.original_asset);assert.equal(after.receipt,before.receipt);assert.equal(after.output_key,before.output_key);if(old==='error')assert.ok(JSON.parse(after.diagnostics).some(x=>x.stage==='poll'));
}
// Retry only GET after storage failure; a stale running response cannot erase output_pending.
for(const storage of ['R2','D1']){
 const key=seed();const a=createBackgroundAdapter({db,bucket,api:{kind:'fake',async retrieve(){return done()}}});if(storage==='R2')failR2=true;else failUpdate=true;
 await assert.rejects(a.poll('owner',key));failR2=false;failUpdate=false;await a.poll('owner',key);assert.equal(row(key).state,'completed');assert.deepEqual(Buffer.from(objects.get(row(key).output_key)),png);
}
// Concurrent identical completion updates contend on CAS, but preserve one terminal result.
const key=seed();const a=createBackgroundAdapter({db,bucket,api:{kind:'fake',async retrieve(){return done()}}});await Promise.all([a.poll('owner',key),otherIsolate({db,bucket,api:{kind:'fake',async retrieve(){return done()}}}).poll('owner',key)]);assert.equal(row(key).state,'completed');assert.ok(row(key).result_asset);
console.log('PASS v22: conservative receipt flags/tier/history; terminal failed/completed vs late queued/running/error/completed; assets and receipt retained; R2/D1 GET-only recovery; concurrent CAS. No network.');
