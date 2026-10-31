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
let lastBody=null;let posts=0,gets=0,losePost=false,hold=null;const app=createWorker(async(url,o)=>{if(o.method==='POST'){lastBody=JSON.parse(o.body);posts++;if(losePost)throw Error('Lost POST')}else{gets++;if(hold)await hold;}return Response.json({id:'resp_manual',model:'gpt-6.1-terra',service_tier:'default',status:'queued',output:[]})});
const call=(path,body,config=env,owner='owner')=>app.fetch(new Request('https://manual.test'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':owner,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),config);
const args={asset_id:'input',prompt:'Enhance background',preserve:'Keep character and composition',scale:2};

Object.assign(env,{MANUAL_MODE:'per_order',MANUAL_MODE_ID:'daily'});
const prep=async(a=args)=>{const response=await call('/api/manual/prepare',a);assert.equal(response.status,200);return response.json()};
const one=await prep(),two=await prep();assert.notEqual(one.idempotency_key,two.idempotency_key);assert.equal(posts,0);
let pair=await Promise.all([call('/api/manual/submit',{approval_id:one.approval_id,approved:true}),call('/api/manual/submit',{approval_id:two.approval_id,approved:true})]);assert.equal(posts,1);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
const accepted=sql.prepare('SELECT * FROM response_jobs').get();assert.equal((await call('/api/manual/prepare',args)).status,409);
assert.equal((await call('/api/background', {...args,approved:true,idempotency_key:'bypass'})).status,409);
const mcp=await (await call('/mcp',{id:1,method:'tools/call',params:{name:'canvas_submit_background',arguments:{...args,approved:true,idempotency_key:'mcp-bypass'}}})).json();assert.equal(mcp.result.isError,true);assert.equal(posts,1);
sql.prepare("UPDATE response_jobs SET state='submission_unknown'").run();assert.equal((await (await call('/api/status')).json()).manual_trial.available,false);assert.equal((await call('/api/manual/prepare',args)).status,409);
sql.prepare("UPDATE response_jobs SET state='completed'").run();assert.equal((await (await call('/api/status')).json()).manual_trial.available,true);
await call('/api/manual/submit',{approval_id:one.approval_id,approved:true});assert.equal(posts,1);
const three=await prep({...args,image_model:'gpt-image-2.5-flare'});assert.equal(three.plan.image_model,'gpt-image-2.5-flare');
assert.equal((await call('/api/manual/submit',{approval_id:three.approval_id,approved:true},env,'other')).status,409);
await call('/api/manual/submit',{approval_id:three.approval_id,approved:true});assert.equal(posts,2);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM response_jobs').get().n,2);assert.equal((await call('/api/background/old-key')).status,409);
console.log('PASS regular mode: unique per-order keys, no lifetime quota, one active owner task, atomic concurrent claim, unknown blocks, historical records retained, completed same-key replay no POST, cross-owner rejection, old HTTP/MCP blocked, Flare explicit choice. Fake transport only.');

for(const orientation of [1,6]){const jpg=new Uint8Array(await readFile('scripts/fixtures-v27/orientation-'+orientation+'.jpg'));const response=await app.fetch(new Request('https://manual.test/api/files',{method:'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':'owner','content-type':'image/jpeg'},body:jpg}),env);assert.equal(response.status,200);const a=await response.json();assert.equal(a.mime,'image/jpeg');assert.equal(a.normalized,orientation!==1);const download=await call('/api/files/'+a.id);assert.equal(download.headers.get('content-type'),'image/jpeg');assert.match(download.headers.get('content-disposition'),/jpg/);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),jpg);
sql.prepare("UPDATE response_jobs SET state='completed'").run();const quote=await prep({...args,asset_id:a.id});await call('/api/manual/submit',{approval_id:quote.approval_id,approved:true});assert.match(lastBody.input[0].content[1].image_url,orientation===1?/^data:image\/jpeg;base64,/:/^data:image\/png;base64,/);const recorded=sql.prepare('SELECT * FROM response_jobs WHERE idem=?').get(quote.idempotency_key);assert.equal(recorded.input_asset,a.id);}
console.log('PASS JPEG HTTP upload, original-byte download/MIME, EXIF normalized derivative, original source binding, correct Responses data MIME. Fake API only.');

