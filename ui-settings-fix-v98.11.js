(()=>{
  const titles={fr:'Mon actualité',en:'My news',de:'Meine Nachrichten',es:'Mis noticias',it:'Le mie notizie',pt:'As minhas notícias',nl:'Mijn nieuws',pl:'Moje wiadomości',ro:'Știrile mele',sv:'Mina nyheter',no:'Mine nyheter',da:'Mine nyheder',fi:'Omat uutiseni',cs:'Moje zprávy',el:'Οι ειδήσεις μου',tr:'Haberlerim',uk:'Мої новини',ja:'マイニュース',ko:'내 뉴스',hi:'मेरी खबरें',id:'Berita saya'};
  const titleSizeLabels={fr:'Taille des titres',en:'Title sizes',de:'Titelgröße',es:'Tamaño de los títulos',it:'Dimensione dei titoli',pt:'Tamanho dos títulos',nl:'Titelgrootte',pl:'Rozmiar tytułów',ro:'Dimensiunea titlurilor',sv:'Titelstorlek',no:'Tittelstørrelse',da:'Titelstørrelse',fi:'Otsikoiden koko',cs:'Velikost nadpisů',el:'Μέγεθος τίτλων',tr:'Başlık boyutu',uk:'Розмір заголовків',ja:'タイトルのサイズ',ko:'제목 크기',hi:'शीर्षक आकार',id:'Ukuran judul'};
  function language(){return (document.documentElement.lang||'fr').toLowerCase().split('-')[0]}
  function apply(){
    const lang=language(),name=titles[lang]||titles.fr;
    document.querySelectorAll('.hero-header h1,.minimal-loading-v9185 h1').forEach(el=>{el.textContent=name});
    const range=document.querySelector('[data-ui-range="titleSize"]');
    const label=range?.closest('.preference-range')?.querySelector(':scope > strong');
    if(label) label.textContent=titleSizeLabels[lang]||titleSizeLabels.fr;
    if(document.title.includes('Mon actualité')||document.title.includes('My news')) document.title=name;
  }
  window.addEventListener('news:stable-render',apply);
  new MutationObserver(apply).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true}); else apply();
})();
