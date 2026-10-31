import {acquireHeavyWork} from './heavy-work.mjs';
import {imageModels,sizePlan,legacySizePlan,coordinatorModels} from './sizing.mjs';
export {createResponsesTransport} from './responses-transport.mjs';
import {cropPNG,pngInfo,validatePNG} from './png-crop.mjs';
export const backgroundPlan=Object.freeze({main_model:'gpt-6-astra',image_model:'gpt-image-2.5-sunburst',background:true,size:'3344x1888',final_size:'3344x1882',quality:'high',action:'edit',experimental_size:true,max_output_tokens:2048,max_tool_calls:1});
const bgError=(message,status=400)=>Object.assign(new Error(message),{status});
const bgHash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
export function encodePNG(bytes,mime='image/png'){if(bytes.length>8*1024*1024)throw bgError('Input PNG exceeds 8 MiB trial limit',413);let s='';for(let p=0;p<bytes.length;p+=24576)s+=btoa(String.fromCharCode(...bytes.subarray(p,p+24576)));if(!['image/png','image/jpeg'].includes(mime))throw bgError('Unsupported input MIME');return 'data:'+mime+';base64,'+s;}
function decodePNG(s){if(typeof s!=='string'||s.length>24*1024*1024||s.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw bgError('Invalid or oversized PNG output');const n=s.length/4*3-(s.endsWith('==')?2:s.endsWith('=')?1:0),bytes=new Uint8Array(n);for(let p=0,o=0;p<s.length;p+=32768){const b=atob(s.slice(p,p+32768));for(let i=0;i<b.length;i++)bytes[o++]=b.charCodeAt(i)}return bytes;}
export function requestBody({prompt,image_url,plan=sizePlan(1672,941)}){
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000||!/^data:image\/(png|jpeg);base64,/.test(image_url??''))throw bgError('PNG data and prompt required');
 return {model:plan.main_model,background:true,store:true,service_tier:'default',max_output_tokens:2048,max_tool_calls:1,parallel_tool_calls:false,instructions:'You execute an approved image-edit handoff, not creative planning. Use only the supplied original. Follow enhancement regions and preservation constraints exactly; do not add themes, redesign characters, change composition, or make another image call. Produce exactly one image with the forced tool at '+plan.size+'. Return the original generated PNG without cropping or resizing. Never substitute a preview or a different model. Do not produce commentary.',input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url}]}],tools:[{type:'image_generation',model:plan.image_model,action:'edit',quality:'high',size:plan.size,output_format:'png'}],tool_choice:{type:'image_generation'}};
}
export const bgPrices={version:'official-standard-2026-10-30-default-30m',source:'https://developers.openai.com/api/docs/pricing',main:{input:[10,20],cached:[1,2],write:[12.5,50],output:[50,75]},image:{input:8,cached:2,text:5,cached_text:1.25,output:30}};
export function usageReceipt(response,imageModel=backgroundPlan.image_model){
 const u=response.usage,g=response.tool_usage?.image_gen,parts=[],missing=[];const model=response.model??backgroundPlan.main_model,rates=coordinatorModels[model]??coordinatorModels['gpt-6-astra'],long=(u?.input_tokens??0)>272000,ir=rates.input*(long?2:1),cr=rates.cached*(long?2:1),wr=ir*1.25,or=rates.output*(long?1.5:1);if(!coordinatorModels[model]||(long&&model!=='gpt-6-astra'))missing.push('main_pricing_unverified');const valid=n=>Number.isInteger(n)&&n>=0;
 const add=(name,tokens,lo,hi=lo)=>{if(!valid(tokens)){missing.push(name);return}parts.push({name,tokens,usd_min:tokens*lo/1e6,usd_max:tokens*hi/1e6})};
 if(u&&valid(u.input_tokens)&&valid(u.output_tokens)){
  const cached=u.input_tokens_details?.cached_tokens,write=u.input_tokens_details?.cache_write_tokens;
  if(valid(cached)&&valid(write)&&cached+write<=u.input_tokens){add('main_input_uncached',u.input_tokens-cached-write,ir);add('main_input_cached',cached,cr);add('main_cache_write',write,wr)}else{add('main_input_cache_unknown',u.input_tokens,Math.min(cr,ir,wr),Math.max(cr,ir,wr));missing.push('main_cache_breakdown')}
  add('main_output_including_reasoning',u.output_tokens,or);
 }else missing.push('main_usage');
 if(g){const detail=g.input_tokens_details,cache=g.cached_tokens_details;
  for(const [key,label,rate,cr] of [['image_tokens','image_input',8,2],['text_tokens','image_text_input',5,1.25]]){const count=detail?.[key],c=cache?.[key==='image_tokens'?'cached_image_tokens':'cached_text_tokens'];if(valid(c)&&valid(count)&&c<=count){add(label,count-c,rate);add(label+'_cached',c,cr)}else add(label+'_cache_unknown',count,cr,rate);}
  const out=g.output_tokens_details;if(out&&valid(out.image_tokens)&&out.text_tokens===0)add('image_output',out.image_tokens,30);else if(!out&&valid(g.output_tokens)){add('image_output_assumed_all_image',g.output_tokens,30);missing.push('image_output_details_missing')}else missing.push('image_output_breakdown');
  if(out&&out.image_tokens+out.text_tokens!==g.output_tokens)missing.push('image_output_inconsistent');if(!valid(g.input_tokens)||!detail||detail.image_tokens+detail.text_tokens!==g.input_tokens)missing.push('image_input_inconsistent');
  if(response.status==='completed'&&g.output_tokens===0)missing.push('completed_image_has_zero_reported_output');if((response.output??[]).filter(x=>x.type==='image_generation_call').length>1)missing.push('multiple_image_calls');
 }else missing.push('image_tool_usage');
 if(response.status&&response.status!=='completed')missing.push('response_not_completed');if(response.status&&!response.model)missing.push('actual_main_model_missing');
 if(response.service_tier!=='default'){missing.push('service_tier_pricing_unverified');parts.length=0;}else if(missing.includes('main_pricing_unverified')){for(let i=parts.length-1;i>=0;i--)if(parts[i].name.startsWith('main_'))parts.splice(i,1);}
 const min=parts.reduce((s,p)=>s+p.usd_min,0),max=parts.reduce((s,p)=>s+p.usd_max,0);
 return {currency:'USD',billed_usd:null,accounting_status:missing.length?'usage_incomplete':'estimated',response_status:response.status??null,image_call_count:(response.output??[]).filter(x=>x.type==='image_generation_call').length,raw_usage:response.usage??null,raw_tool_usage:response.tool_usage??null,cache_retention_basis:'request omitted cache options; official default 30m',response_id:response.id??null,amount:missing.length?null:max,estimated_range:missing.length?null:{min,max},known_subtotal:{min,max},basis:missing.length?'usage-derived estimate incomplete':'usage-derived estimate (conservative upper estimate)',main_model:response.model??backgroundPlan.main_model,image_model:imageModel,price_version:bgPrices.version,price_source:bgPrices.source,parts,missing,main_usage:u??null,image_usage:g??null,actual_main_model:response.model??null,service_tier:response.service_tier??null,note:'Not a verified charge or balance. Main tier is selected from input_tokens at 272000; this fixed request builder omits cache options, so official default 30m write pricing applies. Unknown image cache hits are ranged from cached to uncached. Reasoning is already in output_tokens. Tool usage is separate; totals are never added twice. Aggregated tool usage may omit incomplete records.'};
}
export function createBackgroundAdapter({db,bucket,api,liveEnabled=false,ownerLimit=1,authorizedKey,previousTrialId,manualAuthorization}){
 if(api?.kind!=='fake'&&!(liveEnabled&&api?.kind==='live'))throw bgError('Live transport disabled',409);
 const get=async(owner,key)=>db.prepare('SELECT * FROM response_jobs WHERE owner=? AND idem=?').bind(owner,key).first();
 const executorLease=Symbol('executor-owned poll lease');
 const terminal=new Set(['completed','failed','incomplete','cancelled','output_invalid','submission_rejected','submission_not_sent']);
 const rank=s=>({submitting:0,submission_unknown:0,queued:1,in_progress:2,output_pending:3}[s]??4);
 const mergeDiagnostics=(a,b)=>{const all=[];for(const d of [...JSON.parse(a||'[]'),...JSON.parse(b||'[]')])if(!all.some(x=>x.method===d.method&&x.started_at===d.started_at&&x.request_id===d.request_id&&x.stage===d.stage&&x.outcome===d.outcome))all.push(d);return JSON.stringify(all.slice(-16));};
 // updated_at is a strictly increasing CAS revision, even within one millisecond.
 // Only the first durable terminal transition wins; late snapshots add diagnostics only.
 const save=async r=>{
  const candidate={...r},heldLease=r[executorLease]??null;
  for(let attempt=0;attempt<8;attempt++){
   const current=await get(r.owner,r.idem);if(heldLease&&(current?.poll_token!==heldLease||current.poll_expires_at<=Date.now()))throw bgError('Poll lease expired; retrieve the same task later',503);if(!current)throw bgError('Job disappeared',503);
   const stale=terminal.has(current.state)||rank(candidate.state)<rank(current.state);
   const next=stale?{...current}:{...current,...candidate};
   for(const field of ['response_id','original_asset','result_asset','output_key'])next[field]=current[field]??next[field]??null;
   next.diagnostics=mergeDiagnostics(current.diagnostics,candidate.diagnostics);
   next.updated_at=Math.max(Date.now(),Number(current.updated_at??0)+1);
   const result=await db.prepare('UPDATE response_jobs SET state=?,response_id=?,receipt=?,revised_prompt=?,output_key=?,original_asset=?,result_asset=?,error_code=?,diagnostics=?,updated_at=? WHERE owner=? AND idem=? AND updated_at IS ? AND (? IS NULL OR (poll_token=? AND poll_expires_at>?))').bind(next.state,next.response_id,next.receipt??null,next.revised_prompt??null,next.output_key,next.original_asset,next.result_asset,next.error_code??null,next.diagnostics,next.updated_at,r.owner,r.idem,current.updated_at??null,heldLease,heldLease,Date.now()).run();
   if(Number(result.meta?.changes??result.changes)===1){Object.assign(r,next);return r;}
  }
  throw bgError('Concurrent job update; read the same job again, never resubmit',503);
 };
 const record=(r,d)=>{if(!d)return;const history=r.diagnostics?JSON.parse(r.diagnostics):[];if(!history.some(x=>x.method===d.method&&x.started_at===d.started_at&&x.request_id===d.request_id))history.push(d);r.diagnostics=JSON.stringify(history.slice(-16))};
 const checkpoint=async r=>{await bucket.put('response-checkpoints/'+r.id,JSON.stringify({response_id:r.response_id,diagnostics:r.diagnostics}),{httpMetadata:{contentType:'application/json'}})};
 const storePNG=async(owner,b,jobID)=>{const info=pngInfo(b),hash=await bgHash(b),id=await bgHash(new TextEncoder().encode(owner+':generated:'+jobID+':'+hash));await bucket.put('files/'+id,b,{httpMetadata:{contentType:'image/png'}});await db.prepare('INSERT OR IGNORE INTO assets(id,owner,hash,width,height,bytes) VALUES(?,?,?,?,?,?)').bind(id,owner,hash,info.width,info.height,b.length).run();return id;};
 const accept=async(r,response)=>{const plan=r.plan_json?JSON.parse(r.plan_json):legacySizePlan(1672,941);
  if(response.id!==r.response_id)throw bgError('Response identity mismatch',502);
  if(!['queued','in_progress','completed','failed','incomplete','cancelled'].includes(response.status))throw bgError('Unsupported response state',502);
  record(r,response._transport_diagnostic);r.state=response.status;r.receipt=JSON.stringify(usageReceipt(response,plan.image_model));r.error_code=response.error?.code??response.incomplete_details?.reason??null;
  const outputs=(response.output??[]).filter(x=>x.type==='image_generation_call');r.revised_prompt=JSON.stringify(outputs.map(x=>x.revised_prompt??null));
  if(r.state==='completed')r.state='output_pending';await save(r);
  if(response.status==='completed'){
   if(r.state!=='output_pending')return r;
   if(outputs.length!==1||outputs[0].status!=='completed'||typeof outputs[0].result!=='string'){r.state='output_invalid';r.error_code='expected_one_completed_image';await save(r);return r;}
   let b;try{b=decodePNG(outputs[0].result);await validatePNG(b,{maxWidth:3840,maxHeight:3840,maxPixels:8294400})}catch{r.state='output_invalid';r.error_code='invalid_png';await save(r);return r;}
   outputs[0].result=null;
   r.original_asset=await storePNG(r.owner,b,r.id);await save(r);
   const info=pngInfo(b);if(info.width!==plan.generation_width||info.height!==plan.generation_height){r.state='output_invalid';r.error_code='unexpected_dimensions_original_retained';await save(r);return r;}
   if(plan.version>=2&&plan.output_mode==='original'){r.result_asset=r.original_asset;r.output_key='files/'+r.result_asset;r.state='completed';await save(r);return r;}
   let cropped;try{cropped=await cropPNG(b,plan.crop.top,plan.crop.bottom,plan.crop.left,plan.crop.right)}catch{r.state='output_invalid';r.error_code='unsupported_or_invalid_png_original_retained';await save(r);return r;}
   r.result_asset=await storePNG(r.owner,cropped,r.id);r.output_key='files/'+r.result_asset;r.state='completed';await save(r);
  }return r;
 };
 return {
  async submit(owner,key,{prompt,asset_id,approved,scale=2,image_model=backgroundPlan.image_model,main_model='gpt-6.1-terra',preserve=''}){
   if(!owner||!/^[-\w]{1,100}$/.test(key??''))throw bgError('Owner and idempotency key required');
   if(approved!==true)throw bgError('Explicit single-run approval required',409);
   let quota=ownerLimit;
   if(manualAuthorization&&(owner!==manualAuthorization.owner||key!==manualAuthorization.key||manualAuthorization.expires<=Date.now()||!(manualAuthorization.mode==='per_order'?Object.hasOwn(imageModels,image_model):image_model==='gpt-image-2.5-sunburst')||main_model!=='gpt-6.1-terra'))throw bgError('Manual authorization does not match',409);
   if(!manualAuthorization&&authorizedKey&&key!==authorizedKey)throw bgError('Only the specifically authorized trial key may submit',409);
   const oldLedger=await get(owner,key);if(oldLedger?.retired_at)return oldLedger;
   const a=await db.prepare('SELECT * FROM assets WHERE id=? AND owner=?').bind(asset_id,owner).first();if(!a||a.storage_state!=='active')throw bgError('Input file not found',404);
   if(a.bytes>8*1024*1024)throw bgError('Input PNG exceeds 8 MiB');const plan=sizePlan(a.width,a.height,scale,image_model,main_model);if(typeof preserve!=='string'||preserve.length>1000)throw bgError('Preservation constraints must be <=1000 characters');if(preserve)prompt=prompt+'\nPreservation constraints: '+preserve;
   if(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000)throw bgError('Prompt must be 1–4000 characters');
   const fingerprint=await bgHash(new TextEncoder().encode(JSON.stringify([a.hash,prompt,plan]))),id=crypto.randomUUID();
   let r=await get(owner,key);if(r){const expected=r.plan_json?fingerprint:await bgHash(new TextEncoder().encode(JSON.stringify([a.hash,prompt,backgroundPlan])));if(r.fingerprint!==expected||(!r.plan_json&&(scale!==2||image_model!==backgroundPlan.image_model||main_model!==backgroundPlan.main_model)))throw bgError('Idempotency conflict',409);return r;}
   if(main_model!=='gpt-6.1-terra')throw bgError('New tasks use gpt-6.1-terra',400);
   const release=acquireHeavyWork(409);try{
   const input=a.normalized_id?await db.prepare('SELECT * FROM assets WHERE id=? AND owner=?').bind(a.normalized_id,owner).first():a;if(!input)throw bgError('Normalized input missing');const source=await bucket.get(input.storage_key||'files/'+input.id);if(!source)throw bgError('Input missing',404);const bytes=new Uint8Array(await new Response(source.body).arrayBuffer());if(bytes.length!==input.bytes||await bgHash(bytes)!==input.hash)throw bgError('Input integrity mismatch',409);
   const body=requestBody({prompt,image_url:encodePNG(bytes,input.mime||'image/png'),plan});
   if(manualAuthorization){
    const m=manualAuthorization;if(fingerprint!==m.fingerprint)throw bgError('Prepared order fingerprint mismatch',409);
    await db.prepare("INSERT OR IGNORE INTO response_jobs(id,owner,idem,fingerprint,state,created_at,updated_at,input_asset,original_prompt,plan_json,manual_grant_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM manual_approvals WHERE token=? AND owner=? AND grant_id=? AND fingerprint=? AND price_version=? AND expires_at>? AND ack_json=?) AND NOT EXISTS(SELECT 1 FROM response_jobs WHERE owner=? AND state IN ('submitting','submission_unknown','queued','in_progress','output_pending') AND NOT (state='submission_unknown' AND id IN (SELECT value FROM json_each(?))))").bind(id,owner,key,fingerprint,'submitting',Date.now(),Date.now(),a.id,prompt,JSON.stringify(plan),m.id,m.token,owner,m.id,fingerprint,m.price_version,Date.now(),m.ack_json,owner,m.ack_json).run();
   }else{
   await db.prepare('INSERT OR IGNORE INTO response_jobs(id,owner,idem,fingerprint,state,created_at,updated_at,input_asset,original_prompt,plan_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM response_jobs WHERE owner=?) < ?').bind(id,owner,key,fingerprint,'submitting',Date.now(),Date.now(),a.id,prompt,JSON.stringify(plan),owner,quota).run();
   }
   r=await get(owner,key);if(!r)throw bgError('Submission blocked: grant consumed, expired, or another task is active; recover the existing task',409);if(r.fingerprint!==fingerprint)throw bgError('Idempotency conflict',409);if(r.id!==id)return r;
   r.newly_created=true;
   body.metadata={canvas_job_id:r.id};
   let response;try{response=await api.create(body)}catch(e){record(r,e.diagnostic??{stage:'request_sent',outcome:'network_uncertain',message:'Unknown transport exception; details withheld',at:new Date().toISOString()});r.state=e.diagnostic?.outcome==='http_rejected'?'submission_rejected':e.diagnostic?.outcome==='not_sent'?'submission_not_sent':'submission_unknown';r.error_code=e.diagnostic?.error_code??'post_outcome_unknown_do_not_resubmit';await save(r);return r;}
   if(!/^resp_[\w-]+$/.test(response?.id??'')){r.state='submission_unknown';await save(r);return r;}
   r.response_id=response.id;record(r,response._transport_diagnostic);let checkpointSaved=false;try{await checkpoint(r);checkpointSaved=true}catch{}try{await save(r)}catch{throw bgError('Response ID '+r.response_id+' received but D1 persistence failed; '+(checkpointSaved?'private recovery checkpoint saved':'checkpoint unavailable')+'. Do not submit again.',503)}return await accept(r,response);
   }finally{release();}
  },
  async poll(owner,key){
   let r=await get(owner,key);if(!r)throw bgError('Job not found',404);
   if(terminal.has(r.state))return r;
   const release=acquireHeavyWork(503);try{
   if(!r.response_id){const o=await bucket.get('response-checkpoints/'+r.id);if(o){const c=JSON.parse(await new Response(o.body).text());if(/^resp_[\w-]+$/.test(c.response_id??'')){r.response_id=c.response_id;r.diagnostics=c.diagnostics;r.state='queued';await save(r);}}}
   if(!r.response_id||terminal.has(r.state))return r;
   const lease=r.manual_grant_id?crypto.randomUUID():null;
   if(lease){const claim=await db.prepare('UPDATE response_jobs SET poll_token=?,poll_expires_at=? WHERE owner=? AND idem=? AND (poll_token IS NULL OR poll_expires_at<=?)').bind(lease,Date.now()+120000,owner,key,Date.now()).run();if(Number(claim.meta?.changes??claim.changes)!==1)return get(owner,key);}
   try{
    if(lease){
     r=await get(owner,key);
     // A stalled executor must never adopt a replacement holder's token from this row.
     if(r?.poll_token!==lease||r.poll_expires_at<=Date.now())throw bgError('Poll lease expired; retrieve the same task later',503);
     Object.defineProperty(r,executorLease,{value:lease});
     if(terminal.has(r.state))return r;
    }
    let response;try{response=await api.retrieve(r.response_id)}catch(e){record(r,e.diagnostic??{stage:'poll',outcome:'unknown',message:'Poll transport failed; no POST attempted'});await save(r);return r;}
    return await accept(r,response);
   }finally{if(lease)await db.prepare('UPDATE response_jobs SET poll_token=NULL,poll_expires_at=NULL WHERE owner=? AND idem=? AND poll_token=?').bind(owner,key,lease).run();}
   }finally{release();}
  },
  async list(owner){return (await db.prepare('SELECT * FROM response_jobs WHERE owner=? ORDER BY created_at DESC LIMIT 20').bind(owner).all()).results;}
 };
}
export function backgroundPublic(r){return {id:r.id,idempotency_key:r.idem,state:r.retired_at?'expired':r.state,retired_at:r.retired_at??null,retention_warning:r.retention_warning??null,plan:r.plan_json?JSON.parse(r.plan_json):null,response_id:r.response_id,original_prompt:r.original_prompt,revised_prompt:r.revised_prompt?JSON.parse(r.revised_prompt):null,cost:receiptView(r.receipt),original_asset_id:r.original_asset,asset_id:r.result_asset,download:r.result_asset?'/api/files/'+r.result_asset:null,original_download:r.original_asset?'/api/files/'+r.original_asset:null,error:r.error_code,diagnostics:r.diagnostics?JSON.parse(r.diagnostics):[],recovery:['submitting','submission_unknown'].includes(r.state)?'Submission outcome unknown. Never change key and resubmit; reconcile manually.':null};}

