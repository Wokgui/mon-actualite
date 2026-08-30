'use strict';

const coreHandler = require('../lib/news-core');
const { mergeEventVariants } = require('../lib/news-dedup');

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
        const before = payload.articles.length;
        const articles = mergeEventVariants(payload.articles);
        payload.articles = articles;
        payload.stats = {
          ...(payload.stats || {}),
          lexicalDeduplicatedItems: before,
          eventDeduplicatedItems: articles.length,
          eventDuplicatesRemoved: Math.max(0, before - articles.length),
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
