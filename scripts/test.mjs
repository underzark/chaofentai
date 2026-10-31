import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker,{receipt} from '../worker/index.js';
const sql=new DatabaseSync(':memory:');sql.exec(await readFile('drizzle/0000_canvas.sql','utf8'));sql.exec(await readFile('drizzle/0001_probes.sql','utf8'));sql.exec(await readFile('drizzle/0002_responses.sql','utf8'));sql.exec(await readFile('drizzle/0003_response_live.sql','utf8'));sql.exec(await readFile('drizzle/0004_response_diagnostics.sql','utf8'));sql.exec(await readFile('drizzle/0005_job_plan.sql','utf8'));sql.exec(await readFile('drizzle/0006_manual_trial.sql','utf8'));sql.exec(await readFile('drizzle/0007_input_formats.sql','utf8'));sql.exec(await readFile('drizzle/0008_work_history.sql','utf8'));sql.exec(await readFile('drizzle/0009_storage_recovery.sql','utf8'));
const objects=new Map();const env={DB:{prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)},async all(){return {results:sql.prepare(q).all(...args)}},async run(){return sql.prepare(q).run(...args)}}}}}},BUCKET:{async put(k,b){objects.set(k,b.slice())},async get(k,options){const b=objects.get(k);return b?{body:options?.range?b.subarray(options.range.offset,options.range.offset+options.range.length):b}:null}}};
const origin='https://trial.test';async function call(path,method='GET',body,who='owner'){return worker.fetch(new Request(origin+path,{method,headers:{...(who?{'oai-authenticated-user-id':who}:{}),origin},body}),env)}
assert.equal((await call('/api/jobs','GET',null,null)).status,401);
assert.equal((await call('/','GET',null,null)).status,302);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64');
const a=await (await call('/api/files','POST',png)).json();assert.equal(a.width,1);assert.equal(a.height,1);
const downloaded=Buffer.from(await (await call(a.download)).arrayBuffer());assert.deepEqual(downloaded,png);
assert.equal((await call(a.download,'GET',null,'other')).status,404);
const args={asset_id:a.id,idempotency_key:'retry-case',delay_seconds:180};const j=await (await call('/api/jobs','POST',JSON.stringify(args))).json();assert.equal(j.state,'mock_waiting');
assert.equal((await (await call('/api/jobs','POST',JSON.stringify(args))).json()).id,j.id);
assert.equal((await call('/api/jobs','POST',JSON.stringify({...args,delay_seconds:0}))).status,409);
assert.equal((await call('/api/jobs','POST',JSON.stringify({...args,mode:'live'}))).status,409);
assert.equal((await call('/api/jobs/'+j.id,'GET',null,'other')).status,404);
sql.prepare('UPDATE jobs SET ready_at=0 WHERE id=?').run(j.id);assert.equal((await (await call('/api/jobs/'+j.id)).json()).state,'mock_ready');
for(const method of ['server/discover','tools/list'])assert.ok((await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:1,method}))).json()).result);
const m=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'canvas_get_result',arguments:{job_id:j.id}}}))).json();assert.equal(JSON.parse(m.result.content[0].text).cost.basis,'mock_no_api_call');
assert.equal(receipt(null,null,'x').amount,null);assert.equal(receipt({input:1},{model:'y'},'x').amount,null);
const p={model:'x',version:'test-only',source:'test fixture',parts:[{key:'input',usd_per_million:10},{key:'cached',usd_per_million:1},{key:'output',usd_per_million:20}]};
assert.ok(Math.abs(receipt({input:100,cached:100,output:100},p,'x').amount-0.0031)<1e-12);assert.equal(receipt({input:100},p,'x').amount,null);assert.equal(receipt({input:-1,cached:0,output:0},p,'x').amount,null);
assert.equal((await worker.fetch(new Request(origin+'/api/files',{method:'POST',headers:{'oai-authenticated-user-id':'owner',origin:'https://evil.test'},body:png}),env)).status,403);
console.log('PASS: auth, ownership, PNG byte equality, idempotency/replay/conflict, mock wait/recovery, live rejection, MCP discovery/call, unknown cost/cache breakdown, CSRF');

