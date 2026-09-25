import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=92.04';

const state = new WeakMap();
const MAX_ACTIVE = 6;
const RETRY_AFTER = 12000;
let active = 0;
let generation = 0;
let queue = [];

function readArticles(){try{const p=JSON.parse(localStorage.getItem('news-live-cache')||'{}');return Array.isArray(p.articles)?p.articles:[]}catch{return[]}}
function articlesById(){return new Map(readArticles().map(a=>[String(a?.id||''),a]))}
function preload(url,timeout=3200){return new Promise(resolve=>{if(!url)return resolve(false);const im=new Image();let done=false;const finish=ok=>{if(done)return;done=true;clearTimeout(t);im.onload=im.onerror=null;resolve(ok)};const t=setTimeout(()=>finish(false),timeout);im.onload=()=>finish(im.naturalWidth>1);im.onerror=()=>finish(false);im.decoding='async';try{im.fetchPriority='high'}catch{};im.src=url;if(im.complete)finish(im.naturalWidth>1)})}
function mark(img,ok){img.classList.remove('image-pending-v9184');img.classList.toggle('image-ready-v9184',ok);img.classList.toggle('image-failed-v9184',!ok);img.dataset.imageSequenceDone='1'}
async function resolveVisual(article){const tile=sourceTileUrl(article),wanted=preparedVisualUrl(article);if(wanted&&wanted!==tile&&await preload(wanted,3200))return{url:wanted,ok:true};return{url:tile||wanted||'',ok:false}}
function priority(card,index){const r=card.getBoundingClientRect();if(r.bottom>=0&&r.top<=innerHeight)return index; if(r.top>innerHeight)return 1000+Math.round(r.top);return 500+index}
function pump(){queue.sort((a,b)=>a.priority-b.priority);while(active<MAX_ACTIVE&&queue.length){const job=queue.shift();if(!job.card?.isConnected)continue;active++;run(job).finally(()=>{active--;pump()})}}
async function run(job){const {card,article,token}=job;if(token!==generation)return;const img=card.querySelector('img.article-image');if(!img)return;const visual=await resolveVisual(article);if(token!==generation||!card.isConnected)return;if(visual.url){img.loading='eager';img.decoding='async';try{img.fetchPriority=job.priority<1000?'high':'auto'}catch{};img.src=visual.url}mark(img,visual.ok);state.set(card,{status:visual.ok?'done':'failed',at:Date.now()})}
function schedule(){const byId=articlesById(),now=Date.now();document.querySelectorAll('.article-card[data-article]').forEach((card,index)=>{const r=card.getBoundingClientRect();if(!(index<30||(r.bottom>=-300&&r.top<=innerHeight*3)))return;const prev=state.get(card);if(prev?.status==='loading'||prev?.status==='done'||(prev?.status==='failed'&&now-prev.at<RETRY_AFTER))return;const article=byId.get(String(card.dataset.article||''));if(!article)return;const img=card.querySelector('img.article-image');if(img){img.classList.add('image-pending-v9184');if(index<8){img.loading='eager';try{img.fetchPriority='high'}catch{}}}state.set(card,{status:'loading',at:now});queue.push({card,article,priority:priority(card,index),token:generation});pump()})}
function resetForRender(){generation++;queue=[];schedule()}
const app=document.getElementById('app');if(app)new MutationObserver(()=>requestAnimationFrame(schedule)).observe(app,{childList:true,subtree:true});
window.addEventListener('news:stable-render',resetForRender);window.addEventListener('pageshow',schedule);window.addEventListener('online',()=>{generation++;queue=[];schedule()});
let sf=0;window.addEventListener('scroll',()=>{if(sf)return;sf=requestAnimationFrame(()=>{sf=0;schedule()})},{passive:true});
schedule();
