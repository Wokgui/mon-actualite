import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1))), '..');

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function clean(value = '') {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function xmlText(value = '') {
  return clean(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;|&#160;/gi, '  ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'));
}

function xmlTag(block = '', name = '') {
  return xmlText((block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')) || [])[1] || '');
}

async function archiveArticles(limit) {
  const now = Date.now();
  const after = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  const before = new Date(now - 8 * 86400000).toISOString().slice(0, 10);
  const subjects = [
    ['Politique', 'politique France'], ['International', 'international'], ['Économie', 'économie France'],
    ['Santé', 'santé médecine'], ['Science', 'science espace'], ['Culture', 'culture cinéma'],
    ['Environnement', 'climat environnement'], ['Tech', 'technologie intelligence artificielle']
  ];
  const output = [];
  for (const [category, subject] of subjects) {
    const url = new URL('https://news.google.com/rss/search');
    url.search = new URLSearchParams({ q: `${subject} after:${after} before:${before}`, hl: 'fr', gl: 'FR', ceid: 'FR:fr' }).toString();
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) continue;
    const xml = await response.text();
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    let kept = 0;
    for (const item of items) {
      const title = xmlTag(item, 'title');
      const urlValue = xmlTag(item, 'link');
      const publishedAt = new Date(xmlTag(item, 'pubDate')).toISOString();
      const source = xmlTag(item, 'source') || 'Google Actualités';
      if (!title || !urlValue || !Number.isFinite(Date.parse(publishedAt))) continue;
      output.push({
        id: `archive-${category}-${output.length + 1}`,
        title,
        url: urlValue,
        summary: xmlTag(item, 'description'),
        detail: xmlTag(item, 'description'),
        publishedAt,
        source,
        sources: [source],
        category,
        image: '',
        visual: { status: 'unavailable', url: '', source: '' },
        visualStatus: 'unavailable'
      });
      kept += 1;
      if (kept >= 2 || output.length >= limit) break;
    }
    if (output.length >= limit) break;
  }
  return output.slice(0, limit);
}

function normalize(value = '') {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function quality(summary = '', article = {}, diagnostics = {}) {
  const text = clean(summary);
  if (!text || /résumé (?:ia )?(?:momentanément )?indisponible/i.test(text)) return 'unavailable';
  if (/news\.google\.com/i.test(article.url || '') && diagnostics.materialSource === 'rss') return 'google-news-aggregate';
  if (text.length < 55) return 'too-short';
  const titleWords = new Set(normalize(article.title).split(' ').filter(word => word.length >= 4));
  const summaryWords = normalize(text).split(' ').filter(word => word.length >= 4);
  const extras = summaryWords.filter(word => !titleWords.has(word));
  const titleHits = [...titleWords].filter(word => summaryWords.includes(word));
  if (titleWords.size >= 4 && titleHits.length / titleWords.size >= 0.84 && extras.length <= 3 && text.length < 190) return 'title-restatement';
  if (new Set(summaryWords).size < 8 && text.length < 100) return 'low-information';
  return text.length >= 90 ? 'good' : 'acceptable-short';
}

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
      getHeader(name) { return headers[String(name).toLowerCase()]; },
      removeHeader(name) { delete headers[String(name).toLowerCase()]; },
      end(body = '') {
        const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
        let data;
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { data = { parseError: true, raw: raw.slice(0, 500) }; }
        resolve({ statusCode: this.statusCode || 200, headers, data });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function ageBucket(article) {
  const hours = Math.max(0, (Date.now() - Date.parse(article.publishedAt || 0)) / 3_600_000);
  if (hours < 12) return '<12h';
  if (hours < 48) return '12-48h';
  if (hours < 168) return '2-7d';
  return '8-31d';
}

function selectSample(articles, limit) {
  const selected = [];
  const used = new Set();
  const dimensions = [
    article => `source:${article.source || 'unknown'}`,
    article => `category:${article.category || 'unknown'}`,
    article => `age:${ageBucket(article)}`,
    article => `format:${new URL(article.url).hostname}`
  ];
  for (const dimension of dimensions) {
    const groups = new Map();
    for (const article of articles) {
      let key;
      try { key = dimension(article); } catch { key = 'invalid'; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(article);
    }
    for (const group of groups.values()) {
      const candidate = group.find(article => !used.has(article.id));
      if (!candidate) continue;
      selected.push(candidate);
      used.add(candidate.id);
      if (selected.length >= limit) return selected;
    }
  }
  for (const article of articles) {
    if (used.has(article.id)) continue;
    selected.push(article);
    if (selected.length >= limit) break;
  }
  return selected;
}

async function mapLimit(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

function csvCell(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [keys.map(csvCell).join(','), ...rows.map(row => keys.map(key => csvCell(row[key])).join(','))].join('\n');
}

const limit = Math.max(1, Number(arg('limit', '48')) || 48);
const concurrency = Math.max(1, Number(arg('concurrency', '4')) || 4);
const label = arg('label', 'audit');
const inputPath = arg('input');
const selectedIndices = arg('indices').split(',').map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0);
const archiveOnly = Math.max(0, Number(arg('archive-only', '0')) || 0);
const outputPath = path.resolve(arg('output', path.join(root, 'audit-output', `${label}.json`)));
const summaryModule = path.resolve(arg('summary-module', path.join(root, 'api', 'article-summary-groq.js')));
const newsHandler = require(path.join(root, 'api', 'news.js'));
const summaryHandler = require(summaryModule);

let articles;
let newsStats = {};
if (archiveOnly) {
  articles = await archiveArticles(archiveOnly);
} else if (inputPath) {
  const loaded = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
  articles = Array.isArray(loaded) ? loaded : loaded.articles;
  if (selectedIndices.length) articles = selectedIndices.map(index => articles[index - 1]).filter(Boolean);
} else {
  const news = await invoke(newsHandler, { method: 'GET', query: {}, body: {}, headers: {}, socket: {} });
  if (news.statusCode !== 200 || !Array.isArray(news.data?.articles)) throw new Error(`News feed unavailable: HTTP ${news.statusCode}`);
  articles = selectSample(news.data.articles, limit);
  newsStats = news.data.stats || {};
}
articles = articles.slice(0, limit);

const rows = await mapLimit(articles, concurrency, async (article, index) => {
  const startedAt = Date.now();
  let response;
  try {
    response = await invoke(summaryHandler, {
      method: 'POST',
      query: { audit: '1' },
      body: { mode: 'article', factualOnly: true, article },
      headers: { 'x-summary-audit': label },
      socket: {}
    });
  } catch (error) {
    response = { statusCode: 599, data: { unavailable: true, error: String(error?.message || error) } };
  }
  const data = response.data || {};
  const diagnostics = data.diagnostics || {};
  const summary = clean(data.summary || data.text || '');
  let host = '';
  try { host = new URL(data.articleUrl || article.url).hostname; } catch {}
  const ageHours = Math.max(0, (Date.now() - Date.parse(article.publishedAt || 0)) / 3_600_000);
  const summaryQuality = quality(summary, article, diagnostics);
  const row = {
    index: index + 1,
    id: article.id,
    source: article.source || '',
    category: article.category || '',
    publishedAt: article.publishedAt || '',
    ageHours: Math.round(ageHours * 10) / 10,
    ageBucket: ageBucket(article),
    pageHost: host,
    inputUrlKind: /news\.google\.com/i.test(article.url || '') ? 'google-news' : 'publisher',
    fullText: diagnostics.materialSource === 'full-text',
    materialSource: diagnostics.materialSource || 'unknown',
    extractedChars: Number(diagnostics.contentChars || 0),
    sourceChars: Number(diagnostics.sourceChars || diagnostics.contentChars || 0),
    extractionMethod: diagnostics.extractionMethod || '',
    rssChars: clean(article.summary || article.detail || '').length,
    summaryChars: summary.length,
    summaryQuality,
    imagePresent: Boolean(article.image || article.visual?.url),
    imageStatus: article.visual?.status || article.visualStatus || '',
    imageSource: article.visual?.source || '',
    failureType: diagnostics.failureType || data.qualityReasonV9112 || data.error || '',
    apiError: data.apiError || data.error || diagnostics.groqError || '',
    errorDetail: diagnostics.error || data.detail || diagnostics.searchError || '',
    timedOut: diagnostics.failureType === 'timeout' || /timeout/i.test(data.error || ''),
    fallbackUsed: Boolean(diagnostics.fallbackUsed || (data.provider && data.provider !== 'groq')),
    fallbackType: diagnostics.fallbackType || (diagnostics.materialSource === 'rss' ? 'rss' : data.provider || ''),
    fallbackQuality: diagnostics.fallbackQuality || data.fallbackQuality || '',
    searchEvidenceCount: Number(diagnostics.searchEvidenceCount || 0),
    retryCount: Number(diagnostics.retryCount || 0),
    provider: data.provider || data.origin || '',
    unavailable: Boolean(data.unavailable || summaryQuality === 'unavailable'),
    elapsedMs: Date.now() - startedAt,
    title: clean(article.title),
    summary
  };
  process.stdout.write(`[${row.index}/${articles.length}] ${row.source} | ${row.materialSource} ${row.extractedChars} | ${row.summaryQuality} | ${row.failureType || 'ok'}\n`);
  return row;
});

const counts = key => Object.fromEntries([...new Set(rows.map(row => row[key] || 'none'))].map(value => [value, rows.filter(row => (row[key] || 'none') === value).length]));
const report = {
  label,
  generatedAt: new Date().toISOString(),
  environment: { groqKey: Boolean(process.env.GROQ_API_KEY), geminiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) },
  sample: {
    size: rows.length,
    sources: new Set(rows.map(row => row.source)).size,
    categories: new Set(rows.map(row => row.category)).size,
    pageHosts: new Set(rows.map(row => row.pageHost)).size,
    imagePresent: rows.filter(row => row.imagePresent).length,
    fullText: rows.filter(row => row.fullText).length,
    rssFallback: rows.filter(row => row.materialSource === 'rss').length,
    unavailable: rows.filter(row => row.unavailable).length,
    acceptable: rows.filter(row => ['good', 'acceptable-short'].includes(row.summaryQuality)).length,
    medianElapsedMs: rows.map(row => row.elapsedMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)] || 0,
    byFailure: counts('failureType'),
    byQuality: counts('summaryQuality'),
    bySourceMaterial: counts('materialSource'),
    byAge: counts('ageBucket')
  },
  newsStats,
  articles,
  rows
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(outputPath.replace(/\.json$/i, '.csv'), `${toCsv(rows)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.sample, null, 2)}\nSaved ${outputPath}\n`);
