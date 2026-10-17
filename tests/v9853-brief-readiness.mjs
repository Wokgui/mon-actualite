import assert from 'node:assert/strict';
import {hasBriefHistory,prepareBriefHistory} from '../brief-prefetch-v98.15.js';
const article={title:'Actualité',url:'https://example.test/a',publishedAt:new Date().toISOString()};
const days=[0,1,2].map(day=>({...article,publishedAt:new Date(Date.now()-day*86400000).toISOString()}));
assert.equal(hasBriefHistory(days),true);assert.equal(hasBriefHistory([article]),false);assert.equal(hasBriefHistory([...days.slice(0,2),{...article,publishedAt:'invalid'}]),false);
const original={fetch:globalThis.fetch,location:globalThis.location,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
const fallback=[article],before=JSON.stringify(fallback);let timeout,cleared=0,requests=0;
try{
globalThis.location={hostname:'localhost',origin:'https://example.test',href:'https://example.test/'};
globalThis.setTimeout=(callback,ms)=>{assert.equal(ms,12000);timeout=callback;return 123;};globalThis.clearTimeout=id=>{assert.equal(id,123);cleared++;};
globalThis.fetch=async(url,options)=>{requests++;assert.equal(new URL(url).searchParams.get('brief'),'3days');assert.equal(new URL(url).searchParams.get('language'),'fr');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({articles:[article]})};};
assert.deepEqual(await prepareBriefHistory({fallback}),{articles:[article],error:''},'one-day complete response unlocks');
globalThis.fetch=async()=>({ok:true,json:async()=>({articles:[]})});assert.deepEqual((await prepareBriefHistory({fallback})).articles,fallback);
globalThis.fetch=async()=>({ok:false,status:503});assert.deepEqual(await prepareBriefHistory({fallback}),{articles:fallback,error:'HTTP 503'});
globalThis.fetch=async()=>({ok:true,json:async()=>({articles:'bad'})});assert.deepEqual(await prepareBriefHistory({fallback}),{articles:fallback,error:'Invalid Brief payload'});
globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Timed out')),{once:true}));
const pending=prepareBriefHistory({fallback});timeout();assert.deepEqual(await pending,{articles:fallback,error:'Timed out'});
assert.equal(cleared,5);assert.equal(requests,1);assert.equal(JSON.stringify(fallback),before);
}finally{Object.assign(globalThis,original);}
console.log('PASS Brief readiness: valid cached history, complete one-day response, bounded timeout, error/cache fallback, no catalogue mutation');
