import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {deflateSync,inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import worker,{createWorker} from '../worker/index.js';
import {usageReceipt,createResponsesTransport,requestBody,encodePNG} from '../worker/responses-background.mjs';
import {cropPNG,pngInfo} from '../worker/png-crop.mjs';
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0}
function chunk(t,b){const c=Buffer.alloc(b.length+12);c.writeUInt32BE(b.length);c.write(t,4);b.copy(c,8);c.writeUInt32BE(crc(c.subarray(4,-4)),c.length-4);return c}
function png(w,h,channels=3){const ih=Buffer.alloc(13);ih.writeUInt32BE(w);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=channels===4?6:2;const stride=w*channels,raw=Buffer.alloc((stride+1)*h),pixels=Buffer.alloc(stride*h);for(let y=0;y<h;y++){const filter=y%5;raw[y*(stride+1)]=filter;for(let x=0;x<stride;x++){const v=(x*7+y*13+(x>>>8))&255;pixels[y*stride+x]=v;const a=x>=channels?pixels[y*stride+x-channels]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;let p=0;if(filter===1)p=a;if(filter===2)p=b;if(filter===3)p=Math.floor((a+b)/2);if(filter===4){const z=a+b-c,pa=Math.abs(z-a),pb=Math.abs(z-b),pc=Math.abs(z-c);p=pa<=pb&&pa<=pc?a:pb<=pc?b:c}raw[y*(stride+1)+x+1]=(v-p)&255;}}return {bytes:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]),pixels,stride};}
function decodeCropped(bytes){const chunks=[];const b=Buffer.from(bytes);for(let p=8;p<b.length;){const n=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8);if(type==='IDAT')chunks.push(b.subarray(p+8,p+8+n));p+=n+12}const raw=inflateSync(Buffer.concat(chunks)),info=pngInfo(bytes),stride=info.width*(info.color===6?4:3),pixels=Buffer.alloc(stride*info.height);for(let y=0;y<info.height;y++){assert.equal(raw[y*(stride+1)],0);raw.copy(pixels,y*stride,y*(stride+1)+1,(y+1)*(stride+1))}return pixels;}
const source=png(1672,941),generated=png(3344,1888);
const cropped=await cropPNG(generated.bytes);assert.equal(pngInfo(cropped).height,1882);assert.deepEqual(decodeCropped(cropped),generated.pixels.subarray(generated.stride*3,-generated.stride*3));
const rgba=png(3344,1888,4),rgbaCrop=await cropPNG(rgba.bytes);assert.deepEqual(decodeCropped(rgbaCrop),rgba.pixels.subarray(rgba.stride*3,-rgba.stride*3));
const broken=Buffer.from(generated.bytes);broken[35]^=1;await assert.rejects(cropPNG(broken),/CRC/);await assert.rejects(cropPNG(source.bytes,941,0),/Invalid crop/);
const sql=new DatabaseSync(':memory:');for(const name of ['0000_canvas','0001_probes','0002_responses','0003_response_live','0004_response_diagnostics','0005_job_plan','0006_manual_trial','0007_input_formats','0008_work_history','0009_storage_recovery'])sql.exec(await readFile('drizzle/'+name+'.sql','utf8'));
const db={prepare(q){return {bind(...a){return {async first(){return sql.prepare(q).get(...a)},async all(){return {results:sql.prepare(q).all(...a)}},async run(){return sql.prepare(q).run(...a)}}}}}};
const objects=new Map();let failStorage=false;const env={DB:db,BUCKET:{async put(k,b){if(failStorage)throw Error('storage');objects.set(k,new Uint8Array(b))},async get(k){const b=objects.get(k);return b?{body:b}:null}},LIVE_ENABLED:'true',OPENAI_API_KEY:'FAKE_TEST_ONLY'};
let posts=0,gets=0,phase='queued',losePost=false,badSize=false;const fakeFetch=async(url,options)=>{
 assert.match(url,/^https:\/\/api.openai.com\/v1\/responses(?:\/resp_test)?$/);assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,'Bearer FAKE_TEST_ONLY');
 if(options.method==='POST'){posts++;const b=JSON.parse(options.body);assert.equal(b.max_tool_calls,1);assert.equal(b.max_output_tokens,2048);assert.equal(b.background,true);assert.equal(b.tools[0].model,'gpt-image-2.5-sunburst');assert.equal(b.model,'gpt-6.1-terra');assert.deepEqual(Buffer.from(b.input[0].content[1].image_url.split(',')[1],'base64'),source.bytes);if(losePost)throw Error('lost POST');}else gets++;
 return Response.json({id:'resp_test',model:'gpt-6.1-terra',service_tier:'default',status:phase,usage:{input_tokens:1200,input_tokens_details:{cached_tokens:200,cache_write_tokens:0},output_tokens:100,output_tokens_details:{reasoning_tokens:50}},tool_usage:{image_gen:{input_tokens:1100,input_tokens_details:{image_tokens:1000,text_tokens:100},output_tokens:5000,output_tokens_details:{image_tokens:5000,text_tokens:0}}},output:phase==='completed'?[{id:'ig_1',type:'image_generation_call',status:'completed',revised_prompt:'faithful revised prompt',result:(badSize?source.bytes:generated.bytes).toString('base64')}]:[]});
};
const app=createWorker(fakeFetch),origin='https://trial.test';async function call(path,method='GET',body,user='owner',config=env){return app.fetch(new Request(origin+path,{method,headers:{origin,...(user?{'oai-authenticated-user-id':user}:{}),'content-type':'application/json'},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)}),config)}
assert.equal((await call('/api/background','POST',{},null)).status,401);
let keyRead=false;const off={...env,LIVE_ENABLED:'false',get OPENAI_API_KEY(){keyRead=true;throw Error('must not read')}};
assert.equal((await call('/api/background','POST',{},'owner',off)).status,409);assert.equal(keyRead,false);assert.equal(posts,0);
assert.throws(()=>createResponsesTransport(off,fakeFetch),/disabled/);assert.equal(keyRead,false);
const asset=await (await call('/api/files','POST',source.bytes)).json();
const args={asset_id:asset.id,idempotency_key:'trial_one',prompt:'Faithful upscale.',approved:true};
assert.equal((await call('/api/background','POST',{...args,approved:false})).status,409);
assert.equal((await call('/api/background','POST',args,'other')).status,404);
const first=await (await call('/api/background','POST',args)).json();assert.equal(first.state,'queued');
assert.equal((await (await call('/api/background','POST',args)).json()).id,first.id);assert.equal(posts,1);
assert.equal((await call('/api/background','POST',{...args,prompt:'different'})).status,409);
assert.equal((await call('/api/background','POST',{...args,idempotency_key:'another'})).status,409);
assert.equal((await call('/api/background/trial_one','GET',undefined,'other')).status,404);
phase='in_progress';assert.equal((await (await call('/api/background/trial_one')).json()).state,phase);
phase='completed';failStorage=true;assert.equal((await call('/api/background/trial_one')).status,503);failStorage=false;
const done=await (await call('/api/background/trial_one')).json();assert.equal(done.state,'completed');assert.equal(done.width,3344);assert.equal(done.height,1888);assert.equal(done.asset_id,done.original_asset_id);assert.deepEqual(Buffer.from(objects.get('files/'+done.asset_id)),generated.bytes);assert.deepEqual(Buffer.from(objects.get('files/'+done.original_asset_id)),generated.bytes);assert.equal(done.sha256,createHash('sha256').update(objects.get('files/'+done.asset_id)).digest('hex'));assert.ok(done.cost.amount>0);assert.equal(posts,1);const previousGets=gets;await call('/api/background/trial_one');assert.equal(gets,previousGets);
assert.equal((await call('/api/files/'+done.asset_id,'GET',undefined,'other')).status,404);
for(const state of ['failed','incomplete','cancelled','submission_unknown','output_invalid']){const who='owner_'+state;const a=await (await call('/api/files','POST',source.bytes,who)).json();phase=state==='submission_unknown'?'queued':state==='output_invalid'?'completed':state;losePost=state==='submission_unknown';badSize=state==='output_invalid';const result=await (await call('/api/background','POST',{...args,asset_id:a.id},who)).json();assert.equal(result.state,state);const p=posts;await call('/api/background','POST',{...args,asset_id:a.id},who);await call('/api/background/trial_one','GET',undefined,who);assert.equal(posts,p);}
const receipt=usageReceipt({service_tier:'default',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200,cache_write_tokens:0},output_tokens:100,output_tokens_details:{reasoning_tokens:99}},tool_usage:{image_gen:{input_tokens:1100,input_tokens_details:{image_tokens:1000,text_tokens:100},cached_tokens_details:{cached_image_tokens:100,cached_text_tokens:10},output_tokens:5000,output_tokens_details:{image_tokens:5000,text_tokens:0}}},output:[{type:'image_generation_call'}]});
assert.ok(Math.abs(receipt.estimated_range.min-(.008+.0002+.005+.0072+.0002+.00045+.0000125+.15))<1e-9);
assert.equal(usageReceipt({}).amount,null);assert.equal(usageReceipt({usage:{input_tokens:1,output_tokens:1}}).amount,null);
assert.throws(()=>encodePNG(new Uint8Array(8*1024*1024+1)),/8 MiB/);
const mcp=await (await call('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'canvas_poll_background',arguments:{idempotency_key:'trial_one'}}})).json();assert.equal(JSON.parse(mcp.result.content[0].text).asset_id,done.asset_id);
assert.equal((await call('/api/background','GET',undefined,'other')).status,200);assert.deepEqual(await (await call('/api/background','GET',undefined,'other')).json(),[]);
console.log('PASS production wiring with injected HTTP: server gate before key access, identity, quota/idempotency, GET-only recovery, unknown POST, all terminal states, base64 exact input, RGB/RGBA filters 0-4 crop pixels, original SHA, R2 retry, private output, MCP, main/tool/cache costs. External API calls: 0.');

assert.equal((await call('/api/background','POST',{},'owner',{...env,OPENAI_API_KEY:undefined})).status,503);
phase='queued';losePost=false;badSize=false;
const raceAsset=await (await call('/api/files','POST',source.bytes,'racer')).json(),pBefore=posts;
const racers=await Promise.all(['race_a','race_b'].map(idempotency_key=>call('/api/background','POST',{...args,asset_id:raceAsset.id,idempotency_key},'racer')));
assert.deepEqual(racers.map(r=>r.status).sort(),[200,409]);assert.equal(posts,pBefore+1);
const readResult=await (await call('/mcp','POST',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'canvas_read_file',arguments:{asset_id:done.asset_id}}})).json();assert.ok(JSON.parse(readResult.result.content[0].text).cost.amount>0);
console.log('PASS missing-secret gate, concurrent cross-key single-submit quota, real-result file cost is not mock zero.');

