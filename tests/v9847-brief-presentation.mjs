import assert from 'node:assert/strict';
import {newestBriefCards,briefSummaryParagraphs,briefArticleBlocks,briefDateLabel} from '../services/brief-presentation.js';
const cards=[{article:{id:'old',publishedAt:'2026-09-27T10:00:00Z'}},{article:{id:'invalid',publishedAt:'bad'}},{article:{id:'new',publishedAt:'2026-10-02T10:00:00Z'}},{article:{id:'same',publishedAt:'2026-10-02T10:00:00Z'}}];
const before=JSON.stringify(cards);
assert.deepEqual(newestBriefCards(cards).map(card=>card.article.id),['new','same','old','invalid']);
assert.equal(JSON.stringify(cards),before);assert.equal(newestBriefCards(cards)[0],cards[2]);
assert.deepEqual(briefSummaryParagraphs('VR : Un nouveau casque.\r\n\r\nAutomobile : Une nouveauté.\nScience : Une découverte.'),[{topic:'VR',text:'Un nouveau casque.'},{topic:'Automobile',text:'Une nouveauté.'},{topic:'Science',text:'Une découverte.'}]);
assert.deepEqual(briefSummaryParagraphs('Ancien résumé sans saut de ligne.'),[{topic:'',text:'Ancien résumé sans saut de ligne.'}]);
assert.equal(briefSummaryParagraphs('<img src=x onerror=alert(1)>')[0].topic,'');
assert.deepEqual(briefSummaryParagraphs('**VR** : Texte.'),[{topic:'VR',text:'Texte.'}]);
assert.equal(briefDateLabel('bad'),'');assert.equal(briefDateLabel(undefined),'');
assert.match(briefDateLabel('2026-10-02T10:00:00Z'),/02\/10\/2026/);
assert.deepEqual(briefArticleBlocks('Lancements spatiaux\nDes essais sont annoncés.\nUtilité : Observer les évolutions.\n**Statut :** Expérimental.\nSource : Fournisseur\nUn lien et ses détails.'),[
  {type:'heading',text:'Lancements spatiaux'},{type:'paragraph',text:'Des essais sont annoncés.'},{type:'paragraph',text:'Observer les évolutions.'},{type:'paragraph',text:'Expérimental.'}
]);
assert.deepEqual(briefArticleBlocks('**VR**\nUn casque nouveau.\n### Sources\nLiens inutiles'),[{type:'heading',text:'VR'},{type:'paragraph',text:'Un casque nouveau.'}]);
assert.deepEqual(briefArticleBlocks('Automobile : Une innovation.\n- Utilité: Mobilité. Statut: Prototype.'),[{type:'heading',text:'Automobile'},{type:'paragraph',text:'Une innovation.'},{type:'paragraph',text:'Mobilité.'},{type:'paragraph',text:'Prototype.'}]);
assert.deepEqual(briefArticleBlocks('**Utilité**\nDes usages concrets. Statut : Prototype. Source : Répétition.\nAutre détail'),[{type:'paragraph',text:'Des usages concrets.'},{type:'paragraph',text:'Prototype.'}]);
assert.deepEqual(briefArticleBlocks('La source confirme la découverte.'),[{type:'paragraph',text:'La source confirme la découverte.'}]);
assert.deepEqual(briefArticleBlocks('Résumé factuel'),[{type:'paragraph',text:'Résumé factuel'}]);
assert.deepEqual(briefArticleBlocks('<img src=x onerror=alert(1)>'),[{type:'paragraph',text:'<img src=x onerror=alert(1)>'}]);
assert.equal(briefSummaryParagraphs('Cette semaine a été riche en innovations.')[0].topic,'');
assert.deepEqual(briefSummaryParagraphs('Cette semaine a été riche en innovations : voici les faits.'),[{topic:'',text:'Cette semaine a été riche en innovations : voici les faits.'}]);
console.log('PASS Brief presentation: stable chronological sorting, legacy cache, topic paragraphs and safe date labels');
