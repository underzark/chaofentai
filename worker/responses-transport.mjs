// Only these response metadata fields are retained. Raw headers/body/messages are never logged.
const diagnosticCodes=new Set(['invalid_api_key','insufficient_permissions','permission_denied','invalid_request_error','invalid_parameter','unsupported_parameter','unsupported_value','invalid_value','model_not_found','rate_limit_exceeded','insufficient_quota','server_error','unsupported_model','invalid_image','content_policy_violation']);
const safeCode=x=>diagnosticCodes.has(x)?x:x==null?null:'unrecognized_redacted';
const safeRequestID=x=>typeof x==='string'&&/^req_[a-zA-Z0-9_-]{1,100}$/.test(x)?x:null;
function diagnosticHeaders(headers){const out={};const id=safeRequestID(headers.get('x-request-id'));if(id)out['x-request-id']=id;for(const key of ['openai-processing-ms','retry-after']){const v=headers.get(key);if(v&&/^\d+(\.\d+)?$/.test(v)&&v.length<20)out[key]=v;}const type=headers.get('content-type');if(type?.startsWith('application/json'))out['content-type']='application/json';return out;}
async function transportBody(response,max){const reader=response.body?.getReader();if(!reader)return '';const parts=[];let n=0;for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max){await reader.cancel();throw Error('body_limit')}parts.push(value)}return new Blob(parts).text();}
export function createResponsesTransport(env,fetcher=fetch,{readOnly=false}={}){
 if(env.LIVE_ENABLED!=='true'&&!(readOnly&&env.POLL_ENABLED==='true'))throw Object.assign(Error('Live generation disabled; no API request made'),{status:409});
 if(!env.OPENAI_API_KEY)throw Object.assign(Error('Server API secret not configured'),{status:503});
 const call=async(method,path,body)=>{
  if(method==='POST'&&(readOnly||env.LIVE_ENABLED!=='true'))throw Object.assign(Error('Submission disabled'),{status:409});
  const started=Date.now(),d={method,stage:'prepare',started_at:new Date(started).toISOString(),http_status:null,request_id:null,headers:{},outcome:'unknown',error_code:null,message:null};
  const failure=(message,outcome)=>{d.message=message;d.outcome=outcome;d.finished_at=new Date().toISOString();d.elapsed_ms=Date.now()-started;return Object.assign(Error(message),{status:502,diagnostic:d})};
  let response;
  try{const options={method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})};d.stage='construct_request';new Request('https://api.openai.com/v1/responses'+path,options);d.stage='fetch_invoked';response=await fetcher('https://api.openai.com/v1/responses'+path,options);}
  catch(e){d.exception=safeTransportException(e);const local=['prepare','construct_request'].includes(d.stage);throw failure(local?'Local request preparation failed; no network call started':e?.name==='TimeoutError'||e?.name==='AbortError'?'Upstream timeout; submission outcome unknown':'Upstream network failure; submission outcome unknown',local?'not_sent':'network_uncertain')}
  d.stage='headers_received';d.headers_received_at=new Date().toISOString();d.headers_elapsed_ms=Date.now()-started;d.http_status=response.status;d.headers=diagnosticHeaders(response.headers);d.request_id=d.headers['x-request-id']??null;
  if(response.status>=300&&response.status<400){d.stage='redirect_rejected';throw failure('Upstream redirect rejected; credentials were not forwarded','http_uncertain')}
  if(!response.ok){let parsed;try{parsed=JSON.parse(await transportBody(response,16384))}catch{}d.error_code=safeCode(parsed?.error?.code);d.error_type=safeCode(parsed?.error?.type);d.stage='http_error';
   // Never retain raw upstream error.message; it may echo credentials, images or prompts.
   const rejected=[400,401,403,404,405,413,415,422,429].includes(response.status);
   throw failure('Upstream HTTP '+response.status+(d.error_code?' ('+d.error_code+')':'')+'; raw error message withheld',rejected?'http_rejected':'http_uncertain');
  }
  let data;try{d.stage='read_response_body';const text=await transportBody(response,24*1024*1024);d.body_received_at=new Date().toISOString();d.body_elapsed_ms=Date.now()-started;d.stage='parse_response';data=JSON.parse(text)}catch{throw failure('Successful HTTP response could not be read or parsed; submission outcome unknown','response_parse_uncertain')}
  d.stage='response_parsed';d.outcome='response_received';d.finished_at=new Date().toISOString();d.elapsed_ms=Date.now()-started;data._transport_diagnostic=d;return data;
 };
 return {kind:'live',create:body=>call('POST','',body),retrieve:id=>{if(!/^resp_[\w-]+$/.test(id))throw Object.assign(Error('Invalid response ID'),{status:400});return call('GET','/'+encodeURIComponent(id))}};
}

// Public diagnostic only: fixed destination, no env, user content or authorization.
export async function networkProbe(fetcher){
 const results=[];
 const step=async(name,fn)=>{const t=Date.now();try{const value=await fn();results.push({name,ok:true,elapsed_ms:Date.now()-t,...value})}catch(e){results.push({name,ok:false,elapsed_ms:Date.now()-t,exception:publicException(e)})}};
 await step('construct_manual',()=>{new Request('https://example.com/',{method:'GET',redirect:'manual',headers:new Headers({'accept':'text/html'}),signal:AbortSignal.timeout(10000)});return {}});
 await step('construct_error',()=>{new Request('https://example.com/',{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});return {}});
 const get=async(fn,redirect)=>{const r=await fn('https://example.com/',{method:'GET',redirect,signal:AbortSignal.timeout(10000)});await r.body?.cancel();return {http_status:r.status}};
 await step('captured_manual',()=>get(fetcher,'manual'));
 await step('bound_manual',()=>get(globalThis.fetch.bind(globalThis),'manual'));
 await step('captured_error',()=>get(fetcher,'error'));
 return {probe:'public-get-v1',target:'https://example.com/',contains_credentials:false,paid_api_calls:0,results};
}
function publicException(e,depth=0){return {name:String(e?.name??'Error').slice(0,80),message:String(e?.message??'Unknown').replace(/https?:\/\/[^\s]+/g,'[url]').replace(/(?:Bearer\s+|sk-)[^\s]+/gi,'[redacted]').slice(0,500),...(depth<1&&e?.cause?{cause:publicException(e.cause,depth+1)}:{})}}

function safeTransportException(e,depth=0){
 const names=new Set(['TypeError','Error','TimeoutError','AbortError','RangeError','SyntaxError']);
 const raw=String(e?.message??'');
 // Only known runtime literals survive; arbitrary exceptions can echo user data.
 const known=['Illegal invocation','Failed to fetch','fetch failed','The operation was aborted','The operation was aborted due to timeout'];
 const message=known.includes(raw)?raw:raw.startsWith('Invalid redirect value, must be one of')?'Invalid redirect value: runtime supports follow/manual only':'[exception message withheld: not an allowlisted runtime literal]';
 return {name:names.has(e?.name)?e.name:'Error',message,...(depth<1&&e?.cause?{cause:safeTransportException(e.cause,depth+1)}:{})};
}