const configuration=await (await call('/api/status','GET',undefined,'owner',off)).json();assert.equal(configuration.api_configured,true);assert.equal(configuration.generation_verified,true);assert.ok(configuration.generation_verification.job_id);const stranger=await (await call('/api/status','GET',undefined,'no-success',off)).json();assert.equal(stranger.generation_verified,false);assert.equal(keyRead,false);assert.equal(configuration.live_enabled,false);console.log('PASS configuration presence reporting never evaluates secret getter; presence is not generation verification.');

const {sizePlan}=await import('../worker/sizing.mjs');
assert.equal(sizePlan(1672,941).size,'3344x1888');assert.deepEqual(sizePlan(1672,941).crop,{left:0,right:0,top:0,bottom:0});
assert.equal(sizePlan(941,1672).size,'1888x3344');assert.deepEqual(sizePlan(941,1672).crop,{left:0,right:0,top:0,bottom:0});
assert.equal(sizePlan(1280,720,3).size,'3840x2160');assert.equal(sizePlan(1280,720,3).experimental_size,true);
for(const a of [[1672,941,4],[100,100,2],[4000,100,1],[1000,1000,0],[1000,1000,NaN],[1000,1000,'2'],[1000,1000,2,'bad']])assert.throws(()=>sizePlan(...a));
const flare=sizePlan(1672,941,1.5,'gpt-image-2.5-flare','gpt-6.1-terra');assert.equal(flare.final_size,'2512x1424');assert.equal(flare.verification,'combination_not_live_verified');
const request=requestBody({prompt:'Keep identity; enhance stars',image_url:encodePNG(source.bytes),plan:flare});assert.equal(request.model,'gpt-6.1-terra');assert.equal(request.tools[0].model,'gpt-image-2.5-flare');assert.equal(request.tools[0].size,flare.size);assert.equal(request.max_tool_calls,1);
const horizontal=png(1024,688),croppedBoth=await cropPNG(horizontal.bytes,1,2,3,4);assert.equal(pngInfo(croppedBoth).width,1017);assert.equal(pngInfo(croppedBoth).height,685);const pixelsBoth=decodeCropped(croppedBoth);for(let y=0;y<685;y++)assert.deepEqual(pixelsBoth.subarray(y*1017*3,(y+1)*1017*3),horizontal.pixels.subarray((y+1)*1024*3+9,(y+1)*1024*3+(1024-4)*3));
let choicePosts=0,chosenBody;const choiceApp=createWorker(async(url,options)=>{choicePosts++;chosenBody=JSON.parse(options.body);return Response.json({id:'resp_choice',status:'queued',output:[],model:chosenBody.model},{headers:{'x-request-id':'req_choice'}})});
const choiceOwner='model-scale-owner';const choiceInput=await (await call('/api/files','POST',source.bytes,choiceOwner)).json();
const sendChoice=body=>choiceApp.fetch(new Request(origin+'/api/background',{method:'POST',headers:{origin,'oai-authenticated-user-id':choiceOwner},body:JSON.stringify(body)}),env);
const choiceArgs={asset_id:choiceInput.id,approved:true,idempotency_key:'choice',prompt:'Preserve subject; enhance background',scale:1.5,image_model:'gpt-image-2.5-flare',main_model:'gpt-6.1-terra'};
const c1=await (await sendChoice(choiceArgs)).json();assert.equal(c1.plan.main_model,'gpt-6.1-terra');assert.equal(c1.plan.final_size,'2512x1424');assert.equal((await sendChoice(choiceArgs)).status,200);assert.equal(choicePosts,1);assert.equal((await sendChoice({...choiceArgs,scale:2})).status,409);assert.equal((await sendChoice({...choiceArgs,image_model:'gpt-image-2.5-sunburst'})).status,409);assert.equal(choicePosts,1);
const planReply=await (await call('/api/plan?width=941&height=1672&scale=2')).json();assert.equal(planReply.final_size,'1888x3344');assert.equal((await call('/api/plan?width=941&height=1672&scale=2','GET',undefined,null)).status,401);
console.log('PASS model/scale: landscape+portrait, max4K/minimum/aspect/invalid scale, 16-alignment and both-axis pixel crop, Flare+Terra fake wiring, per-model idempotency conflicts, owner-only no-cost planning.');

const {scaleBounds}=await import('../worker/sizing.mjs');
for(const [w,h] of [[1672,941],[941,1672],[1024,1024],[3000,2000],[100,100],[1,3]]){try{const l=scaleBounds(w,h);assert.ok(l.min<=l.default&&l.default<=l.max);for(let i=Math.round(l.min*100);i<=Math.round(l.max*100);i++)sizePlan(w,h,i/100);}catch(e){assert.match(e.message,/可用|尺寸/);}}
const cap=scaleBounds(3000,2000);assert.ok(cap.default<2);assert.equal(sizePlan(1672,941).main_model,'gpt-6.1-terra');assert.equal(sizePlan(1672,941).output_mode,'original');assert.throws(()=>scaleBounds(4000,1000),/比例/);
console.log('PASS v20 legal slider range endpoints/all steps, capped visible default, Terra default, original byte-identical PNG output.');
