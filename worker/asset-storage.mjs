// A reservation's immutable key fences writers. Recovery never deletes an active object.
export async function storeInputAsset(env,user,{id,hash,width,height,bytes,mime,normalizedId=null}){
 const fresh='files/'+id+'/'+crypto.randomUUID(),now=Date.now();
 const get=()=>env.DB.prepare('SELECT * FROM assets WHERE id=? AND owner=?').bind(id,user).first();
 const busy=()=>Object.assign(Error('File storage is busy; retry upload shortly'),{status:409});
 await env.DB.prepare("INSERT OR IGNORE INTO assets(id,owner,hash,width,height,bytes,mime,normalized_id,storage_key,storage_state,write_expires) VALUES(?,?,?,?,?,?,?,?,?,'writing',?)").bind(id,user,hash,width,height,bytes.length,mime,normalizedId,fresh,now+300000).run();
 let row=await get();
 if(!row||row.storage_state==='deleting')throw busy();
 if(row.hash!==hash||row.bytes!==bytes.length||row.width!==width||row.height!==height||row.mime!==mime||(row.normalized_id??null)!==normalizedId)throw Object.assign(Error('File reservation does not match upload'),{status:409});
 if(row.storage_state==='active')return row;
 let key=row.storage_key;
 if(key!==fresh){
  const object=await env.BUCKET.get(key);
  if(object){
   const stored=new Uint8Array(await new Response(object.body).arrayBuffer());
   if(stored.length!==bytes.length||stored.some((value,i)=>value!==bytes[i]))throw Object.assign(Error('Stored upload integrity mismatch; manual recovery required'),{status:409});
   await env.DB.prepare("UPDATE assets SET storage_state='active',write_expires=0 WHERE id=? AND owner=? AND storage_key=? AND storage_state='writing'").bind(id,user,key).run();
   row=await get();if(row?.storage_state==='active'&&row.storage_key===key)return row;throw busy();
  }
  if((row.write_expires??0)>now)throw busy();
  const claimed=await env.DB.prepare("UPDATE assets SET storage_key=?,write_expires=? WHERE id=? AND owner=? AND storage_key=? AND storage_state='writing' AND COALESCE(write_expires,0)<=?").bind(fresh,now+300000,id,user,key,now).run();
  if(!claimed.meta?.changes)throw busy();key=fresh;
 }
 try{
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:mime}});
  await env.DB.prepare("UPDATE assets SET storage_state='active',write_expires=0 WHERE id=? AND owner=? AND storage_key=? AND storage_state='writing'").bind(id,user,key).run();
  row=await get();if(row?.storage_state==='active'&&row.storage_key===key)return row;
  // A demonstrably replaced reservation cannot publish this old object.
  if(row&&row.storage_key!==key)await env.BUCKET.delete(key);
  throw busy();
 }catch(error){
  try{row=await get();if(row?.storage_state==='active'&&row.storage_key===key)return row;
   await env.DB.prepare("UPDATE assets SET write_expires=0 WHERE id=? AND owner=? AND storage_key=? AND storage_state='writing'").bind(id,user,key).run();
  }catch{}throw error;
 }
}
