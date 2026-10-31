import {isolatedAdapter} from './isolated-adapter.mjs';
const otherIsolate=await isolatedAdapter();
import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import {createBackgroundAdapter} from '../worker/responses-background.mjs';
const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+f,'utf8'));
sql.prepare('INSERT INTO response_jobs(id,owner,idem,fingerprint,state,response_id,manual_grant_id,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('job','owner','manual-window','fp','in_progress','resp_fixture','window',1);
let paused,releaseClaim;const claimStarted=new Promise(r=>paused=r),claimHold=new Promise(r=>releaseClaim=r);let claims=0;
const db={prepare(q){return{bind(...a){return{
 async first(){return sql.prepare(q).get(...a)},async all(){return{results:sql.prepare(q).all(...a)}},
 async run(){const result=sql.prepare(q).run(...a);if(q.startsWith('UPDATE response_jobs SET poll_token=?')&&++claims===1){paused();await claimHold}return{meta:{changes:Number(result.changes)}}}
}}}}};
let gets=0,releaseNew,newStarted;const newHold=new Promise(r=>releaseNew=r),newEntered=new Promise(r=>newStarted=r);
const api={kind:'fake',async retrieve(){if(++gets===1){newStarted();await newHold;return{id:'resp_fixture',status:'in_progress'}}return{id:'resp_fixture',status:'failed'}}};
const adapter=createBackgroundAdapter({db,bucket:{},api});const realNow=Date.now;let clock=1000000;Date.now=()=>clock;
const old=adapter.poll('owner','manual-window');const rejected=assert.rejects(old,e=>e.status===503&&/lease expired/.test(e.message));await claimStarted;const oldToken=sql.prepare('SELECT poll_token FROM response_jobs').get().poll_token;
clock+=120001;const newer=otherIsolate({db,bucket:{},api}).poll('owner','manual-window');await newEntered;const newToken=sql.prepare('SELECT poll_token FROM response_jobs').get().poll_token;assert.notEqual(oldToken,newToken);
releaseClaim();await rejected;
assert.equal(gets,1);assert.equal(sql.prepare('SELECT state FROM response_jobs').get().state,'in_progress');assert.equal(sql.prepare('SELECT poll_token FROM response_jobs').get().poll_token,newToken);
console.log('PASS: expired pre-GET holder rejected; no second GET, no stale write, replacement holder token retained.');
releaseNew();await newer;assert.equal(sql.prepare('SELECT state FROM response_jobs').get().state,'in_progress');assert.equal(sql.prepare('SELECT poll_token FROM response_jobs').get().poll_token,null);Date.now=realNow;