const fc=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'canvas_create_test_fixture'}}))).json();
const fa=JSON.parse(fc.result.content[0].text);assert.equal(fa.width,3344);assert.equal(fa.height,1882);assert.ok(fa.bytes>11*1024*1024&&fa.bytes<16*1024*1024);
const vc=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'canvas_verify_file',arguments:{asset_id:fa.id}}}))).json();assert.equal(JSON.parse(vc.result.content[0].text).matches_upload,true);
const bad=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'canvas_import_file',arguments:{file:{download_url:'http://127.0.0.1/private',file_id:'test'}}}}))).json();assert.equal(bad.result.isError,true);
console.log('PASS: 11MiB synthetic 3344x1882 PNG, stored-file checksum, unsafe file URL rejection');
const embedded=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'canvas_read_file',arguments:{asset_id:a.id}}}))).json();assert.deepEqual(Buffer.from(embedded.result.content[1].resource.blob,'base64'),png);assert.equal(JSON.parse(embedded.result.content[0].text).cost.currency,'USD');console.log('PASS: MCP embedded resource preserves original PNG bytes with cost');
const savedFetch=globalThis.fetch;let fetched=0;
globalThis.fetch=async()=>{fetched++;return fetched===1?new Response(null,{status:302,headers:{location:'https://files.oaiusercontent.com/test.png'}}):new Response(png)};
const imp=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'canvas_import_file',arguments:{file:{file_id:'synthetic-test',download_url:'https://files.oaiusercontent.com/redirect'}}}}))).json();assert.equal(JSON.parse(imp.result.content[0].text).sha256,a.sha256);assert.equal(fetched,2);
globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});
const unsafe=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'canvas_import_file',arguments:{file:{file_id:'synthetic-test',download_url:'https://files.oaiusercontent.com/redirect'}}}}))).json();assert.equal(unsafe.result.isError,true);globalThis.fetch=savedFetch;
console.log('PASS: allowed file redirect succeeds, redirected local URL rejected');

const part=await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'canvas_read_file_chunk',arguments:{asset_id:fa.id,offset:262144,length:262144}}}))).json();assert.equal(part.result.content[1].resource.mimeType,'application/octet-stream');assert.equal(Buffer.from(part.result.content[1].resource.blob,'base64').length,262144);assert.deepEqual(Buffer.from(part.result.content[1].resource.blob,'base64'),Buffer.from(objects.get(sql.prepare('SELECT storage_key FROM assets WHERE id=?').get(fa.id).storage_key).subarray(262144,524288)));console.log('PASS: bounded R2 range preserves exact requested bytes');

const probeArgs={probe_key:'test-probe',probe_seconds:0,asset_id:a.id};
async function probe(args){return (await (await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'canvas_status',arguments:args}}))).json()).result}
const pr=JSON.parse((await probe(probeArgs)).content[0].text);assert.equal(pr.state,'completed');assert.ok(objects.has('probes/'+pr.id+'/output.png'));assert.equal(JSON.parse((await probe(probeArgs)).content[0].text).id,pr.id);assert.equal((await probe({...probeArgs,probe_seconds:1})).isError,true);
sql.prepare('UPDATE probes SET state=?,lastbeat=? WHERE id=?').run('running',0,pr.id);assert.equal(JSON.parse((await probe({probe_key:'test-probe'})).content[0].text).observed_state,'unknown_after_disconnect_or_stall');console.log('PASS: real request probe completion, output persistence, no duplicate execution, conflict and unknown-stale state');
const streamed=await call('/mcp','POST',JSON.stringify({jsonrpc:'2.0',id:11,method:'tools/call',params:{name:'canvas_status',arguments:{probe_key:'stream-test',probe_seconds:0,asset_id:a.id,probe_stream:true}}}));assert.equal(streamed.headers.get('content-type'),'text/event-stream');const eventText=await streamed.text();assert.ok(eventText.includes('"state":"completed"')===false);assert.ok(eventText.includes('event: message'));assert.ok(eventText.includes('completed'));console.log('PASS: optional SSE probe sends final JSON-RPC result');

const corrupt=Buffer.from(png);corrupt[45]^=1;assert.equal((await call('/api/files','POST',corrupt)).status,400);assert.equal((await call('/api/files','POST',png.subarray(0,33))).status,400);
assert.equal((await worker.fetch(new Request(origin+'/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'owner',origin:'https://evil.test'},body:JSON.stringify({method:'tools/list'})}),env)).status,403);
assert.equal((await call('/mcp','POST',' '.repeat(65537))).status,413);
console.log('PASS v21 corrupt/truncated PNG rejected before storage; foreign-Origin MCP and oversized JSON blocked.');
