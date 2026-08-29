const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

function decode(value = '') {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function plain(value='') { return decode(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function words(value='') {
  const stop = new Set(['avec','dans','pour','plus','apres','avant','cette','sont','etre','leur','leurs','tout','mais','sans','vers','entre','une','des','les','sur','qui','que','aux','par','ses','son','ont','est','etats','unis']);
  return [...new Set(plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(w=>w.length>=3&&!stop.has(w)))];
}
function agreement(a,b){ const wa=words(b), wb=new Set(words(a)); const hits=wa.filter(w=>wb.has(w)).length; return {hits,score:hits/Math.max(1,wa.length),shorter:hits/Math.max(1,Math.min(wa.length,wb.size))}; }
function same(a,b){ const x=agreement(a,b); return (x.score>=.68&&x.hits>=Math.min(4,words(b).length))||(x.hits>=5&&x.shorter>=.52)||(x.hits>=4&&x.shorter>=.66); }
function tag(block,name){ const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i')); return m?plain(m[1]):''; }
function variants(title){ const clean=plain(title).replace(/\s+[-–—]\s+[^-–—]{2,90}$/,'').slice(0,240); const out=[clean]; const tail=clean.split(/\s*[:：]\s*/).filter(Boolean).pop(); if(tail&&tail!==clean) out.push(tail); const w=words(clean).filter(x=>x.length>=4); if(w.length>=4){out.push(w.slice(-10).join(' ')); out.push(w.slice(-8).join(' '));} return [...new Set(out)]; }

module.exports = async function handler(req,res){
  const title=String(req.query?.title||'').slice(0,300);
  const output=[];
  for(const q of variants(title)){
    try{
      const url=new URL('https://news.google.com/rss/search');
      url.search=new URLSearchParams({q,hl:'fr',gl:'FR',ceid:'FR:fr'}).toString();
      const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(5000),headers:{'User-Agent':UA,'Accept':'application/rss+xml,application/xml,text/xml'}});
      const xml=await r.text();
      const items=(xml.match(/<item\b[\s\S]*?<\/item>/gi)||[]).slice(0,20).map(block=>{const headline=tag(block,'title');return {headline,source:tag(block,'source'),link:tag(block,'link')||tag(block,'guid'),agreement:agreement(headline,title),same:same(headline,title)}});
      output.push({q,status:r.status,count:items.length,items:items.filter(x=>x.same).slice(0,10),sample:items.slice(0,5)});
    }catch(e){output.push({q,error:String(e?.message||e)});}
  }
  res.statusCode=200;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({title,variants:variants(title),output},null,2));
};