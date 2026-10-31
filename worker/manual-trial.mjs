// A server-configured, expiring, owner-bound grant. Browser requests cannot mint grants.
import {sizePlan} from './sizing.mjs';
import {bgPrices} from './responses-background.mjs';
const manualFail=(m,s=409)=>{throw Object.assign(Error(m),{status:s})};
const manualHash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
export function manualConfig(env,user,{allowExpired=false}={}){
 const regular=env.MANUAL_MODE==='per_order',id=regular?env.MANUAL_MODE_ID:env.MANUAL_TRIAL_ID,owner=env.MANUAL_TRIAL_OWNER,expires=regular?Date.now()+10*60000:Number(env.MANUAL_TRIAL_EXPIRES_AT);
 if(!id||(regular&&id.length>40)||!/^[-\w]{1,64}$/.test(id)||owner!==user||!Number.isSafeInteger(expires)||(!allowExpired&&(expires<=Date.now()||expires>Date.now()+24*3600000)))return null;
 let acknowledged;try{acknowledged=JSON.parse(env.MANUAL_ACK_UNKNOWN_IDS||'[]')}catch{return null}
 if(!Array.isArray(acknowledged)||acknowledged.length>20||acknowledged.some(x=>typeof x!=='string'||!/^[-\w]{1,100}$/.test(x)))return null;
 return {id,owner,expires,acknowledged,key:'manual-'+id,mode:regular?'per_order':'trial'};
}
export async function manualStatus(env,user){
 const configured=!!env.MANUAL_TRIAL_ID||env.MANUAL_MODE==='per_order',c=manualConfig(env,user,{allowExpired:true});
 if(!c)return {configured,available:false,job:null};
 const row=c.mode==='per_order'?await env.DB.prepare("SELECT id,idem,state FROM response_jobs WHERE owner=? AND state IN ('submitting','submission_unknown','queued','in_progress','output_pending') AND NOT (state='submission_unknown' AND id IN (SELECT value FROM json_each(?))) ORDER BY created_at DESC LIMIT 1").bind(user,JSON.stringify(c.acknowledged)).first():await env.DB.prepare('SELECT id,idem,state FROM response_jobs WHERE manual_grant_id=? AND owner=?').bind(c.id,user).first();
 return {configured,available:env.LIVE_ENABLED==='true'&&!!manualConfig(env,user)&&!row,mode:c.mode,expires_at:c.mode==='per_order'?null:c.expires,job:row?{id:row.id,idempotency_key:row.idem,state:row.state}:null,limit:1,image_model:'gpt-image-2.5-sunburst',max_edge:c.mode==='per_order'?3840:3344,max_pixels:c.mode==='per_order'?8294400:3344*1888};
}
export function normalizeManual(args,a,regular=false){
 if(args.main_model&&args.main_model!=='gpt-6.1-terra')manualFail('Manual trial requires gpt-6.1-terra');
 if(args.image_model&&!(regular?['gpt-image-2.5-sunburst','gpt-image-2.5-flare'].includes(args.image_model):args.image_model==='gpt-image-2.5-sunburst'))manualFail('Manual trial only allows Sunburst');
 if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>4000)manualFail('Prompt required',400);
 if(args.preserve!==undefined&&(typeof args.preserve!=='string'||args.preserve.length>1000))manualFail('Invalid preservation constraints',400);
 const preserve=args.preserve??'',prompt=preserve?args.prompt+'\nPreservation constraints: '+preserve:args.prompt;
 if(prompt.length>4000)manualFail('Combined prompt too long',400);
 const plan=sizePlan(a.width,a.height,args.scale??2,regular?(args.image_model??'gpt-image-2.5-sunburst'):'gpt-image-2.5-sunburst','gpt-6.1-terra');
 if(!regular&&(plan.generation_width>3344||plan.generation_height>3344||plan.generation_width*plan.generation_height>3344*1888))manualFail('Manual trial output is limited to 3344px edges and 6313472 pixels');
 return {prompt,plan,args:{asset_id:a.id,prompt:args.prompt,preserve,scale:plan.scale,image_model:plan.image_model,main_model:plan.main_model}};
}
export async function prepareManual(env,user,args){
 const c=manualConfig(env,user);if(env.LIVE_ENABLED!=='true'||!c)manualFail('Manual trial is closed');
 if((await manualStatus(env,user)).job)manualFail('This grant was already claimed; recover its existing task');
 const a=await env.DB.prepare('SELECT * FROM assets WHERE id=? AND owner=?').bind(args.asset_id,user).first();if(!a||a.storage_state!=='active'||a.bytes>8*1024*1024)manualFail('Owned PNG up to 8 MiB required',400);
 const n=normalizeManual(args,a,c.mode==='per_order'),fingerprint=await manualHash(JSON.stringify([a.hash,n.prompt,n.plan])),token=crypto.randomUUID(),expires=Math.min(c.expires,Date.now()+10*60000),grant=c.mode==='per_order'?c.id+'-'+token:c.id;
 await env.DB.prepare('INSERT INTO manual_approvals(token,grant_id,owner,fingerprint,args_json,price_version,expires_at,ack_json) VALUES(?,?,?,?,?,?,?,?)').bind(token,grant,user,fingerprint,JSON.stringify(n.args),bgPrices.version,expires,JSON.stringify(c.acknowledged)).run();
 return {approval_id:token,idempotency_key:'manual-'+grant,expires_at:expires,sha256:a.hash,plan:n.plan,prompt:n.prompt,price_version:bgPrices.version,currency:'USD',cost_note:'Usage-derived estimate, not a final bill or hard dollar cap; missing usage remains unknown. One image only.'};
}
export async function consumeManualRequest(env,user,args){
 if(args.approved!==true||typeof args.approval_id!=='string')manualFail('Explicit confirmation of the prepared order is required');
 const c=manualConfig(env,user);if(env.LIVE_ENABLED!=='true'||!c)manualFail('Manual trial is closed');
 const approval=c.mode==='per_order'?await env.DB.prepare('SELECT * FROM manual_approvals WHERE token=? AND owner=?').bind(args.approval_id,user).first():await env.DB.prepare('SELECT * FROM manual_approvals WHERE token=? AND owner=? AND grant_id=?').bind(args.approval_id,user,c.id).first();
 if(!approval||(c.mode==='per_order'&&approval.grant_id!==c.id+'-'+approval.token)||approval.expires_at<=Date.now()||approval.price_version!==bgPrices.version||approval.ack_json!==JSON.stringify(c.acknowledged))manualFail('Approval expired or configuration changed; prepare and confirm again');
 return {args:{...JSON.parse(approval.args_json),approved:true},authorization:{...c,id:approval.grant_id,key:'manual-'+approval.grant_id,expires:approval.expires_at,token:approval.token,fingerprint:approval.fingerprint,price_version:approval.price_version,ack_json:approval.ack_json}};
}

export async function authorizeManualPoll(env,user,key){const c=manualConfig(env,user,{allowExpired:true});if(!c)manualFail('Manual owner required');if(c.mode!=='per_order'){if(key!==c.key)manualFail('Polling is scoped to the manual trial');return;}const row=await env.DB.prepare('SELECT manual_grant_id FROM response_jobs WHERE owner=? AND idem=?').bind(user,key).first();const ownWeb=row?.manual_grant_id?.startsWith(c.id+'-'),ownWork=env.WORK_ENABLED==='true'&&env.WORK_MODE_ID&&row?.manual_grant_id?.startsWith('work-'+env.WORK_MODE_ID+'-');if(!ownWeb&&!ownWork)manualFail('Polling is scoped to confirmed owner orders');}
