// Per-owner media retention. Called only after a newly claimed submission, never on reads/migrations.
const retainedTerminal=['completed','failed','incomplete','cancelled','output_invalid','submission_rejected','submission_not_sent'];
const marks=retainedTerminal.map(()=>'?').join(',');
export async function historyView(env,owner,publicRow){
 const rows=(await env.DB.prepare('SELECT r.*,a.id source_id,a.width source_width,a.height source_height FROM response_jobs r LEFT JOIN assets a ON a.id=r.input_asset AND a.owner=r.owner AND a.storage_state=\'active\' WHERE r.owner=? AND r.retired_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 50').bind(owner).all()).results;
 const assets=await env.DB.prepare('SELECT COALESCE(SUM(bytes),0) bytes,COUNT(*) count FROM assets WHERE owner=?').bind(owner).first();
 const count=await env.DB.prepare('SELECT COUNT(*) count FROM response_jobs WHERE owner=? AND retired_at IS NULL').bind(owner).first();
 return {items:rows.map(r=>({...publicRow(r),input_download:r.source_id?'/api/files/'+r.source_id:null,input_width:r.source_width??null,input_height:r.source_height??null,thumbnail:r.result_asset?'/api/thumbnail/'+r.result_asset:null,created_at:r.created_at})),limit:50,retained_count:count.count,storage:{media_bytes:assets.bytes,asset_count:assets.count,basis:'Recorded unique original, normalized and output object bytes; excludes D1/index overhead and externally untracked objects'},retention_enabled:env.HISTORY_RETENTION_ENABLED==='true',notice:(env.HISTORY_RETENTION_ENABLED==='true'?'':'自动淘汰待审查启用，目前未删除历史文件。')+'保留最近50条；新任务超过上限后，最早可淘汰任务的原图与成品会永久移除。重要图片请先保存。在途、结果未知及仍被引用的图片受保护；仅保留必要的防重复安全记录。'};
}
export async function retainHistory(env,owner,trigger){
 if(env.HISTORY_RETENTION_ENABLED!=='true'||!trigger?.newly_created)return {executed:false};
 // A read/replay cannot trigger deletion. Live approval is separately reviewed before activation.
 const count=await env.DB.prepare('SELECT COUNT(*) n FROM response_jobs WHERE owner=? AND retired_at IS NULL').bind(owner).first();
 const excess=Math.max(0,count.n-50);let retired=0;
 if(excess){const rows=(await env.DB.prepare(`SELECT * FROM response_jobs WHERE owner=? AND retired_at IS NULL AND state IN (${marks}) AND (poll_token IS NULL OR poll_expires_at<=?) ORDER BY created_at,id LIMIT ?`).bind(owner,...retainedTerminal,Date.now(),Math.min(excess,50)).all()).results;
  for(const row of rows){
   const ids=[row.input_asset,row.original_asset,row.result_asset].filter(Boolean);const expanded=new Set(ids);
   for(const id of ids){const a=await env.DB.prepare('SELECT normalized_id FROM assets WHERE owner=? AND id=?').bind(owner,id).first();if(a?.normalized_id)expanded.add(a.normalized_id);}
   // Save a bounded cleanup candidate queue before clearing references. Retried safely on later submissions.
   for(const id of expanded)await env.DB.prepare('INSERT OR IGNORE INTO media_gc(owner,asset_id) VALUES(?,?)').bind(owner,id).run();
   const changed=await env.DB.prepare(`UPDATE response_jobs SET retired_at=?,input_asset=NULL,original_asset=NULL,result_asset=NULL,output_key=NULL,original_prompt=NULL,revised_prompt=NULL,receipt=NULL,diagnostics=NULL,plan_json=NULL WHERE owner=? AND id=? AND retired_at IS NULL AND state IN (${marks}) AND (poll_token IS NULL OR poll_expires_at<=?)`).bind(Date.now(),owner,row.id,...retainedTerminal,Date.now()).run();
   if(Number(changed.meta?.changes??changed.changes))retired++;
  }
 }
 const oldRows=(await env.DB.prepare('SELECT id,manual_grant_id FROM response_jobs WHERE owner=? AND retired_at IS NOT NULL AND checkpoint_deleted IS NULL LIMIT 100').bind(owner).all()).results;
 for(const row of oldRows){await env.BUCKET.delete('response-checkpoints/'+row.id);if(row.manual_grant_id){await env.DB.prepare('DELETE FROM work_quotes WHERE owner=? AND approval_id IN (SELECT token FROM manual_approvals WHERE owner=? AND grant_id=?)').bind(owner,owner,row.manual_grant_id).run();await env.DB.prepare('DELETE FROM manual_approvals WHERE owner=? AND grant_id=?').bind(owner,row.manual_grant_id).run();}await env.DB.prepare('UPDATE response_jobs SET checkpoint_deleted=1 WHERE owner=? AND id=? AND retired_at IS NOT NULL').bind(owner,row.id).run();}
 // Original assets are considered first. Removing them releases their normalized derivatives next pass.
 for(let pass=0;pass<2;pass++){
  const candidates=(await env.DB.prepare('SELECT a.* FROM assets a JOIN media_gc g ON g.asset_id=a.id AND g.owner=a.owner WHERE a.owner=? ORDER BY a.normalized_id IS NULL LIMIT 150').bind(owner).all()).results;
  for(const a of candidates){
   await env.DB.prepare(`UPDATE assets SET storage_state='deleting' WHERE id=? AND owner=? AND storage_state='active'
    AND NOT EXISTS(SELECT 1 FROM response_jobs WHERE owner=? AND (input_asset=? OR original_asset=? OR result_asset=?))
    AND NOT EXISTS(SELECT 1 FROM jobs WHERE owner=? AND asset_id=?)
    AND NOT EXISTS(SELECT 1 FROM probes WHERE owner=? AND asset_id=?)
    AND NOT EXISTS(SELECT 1 FROM assets WHERE owner=? AND normalized_id=?)
    AND NOT EXISTS(SELECT 1 FROM manual_approvals WHERE owner=? AND expires_at>? AND json_extract(args_json,'$.asset_id')=?)
    AND NOT EXISTS(SELECT 1 FROM gif_outputs WHERE owner=? AND asset_id=?)
    AND NOT EXISTS(SELECT 1 FROM gif_jobs j,json_each(j.request_json,'$.reference_images') r WHERE j.owner=? AND (json_extract(r.value,'$.asset_id')=? OR json_extract(r.value,'$.model_asset_id')=?))
    AND NOT EXISTS(SELECT 1 FROM gif_quotes q,json_each(q.request_json,'$.reference_images') r WHERE q.owner=? AND q.expires_at>? AND (json_extract(r.value,'$.asset_id')=? OR json_extract(r.value,'$.model_asset_id')=?))`).bind(a.id,owner,owner,a.id,a.id,a.id,owner,a.id,owner,a.id,owner,a.id,owner,Date.now(),a.id,owner,a.id,owner,a.id,a.id,owner,Date.now(),a.id,a.id).run();
   const claimed=await env.DB.prepare("SELECT * FROM assets WHERE id=? AND owner=? AND storage_state='deleting'").bind(a.id,owner).first();if(!claimed)continue;
   // New uploads use unique object keys. A delayed old delete can never remove a replacement's bytes.
   await env.BUCKET.delete(claimed.storage_key||'files/'+claimed.id);
   await env.DB.prepare("DELETE FROM assets WHERE id=? AND owner=? AND storage_state='deleting' AND storage_key IS ?").bind(claimed.id,owner,claimed.storage_key).run();
   await env.DB.prepare('DELETE FROM media_gc WHERE owner=? AND asset_id=? AND NOT EXISTS(SELECT 1 FROM assets WHERE owner=? AND id=?)').bind(owner,claimed.id,owner,claimed.id).run();
  }
 }
 await env.DB.prepare('DELETE FROM media_gc WHERE owner=? AND NOT EXISTS(SELECT 1 FROM assets WHERE assets.owner=media_gc.owner AND assets.id=media_gc.asset_id)').bind(owner).run();
 return {executed:true,retired};
}
