// Pure presentation helpers: never mutate cached sources or photo identities.
export function newestBriefCards(cards) {
  const time = card => { const value = Date.parse(card?.article?.publishedAt || ''); return Number.isFinite(value) ? value : -Infinity; };
  return (Array.isArray(cards) ? [...cards] : []).sort((a,b) => time(b) - time(a) || 0);
}
export function briefSummaryParagraphs(summary) {
  return String(summary || '').replace(/\r\n?/g,'\n').split(/\n+/).map(text => text.trim()).filter(Boolean).map(text => {
    // Topic labels are plain text, not model-supplied HTML.
    const topic = text.match(/^(?:\*\*)?([^:!?\.\[\]<>\n]{2,55})(?:\*\*)?\s*:\s+(.+)$/u);
    return topic ? { topic:topic[1].replace(/\*\*/g,'').trim(),text:topic[2] } : {topic:'',text};
  });
}
export function briefDateLabel(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
}
