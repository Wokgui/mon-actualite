'use strict';
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const budget = new AsyncLocalStorage();
const positive = new Map();
const inflight = new Map();
const MAX_BYTES = 64 * 1024 * 1024;
const TTL_MS = 7 * 86400000;
let bytes = 0;

function canonicalUrl(raw = '') {
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.href;
  } catch { return String(raw || '').trim(); }
}

function photoKey(query) {
  const identity = canonicalUrl(query.url) || String(query.id || '') || canonicalUrl(query.image) || `${query.source || ''}|${query.title || ''}`;
  return createHash('sha256').update(`photo-v1|${identity}`).digest('hex');
}

function photoSignal(timeoutMs) {
  const signal = budget.getStore();
  signal?.throwIfAborted();
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function withPhotoBudget(timeoutMs, work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const parent = budget.getStore();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  try { return await budget.run(signal, work); }
  finally { clearTimeout(timer); }
}

function isPositive(result) {
  const type = result?.headers?.get('content-type') || '';
  const status = result?.headers?.get('x-thumbnail-status') || '';
  return result?.statusCode === 200 && /^image\/(?:jpeg|png|webp|avif|gif)/i.test(type) && !/fallback|neutral|tile/i.test(status) && result.buffer?.length > 0;
}

async function cachedPhoto(query, select) {
  const key = photoKey(query);
  const cached = positive.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return { result: cached.result, cache: 'hit' };
  if (cached) { bytes -= cached.result.buffer.length; positive.delete(key); }
  // Positive bytes share one article lock. Negative client handoffs must not
  // be delivered to older clients that do not implement off-DOM recovery.
  const flightKey = key + (query.clientRecovery === '1' ? ':client' : ':server');
  if (inflight.has(flightKey)) return { result: await inflight.get(flightKey), cache: 'shared' };
  const task = Promise.resolve().then(select).then(result => {
    if (isPositive(result)) {
      // Capability-specific flights can overlap. The first positive article
      // selection wins for both clients; a later flight cannot replace it.
      const locked = positive.get(key);
      if (locked && Date.now() - locked.at < TTL_MS) return locked.result;
      result.headers.set('cache-control', 'public, max-age=604800, s-maxage=604800, immutable');
      result.headers.set('etag', `"${createHash('sha256').update(result.buffer).digest('hex')}"`);
      while (bytes + result.buffer.length > MAX_BYTES && positive.size) {
        const oldest = positive.keys().next().value;
        bytes -= positive.get(oldest).result.buffer.length;
        positive.delete(oldest);
      }
      positive.set(key, { result, at: Date.now() });
      bytes += result.buffer.length;
    }
    return result;
  }).finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, task);
  return { result: await task, cache: 'miss' };
}

module.exports = { photoKey, canonicalUrl, cachedPhoto, withPhotoBudget, photoSignal };
