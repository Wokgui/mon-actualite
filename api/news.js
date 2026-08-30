'use strict';

const coreHandler = require('../lib/news-core');
const { mergeEventVariants } = require('../lib/news-dedup');
const { rankCatalogArticles } = require('../lib/news-significance');

const CATALOG_LIMIT = 90;

module.exports = async function handler(req, res) {
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

  await coreHandler(req, capture);

  let output = body;
  if (statusCode === 200 && body) {
    try {
      const payload = JSON.parse(body);
      if (Array.isArray(payload?.articles)) {
        const candidateItems = payload.articles.length;
        const uniqueCandidates = mergeEventVariants(payload.articles);
        const rankedCandidates = rankCatalogArticles(uniqueCandidates);
        const articles = rankedCandidates.slice(0, CATALOG_LIMIT);
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
          deduplicatedItems: articles.length
        };
        output = JSON.stringify(payload);
      }
    } catch {}
  }

  res.statusCode = statusCode;
  for (const [name, value] of headers) res.setHeader(name, value);
  return res.end(output);
};
