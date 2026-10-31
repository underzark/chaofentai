import assert from 'node:assert/strict';
import vm from 'node:vm';
import {HTML} from '../worker/studio.mjs';
const nodes=new Map();function element(){return {showModal(){this.open=true},close(){this.open=false},focus(){},textContent:'',hidden:false,disabled:false,value:'',checked:false,children:[],style:{},classList:{add(){},remove(){}},getAttribute(){return ''},getBoundingClientRect(){return {width:800,height:600,left:0,top:0}},setPointerCapture(){},hasPointerCapture(){return false},listeners:{},addEventListener(name,fn){this.listeners[name]=fn},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}}}const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)};
const jobs=[{id:'success',state:'completed',cost:{amount:.210354,estimated_range:{min:.2004135,max:.210354}},download:'/api/files/output',original_download:'/api/files/original'},{id:'unknown',state:'submission_unknown',cost:{amount:null}}];
const context={document:{addEventListener(){},getElementById:get,createElement:element,querySelector:()=>element()},URLSearchParams,location:{origin:'https://private.test'},URL,console,setTimeout,clearTimeout,fetch:async path=>({ok:true,json:async()=>path==='/api/status'?{api_configured:true,generation_verified:true,live_enabled:false,poll_enabled:false}:jobs})};
vm.runInNewContext(HTML.match(/<script>([\s\S]*)<\/script>/)[1],context);
await new Promise(r=>setTimeout(r,10));
assert.match(get('config').textContent,/配置项已存在/);assert.match(get('cost').textContent,/0.20041350.*0.21035400/);assert.equal(get('submit').disabled,true);assert.equal(get('download').hidden,false);
await get('jobs').children[1].children[1].onclick();assert.match(get('cost').textContent,/无法计算/);assert.equal(get('download').hidden,true);
console.log('PASS studio: success and closed gate coexist; historical unknown stays unknown; accurate range, private result links, disabled submission.');

assert.match(get('availability').textContent,/提交已关闭/);assert.ok(!HTML.includes('<summary>模型与费用说明'));assert.ok(!HTML.includes('<summary>无费用连接检查'));assert.ok(HTML.includes('<span>已确认</span>'));assert.ok(!HTML.includes('<select id=\"mainModel\"'));

get('imageModel').value='gpt-image-2.5-sunburst';
await vm.runInNewContext("selected={width:1672,height:941,valid:true};updatePlan()",context);
assert.equal(get('scale').min,1);assert.equal(get('scale').max,2.29);assert.equal(Number(get('scale').value),2);assert.match(get('sizePlan').textContent,/3344.*1888/);
get('approve').checked=true;get('scale').value='2.29';get('scale').listeners.input();assert.equal(get('approve').checked,false);assert.match(get('sizePlan').textContent,/3840.*2160/);
await vm.runInNewContext("selected={width:3000,height:2000,valid:true};updatePlan()",context);assert.ok(Number(get('scale').value)<2);assert.ok(get('scaleValue').textContent!=='2×');
get('imageModel').value='gpt-image-2.5-flare';await get('imageModel').listeners.input();assert.match(get('chargeSummary').textContent,/Flare/);
await vm.runInNewContext("selected={width:4000,height:1000,valid:true};updatePlan()",context);assert.equal(get('scale').disabled,true);assert.match(get('sizePlan').textContent,/比例/);
console.log('PASS actual UI script: dynamic slider bounds/default/instant dimensions, model change, consent reset, unsupported ratio.');

get('preview').naturalWidth=1600;get('preview').naturalHeight=900;get('preview').hidden=false;
vm.runInNewContext('fitView()',context);assert.equal(get('viewScale').textContent,'100%');let prevented=false;get('viewport').listeners.wheel({preventDefault(){prevented=true},deltaY:-100,clientX:400,clientY:300});assert.equal(prevented,true);assert.notEqual(get('viewScale').textContent,'100%');
get('viewport').listeners.pointerdown({preventDefault(){},pointerId:1,button:0,clientX:400,clientY:300});get('viewport').listeners.pointermove({pointerId:1,clientX:500,clientY:350});assert.match(get('preview').style.transform,/100px,50px/);get('viewport').listeners.pointerup({pointerId:1});get('fitView').onclick();assert.match(get('preview').style.transform,/0px,0px/);
await vm.runInNewContext("selectFiles([]).catch(e=>{document.getElementById('error').textContent=e.message})",context);assert.match(get('error').textContent,/本地/);
await vm.runInNewContext("selectFiles([{},{}]).catch(e=>{document.getElementById('error').textContent=e.message})",context);assert.match(get('error').textContent,/一张/);
vm.runInNewContext("render({id:'running',state:'in_progress',cost:{amount:null}})",context);assert.match(get('cost').textContent,/完成后计算/);
console.log('PASS v21 viewer zoom/pan/reset, URL-only/multi-file rejection, running cost pending.');

