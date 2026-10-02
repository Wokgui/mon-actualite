// Data-only preparation. app.js alone owns the loading/ready DOM transition.
export function hasBriefHistory(articles = []) {
  return new Set(articles.filter(article => article?.title && article?.url && Number.isFinite(Date.parse(article.publishedAt))).map(article => {
    const date = new Date(article.publishedAt);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  })).size >= 3;
}

export async function prepareBriefHistory({language = 'fr', fallback = []} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const url = location.hostname === 'wokgui.github.io' ? new URL('./preview-news.json', location.href) : new URL('/api/news', location.origin);
    url.searchParams.set('language', language);
    url.searchParams.set('brief', '3days');
    url.searchParams.set('t', String(Date.now()));
    const response = await fetch(url.href, {cache:'no-store', signal:controller.signal, headers:{Accept:'application/json','Cache-Control':'no-cache'}});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.articles)) throw Error('Invalid Brief payload');
    // One/two days are still a complete response, never an endless spinner.
    const articles = payload.articles.filter(article => article && typeof article.title === 'string' && article.title.trim() && typeof article.url === 'string' && Number.isFinite(Date.parse(article.publishedAt)));
    return {articles:articles.length ? articles : fallback, error:''};
  } catch (error) {
    return {articles:fallback, error:error.message};
  } finally {clearTimeout(timeout);}
}
