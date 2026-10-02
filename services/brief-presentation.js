// Pure presentation helpers: never mutate cached sources or photo identities.
export function newestBriefCards(cards) {
  const time = card => { const value = Date.parse(card?.article?.publishedAt || ''); return Number.isFinite(value) ? value : -Infinity; };
  return (Array.isArray(cards) ? [...cards] : []).sort((a,b) => time(b) - time(a) || 0);
}
export function briefSummaryParagraphs(summary) {
  return String(summary || '').replace(/\r\n?/g,'\n').split(/\n+/).map(text => text.trim()).filter(Boolean).map(text => {
    // Topic labels are plain text, not model-supplied HTML.
    const introductory = /^(?:Cette semaine|Cette journée|Ce mois|Aujourd’hui|En résumé|En bref|Les derniers jours|La semaine)\b/iu.test(text);
    const topic = !introductory && text.match(/^(?:\*\*)?([^:!?\.\[\]<>\n]{2,55})(?:\*\*)?\s*:\s+(.+)$/u);
    return topic ? { topic:topic[1].replace(/\*\*/g,'').trim(),text:topic[2] } : {topic:'',text};
  });
}
export function briefDateLabel(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
}

// Clean legacy model field labels at render time; never rewrite the cached result.
export function briefArticleBlocks(summary) {
  const blocks = [];
  const field = /^(?:[-*•]\s*)?(?:\*\*)?(Utilit[ée]|Statut|Sources?)(?:\*\*)?\s*[:：–-]\s*(?:\*\*)?\s*/iu;
  const append = (type, text) => { if (text.trim()) blocks.push({type, text:text.trim()}); };
  const lines = String(summary || '').replace(/\r\n?/g, '\n')
    .replace(/([.!?;])\s+(?=(?:\*\*)?(?:Utilit[ée]|Statut|Sources?)(?:\*\*)?\s*[:：])/gu, '$1\n')
    .split(/\n+/).map(text => text.trim()).filter(Boolean);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const label = line.match(field);
    // Source/provenance already belongs to the immutable article header.
    // A legacy Sources section (including its continuation) is not repeated below.
    if ((label && /^sources?$/iu.test(label[1])) || /^(?:#{1,6}\s+)?(?:\*\*)?Sources?(?:\*\*)?\s*:?$/iu.test(line)) break;
    if (/^(?:#{1,6}\s+)?(?:\*\*)?(?:Utilit[ée]|Statut)(?:\*\*)?\s*:?$/iu.test(line)) continue;
    const prose = text => text.replace(/(?:\*\*)?\b(?:Utilit[ée]|Statut)(?:\*\*)?\s*[:：]\s*(?:\*\*)?/giu, '');
    if (label) { append('paragraph', prose(line.slice(label[0].length))); continue; }
    const marked = line.match(/^(?:#{1,6}\s+(.+)|\*\*(.+?)\*\*\s*:?)$/u);
    const topic = line.match(/^([^:!?.\[\]<>\n]{2,55})\s*:\s+(.+)$/u);
    if (marked) append('heading', (marked[1] || marked[2]).replace(/:$/, ''));
    else if (topic) { append('heading', topic[1]); append('paragraph', topic[2]); }
    else if (index < lines.length - 1 && line.length <= 55 && !/[.!?;:<>{}\[\]]|https?:\/\//u.test(line) && /^[\p{L}\p{N}]/u.test(line)) append('heading', line);
    else append('paragraph', prose(line));
  }
  return blocks;
}