let finishUpload;const stream=new ReadableStream({start(c){finishUpload=()=>{c.enqueue(new Uint8Array([1,2,3]));c.close()}}});
const pendingUpload=app.fetch(new Request('https://manual.test/api/files',{method:'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':'owner'},body:stream,duplex:'half'}),env);
const rejected=await app.fetch(new Request('https://manual.test/api/files',{method:'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':'owner'},body:new Uint8Array([1])}),env);assert.equal(rejected.status,429);finishUpload();assert.equal((await pendingUpload).status,400);
const afterFailure=await app.fetch(new Request('https://manual.test/api/files',{method:'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':'owner'},body:await readFile('scripts/fixtures-v27/orientation-1.jpg')}),env);assert.equal(afterFailure.status,200);
console.log('PASS isolate upload serialization starts before body read and releases after failure.');

// Independent follow-up: grant namespace, acknowledged unknown specificity, retry after lost POST.
sql.exec("UPDATE response_jobs SET state='completed'");
const stale=await prep();const changed={...env,MANUAL_MODE_ID:'new-namespace'};
assert.equal((await call('/api/manual/submit',{approval_id:stale.approval_id,approved:true},changed)).status,409);
const beforeUnknown=posts;losePost=true;
const pending=await prep();const lost=await(await call('/api/manual/submit',{approval_id:pending.approval_id,approved:true})).json();assert.equal(lost.state,'submission_unknown');assert.equal(posts,beforeUnknown+1);
await call('/api/manual/submit',{approval_id:pending.approval_id,approved:true});assert.equal(posts,beforeUnknown+1);
assert.equal((await call('/api/manual/submit',{approval_id:stale.approval_id,approved:true})).status,409);
assert.equal((await call('/api/manual/prepare',args,{...env,MANUAL_ACK_UNKNOWN_IDS:'["unrelated-old-id"]'})).status,409);
assert.equal((await(await call('/api/status')).json()).manual_trial.available,false);
console.log('PASS independent regular namespace replacement denied, lost POST one call, old preprepared quote blocked by new unknown, unrelated ack does not clear block');
// Demonstrate overlap before making any runtime-memory claim.
sql.prepare("UPDATE response_jobs SET state='queued',response_id='resp_manual' WHERE id=?").run(lost.id);
let streaming=false,finishBody;const overlapApp=createWorker(async()=>new Response(new ReadableStream({start(c){streaming=true;c.enqueue(new TextEncoder().encode('{"id":"resp_manual","status":"queued","padding":"'+ 'x'.repeat(1024*1024)));finishBody=()=>{c.enqueue(new TextEncoder().encode('"}'));c.close()}}}),{headers:{'content-type':'application/json'}}));
const read=overlapApp.fetch(new Request('https://manual.test/api/background/'+pending.idempotency_key,{headers:{'oai-authenticated-user-id':'owner'}}),env);
while(!streaming)await new Promise(r=>setTimeout(r,1));
const simultaneousUpload=await overlapApp.fetch(new Request('https://manual.test/api/files',{method:'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':'owner','content-type':'image/jpeg'},body:await readFile('scripts/fixtures-v27/orientation-6.jpg')}),env);
assert.equal(simultaneousUpload.status,429);assert.ok(streaming);console.log('PASS v28 upload rejected while same-isolate response body is pending');finishBody();assert.equal((await read).status,200);


// Lock releases after response parsing, including failed parsing; pre-POST busy consumes nothing.
sql.exec("UPDATE response_jobs SET state='completed'");losePost=false;
const fresh=await prep();let releaseUpload;
const stalled=app.fetch(new Request('https://manual.test/api/files',{method:'POST',headers:{origin:'https://manual.test','oai-authenticated-user-id':'owner'},body:new ReadableStream({start(c){releaseUpload=()=>{c.enqueue(new Uint8Array([0]));c.close()}}}),duplex:'half'}),env);
const beforePosts=posts,beforeRows=sql.prepare('SELECT COUNT(*) n FROM response_jobs').get().n;
assert.equal((await call('/api/manual/submit',{approval_id:fresh.approval_id,approved:true})).status,409);
assert.equal(posts,beforePosts);assert.equal(sql.prepare('SELECT COUNT(*) n FROM response_jobs').get().n,beforeRows);
releaseUpload();assert.equal((await stalled).status,400);
assert.equal((await call('/api/manual/submit',{approval_id:fresh.approval_id,approved:true})).status,200);assert.equal(posts,beforePosts+1);
console.log('PASS v28 busy before POST adds no job and consumes no approval; same confirmation succeeds after release.');
