import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=98.10';

const MAX_CONCURRENT = 8;
const PRIORITY_COUNT = 16;
const REQUEST_TIMEOUT_MS = 6500;
const RETRY_AFTER_MS = 60_000;
const bound = new WeakSet();
const queued = new WeakSet();
const failures = new Map();
const managedInflight = new Map();
const managedBlobs = new Map();
const queue = [];
const sessionPhotoLocks = new Map();
let active = 0;

function articleMap() { try { const payload=JSON.parse(localStorage.getItem('news-live-cache')||'{}'); return new Map((Array.isArray(payload.articles)?payload.articles:[]).map(a=>[String(a.id||''),a])); } catch { return new Map(); } }
function proxyUrl(article){const p=new URLSearchParams({v:'98.10',url:String(article?.url||'').slice(0,1900),image:String(article?.visual?.url||article?.image||'').slice(0,1900),title:String(article?.title||'').slice(0,280),category:String(article?.category||'').slice(0,70),source:String(article?.source||article?.feedTitle||'').slice(0,100)});return `/api/article-photo-fast?${p}`;}
function absolute(url){try{return new URL(url,location.href).href}catch{return String(url||'')}}
function isManagedProxy(url){try{const p=new URL(url,location.href);return p.origin===location.origin&&['/api/article-photo-fast','/api/article-thumbnail','/api/exact-news-thumbnail'].includes(p.pathname)}catch{return false}}
function isGenericResolver(url){try{const p=new URL(url,location.href);return p.origin===location.origin&&p.pathname==='/api/article-photo-fast'}catch{return false}}
function isExternalHttp(url){try{const p=new URL(url,location.href);return ['http:','https:'].includes(p.protocol)&&p.origin!==location.origin}catch{return false}}
function rememberBlob(url,blob){managedBlobs.delete(url);managedBlobs.set(url,blob);while(managedBlobs.size>96)managedBlobs.delete(managedBlobs.keys().next().value);return blob}
function managedImageBlob(url){if(managedBlobs.has(url))return Promise.resolve(rememberBlob(url,managedBlobs.get(url)));if(managedInflight.has(url))return managedInflight.get(url);const c=new AbortController(),t=setTimeout(()=>c.abort(),REQUEST_TIMEOUT_MS);const r=fetch(url,{cache:'force-cache',credentials:'same-origin',signal:c.signal}).then(async res=>{const s=String(res.headers.get('X-Thumbnail-Status')||'').toLowerCase(),ct=String(res.headers.get('Content-Type')||'').toLowerCase();if(!res.ok||s.includes('fallback')||ct.includes('image/svg+xml'))throw Error('unusable');const b=await res.blob();if(b.size<256||!String(b.type||ct).toLowerCase().startsWith('image/'))throw Error('invalid');return rememberBlob(url,b)}).finally(()=>{clearTimeout(t);managedInflight.delete(url)});managedInflight.set(url,r);return r}
function mark(image,ready){image.classList.remove('image-pending-v98');image.classList.toggle('image-ready-v98',ready);image.classList.toggle('image-fallback-v98',!ready)}
function pump(){while(active<MAX_CONCURRENT&&queue.length){const task=queue.shift();if(!task.card.isConnected||task.finished)continue;active++;task.start()}}
function enqueue(task){if(task.started||task.finished||queued.has(task.card))return;queued.add(task.card);queue.push(task);pump()}
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(!e.isIntersecting)return;const t=e.target.__imageTaskV98;if(t)enqueue(t);observer.unobserve(e.target)}),{rootMargin:'1200px 0px',threshold:.01});

function bind(card,index,articles){
 if(bound.has(card))return; const image=card.querySelector('img.article-image'),article=articles.get(String(card.dataset.article||'')); if(!image||!article)return; bound.add(card);
 const id=String(article.id||card.dataset.article||''); const tile=sourceTileUrl(article); const locked=sessionPhotoLocks.get(id);
 if(locked){ image.src=locked; image.loading='eager'; mark(image,true); card.dataset.photoLocked='1'; return; }
 const prepared=image.dataset.photoSrc||preparedVisualUrl(article); const preferred=isExternalHttp(prepared)||isGenericResolver(prepared)?proxyUrl(article):prepared; const candidates=[...new Set([preferred,proxyUrl(article)].filter(u=>u&&absolute(u)!==absolute(tile)))];
 const task={card,image,article,candidates,tile,cursor:0,started:false,finished:false,released:false,currentCandidate:'',objectUrl:'',start:null};
 const release=()=>{if(task.released)return;task.released=true;active=Math.max(0,active-1);pump()};
 const finish=(ready,stableUrl='')=>{if(task.finished)return;task.finished=true;mark(image,ready);if(ready&&stableUrl){sessionPhotoLocks.set(id,stableUrl);card.dataset.photoLocked='1';window.dispatchEvent(new CustomEvent('news:photo-locked',{detail:{id,url:stableUrl}}));}release()};
 const assign=async candidate=>{task.currentCandidate=candidate;try{if(isManagedProxy(candidate)){const blob=await managedImageBlob(candidate);if(task.finished||task.currentCandidate!==candidate||!card.isConnected)return;const objectUrl=URL.createObjectURL(blob);task.objectUrl=objectUrl;image.src=objectUrl}else image.src=candidate}catch{if(task.finished)return;failures.set(candidate,Date.now());next()}};
 const next=()=>{while(task.cursor<task.candidates.length){const c=task.candidates[task.cursor++];if(Date.now()-(failures.get(c)||0)<RETRY_AFTER_MS)continue;void assign(c);return}task.currentCandidate='';image.src=tile;finish(false)};
 image.loading='eager';image.decoding='async';if(index<PRIORITY_COUNT)image.fetchPriority='high';
 image.addEventListener('load',async()=>{if(!task.started||task.finished)return;if(absolute(image.src)===absolute(tile)){finish(false);return}try{await image.decode()}catch{}if(image.naturalWidth>1&&image.naturalHeight>1){const stable=task.currentCandidate||image.currentSrc||image.src;finish(true,stable)}else next()});
 image.addEventListener('error',()=>{if(!task.started||task.finished)return;if(task.currentCandidate)failures.set(task.currentCandidate,Date.now());next()});
 task.start=()=>{if(task.started||task.finished)return;task.started=true;next()};card.__imageTaskV98=task;if(!candidates.length){mark(image,false);task.finished=true;return}if(index<PRIORITY_COUNT)enqueue(task);else observer.observe(card);
}
function scan(){const articles=articleMap();document.querySelectorAll('.article-card[data-article]').forEach((card,index)=>bind(card,index,articles))}
window.addEventListener('news:stable-render',()=>requestAnimationFrame(scan));window.addEventListener('pageshow',scan);new MutationObserver(()=>requestAnimationFrame(scan)).observe(document.getElementById('app'),{childList:true,subtree:true});scan();
