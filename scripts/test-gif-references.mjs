import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createWorker} from '../worker/index.js';
import {normalizeGif} from '../worker/gif.mjs';
import {pngChunk} from '../worker/png-crop.mjs';
import {retainHistory} from '../worker/history.mjs';

// All upstream traffic is injected. An accidental global fetch fails immediately.
globalThis.fetch=()=>{throw Error('External network forbidden in GIF reference tests');};
const hash=b=>createHash('sha256').update(b).digest('hex');
const fixture=Buffer.from('R0lGODlhEAAQAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAEAAQAAAIHQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFgQEBACH5BAEUAAEALAAAAAAQABAAgQAA/wAAAAAAAAAAAAgdAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWBAQEAOw==','base64');
const ih=Buffer.alloc(13);ih.writeUInt32BE(1,0);ih.writeUInt32BE(1,4);ih[8]=8;ih[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ih),pngChunk('IDAT',deflateSync(Buffer.from([0,250,10,20]))),pngChunk('IEND',new Uint8Array())]);
const sql=new DatabaseSync(':memory:');
for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())sql.exec(await readFile('drizzle/'+f,'utf8'));
const db={prepare(q){return {bind(...a){return {async first(){return sql.prepare(q).get(...a);},async all(){return {results:sql.prepare(q).all(...a)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...a).changes)}};}};}};}};
const objects=new Map(),deleted=[];
const env={DB:db,BUCKET:{async get(k){const b=objects.get(k);return b?{body:b.slice()}:null;},async put(k,b){objects.set(k,typeof b==='string'?Buffer.from(b):new Uint8Array(b));},async delete(k){deleted.push(k);objects.delete(k);}},GIF_ENABLED:'true',LIVE_ENABLED:'true',WORK_ENABLED:'true',MANUAL_TRIAL_OWNER:'owner',OPENAI_API_KEY:'FAKE',HISTORY_RETENTION_ENABLED:'true'};
let posts=0,last=null,mode='ok',hold=null;
const app=createWorker(async(url,init)=>{posts++;last={url,init:{...init}};assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');if(hold)await hold;if(mode==='unknown')throw Error('synthetic lost response');return Response.json({data:[{b64_json:fixture.toString('base64')}],usage:{output_tokens:1}});});
const call=(path,body,owner='owner')=>app.fetch(new Request('https://gif.test'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://gif.test','oai-authenticated-user-id':owner,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);
const data=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,await r.clone().text());return r.json();};
const mcp=async(name,args)=> (await data('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})).result;
const parseMcp=r=>{assert.notEqual(r.isError,true,r.content[0].text);return JSON.parse(r.content[0].text);};
const args={prompt:'A cat blinks, seamless loop',frame_count:2};
const prepare=(ids,extra={})=>data('/api/gif/prepare',{...args,...extra,...(ids===undefined?{}:{reference_asset_ids:ids})});
const confirm=q=>({approval_id:q.approval_id,quote_hash:q.quote_hash,approved:true});
const workConfirm=q=>({approval_id:q.approval_id,quote_hash:q.quote_hash,confirmation_text:q.confirmation_text,user_confirmation:'I approve this exact reference image order and unknown cost.'});
const count=table=>sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
const row=id=>sql.prepare('SELECT * FROM assets WHERE id=?').get(id);
const key=id=>row(id).storage_key||'files/'+id;
async function upload(bytes,owner='owner'){
 const r=await app.fetch(new Request('https://gif.test/api/files',{method:'POST',headers:{origin:'https://gif.test','oai-authenticated-user-id':owner},body:bytes}),env);
 assert.equal(r.status,200,await r.clone().text());const a=await r.json();assert.equal(a.sha256,hash(bytes));return a;
}
async function freeFailure(q,mutation,undo){
 const beforePosts=posts,beforeJobs=count('gif_jobs');await mutation();
 try{const r=await call('/api/gif/submit',confirm(q));assert.ok(r.status>=400,`expected free rejection, got ${r.status}: ${await r.text()}`);assert.equal(posts,beforePosts);assert.equal(count('gif_jobs'),beforeJobs);assert.equal(sql.prepare('SELECT confirmed_at FROM gif_quotes WHERE id=?').get(q.approval_id).confirmed_at,null);}finally{await undo();}
}
const a=await upload(png),jpegBytes=await readFile('scripts/fixtures-v27/orientation-6.jpg'),b=await upload(jpegBytes),foreign=await upload(png,'other');
assert.notEqual(a.id,foreign.id);assert.ok(row(b.id).normalized_id,'rotated JPEG must use normalized derivative');
const normalized=row(row(b.id).normalized_id);assert.notEqual(normalized.hash,b.sha256);
for(const ids of [null,'x',[a.id,a.id],Array(17).fill(a.id),['A'.repeat(64)],['x'],[7]])assert.throws(()=>normalizeGif({...args,reference_asset_ids:ids}));
assert.equal('reference_asset_ids' in normalizeGif({...args,reference_asset_ids:[]}),false);
for(const ids of [[foreign.id],['f'.repeat(64)]]){const n=count('gif_quotes');assert.ok((await call('/api/gif/prepare',{...args,reference_asset_ids:ids})).status>=400);assert.equal(count('gif_quotes'),n);}
assert.equal(posts,0);
// Ordered immutable metadata, original/derivative digests, and every relevant quote change.
const q=await prepare([a.id,b.id]);assert.deepEqual(q.summary.request.reference_asset_ids,[a.id,b.id]);assert.equal(q.summary.endpoint,'/v1/images/edits');
assert.equal(q.summary.reference_images[0].sha256,a.sha256);assert.equal(q.summary.reference_images[1].sha256,b.sha256);assert.equal(q.summary.reference_images[1].model_sha256,normalized.hash);assert.equal(q.summary.reference_images[1].model_asset_id,normalized.id);
for(const changed of [await prepare([b.id,a.id]),await prepare([a.id]),await prepare([a.id,b.id],{prompt:'A different loop'}),await prepare([a.id,b.id],{frame_count:3})]){assert.notEqual(changed.quote_hash,q.quote_hash);assert.notEqual(changed.approval_id,q.approval_id);}
assert.equal((await call('/api/gif/submit',{...confirm(q),reference_asset_ids:[b.id]})).status,409);
assert.equal((await call('/api/gif/submit',{...confirm(q),quote_hash:'wrong'})).status,409);
assert.equal((await call('/api/gif/submit',confirm(q),'other')).status,409);
assert.equal((await mcp('canvas_confirm_gif',workConfirm(q))).isError,true);
// Concurrent exact confirmations are single-flight, followed by permanent replay safety.
let release;hold=new Promise(r=>release=r);const pending=call('/api/gif/submit',confirm(q));while(!posts)await new Promise(r=>setTimeout(r,1));const duplicate=await call('/api/gif/submit',confirm(q));assert.ok([200,429].includes(duplicate.status));assert.equal(posts,1);release();hold=null;
const result=await (await pending).json();assert.equal(result.state,'completed');assert.equal(last.url,'https://api.openai.com/v1/images/edits');assert.ok(last.init.body instanceof FormData);assert.equal(new Headers(last.init.headers).has('content-type'),false);
const form=last.init.body,files=form.getAll('image[]');assert.equal(files.length,2);assert.deepEqual(Buffer.from(await files[0].arrayBuffer()),png);assert.deepEqual(Buffer.from(await files[1].arrayBuffer()),Buffer.from(objects.get(key(normalized.id))));assert.equal(files[0].type,'image/png');assert.equal(files[1].type,normalized.mime);assert.equal(form.get('output_format'),'gif');assert.equal(form.get('frame_count'),'2');assert.equal(form.get('prompt'),args.prompt);
for(const local of ['reference_asset_ids','reference_images','asset_id','model_asset_id'])assert.equal(form.has(local),false);
for(const [,value] of form)if(typeof value==='string')for(const id of [a.id,b.id,normalized.id])assert.equal(value.includes(id),false);
await data('/api/gif/submit',confirm(q));await data('/api/gif/jobs/'+q.idempotency_key);assert.equal(posts,1);
const out=result.outputs[0];assert.equal((await call('/api/gif/prepare',{...args,reference_asset_ids:[out.asset_id]})).status,400);
// Empty/omitted references preserve the original JSON text-only endpoint.
for(const refs of [undefined,[]]){const plain=await prepare(refs);assert.equal(plain.summary.endpoint,'/v1/images/generations');await data('/api/gif/submit',confirm(plain));assert.equal(last.url,'https://api.openai.com/v1/images/generations');assert.equal(new Headers(last.init.headers).get('content-type'),'application/json');const json=JSON.parse(last.init.body);assert.equal(json.output_format,'gif');assert.equal('reference_asset_ids' in json,false);assert.equal('reference_images' in json,false);}
// Work/web separation applies equally to image-conditioned GIFs.
const work=parseMcp(await mcp('canvas_prepare_gif',{...args,reference_asset_ids:[b.id]}));assert.equal((await call('/api/gif/submit',confirm(work))).status,409);const beforeWork=posts;assert.equal(parseMcp(await mcp('canvas_confirm_gif',workConfirm(work))).state,'completed');await mcp('canvas_confirm_gif',workConfirm(work));assert.equal(posts,beforeWork+1);assert.equal(last.url,'https://api.openai.com/v1/images/edits');
// Asset metadata changes, missing bytes, and same-length corruption must fail before claim.
for(const [id,field,value] of [[a.id,'storage_state','deleting'],[a.id,'hash','e'.repeat(64)],[b.id,'normalized_id',a.id],[normalized.id,'mime','image/gif']]){
 const fresh=await prepare([a.id,b.id]),old=row(id)[field];await freeFailure(fresh,()=>sql.prepare(`UPDATE assets SET ${field}=? WHERE id=?`).run(value,id),()=>sql.prepare(`UPDATE assets SET ${field}=? WHERE id=?`).run(old,id));
}
for(const id of [a.id,normalized.id,b.id])for(const damage of ['missing','same-length','too-short','too-long']){
 const fresh=await prepare([a.id,b.id]),k=key(id),old=objects.get(k);
 await freeFailure(fresh,()=>{if(damage==='missing')objects.delete(k);else if(damage==='same-length'){const bad=old.slice();bad[bad.length-1]^=1;objects.set(k,bad);}else objects.set(k,damage==='too-short'?old.slice(0,-1):Buffer.concat([old,Buffer.from([0])]));},()=>objects.set(k,old));
}
const expired=await prepare([a.id]);await freeFailure(expired,()=>sql.prepare('UPDATE gif_quotes SET expires_at=0 WHERE id=?').run(expired.approval_id),()=>{});
const tampered=await prepare([a.id]),snapshot=sql.prepare('SELECT request_json FROM gif_quotes WHERE id=?').get(tampered.approval_id).request_json;
await freeFailure(tampered,()=>sql.prepare('UPDATE gif_quotes SET request_json=? WHERE id=?').run(JSON.stringify({...JSON.parse(snapshot),prompt:'unapproved replacement'}),tampered.approval_id),()=>sql.prepare('UPDATE gif_quotes SET request_json=? WHERE id=?').run(snapshot,tampered.approval_id));
// Exercise count/file/aggregate limits using metadata-only fixtures. No large allocation needed.
const limitIds=[];for(let i=0;i<17;i++){const id=hash('limits-'+i);limitIds.push(id);sql.prepare("INSERT INTO assets(id,owner,hash,width,height,bytes,mime,storage_state) VALUES(?,?,?,?,?,?,?,'active')").run(id,'owner',id,1,1,1024,'image/png');}
assert.equal((await prepare(limitIds.slice(0,16))).summary.reference_images.length,16);
for(const mutate of [()=>sql.prepare('UPDATE assets SET bytes=? WHERE id=?').run(8*1024*1024+1,limitIds[0]),()=>{for(const id of limitIds.slice(0,3))sql.prepare('UPDATE assets SET bytes=? WHERE id=?').run(6*1024*1024,id);},()=>{sql.prepare('UPDATE assets SET normalized_id=? WHERE id=?').run(limitIds[3],limitIds[0]);for(const id of limitIds.slice(1,4))sql.prepare('UPDATE assets SET bytes=? WHERE id=?').run(6*1024*1024,id);}]){
 mutate();const before=count('gif_quotes');assert.equal((await call('/api/gif/prepare',{...args,reference_asset_ids:limitIds.slice(0,3)})).status,400);assert.equal(count('gif_quotes'),before);for(const id of limitIds)sql.prepare('UPDATE assets SET bytes=1024,normalized_id=NULL WHERE id=?').run(id);
}
// Both per-file 8 MiB and combined 16 MiB are inclusive boundaries.
for(const id of limitIds.slice(0,2))sql.prepare('UPDATE assets SET bytes=? WHERE id=?').run(8*1024*1024,id);
assert.equal((await prepare(limitIds.slice(0,2))).summary.reference_images.reduce((n,r)=>n+r.bytes,0),16*1024*1024);
for(const invalidBytes of [0,-1,1.5]){sql.prepare('UPDATE assets SET bytes=? WHERE id=?').run(invalidBytes,limitIds[0]);assert.equal((await call('/api/gif/prepare',{...args,reference_asset_ids:[limitIds[0]]})).status,400);}
for(const id of limitIds)sql.prepare('UPDATE assets SET bytes=1024 WHERE id=?').run(id);
// Unavailable states cannot be quoted; schema rejects foreign derivative links.
assert.throws(()=>sql.prepare('UPDATE assets SET normalized_id=? WHERE id=?').run(foreign.id,limitIds[0]),/not available/);
for(const [field,value] of [['storage_state','deleting'],['storage_state','writing']]){
 const old=row(limitIds[0])[field];sql.prepare(`UPDATE assets SET ${field}=? WHERE id=?`).run(value,limitIds[0]);
 assert.ok((await call('/api/gif/prepare',{...args,reference_asset_ids:[limitIds[0]]})).status>=400);
 sql.prepare(`UPDATE assets SET ${field}=? WHERE id=?`).run(old,limitIds[0]);
}
for(const id of [a.id,normalized.id,out.asset_id])sql.prepare('INSERT OR IGNORE INTO media_gc(owner,asset_id) VALUES(?,?)').run('owner',id);
// Permanent GIF job and GIF output pins survive expired quote cleanup, including derivatives.
sql.exec('UPDATE gif_quotes SET expires_at=0');await retainHistory(env,'owner',{newly_created:true});for(const id of [a.id,normalized.id,out.asset_id]){assert.ok(row(id));assert.ok(objects.has(key(id)));}
const quoted=await upload(await readFile('scripts/fixtures-v27/orientation-8.jpg')),derived=row(quoted.id).normalized_id;assert.ok(derived);const protectedQuote=await prepare([quoted.id]);
for(const id of [quoted.id,derived])sql.prepare('INSERT OR IGNORE INTO media_gc(owner,asset_id) VALUES(?,?)').run('owner',id);
const retainedKeys=[key(quoted.id),key(derived)];await retainHistory(env,'owner',{newly_created:true});for(const id of [quoted.id,derived])assert.ok(row(id),'unexpired quote retains original and derivative');
sql.prepare('UPDATE gif_quotes SET expires_at=0 WHERE id=?').run(protectedQuote.approval_id);await retainHistory(env,'owner',{newly_created:true});for(const id of [quoted.id,derived])assert.equal(row(id),undefined);for(const k of retainedKeys)assert.ok(deleted.includes(k));
// Unknown edits outcomes remain sticky even when their references later disappear.
const unknownQuote=await prepare([a.id]),beforeUnknown=posts;mode='unknown';const unknown=await data('/api/gif/submit',confirm(unknownQuote));assert.equal(unknown.state,'submission_unknown');assert.equal(posts,beforeUnknown+1);const original=objects.get(key(a.id));objects.delete(key(a.id));await data('/api/gif/submit',confirm(unknownQuote));await data('/api/gif/jobs/'+unknownQuote.idempotency_key);assert.equal(posts,beforeUnknown+1);objects.set(key(a.id),original);assert.equal((await call('/api/gif/prepare',args)).status,409);
console.log('PASS GIF references: raw upload and owner isolation; ordered original/normalized SHA quote binding; PNG/JPEG/count/size limits; multipart edits and unchanged JSON generations; free pre-claim stale/tampered failures; concurrent/replay/unknown one-POST safety; Work/web isolation; permanent job/output and expiring quote retention. Real API calls: 0.');