// Browser two-step handoff: old historical rows do not consume a newly server-granted window.
let paid=0,prepared=0;
context.fetch=async(path,options)=>({ok:true,json:async()=>{
 if(path==='/api/status')return {live_enabled:true,poll_enabled:false,manual_trial:{configured:true,available:paid===0,job:paid?{id:'manual-job',idempotency_key:'manual-window',state:'queued'}:null}};
 if(path==='/api/manual/prepare'){prepared++;return {approval_id:'server-draft',idempotency_key:'manual-window',sha256:'test-sha',plan:{size:'3344x1888'}};}
 if(path==='/api/manual/submit'){paid++;assert.deepEqual(JSON.parse(options.body),{approval_id:'server-draft',approved:true});return {id:'manual-job',idempotency_key:'manual-window',state:'queued',cost:{amount:null}};}
 return paid?[{id:'manual-job',idempotency_key:'manual-window',state:'queued',cost:{amount:null}}]:jobs;
}});
get('imageModel').value='gpt-image-2.5-sunburst';get('prompt').value='Enhance stars';
await vm.runInNewContext("(async()=>{selected={width:1672,height:941,valid:true};uploaded={id:'input'};pendingKey=null;await refreshSettings();await updatePlan()})()",context);
assert.equal(get('submit').disabled,false);
const settle=()=>new Promise(r=>setTimeout(r,10));
let click=get('submit').onclick();await settle();assert.equal(prepared,1);assert.equal(paid,0);assert.equal(get('confirmOrder').open,true);assert.equal(get('submit').disabled,true);
await get('submit').onclick();assert.equal(prepared,1);assert.equal(paid,0);
get('cancelOrder').onclick();await click;assert.equal(paid,0);assert.equal(get('confirmOrder').open,false);assert.equal(get('submit').disabled,false);
click=get('submit').onclick();await settle();assert.equal(prepared,2);get('scale').value='1.5';get('scale').listeners.input();await click;assert.equal(paid,0);assert.equal(get('confirmOrder').open,false);
click=get('submit').onclick();await settle();assert.equal(prepared,3);get('confirmPaid').onclick();get('confirmPaid').onclick();await click;assert.equal(paid,1);assert.equal(get('submit').disabled,true);
await vm.runInNewContext('refreshSettings()',context);assert.equal(get('submit').disabled,true);
vm.runInNewContext('clearTimeout(timer)',context);
vm.runInNewContext("render({id:'done',state:'completed',cost:{amount:null}})",context);assert.equal(get('progress').className,'status complete');assert.match(get('progress').textContent,/✓/);assert.equal(get('stageProgress').children.length,5);
vm.runInNewContext("render({id:'unknown',state:'submission_unknown',cost:{amount:null}})",context);assert.equal(get('progress').className,'status warning');assert.equal(get('stageProgress').children.length,0);
console.log('PASS v26 modal: quote zero paid POST, cancel free, duplicate click blocked, changed parameters cancel quote, explicit confirm one POST, duplicate confirm no replay, refresh restores consumed grant, completed/unknown accessible stages.');

