import assert from 'node:assert/strict';import worker from '../worker/index.js';
const env={DB:{prepare(){return {bind(){return {async first(){return null},async all(){return {results:[]}}}}}}}};
async function rpc(method,params){return (await (await worker.fetch(new Request('https://unit.test/mcp',{method:'POST',headers:{origin:'https://unit.test','oai-authenticated-user-id':'test'},body:JSON.stringify({id:1,method,params})}),env)).json()).result;}
const init=await rpc('initialize',{});assert.match(init.instructions,/不让用户猜尺寸/);assert.match(init.instructions,/只有用户明确要求快速/);assert.match(init.instructions,/不能直接生成/);
const list=await rpc('tools/list',{});const map=Object.fromEntries(list.tools.map(t=>[t.name,t.description]));assert.match(map.canvas_status,/max_plan/);assert.match(map.canvas_confirm_order,/真实用户同意原话/);assert.match(map.canvas_submit_background,/禁止使用/);
async function plan(width,height,scale=2){const r=await rpc('tools/call',{name:'canvas_status',arguments:{plan:{width,height,scale}}});assert.ok(!r.isError);return JSON.parse(r.content[0].text);}
const normal=await plan(1672,941);assert.equal(normal.size,'3344x1888');assert.equal(normal.requires_user_choice,false);assert.ok(normal.max_plan.scale>=2);
const capped=await plan(3000,2000);assert.equal(capped.requires_user_choice,true);assert.ok(capped.requested_plan_error);assert.ok(capped.scale_bounds.max<2);assert.equal(capped.max_plan.scale,capped.scale_bounds.max);assert.ok(!capped.size);assert.equal(capped.requested_scale,2);
const minimum=await plan(100,100);assert.equal(minimum.requires_user_choice,true);assert.ok(minimum.scale_bounds.min>2);assert.ok(minimum.suggested_plan.scale>2);
console.log('PASS v32 actual MCP instructions/descriptions, exact 2x plan, oversized/undersized 2x returns authoritative bounds and choices without automatic submission. No network or generation.');
