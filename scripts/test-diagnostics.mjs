import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createResponsesTransport} from '../worker/responses-transport.mjs';
import {createBackgroundAdapter} from '../worker/responses-background.mjs';
const fakeKey='sk-proj-SENTINEL-NEVER-LOG',privatePrompt='PRIVATE_PROMPT_NEVER_LOG',fakeImage='data:image/png;base64,SENTINEL_IMAGE_NEVER_LOG';
let externalCalls=0;const config={LIVE_ENABLED:'true',OPENAI_API_KEY:fakeKey};
for(const status of [400,401,403,429,500,503]){
 const transport=createResponsesTransport(config,async()=>{externalCalls++;return new Response(JSON.stringify({error:{code:status===401?'invalid_api_key':status===429?'rate_limit_exceeded':'unsupported_parameter',type:'invalid_request_error',message:[fakeKey,privatePrompt,fakeImage,'Authorization: Bearer '+fakeKey].join(' ')}}),{status,headers:{'x-request-id':'req_diagnostic_'+status,'openai-processing-ms':'12','retry-after':'2','content-type':'application/json','authorization':fakeKey,'x-sensitive':privatePrompt}})});
 await assert.rejects(transport.create({input:privatePrompt}),e=>{const d=e.diagnostic;assert.equal(d.http_status,status);assert.equal(d.request_id,'req_diagnostic_'+status);assert.equal(d.outcome,status<500?'http_rejected':'http_uncertain');assert.ok(d.started_at&&d.finished_at&&d.elapsed_ms>=0);const serialized=JSON.stringify(d);for(const x of [fakeKey,privatePrompt,fakeImage,'Authorization'])assert.equal(serialized.includes(x),false);assert.deepEqual(Object.keys(d.headers).sort(),['content-type','openai-processing-ms','retry-after','x-request-id']);return true;});
}
for(const [name,fetcher,outcome] of [['timeout',async()=>{throw Object.assign(Error(fakeKey),{name:'TimeoutError'})},'network_uncertain'],['network',async()=>{throw Error(privatePrompt)},'network_uncertain'],['parse',async()=>new Response('not JSON '+fakeKey,{headers:{'x-request-id':'req_parse'}}),'response_parse_uncertain']]){
 await assert.rejects(createResponsesTransport(config,fetcher).create({}),e=>{assert.equal(e.diagnostic.outcome,outcome);assert.equal(JSON.stringify(e.diagnostic).includes(fakeKey),false);assert.equal(JSON.stringify(e.diagnostic).includes(privatePrompt),false);return true});
}
const sql=new DatabaseSync(':memory:');for(const p of ['0000_canvas','0001_probes','0002_responses','0003_response_live','0004_response_diagnostics','0005_job_plan','0006_manual_trial','0007_input_formats','0008_work_history','0009_storage_recovery'])sql.exec(await readFile('drizzle/'+p+'.sql','utf8'));
let failSave=false;const db={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)},async all(){return {results:sql.prepare(q).all(...args)}},async run(){if(failSave&&q.startsWith('UPDATE response_jobs')&&args[1]==='resp_recovered'){failSave=false;throw Error('Injected D1 failure')}return sql.prepare(q).run(...args)}}}}}};
const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10]);new DataView(b.buffer).setUint32(16,1672);new DataView(b.buffer).setUint32(20,941);const hash=createHash('sha256').update(b).digest('hex');
const objects=new Map([['files/input',b]]),bucket={async put(k,v){objects.set(k,typeof v==='string'?new TextEncoder().encode(v):v)},async get(k){return objects.has(k)?{body:objects.get(k)}:null}};
let posts=0,gets=0;const transport=createResponsesTransport(config,async(url,options)=>{if(options.method==='POST')posts++;else gets++;return Response.json({id:'resp_recovered',status:'queued',output:[]},{headers:{'x-request-id':'req_recovered'}})});
sql.prepare('INSERT INTO assets(id,owner,hash,width,height,bytes) VALUES(?,?,?,?,?,?)').run('input','owner',hash,1672,941,b.length);
const adapter=createBackgroundAdapter({db,bucket,api:transport,liveEnabled:true});const args={asset_id:'input',prompt:privatePrompt,approved:true};
failSave=true;await assert.rejects(adapter.submit('owner','checkpoint',args),/resp_recovered.*persistence failed.*checkpoint saved/);assert.equal(posts,1);
const restored=await adapter.poll('owner','checkpoint');assert.equal(restored.response_id,'resp_recovered');assert.equal(gets,1);assert.equal(posts,1);assert.ok(JSON.parse(restored.diagnostics).some(d=>d.request_id==='req_recovered'));
for(const [status,state] of [[401,'submission_rejected'],[403,'submission_rejected'],[400,'submission_rejected'],[429,'submission_rejected'],[500,'submission_unknown']]){const owner='http_'+status;sql.prepare('INSERT INTO assets(id,owner,hash,width,height,bytes) VALUES(?,?,?,?,?,?)').run(owner,owner,hash,1672,941,b.length);objects.set('files/'+owner,b);let calls=0;const api=createResponsesTransport(config,async()=>{calls++;return Response.json({error:{code:'invalid_request_error',message:privatePrompt}},{status,headers:{'x-request-id':'req_'+status}})});const a=createBackgroundAdapter({db,bucket,api,liveEnabled:true});const result=await a.submit(owner,'once',{...args,asset_id:owner});assert.equal(result.state,state);await a.submit(owner,'once',{...args,asset_id:owner});await a.poll(owner,'once');assert.equal(calls,1);assert.equal(JSON.stringify(result.diagnostics).includes(privatePrompt),false);}
console.log('PASS diagnostics: 400/401/403/429 rejected, 5xx/timeout/network/parse uncertain; allowlisted headers/request IDs/stage times; no secret/prompt/base64 in diagnostics; response-ID checkpoint restores after D1 failure; no second POST. All transport injected; actual OpenAI calls 0.');