export function receiptView(raw){
 const saved=raw?JSON.parse(raw):{currency:'USD',amount:null,basis:'unknown'};
 if(!saved.main_usage||!saved.image_usage)return saved;
 const revised=usageReceipt({id:saved.response_id,model:saved.actual_main_model,service_tier:saved.service_tier,status:saved.response_status,usage:saved.main_usage,tool_usage:{image_gen:saved.image_usage},output:Array.from({length:Math.min(2,saved.image_call_count??0)},()=>({type:'image_generation_call'}))},saved.image_model);
 const missing=[...new Set([...(saved.missing??[]),...revised.missing])];
 if(!saved.response_status)missing.push('historical_completion_evidence_missing');
 if(saved.accounting_status==='usage_incomplete'&&!missing.length)missing.push('historical_usage_incomplete');
 return {...revised,missing,amount:missing.length?null:revised.amount,estimated_range:missing.length?null:revised.estimated_range,accounting_status:missing.length?'usage_incomplete':'estimated',basis:missing.length?'usage-derived estimate incomplete':revised.basis,response_id:saved.response_id??null,raw_usage:saved.raw_usage??saved.main_usage,raw_tool_usage:saved.raw_tool_usage??{image_gen:saved.image_usage},original_estimated_range:saved.estimated_range??null,recalculated_from_saved_usage:true};
}
