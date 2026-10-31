// Test-only module graph isolation: models two Worker isolates sharing D1/R2.
import {readFile} from 'node:fs/promises';
export async function isolatedAdapter(){
 const base=new URL('../worker/responses-background.mjs',import.meta.url);
 const gate=await readFile(new URL('./heavy-work.mjs',base),'utf8');
 const gateURL='data:text/javascript;base64,'+Buffer.from(gate+'\n//'+crypto.randomUUID()).toString('base64');
 let source=await readFile(base,'utf8');
 source=source.replace(/from ['"](.+?)['"]/g,(_,path)=>'from '+JSON.stringify(path==='./heavy-work.mjs'?gateURL:new URL(path,base).href));
 return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).createBackgroundAdapter;
}