// v29 mobile save: prepare+SHA first, next deliberate tap invokes native share with original bytes.
context.crypto=globalThis.crypto;context.File=File;context.Blob=Blob;context.navigator={};context.matchMedia=()=>({matches:true});
const pngSave=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC','base64');
const saveHash=Buffer.from(await crypto.subtle.digest('SHA-256',pngSave)).toString('hex');let shares=0,sharedFile;
context.fetch=async()=>new Response(pngSave,{headers:{'content-type':'image/png','x-content-sha256':saveHash}});
context.navigator={canShare:()=>true,async share(data){shares++;sharedFile=data.files[0]}};
vm.runInNewContext("setSaveTarget({download:'/api/files/save-test'})",context);await get('download').onclick();assert.equal(shares,0);await get('download').onclick();assert.equal(shares,1);assert.deepEqual(Buffer.from(await sharedFile.arrayBuffer()),pngSave);
context.navigator.share=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'})};await get('download').onclick();assert.match(get('saveNote').textContent,/取消/);
context.fetch=async()=>new Response(pngSave,{headers:{'content-type':'image/png','x-content-sha256':'bad'}});vm.runInNewContext("setSaveTarget({download:'/api/files/tampered'})",context);await get('download').onclick();assert.match(get('error').textContent,/完整性/);
context.matchMedia=()=>({matches:false});let desktopPrevented=false;await get('download').onclick({button:0,preventDefault(){desktopPrevented=true}});assert.equal(desktopPrevented,false);assert.ok(!get('saveNote').textContent.includes('Safari'));assert.ok(!get('saveNote').textContent.includes('已发起'));assert.ok(HTML.includes('id="download" download="chaofentai-original.png"'));assert.ok(!HTML.includes('id="saveLocal"'));console.log('PASS v36 one real-file download anchor, desktop click not intercepted, context-menu path retained, no false success.');
console.log('PASS v29 mobile: no automatic share, fresh second user tap, original PNG SHA/bytes, cancellation, corrupted response rejected. Native iPhone chooser needs device acceptance.');

// v29 paired viewer: retain single-image normalized view; comparison is fit-only.
vm.runInNewContext("setJobViewer({id:'pair',download:'/api/files/result',input_download:'/api/files/source',input_width:800,input_height:450,plan:{final_width:1600,final_height:912}});view.zoom=2;view.x=20;view.y=15",context);
assert.equal(get('viewOriginal').disabled,false);get('viewOriginal').onclick();
assert.equal(vm.runInNewContext('view.zoom',context),2);assert.equal(vm.runInNewContext('view.x',context),20);
get('viewCompare').onclick();assert.equal(get('compareCanvas').hidden,false);assert.equal(get('preview').hidden,true);
let comparePrevent=false;get('viewport').listeners.wheel({preventDefault(){comparePrevent=true},deltaY:-100,clientX:400,clientY:300});assert.equal(comparePrevent,false);assert.equal(vm.runInNewContext('view.zoom',context),2);
get('compareRange').value='25';get('compareRange').listeners.input();assert.equal(get('compareLeft').style.clipPath,'inset(0 75% 0 0)');
get('compareLine').listeners.pointerdown({pointerId:42,button:0});get('compareLine').listeners.pointermove({pointerId:42,clientX:600});assert.equal(get('compareLine').style.left,'75%');get('compareLine').listeners.pointercancel({pointerId:42});get('compareLine').listeners.pointermove({pointerId:42,clientX:0});assert.equal(get('compareLine').style.left,'75%');
get('viewResult').onclick();assert.equal(vm.runInNewContext('view.zoom',context),2);assert.equal(get('compareCanvas').hidden,true);
let touchPrevent=false;get('viewport').listeners.pointerdown({pointerType:'touch',pointerId:1,button:0,preventDefault(){touchPrevent=true}});assert.equal(touchPrevent,false);
vm.runInNewContext("setJobViewer({id:'missing',download:'/api/files/result'})",context);assert.equal(get('viewOriginal').disabled,true);assert.equal(get('viewCompare').disabled,true);
assert.throws(()=>vm.runInNewContext("setJobViewer({id:'bad',download:'https://foreign.test/file'})",context));
console.log('PASS v29 viewer: paired history, retained zoom/pan, fit-only split, pointercancel, missing source disabled, same-origin only, touch vertical scrolling preserved.');

