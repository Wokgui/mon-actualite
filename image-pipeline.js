import { preparedVisualUrl, sourceTileUrl } from './services/article-visuals.js?v=98.10';

const bound = new WeakSet();
const sessionPhotoLocks = new Map();

function articleMap(){try{const payload=JSON.parse(localStorage.getItem('news-live-cache')||'{}');return new Map((Array.isArray(payload.articles)?payload.articles:[]).map(a=>[String(a.id||''),a]))}catch{return new Map()}}
function mark(image,ready){image.classList.remove('image-pending-v98');image.classList.toggle('image-ready-v98',ready);image.classList.toggle('image-fallback-v98',!ready)}
function usable(url){return typeof url==='string'&&url.trim()&&!url.startsWith('data:image/svg')}

function bind(card,index,articles){
  if(bound.has(card))return;
  const image=card.querySelector('img.article-image');
  const article=articles.get(String(card.dataset.article||''));
  if(!image||!article)return;
  bound.add(card);
  const id=String(article.id||card.dataset.article||'');
  const locked=sessionPhotoLocks.get(id);
  if(locked){image.src=locked;mark(image,true);card.dataset.photoLocked='1';return}

  /* Stability rule: use one URL only. Never replace a visible photo by a later resolver result. */
  const existing=usable(image.currentSrc)?image.currentSrc:(usable(image.getAttribute('src'))?image.getAttribute('src'):'');
  const prepared=preparedVisualUrl(article);
  const tile=sourceTileUrl(article);
  const chosen=existing||prepared||tile;
  if(!chosen){mark(image,false);card.dataset.photoLocked='1';return}

  sessionPhotoLocks.set(id,chosen);
  card.dataset.photoLocked='1';
  image.loading=index<12?'eager':'lazy';
  image.decoding='async';
  if(index<12)image.fetchPriority='high';
  if(!existing)image.src=chosen;

  const ready=()=>{mark(image,image.naturalWidth>1);window.dispatchEvent(new CustomEvent('news:photo-locked',{detail:{id,url:chosen}}))};
  if(image.complete)ready();
  else {image.addEventListener('load',ready,{once:true});image.addEventListener('error',()=>mark(image,false),{once:true});}
}

function scan(){const articles=articleMap();document.querySelectorAll('.article-card[data-article]').forEach((card,index)=>bind(card,index,articles))}
window.addEventListener('news:stable-render',()=>requestAnimationFrame(scan));
window.addEventListener('pageshow',scan);
new MutationObserver(()=>requestAnimationFrame(scan)).observe(document.getElementById('app'),{childList:true,subtree:true});
scan();