let postForbidden=0;const readOnly=createResponsesTransport({LIVE_ENABLED:'false',POLL_ENABLED:'true',OPENAI_API_KEY:'FAKE'},async()=>{postForbidden++;return Response.json({id:'resp_readonly',status:'queued'})},{readOnly:true});await assert.rejects(readOnly.create({}),/disabled/);assert.equal(postForbidden,0);await readOnly.retrieve('resp_readonly');assert.equal(postForbidden,1);
let redirects=0;
await assert.rejects(createResponsesTransport(config,async(url,options)=>{redirects++;assert.equal(options.redirect,'manual');return new Response(null,{status:307,headers:{location:'https://untrusted.example/'}})}).create({}),e=>e.diagnostic.stage==='redirect_rejected');
assert.equal(redirects,1);
await assert.rejects(createResponsesTransport(config,async()=>{throw new TypeError('Illegal invocation',{cause:new Error(fakeKey)})}).create({}),e=>{assert.equal(e.diagnostic.stage,'fetch_invoked');assert.equal(e.diagnostic.exception.name,'TypeError');assert.equal(e.diagnostic.exception.message,'Illegal invocation');assert.equal(JSON.stringify(e.diagnostic).includes(fakeKey),false);return true});
console.log('PASS Worker-compatible manual redirect, no redirect forwarding, safe exception name/message/cause, accurate fetch-invoked stage.');

const {receiptView}=await import('../worker/responses-background.mjs');
const priced=receiptView(JSON.stringify({actual_main_model:'gpt-6-astra',response_status:'completed',image_call_count:1,service_tier:'default',main_usage:{input_tokens:9848,input_tokens_details:{cache_write_tokens:2300,cached_tokens:0},output_tokens:241},image_usage:{input_tokens:1746,input_tokens_details:{image_tokens:1508,text_tokens:238},output_tokens:2694,output_tokens_details:{image_tokens:2694,text_tokens:0}}}));
assert.ok(Math.abs(priced.estimated_range.min-0.2004135)<1e-10);assert.ok(Math.abs(priced.estimated_range.max-0.210354)<1e-10);assert.equal(receiptView(null).amount,null);console.log('PASS saved usage recalculation, short-context default30m rates, unknown image-cache interval, missing usage remains unknown.');

