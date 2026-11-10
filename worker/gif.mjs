// Direct Images API GIF generation/edits. No Responses API or automatic paid retries.
import {acquireHeavyWork} from './heavy-work.mjs';
import {storeInputAsset} from './asset-storage.mjs';
export const gifModels=['gpt-image-2.6-sunburst','gpt-image-2.6-flare'];
export const gifGuide='https://developers.openai.com/api/docs/guides/image-generation#generate-animated-gif-output';
const gifError=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const gifHash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
const gifDigest=value=>gifHash(new TextEncoder().encode(value));
const gifCostNote='本网站最多接收 16 MiB 编码响应（约 12 MiB GIF 总量），超出可能无法取回已付费结果，请优先小尺寸、少帧、单个动画。付费调用 OpenAI Images API；GIF 暂无可靠的单张预估，本单费用未知、没有美元硬封顶。实际费用以 OpenAI 账单为准；不套用静态图片估价。';
export const gifReferenceLimits={max_count:16,max_file_bytes:8*1024*1024,max_total_bytes:16*1024*1024,mime_types:['image/png','image/jpeg']};
export const gifInputSchema={type:'object',properties:{reference_asset_ids:{type:'array',maxItems:16,uniqueItems:true,items:{type:'string',pattern:'^[a-f0-9]{64}$'},description:'Optional ordered private PNG/JPEG asset IDs uploaded/imported by this owner. Up to 16, each <=8 MiB, total <=16 MiB; empty means text-only. Reference images are sent to OpenAI only after this exact order is confirmed.'},prompt:{type:'string',minLength:1,maxLength:4000},model:{type:'string',enum:gifModels,default:gifModels[0]},frame_count:{type:'integer',minimum:2,maximum:16,default:9,description:'GIF frames: 2–16 inclusive; default 9. Longer loops use frame_duration_ms, not more than 16 frames.'},frame_duration_ms:{type:'integer',minimum:20,maximum:2000,default:200},size:{type:'string',default:'auto'},quality:{type:'string',enum:['auto','low','medium','high','xhigh','max'],default:'auto'},n:{type:'integer',minimum:1,maximum:10,default:1},background:{type:'string',enum:['auto','opaque'],default:'auto'},moderation:{type:'string',enum:['auto','low'],default:'auto'}},required:['prompt'],additionalProperties:false};
export function normalizeGif(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(gifInputSchema.properties,k)))gifError('Unsupported GIF parameter; use reference_asset_ids for owned static references. Streaming, partial images, masks, compression and prompt rewriting are not supported');
 if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>4000)gifError('Describe the subject, motion and loop in 1–4000 characters');
 const p={model:gifModels[0],prompt:args.prompt.trim(),output_format:'gif',frame_count:9,frame_duration_ms:200,size:'auto',quality:'auto',n:1,background:'auto',moderation:'auto',...args};p.prompt=p.prompt.trim();
 if(!Number.isInteger(p.frame_count)||p.frame_count<2||p.frame_count>16)gifError('GIF 帧数必须是 2–16 的整数，默认 9 帧。20、24 等超过当前 API 上限；请修改后重新核对，不会提交生成。');
 if(!gifModels.includes(p.model))gifError('GIF requires GPT Image 2.6 Sunburst or Flare; 2.5 remains on the enhancement page');
 for(const [key,min,max] of [['frame_count',2,16],['frame_duration_ms',20,2000],['n',1,10]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)gifError(key+' must be an integer between '+min+' and '+max);
 if(p.reference_asset_ids!==undefined){const ids=p.reference_asset_ids;if(!Array.isArray(ids)||ids.length>16||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||new Set(ids).size!==ids.length)gifError('参考图必须是最多 16 个不重复的本站私有图片 ID');if(ids.length)p.reference_asset_ids=[...ids];else delete p.reference_asset_ids;}
 p.frame_duration_ms=Math.round(p.frame_duration_ms/10)*10;
 if(!gifInputSchema.properties.quality.enum.includes(p.quality)||!['auto','opaque'].includes(p.background)||!['auto','low'].includes(p.moderation))gifError('Unsupported GIF quality, background or moderation');
 if(p.size!=='auto'){
  const m=typeof p.size==='string'&&/^([1-9]\d{0,4})x([1-9]\d{0,4})$/.exec(p.size);if(!m||Number(m[1])%16||Number(m[2])%16)gifError('GIF width and height must be positive multiples of 16, or use auto');
  // Application decoding guard, not an assertion about the API's unpublished GIF budget.
  if(Number(m[1])>8192||Number(m[2])>8192||Number(m[1])*Number(m[2])>20000000)gifError('This site supports frames up to 8192px per edge and 20MP; use auto or smaller dimensions');
 }
 return p;
}
function gifEnabled(env,user,channel){return env.GIF_ENABLED==='true'&&env.LIVE_ENABLED==='true'&&env.MANUAL_TRIAL_OWNER===user&&Object.prototype.hasOwnProperty.call(env,'OPENAI_API_KEY')&&(channel!=='work'||env.WORK_ENABLED==='true');}
function gifRequire(env,user,channel){if(!gifEnabled(env,user,channel))gifError('GIF generation is not enabled for this owner/channel',409);}
function gifAcknowledged(env){try{const a=JSON.parse(env.GIF_ACK_UNKNOWN_IDS||'[]');if(Array.isArray(a)&&a.length<=20&&a.every(x=>typeof x==='string'&&/^[-\w]{1,100}$/.test(x)))return JSON.stringify(a);}catch{}gifError('Invalid GIF recovery configuration',409);}
async function gifBlocker(env,user){return env.DB.prepare("SELECT id,idem,state,created_at FROM gif_jobs WHERE owner=? AND state IN ('submitting','submission_unknown','output_pending') AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT 1").bind(user,gifAcknowledged(env)).first();}
export async function gifOptions(env,user){const blocker=await gifBlocker(env,user);return {enabled:gifEnabled(env,user,'web'),work_enabled:gifEnabled(env,user,'work'),models:gifModels,fields:gifInputSchema.properties,default_model:gifModels[0],output_format:'gif',endpoint:'/v1/images/generations',reference_endpoint:'/v1/images/edits',reference_limits:gifReferenceLimits,guide:gifGuide,blocker:blocker?{...blocker,owner:undefined}:null,cost_note:gifCostNote,size_note:'GIF 总像素预算由 API 校验，官方未公布统一数值；帧数、尺寸和数量过大会被拒绝。auto 最稳妥。',limitations:['Optional static PNG/JPEG references use Images edits; model/project must have GIF preview access','No streaming, partial images, custom compression or prompt_rewriter','Playback FPS is 1000 / frame_duration_ms, not generation speed','2.5 image enhancement is unchanged'],prepare_tool:'canvas_prepare_gif',confirm_tool:'canvas_confirm_gif',query_tool:'canvas_get_gif',history_tool:'canvas_gif_history'};}
function gifQuoteSummary(request){return {request,reference_images:request.reference_images||[],endpoint:request.reference_images?.length?'/v1/images/edits':'/v1/images/generations',playback_fps:1000/request.frame_duration_ms,loop_duration_ms:request.frame_count*request.frame_duration_ms,cost:{currency:'USD',amount:null,basis:'unknown',note:gifCostNote},guide:gifGuide};}
export async function prepareGif(env,user,args,channel='web'){
 gifRequire(env,user,channel);if(await gifBlocker(env,user))gifError('An existing GIF order is running or unresolved. Query it; do not create another paid request',409);
 const request=normalizeGif(args),id=crypto.randomUUID(),expires=Date.now()+10*60000;
 if(request.reference_asset_ids)request.reference_images=await gifResolveReferences(env,user,request.reference_asset_ids);
 const summary=gifQuoteSummary(request);
 const quote_hash=await gifDigest(JSON.stringify(summary)),confirmation_text='确认 GIF 本单 '+id.slice(0,8)+'：'+request.n+' 个动画，费用未知，按实际用量收费';
 await env.DB.prepare('INSERT INTO gif_quotes(id,owner,channel,quote_hash,request_json,confirmation_text,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,user,channel,quote_hash,JSON.stringify(request),confirmation_text,expires).run();
 return {approval_id:id,idempotency_key:'gif-'+id,quote_hash,confirmation_text,expires_at:expires,summary,instructions:'Show the exact selected reference images/SHA256 (if any), disclose transmission to OpenAI, prompt, model, all parameters, playback speed and unknown cost; wait for this order’s explicit paid approval. Changing anything requires a new quote. Never invent user_confirmation.'};
}
// Bind references to immutable owner-scoped original and normalized hashes, never external URLs.
async function gifReferenceAsset(env,user,id){
 const a=await env.DB.prepare('SELECT * FROM assets WHERE id=? AND owner=?').bind(id,user).first();
 if(!a||a.storage_state!=='active')gifError('参考图不可用，请重新上传后核对本单',409);
 if(!gifReferenceLimits.mime_types.includes(a.mime)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>gifReferenceLimits.max_file_bytes)gifError('参考图仅支持 PNG/JPEG，每张不超过 8 MiB');
 return a;
}
async function gifResolveReferences(env,user,ids){
 const refs=[];let originalTotal=0,modelTotal=0;
 for(const id of ids){const original=await gifReferenceAsset(env,user,id),model=original.normalized_id?await gifReferenceAsset(env,user,original.normalized_id):original;
  originalTotal+=original.bytes;modelTotal+=model.bytes;if(Math.max(originalTotal,modelTotal)>gifReferenceLimits.max_total_bytes)gifError('参考图合计（含校正后图片）不能超过 16 MiB');
  refs.push({asset_id:original.id,sha256:original.hash,width:original.width,height:original.height,bytes:original.bytes,mime:original.mime,model_asset_id:model.id,model_sha256:model.hash,model_mime:model.mime,model_bytes:model.bytes});
 }
 return refs;
}
async function gifReferenceBytes(env,user,id,expectedBytes,expectedHash){
 const asset=await gifReferenceAsset(env,user,id),stored=await env.BUCKET.get(asset.storage_key||'files/'+asset.id);
 if(!stored)gifError('参考图原文件缺失，请重新上传后核对本单',409);
 const reader=new Response(stored.body).body.getReader(),parts=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>expectedBytes){await reader.cancel();gifError('参考图完整性校验失败，请重新上传',409);}parts.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 if(length!==expectedBytes||await gifHash(bytes)!==expectedHash)gifError('参考图完整性校验失败，请重新上传',409);
 return bytes;
}
async function gifRequestBody(env,user,request){
 const {reference_asset_ids,reference_images,...parameters}=request;
 if(!reference_asset_ids?.length)return {target:'https://api.openai.com/v1/images/generations',body:JSON.stringify(parameters),headers:{'content-type':'application/json'}};
 const actual=await gifResolveReferences(env,user,reference_asset_ids);
 if(JSON.stringify(actual)!==JSON.stringify(reference_images))gifError('参考图已变更或不可用，请重新核对本单',409);
 const body=new FormData();for(const [key,value] of Object.entries(parameters))body.append(key,String(value));
 for(let i=0;i<actual.length;i++){
  const ref=actual[i];
  // Verify both the approved original and any orientation/trailer-corrected derivative.
  let bytes=await gifReferenceBytes(env,user,ref.asset_id,ref.bytes,ref.sha256);
  if(ref.model_asset_id!==ref.asset_id)bytes=await gifReferenceBytes(env,user,ref.model_asset_id,ref.model_bytes,ref.model_sha256);
  body.append('image[]',new Blob([bytes],{type:ref.model_mime}),'reference-'+(i+1)+(ref.model_mime==='image/jpeg'?'.jpg':'.png'));
 }
 return {target:'https://api.openai.com/v1/images/edits',body,headers:{}};
}
// Validate LZW without allocating a decoded frame. Dictionary entries track output lengths.
function gifValidateLzw(data,range,minSize,pixels,colors){
 const clear=1<<minSize,end=clear+1,lengths=new Uint32Array(4096);let size=minSize+1,next=end+1,previous=-1,count=0,cleared=false,offset=range.start,remaining=0,buffer=0,bits=0;
 const readCode=()=>{while(bits<size){if(!remaining){if(offset>=range.end)return null;remaining=data[offset++];if(!remaining)return null;}buffer|=data[offset++]<<bits;bits+=8;remaining--;}const code=buffer&((1<<size)-1);buffer>>>=size;bits-=size;return code;};
 const reset=()=>{size=minSize+1;next=end+1;previous=-1;for(let j=0;j<clear;j++)lengths[j]=j<colors?1:0;};reset();
 for(;;){const code=readCode();if(code===null)break;
  if(code===clear){reset();cleared=true;continue;}if(!cleared)gifError('GIF LZW must start with a clear code',502);
  if(code===end){if(count!==pixels)gifError('GIF decoded frame size mismatch',502);return;}
  let length;if(code<next&&code!==end)length=lengths[code];else if(code===next&&previous>=0)length=lengths[previous]+1;
  if(!length||count+length>pixels)gifError('Invalid GIF LZW stream',502);count+=length;
  if(previous>=0&&next<4096){lengths[next++]=lengths[previous]+1;if(next===(1<<size)&&size<12)size++;}
  previous=code;
 }gifError('GIF LZW end code missing',502);
}
export function gifInfo(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let i=0,frames=0,duration=0,delay=0;
 const need=n=>{if(i+n>b.length)gifError('Truncated GIF output',502)};
 const u16=p=>b[p]|b[p+1]<<8;need(13);const signature=new TextDecoder().decode(b.subarray(0,6));if(!['GIF87a','GIF89a'].includes(signature))gifError('API output is not a GIF',502);
 const width=u16(6),height=u16(8);if(!width||!height||width>8192||height>8192||width*height>20000000)gifError('GIF dimensions exceed site decoding limits',502);
 const globalColors=b[10]&128?1<<((b[10]&7)+1):0;
 i=13;if(b[10]&128){const n=3*(1<<((b[10]&7)+1));need(n);i+=n;}
 const sub=()=>{const start=i;let length=0;for(;;){need(1);const n=b[i++];if(!n)return {start,end:i,length};need(n);length+=n;i+=n;}};
 while(i<b.length){const tag=b[i++];if(tag===0x3b){if(i!==b.length||frames<2)gifError('Expected a complete animated GIF',502);return {width,height,frame_count:frames,duration_ms:duration};}
  if(tag===0x21){need(1);const type=b[i++];if(type===0xf9){need(6);if(b[i]!==4||b[i+5]!==0)gifError('Invalid GIF frame control',502);delay=u16(i+2)*10;i+=6;}else sub();}
  else if(tag===0x2c){need(9);const x=u16(i),y=u16(i+2),w=u16(i+4),h=u16(i+6),packed=b[i+8];if(!w||!h||x+w>width||y+h>height)gifError('Invalid GIF frame bounds',502);i+=9;if(packed&128){const n=3*(1<<((packed&7)+1));need(n);i+=n;}need(1);const lzw=b[i++];if(lzw<2||lzw>8)gifError('Invalid GIF LZW code size',502);const compressed=sub(),colors=packed&128?1<<((packed&7)+1):globalColors;if(!colors||!compressed.length)gifError('GIF frame requires a palette and image data',502);gifValidateLzw(b,compressed,lzw,w*h,colors);if(++frames>64)gifError('Too many GIF frames',502);duration+=delay;delay=0;}
  else gifError('Invalid GIF structure',502);
 }gifError('Missing GIF trailer',502);
}
function gifReceipt(usage,model){return {currency:'USD',amount:null,basis:'unknown',usage:usage??null,model,note:'GIF 费用未套用静态图片公式；用量仅供核对，最终金额见 OpenAI 账单。'};}
async function gifRow(env,user,key){if(typeof key!=='string'||!/^[-\w]{1,100}$/.test(key))gifError('Invalid GIF order key');const r=await env.DB.prepare('SELECT * FROM gif_jobs WHERE owner=? AND idem=?').bind(user,key).first();if(!r)gifError('GIF order not found',404);return r;}
async function gifPublic(env,user,row){const outputs=(await env.DB.prepare("SELECT o.position,o.metadata_json,a.id,a.hash,a.bytes,a.width,a.height,a.mime FROM gif_outputs o JOIN assets a ON a.id=o.asset_id AND a.owner=o.owner AND a.storage_state='active' WHERE o.owner=? AND o.job_id=? ORDER BY o.position").bind(user,row.id).all()).results;
 return {id:row.id,idempotency_key:row.idem,state:row.state==='submitting'&&Date.now()-row.created_at>300000?'submission_unknown':row.state,created_at:row.created_at,request:JSON.parse(row.request_json),request_id:row.request_id,error:row.error,cost:row.receipt_json?JSON.parse(row.receipt_json):gifReceipt(null,JSON.parse(row.request_json).model),transport:row.receipt_json?JSON.parse(row.receipt_json).transport??null:null,outputs:outputs.map(o=>({asset_id:o.id,sha256:o.hash,bytes:o.bytes,width:o.width,height:o.height,mime:'image/gif',download:'/api/files/'+o.id,...JSON.parse(o.metadata_json),file_transfer:{tool:o.bytes<=1048576?'canvas_read_file':'canvas_read_file_chunk',chunk_bytes:o.bytes<=1048576?null:4194304,fallback_chunk_bytes:262144},presentation:'Deliver unchanged .gif bytes via a native Library attachment after SHA256 validation. Never convert to PNG.'})),warning:'Direct GIF generation has no retrieval API. Never repeat an uncertain paid POST. Query this same key. Only a saved local response can be recovered.'};
}
async function gifBoundedResponse(response,max=16*1024*1024){const reader=response.body?.getReader();if(!reader)gifError('Empty API response',502);let n=0;const parts=[];for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max){await reader.cancel();gifError('GIF response exceeds this site’s 16 MiB response limit',502);}parts.push(value);}const b=new Uint8Array(n);let offset=0;for(const p of parts){b.set(p,offset);offset+=p.length;}return new TextDecoder().decode(b);}
async function gifPersist(env,user,row,raw){
 let data;try{data=JSON.parse(raw);}catch{gifError('Malformed Images API response',502);}const request=JSON.parse(row.request_json);
 if(!Array.isArray(data.data)||data.data.length!==request.n)gifError('GIF result count did not match the confirmed order',502);
 for(let position=0;position<data.data.length;position++){
  const encoded=data.data[position]?.b64_json;if(typeof encoded!=='string'||encoded.length>16*1024*1024||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))gifError('Invalid base64 GIF response',502);
  const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0,bytes=new Uint8Array(encoded.length/4*3-padding);let offset=0;try{for(let start=0;start<encoded.length;start+=65536){const binary=atob(encoded.slice(start,start+65536));for(let j=0;j<binary.length;j++)bytes[offset++]=binary.charCodeAt(j);}}catch{gifError('Invalid GIF encoding',502);}const info=gifInfo(bytes),hash=await gifHash(bytes),id=await gifDigest(user+':'+hash);
  await storeInputAsset(env,user,{id,hash,width:info.width,height:info.height,bytes,mime:'image/gif'});
  await env.DB.prepare('INSERT OR IGNORE INTO gif_outputs(job_id,owner,position,asset_id,metadata_json) VALUES(?,?,?,?,?)').bind(row.id,user,position,id,JSON.stringify(info)).run();
 }
 await env.DB.prepare("UPDATE gif_jobs SET state='completed',receipt_json=?,error=NULL WHERE id=? AND owner=?").bind(JSON.stringify({...gifReceipt(data.usage,request.model),transport:row.receipt_json?JSON.parse(row.receipt_json).transport??null:null}),row.id,user).run();
 // Outputs are now durable and linked. Checkpoint can be removed without touching media.
 try{await env.BUCKET.delete('gif-checkpoints/'+row.id);}catch{}
}
export async function getGif(env,user,key){
 let row=await gifRow(env,user,key);
 if(row.state==='output_pending'||row.state==='submitting'||row.state==='submission_unknown'){
  const checkpoint=await env.BUCKET.get('gif-checkpoints/'+row.id);
  if(checkpoint){let release;try{release=acquireHeavyWork(429);await gifPersist(env,user,row,await new Response(checkpoint.body).text());}catch(e){if(e.status!==429)await env.DB.prepare("UPDATE gif_jobs SET state='output_pending',error=? WHERE id=? AND owner=? AND state!='completed'").bind('Saved response needs recovery: '+(e.status?e.message:'storage unavailable')+'. Do not regenerate.',row.id,user).run();}finally{release?.();}row=await gifRow(env,user,key);}
 }
 return gifPublic(env,user,row);
}
export async function gifHistory(env,user){const rows=(await env.DB.prepare('SELECT * FROM gif_jobs WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(user).all()).results;const totals=await env.DB.prepare('SELECT COUNT(*) count FROM gif_jobs WHERE owner=?').bind(user).first();const media=await env.DB.prepare('SELECT COUNT(*) count,COALESCE(SUM(bytes),0) bytes FROM assets WHERE owner=?').bind(user).first();return {items:await Promise.all(rows.map(r=>gifPublic(env,user,r))),count:totals.count,limit:50,storage:media,notice:'显示最近 50 条 GIF 记录。GIF 原文件单独保留，暂不自动淘汰；存储会持续增长，请及时下载。存储统计含超分与 GIF 原文件，不含检查点和数据库。'};}
const gifDiagnosticCodes=new Set(['invalid_api_key','insufficient_permissions','permission_denied','invalid_request_error','invalid_parameter','unsupported_parameter','unsupported_value','invalid_value','model_not_found','rate_limit_exceeded','insufficient_quota','server_error','unsupported_model','image_generation_user_error','moderation_blocked']);
// Error payloads may echo prompts, invalid values or credentials. Retain only exact known identifiers.
const gifDiagnosticParams=new Set([...Object.keys(gifInputSchema.properties),'output_format','image','image[]','images']);
const gifDiagnosticTypes=new Set(['invalid_request_error','image_generation_user_error','authentication_error','permission_error','rate_limit_error','server_error']);
const gifSafeDiagnosticValue=(value,allowed)=>value==null?null:allowed.has(value)?value:'unrecognized_redacted';
function gifSafeException(error){const names=['TypeError','Error','TimeoutError','AbortError','RangeError','SyntaxError'];const raw=String(error?.message??'');const literals=['Illegal invocation','Failed to fetch','fetch failed','The operation was aborted','The operation was aborted due to timeout'];return {name:names.includes(error?.name)?error.name:'Error',message:literals.includes(raw)?raw:raw.startsWith('Invalid redirect value, must be one of')?'Invalid redirect value: runtime supports follow/manual only':'[exception message withheld]'};}
async function gifRecordDiagnostic(env,user,id,model,diagnostic){await env.DB.prepare('UPDATE gif_jobs SET receipt_json=? WHERE id=? AND owner=? AND state!=\'completed\'').bind(JSON.stringify({...gifReceipt(null,model),transport:diagnostic}),id,user).run();}
export async function submitGif(env,user,args,fetcher,channel='web'){
 gifRequire(env,user,channel);
 const allowed=channel==='work'?['approval_id','quote_hash','confirmation_text','user_confirmation']:['approval_id','quote_hash','approved'];if(!args||Object.keys(args).some(k=>!allowed.includes(k)))gifError('Only the exact prepared GIF approval may be submitted',409);
 const q=await env.DB.prepare('SELECT * FROM gif_quotes WHERE id=? AND owner=? AND channel=?').bind(args.approval_id??'',user,channel).first();
 if(!q||q.quote_hash!==args.quote_hash||(channel==='web'?args.approved!==true:args.confirmation_text!==q.confirmation_text||typeof args.user_confirmation!=='string'||args.user_confirmation.trim().length<2||args.user_confirmation.length>1000))gifError('Exact GIF quote and explicit user approval required',409);
 const key='gif-'+q.id;const existing=await env.DB.prepare('SELECT * FROM gif_jobs WHERE owner=? AND idem=?').bind(user,key).first();if(existing)return getGif(env,user,key);
 if(q.expires_at<=Date.now())gifError('GIF confirmation expired; prepare and confirm again',409);
 // Revalidate unused pre-upgrade quotes before claim/fetch; never rewrite approved parameters.
 const prepared=JSON.parse(q.request_json),{output_format,reference_images,...parameters}=prepared;const current=normalizeGif(parameters);
 if(output_format!=='gif'||Object.keys(current).some(k=>JSON.stringify(prepared[k])!==JSON.stringify(current[k])))gifError('GIF confirmation parameters are no longer supported; prepare and confirm a new order',409);
 const summary=gifQuoteSummary(prepared),{reference_images:ignoredRefs,endpoint:ignoredEndpoint,...legacySummary}=summary;
 if(await gifDigest(JSON.stringify(summary))!==q.quote_hash&&(prepared.reference_asset_ids||prepared.reference_images||await gifDigest(JSON.stringify(legacySummary))!==q.quote_hash))gifError('GIF confirmation content changed; prepare and confirm a new order',409);
 const release=acquireHeavyWork(429);try{
 // Build and verify every approved reference before claiming a paid job. Failure is free.
 const payload=await gifRequestBody(env,user,prepared);
 const id=crypto.randomUUID(),now=Date.now();
 const claim=await env.DB.prepare("INSERT OR IGNORE INTO gif_jobs(id,owner,idem,state,request_json,created_at) SELECT ?,?,?,'submitting',?,? WHERE NOT EXISTS(SELECT 1 FROM gif_jobs WHERE owner=? AND state IN ('submitting','submission_unknown','output_pending') AND id NOT IN (SELECT value FROM json_each(?)))").bind(id,user,key,q.request_json,now,user,gifAcknowledged(env)).run();
 if(!claim.meta?.changes){const replay=await env.DB.prepare('SELECT * FROM gif_jobs WHERE owner=? AND idem=?').bind(user,key).first();if(replay)return gifPublic(env,user,replay);gifError('Another GIF request is already running or unresolved',409);}
 // Every failure after claim is sticky. Reads can recover saved bytes, never send a second POST.
 let received=false,fetchInvoked=false;const diagnostic={method:'POST',stage:'prepare',outcome:'unknown',started_at:now,http_status:null,request_id:null,error_code:null,error_param:null,error_type:null};const model=JSON.parse(q.request_json).model;
 try{
  await env.DB.prepare('UPDATE gif_quotes SET confirmed_at=?,user_confirmation=? WHERE id=? AND owner=?').bind(now,channel==='work'?args.user_confirmation:'Browser confirmed exact quote',q.id,user).run();
  diagnostic.stage='construct_request';
  const target=payload.target,options={method:'POST',headers:{authorization:'Bearer '+env.OPENAI_API_KEY,...payload.headers,'x-client-request-id':id},body:payload.body,redirect:'manual',signal:AbortSignal.timeout(240000)};
  new Request(target,options); // Workers only support follow/manual; catch local construction before any fetch.
  await gifRecordDiagnostic(env,user,id,model,diagnostic);
  diagnostic.stage='fetch_invoked';fetchInvoked=true;let response;try{response=await fetcher(target,options);}finally{options.body=null;payload.body=null;} // Drop reference blobs before buffering the GIF response.
  diagnostic.stage='headers_received';diagnostic.http_status=response.status;diagnostic.elapsed_ms=Date.now()-now;
  const rawId=response.headers.get('x-request-id'),requestId=typeof rawId==='string'&&/^req_[a-zA-Z0-9_-]{1,100}$/.test(rawId)?rawId:null;diagnostic.request_id=requestId;await env.DB.prepare('UPDATE gif_jobs SET request_id=? WHERE id=? AND owner=?').bind(requestId,id,user).run();
  if(response.status>=300&&response.status<400){diagnostic.stage='redirect_rejected';diagnostic.outcome='http_uncertain';await gifRecordDiagnostic(env,user,id,model,diagnostic);await env.DB.prepare("UPDATE gif_jobs SET state='submission_unknown',error=? WHERE id=? AND owner=?").bind('上游重定向已拒绝，未向跳转目标发送凭据。提交结果待核对，不会自动重试。',id,user).run();try{await response.body?.cancel();}catch{}return getGif(env,user,key);}
  if(!response.ok){const rejected=response.status>=400&&response.status<500&&response.status!==408;diagnostic.stage='http_error';diagnostic.outcome=rejected?'http_rejected':'http_uncertain';try{const error=JSON.parse(await gifBoundedResponse(response,16384))?.error;diagnostic.error_code=gifSafeDiagnosticValue(error?.code,gifDiagnosticCodes);diagnostic.error_param=gifSafeDiagnosticValue(error?.param,gifDiagnosticParams);diagnostic.error_type=gifSafeDiagnosticValue(error?.type,gifDiagnosticTypes);}catch{}await gifRecordDiagnostic(env,user,id,model,diagnostic);const field=gifDiagnosticParams.has(diagnostic.error_param)?'，参数 '+diagnostic.error_param:'';await env.DB.prepare('UPDATE gif_jobs SET state=?,error=? WHERE id=? AND owner=?').bind(rejected?'submission_rejected':'submission_unknown','OpenAI HTTP '+response.status+(diagnostic.error_code?' ('+diagnostic.error_code+')':'')+field+'。请核对模型权限、额度或动画参数；不会自动重试。',id,user).run();return getGif(env,user,key);}
  diagnostic.stage='read_response_body';const raw=await gifBoundedResponse(response);diagnostic.stage='save_response';await env.BUCKET.put('gif-checkpoints/'+id,raw,{httpMetadata:{contentType:'application/json'}});received=true;diagnostic.stage='response_saved';diagnostic.outcome='response_received';diagnostic.elapsed_ms=Date.now()-now;await gifRecordDiagnostic(env,user,id,model,diagnostic);
  await env.DB.prepare("UPDATE gif_jobs SET state='output_pending' WHERE id=? AND owner=? AND state!='completed'").bind(id,user).run();
  const outputJob=await gifRow(env,user,key);if(outputJob.state!=='completed')await gifPersist(env,user,outputJob,raw);
 }catch(e){diagnostic.exception=gifSafeException(e);diagnostic.outcome=received?'local_recovery_pending':fetchInvoked?'network_uncertain':'not_sent';diagnostic.elapsed_ms=Date.now()-now;try{await gifRecordDiagnostic(env,user,id,model,diagnostic);await env.DB.prepare('UPDATE gif_jobs SET state=?,error=? WHERE id=? AND owner=? AND state!=\'completed\'').bind(received?'output_pending':fetchInvoked?'submission_unknown':'submission_not_sent',received?'响应已保存，原文件恢复待完成，请勿重新生成。':fetchInvoked?'提交结果未知，可能已产生费用。请查询原订单，不会自动重试。':'本地请求准备失败，尚未调用网络生成。旧确认不会自动重发，需要修复后重新核对新单。',id,user).run();}catch{}}
 return getGif(env,user,key);
 }finally{release();}
}
