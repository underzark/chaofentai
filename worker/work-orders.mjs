import {manualConfig,prepareManual,consumeManualRequest} from './manual-trial.mjs';
import {bgPrices} from './responses-background.mjs';
const orderFail=m=>{throw Object.assign(Error(m),{status:409})};
export function workConfig(env,user){
 if(env.WORK_ENABLED!=='true'||!/^[-\w]{1,40}$/.test(env.WORK_MODE_ID??'')||env.MANUAL_TRIAL_OWNER!==user)orderFail('Work paid submission is not enabled for this owner');
 return {...env,MANUAL_MODE:'per_order',MANUAL_MODE_ID:'work-'+env.WORK_MODE_ID};
}
export async function prepareWork(env,user,args){
 const scoped=workConfig(env,user),q=await prepareManual(scoped,user,args);
 const cost={currency:'USD',basis:'preflight estimate, not a hard cap or invoice',price_version:bgPrices.version,price_source:bgPrices.source,main_model:q.plan.main_model,image_model:q.plan.image_model,reference_usd:q.plan.size==='3344x1888'&&q.plan.image_model==='gpt-image-2.5-sunburst'?0.10:null,note:'实际费用取决于主模型与图像工具实际用量；未知用量不按0计算。'};
 const summary={original_sha256:q.sha256,prompt:q.prompt,plan:q.plan,cost};
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(summary)))),x=>x.toString(16).padStart(2,'0')).join('');
 const phrase='确认本单 '+q.approval_id.slice(0,8)+'：生成1张，费用按实际用量估算，非硬上限';
 await env.DB.prepare('INSERT INTO work_quotes(approval_id,owner,quote_hash,snapshot_json,confirmation_text) VALUES(?,?,?,?,?)').bind(q.approval_id,user,digest,JSON.stringify(summary),phrase).run();
 return {...q,quote_hash:digest,summary,confirmation_text:phrase,instructions:'向用户展示本单原图、增强/保留方案、实际尺寸、模型和费用说明后等待明确本单付费授权。不能把上传、@插件或旧授权当成本单同意。用户改变任何参数必须重新 prepare。记录用户原话；不要自己伪造同意。'};
}
export async function consumeWork(env,user,args){
 const scoped=workConfig(env,user);
 const allowed=['approval_id','quote_hash','confirmation_text','user_confirmation'];if(Object.keys(args).some(k=>!allowed.includes(k)))orderFail('Submit accepts only the prepared Work quote, never replacement parameters');
 const q=await env.DB.prepare('SELECT * FROM work_quotes WHERE approval_id=? AND owner=?').bind(args.approval_id??'',user).first();
 if(!q||q.quote_hash!==args.quote_hash||q.confirmation_text!==args.confirmation_text||typeof args.user_confirmation!=='string'||args.user_confirmation.trim().length<2||args.user_confirmation.length>1000)orderFail('Exact prepared Work quote and user confirmation evidence required');
 const result=await consumeManualRequest(scoped,user,{approval_id:args.approval_id,approved:true});
 await env.DB.prepare('UPDATE work_quotes SET user_confirmation=COALESCE(user_confirmation,?),confirmed_at=COALESCE(confirmed_at,?) WHERE approval_id=? AND owner=?').bind(args.user_confirmation,Date.now(),args.approval_id,user).run();
 return result;
}
