import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const storage = new Map([['news-brief-ai-settings-v1', JSON.stringify({ prompt:'Innovations VR voitures',mode:'manual-chat',autoAtOpen:false })]]);
let failStorage = false, calls = [], configured = true, version = 'key-1', failGenerate = '', releaseGenerate;
globalThis.localStorage = { getItem:key=>storage.get(key)||null, setItem(key,value) { if(failStorage) throw Error('disk'); storage.set(key,value); } };
globalThis.document = { hidden:false }; Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
globalThis.window = { MonActualiteGroq:{ postMessage(text) {
  const request = JSON.parse(text); calls.push(request);
  const send = () => window.MonActualiteGroq.onmessage({data:JSON.stringify({ id:request.id,ok:!failGenerate || request.action!=='generate', error:failGenerate,
    data: request.action==='generate' ? { credentialVersion:version,model:'openai/gpt-oss-120b',result:{summary:'Résumé [source](A1)',cards:[{sourceId:'A1',title:'Sujet',summary:'Faits'}]} } : {configured,credentialVersion:version} })});
  if(request.action==='generate' && releaseGenerate===true) releaseGenerate=send; else setTimeout(send,1);
} }, MonActualiteAI:{postMessage(){throw Error('Forbidden subscription');}} };
globalThis.fetch = () => { throw Error('No direct network or JS credentials'); };
const ai = await import('../services/brief-groq.js?unit=1');
const articles = Array.from({length:35},(_,i)=>({id:'article-'+i,url:'https://example.test/'+i,title:'Innovation VR voiture '+i,summary:'Faits vérifiés',source:'Source',category:i%3===0?'Automobile':i%3===1?'VR':'Science',image:'https://example.test/photo.jpg',publishedAt:new Date(Date.now()-i*3600000).toISOString()}));
assert.equal(ai.briefAI.autoAtOpen,true,'manual migration enables automatic mode');
assert.equal(ai.briefAI.prompt,'Innovations VR voitures');
assert.ok(ai.briefTopics(ai.briefAI.prompt).every(topic=>topic.length<=70 && topic.endsWith('when:7d')));
assert.ok(ai.briefTopics('Suivre les avancées en archéologie et agriculture').join(' ').includes('archeologie'));
const selected = ai.selectBriefArticles([...articles,{...articles[0],url:'javascript:alert(1)'},{...articles[0],url:'https://old.test',publishedAt:'2020-01-01'}],ai.briefAI.prompt);
assert.equal(selected.length,35);
const many=Array.from({length:90},(_,i)=>({...articles[0],id:'many-'+i,url:'https://many.test/'+i}));assert.equal(ai.selectBriefArticles(many,ai.briefAI.prompt).length,72);
const payload={summary:'Synthèse',cards:many.slice(0,24).map((a,i)=>({sourceId:'A'+(i+1),summary:'Faits'}))};const expanded=ai.normalizeAIResult(payload,many);assert.equal(expanded.cards.length,24);
const old={article:{...articles[0],url:'https://expired.test',publishedAt:new Date(Date.now()-8*86400000).toISOString()}};
const merged=ai.mergeBriefCards(expanded.cards,[expanded.cards[0],{article:articles[1],summary:'Ancien résumé conservé'},old]);assert.equal(merged.length,25);assert.ok(!merged.some(c=>c.article.url==='https://expired.test'));assert.equal(merged.find(c=>c.article.url===expanded.cards[0].article.url),expanded.cards[0]); assert.equal(new Set(selected.map(article=>article.category)).size,3);
await ai.initializeBrief({getArticles:()=>articles,discover:async()=>[],filter:article=>article.id!=='article-0'});
assert.equal(calls.filter(call=>call.action==='generate').length,1);
assert.ok(!ai.briefAI.result.cards.some(card=>card.article.id==='article-0'));
const previous = ai.briefAI.result;
assert.match(previous.summary,/https:\/\/example.test/);
await ai.maybeGenerateBrief(); await ai.maybeGenerateBrief(); assert.equal(calls.filter(call=>call.action==='generate').length,1);
const before = calls.length; failGenerate='Limite gratuite Groq atteinte.';
await ai.generateBrief({force:true}); assert.equal(ai.briefAI.result,previous); assert.match(ai.briefAI.error,/Groq/);
assert.equal(calls.length,before+1);
failGenerate=''; releaseGenerate=true;
const first = ai.generateBrief({force:true}); const second = ai.generateBrief({force:true}); assert.equal(first,second,'one shared in-flight request');
while(typeof releaseGenerate!=='function') await new Promise(resolve=>setTimeout(resolve,1));
ai.setAISettings({prompt:'Nouveau prompt'}); releaseGenerate(); await first;
assert.equal(ai.briefAI.result,previous,'discard old-prompt response');
releaseGenerate=undefined; failStorage=true;
assert.equal(ai.setAISettings({prompt:'Lost'}),false); assert.equal(ai.briefAI.prompt,'Nouveau prompt');
await ai.generateBrief({force:true}); assert.equal(ai.briefAI.result,previous); assert.equal(ai.briefAI.busy,'');
failStorage=false;
await ai.generateBrief({force:true}); assert.equal(ai.briefAI.result.prompt,'Nouveau prompt','storage failure does not leave a stuck promise');
const protectedResult = ai.briefAI.result;
ai.setAISettings({prompt:'Inventions'}); version='changed-during-flight'; await ai.generateBrief({force:true});
assert.equal(ai.briefAI.result,protectedResult,'discard mismatched key response');
assert.equal(ai.normalizeAIResult({summary:'Analyse',cards:[{sourceId:'A1',title:'Titre',summary:'Faits',url:'https://evil.test',image:'https://evil.test/photo'}]},selected).cards[0].article.url,selected[0].url);
assert.throws(()=>ai.normalizeAIResult({summary:'Analyse',cards:[{sourceId:'A999',title:'Faux',summary:'Faux'}]},selected));
// Fresh startup instances: disabled/offline/12h cache/error backoff/expired cache.
configured=true;version='key-1';
const savedResult={...previous,prompt:'Innovations VR voitures',credentialVersion:version};
async function freshScenario(name,{age=0,autoAtOpen=true,online=true,backoff=false}={}) {
  storage.set('news-brief-ai-settings-v1',JSON.stringify({mode:'groq-auto',prompt:savedResult.prompt,autoAtOpen}));
  storage.set('news-brief-ai-results-v1',JSON.stringify({...savedResult,generatedAt:new Date(Date.now()-age).toISOString()}));
  storage.delete('news-brief-groq-attempt-v1');
  if(backoff) storage.set('news-brief-groq-attempt-v1',JSON.stringify({at:Date.now(),signature:JSON.stringify([savedResult.prompt,version])}));
  navigator.onLine=online;
  const module=await import('../services/brief-groq.js?scenario='+name), count=calls.filter(call=>call.action==='generate').length;
  await module.initializeBrief({getArticles:()=>articles,discover:async()=>{throw Error('discovery unavailable');}});
  return {module,count:calls.filter(call=>call.action==='generate').length-count};
}
assert.equal((await freshScenario('fresh')).count,0);
assert.equal((await freshScenario('disabled',{autoAtOpen:false,age:13*3600000})).count,0);
assert.equal((await freshScenario('offline',{online:false,age:13*3600000})).count,0);
assert.equal((await freshScenario('backoff',{backoff:true,age:13*3600000})).count,0);
const aged=await freshScenario('aged',{age:13*3600000});
assert.equal(aged.count,1);assert.equal(aged.module.briefAI.result.partialSources,true);
await aged.module.maybeGenerateBrief();assert.equal(calls.filter(call=>call.action==='generate').at(-1).force,false);
assert.ok(![...storage.values()].join('').includes('gsk_'),'no credential in JS storage');
const activity = await readFile(new URL('../android-app/app/src/main/java/com/wokgui/monactualite/MainActivity.java',import.meta.url),'utf8');
const native = await readFile(new URL('../android-app/app/src/main/java/com/wokgui/monactualite/GroqAiBridge.java',import.meta.url),'utf8');
const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
assert.ok(activity.includes('new GroqAiBridge')); assert.ok(!activity.includes('ChatHandoffBridge')&&!activity.includes('new SubscriptionAiBridge'));
for(const marker of ['AndroidKeyStore','getNoBackupFilesDir','AES/GCM/NoPadding','setInstanceFollowRedirects(false)','/openai/v1/chat/completions','!mainFrame']) assert.ok(native.includes(marker),marker);
assert.ok(!app.includes('brief-chat.js')&&!app.includes('data-ai-response')&&!app.includes('data-ai-copy-open'));
// Discovery uses bounded public news inputs, never the Home history cache.
globalThis.location={hostname:'mon-actualite.vercel.app',origin:'https://mon-actualite.vercel.app'};
const connectors=await import('../services/source-connectors.js?groq-test');
const storedBefore=new Map(storage);let discoveryBody;
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'/api/news?brief=1');assert.equal(options.cache,'no-store');
  assert.ok(options.signal instanceof AbortSignal);discoveryBody=JSON.parse(options.body);
  return new Response(JSON.stringify({articles}),{status:200});
};
const discovered=await connectors.fetchBriefCandidates(Array(8).fill('VR when:7d'),{sources:[{enabled:false},...Array(20).fill({enabled:true,url:'https://feed.test/rss'})]});
assert.equal(discovered.length,articles.length);assert.equal(discoveryBody.keywords.length,6);
assert.equal(discoveryBody.sources.length,12);assert.equal(discoveryBody.historyDays,7);
assert.deepEqual(storage,storedBefore,'no Home or settings cache mutations during discovery');
// Exercise the actual route wrapper with stub catalogue sources, no network.
let warmed=0;const routeModule={exports:null};
vm.runInNewContext(await readFile(new URL('../api/news.js',import.meta.url),'utf8'),{
  module:routeModule,Buffer,URL,Date,Map,Set,JSON,
  require(name){
    if(name==='../lib/news-core')return async(req,res)=>{res.statusCode=200;res.end(JSON.stringify({articles:articles.slice(0,3)}));};
    if(name==='../lib/news-dedup')return{mergeEventVariants:items=>items};
    if(name==='../lib/news-significance')return{rankCatalogArticles:items=>items};
    if(name==='../lib/final-image-prewarm')return{suppressCorePrewarmRequest:req=>req,scheduleFinalImagePrewarm:async()=>{warmed++;return 16;}};
    return()=>{throw Error('unexpected route');};
  }
});
async function catalogue(url,query={}){let payload;await routeModule.exports({method:'POST',url,query,headers:{}},{setHeader(){},end(body){payload=JSON.parse(body);}});return payload;}
assert.equal((await catalogue('/api/news?brief=1')).stats.prewarmScheduled,0);
assert.equal((await catalogue('/api/news',{brief:'1'})).stats.prewarmScheduled,0);
assert.equal(warmed,0,'Brief discovery spends no Home photo budget');
assert.equal((await catalogue('/api/news')).stats.prewarmScheduled,16);assert.equal(warmed,1,'normal feed budget unchanged');
console.log('PASS Groq migration, seven-day diverse selection, frozen source provenance, 12h cache, dedup, errors, stale responses, storage atomicity and native security contracts');
