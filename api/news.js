'use strict';

const coreHandler = require('../lib/news-core');
const fastNewsHandler = require('../lib/news-fast');
const { mergeEventVariants } = require('../lib/news-dedup');
const { rankCatalogArticles } = require('../lib/news-significance');
const { suppressCorePrewarmRequest, scheduleFinalImagePrewarm } = require('../lib/final-image-prewarm');
const articleReaderHandler = require('../lib/article-reader');

const CATALOG_LIMIT = 90;

function wantsReaderMode(req) {
  if (String(req.query?.reader || '') === '1') return true;
  try {
    return new URL(req.url || '/', 'https://local.invalid').searchParams.get('reader') === '1';
  } catch {
    return false;
  }
}

function wantsFastMode(req) {
  if (String(req.query?.fast || '') === '1') return true;
  try {
    return new URL(req.url || '/', 'https://local.invalid').searchParams.get('fast') === '1';
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (wantsReaderMode(req)) return articleReaderHandler(req, res);
  if (req.method === 'GET' && wantsFastMode(req)) return fastNewsHandler(req, res);

  let statusCode = 200;
  let body = '';
  const headers = new Map();
  const capture = {
    get statusCode() { return statusCode; },
    set statusCode(value) { statusCode = Number(value) || 200; },
    setHeader(name, value) { headers.set(String(name), value); },
    getHeader(name) { return headers.get(String(name)); },
    removeHeader(name) { headers.delete(String(name)); },
    write(chunk = '') { body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk); return true; },
    end(chunk = '') { if (chunk) this.write(chunk); return this; }
  };

  // news-core ranks and lexically deduplicates the broad candidate pool. Its
  // historical image prewarm happens before this route performs semantic
  // event deduplication and final catalogue significance ranking. Suppress
  // only that early prewarm here, then spend the same 16-request budget on
  // the actual final-ranked catalogue below.
  await coreHandler(suppressCorePrewarmRequest(req), capture);

  let output = body;
  if (statusCode === 200 && body) {
    try {
      const payload = JSON.parse(body);
      if (Array.isArray(payload?.articles)) {
        const candidateItems = payload.articles.length;
        const uniqueCandidates = mergeEventVariants(payload.articles);
        const rankedCandidates = rankCatalogArticles(uniqueCandidates);
        const articles = rankedCandidates.slice(0, CATALOG_LIMIT);
        const prewarmScheduled = await scheduleFinalImagePrewarm(req, articles);
        payload.articles = articles;
        payload.stats = {
          ...(payload.stats || {}),
          candidateItems,
          lexicalDeduplicatedItems: candidateItems,
          eventDeduplicatedItems: uniqueCandidates.length,
          eventDuplicatesRemoved: Math.max(0, candidateItems - uniqueCandidates.length),
          catalogLimit: CATALOG_LIMIT,
          catalogItems: articles.length,
          catalogSignalV915: true,
          catalogPositiveSignals: articles.filter(article => Number(article.catalogSignalV915 || 0) > 0).length,
          catalogNegativeSignals: articles.filter(article => Number(article.catalogSignalV915 || 0) < 0).length,
          deduplicatedItems: articles.length,
          prewarmScheduled,
          prewarmStageV9135: 'final-ranked-catalog'
        };
        output = JSON.stringify(payload);
      }
    } catch {}
  }

  res.statusCode = statusCode;
  for (const [name, value] of headers) res.setHeader(name, value);
  return res.end(output);
};