vm.runInNewContext("setJobViewer({id:'default-compare',download:'/api/files/result',input_download:'/api/files/source',plan:{final_width:1600,final_height:912}})",context);assert.equal(vm.runInNewContext('viewerMode',context),'compare');
assert.ok(HTML.indexOf('id="viewCompare"')<HTML.indexOf('id="viewResult"'));assert.ok(HTML.indexOf('id="viewResult"')<HTML.indexOf('id="viewOriginal"'));
vm.runInNewContext("rows=Array.from({length:50},(_,i)=>({id:'page-'+i,state:'completed',cost:{amount:null},thumbnail:'/api/thumbnail/'+i}));historyPage=0;renderHistoryPage()",context);
assert.equal(get('jobs').children.length,10);assert.equal(get('historyPrev').disabled,true);assert.equal(vm.runInNewContext('thumbnailCache.size',context),10);const cachedFirst=get('jobs').children[0].children[2];
get('historyNext').onclick();assert.equal(vm.runInNewContext('historyPage',context),1);assert.equal(get('jobs').children.length,10);assert.equal(vm.runInNewContext('thumbnailCache.size',context),20);
get('historyPrev').onclick();assert.equal(get('jobs').children[0].children[2],cachedFirst);for(let i=0;i<4;i++)get('historyNext').onclick();assert.equal(get('historyNext').disabled,true);assert.equal(get('jobs').children.length,10);
context.fetch=async()=>({ok:true,json:async()=>Array.from({length:23},(_,i)=>({id:'page-'+i,state:'completed',cost:{amount:null}}))});await vm.runInNewContext('history()',context);assert.equal(vm.runInNewContext('historyPage',context),2);assert.equal(get('jobs').children.length,3);get('historyPrev').onclick();await vm.runInNewContext('history()',context);assert.equal(vm.runInNewContext('historyPage',context),1);
assert.ok(HTML.includes('#compareLine:focus-visible'));assert.ok(!HTML.includes('整图适配，不裁切；查看细节请切换原图或结果。'));assert.ok(!HTML.includes('按共同画框查看；原图显示放大不代表增加细节。'));
console.log('PASS v31 default compare, button order, fine divider states with keyboard focus, 10/page max5, current-page thumbnail mounting/cache reuse, refresh preserves page and clamps final page.');

for(const id of ['historyPages','historyPrev','historyNext','historyPageLabel'])assert.ok(HTML.includes('id=\"'+id+'\"'));

// v34 readable diagnostic, exact clipboard payload, and manual-copy fallback.
const diagnostic='Invalid or unsupported image: JPEG_END_SIGNATURE_INVALID: final bytes must be FFD9; upload_diagnostic='+JSON.stringify({version:'upload-v33',received_bytes:251269,jpeg_start_valid:true,jpeg_end_valid:false,sha256:'a'.repeat(64)});
context.diagnostic=diagnostic;vm.runInNewContext('showError(diagnostic)',context);assert.ok(get('error').textContent.length<100);assert.equal(get('errorDetails').hidden,false);assert.equal(get('errorDetails').open,false);assert.equal(get('errorDiagnostic').value,diagnostic);
let copied;context.navigator.clipboard={async writeText(value){copied=value}};await get('copyDiagnostic').onclick();assert.equal(copied,diagnostic);
let selectedDiagnostic=false;get('errorDiagnostic').select=()=>{selectedDiagnostic=true};context.navigator.clipboard.writeText=async()=>{throw Error('denied')};await get('copyDiagnostic').onclick();assert.equal(selectedDiagnostic,true);assert.equal(get('errorDetails').open,true);assert.equal(get('errorDiagnostic').value,diagnostic);
vm.runInNewContext("showError('')",context);assert.equal(get('errorDetails').hidden,true);
context.inputFile=new File([new Uint8Array([255,216,0,0])],'input.jpg',{type:'image/jpeg'});let uploadCalls=0;
context.fetch=async(path,options)=>{assert.equal(path,'/api/files');assert.equal(options.body,context.inputFile);uploadCalls++;return {ok:false,json:async()=>({error:diagnostic})}};
await assert.rejects(()=>vm.runInNewContext('uploaded=null;selected={file:inputFile,valid:true};upload()',context),e=>{assert.match(e.message,/client_diagnostic=/);assert.match(e.message, /"file_size":4/);assert.match(e.message,/"jpeg_end_valid":false/);return true;});assert.equal(uploadCalls,1);
console.log('PASS v34 short error, full expandable diagnostics, exact copy/fallback, raw File upload and bounded client checksum. No generation.');
