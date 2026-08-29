(() => {
  'use strict';

  const upstreamFetch = window.fetch.bind(window);

  function clean(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value = '') {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function tokens(value = '') {
    const stop = new Set('avec dans pour plus apres avant cette sont etre leur leurs tout mais sans vers entre une des les sur qui que aux par son ses est fait article actualite direct selon nouveau nouvelle'.split(' '));
    return [...new Set(normalize(value).split(' ').filter(word => word.length >= 4 && !stop.has(word)))];
  }

  function titleRestatement(summary = '', title = '') {
    const text = clean(summary);
    const wanted = tokens(title);
    if (!text || wanted.length < 4) return false;
    const found = new Set(tokens(text));
    const hits = wanted.filter(word => found.has(word)).length;
    const coverage = hits / Math.max(1, wanted.length);
    return text.length <= Math.max(190, clean(title).length * 1.7) && coverage >= 0.82;
  }

  function poorSummary(payload = {}, article = {}) {
    const summary = clean(payload.summary || payload.text || '');
    if (payload.unavailable || summary.length < 70) return true;
    if (/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(summary)) return true;
    return titleRestatement(summary, article.title || '');
  }

  function responseFrom(response, payload) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
  }

  window.fetch = async function summarySupplementV86Fetch(input, init) {
    const response = await upstreamFetch(input, init);
    let url;
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      url = new URL(raw, location.href);
    } catch { return response; }

    if (url.origin !== location.origin || url.pathname !== '/api/article-summary-groq' || !response.ok || !navigator.onLine) return response;

    let body = null;
    try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch {}
    const article = body?.article && typeof body.article === 'object' ? body.article : null;
    if (!article?.title) return response;

    let base = null;
    try { base = await response.clone().json(); } catch { return response; }
    if (!poorSummary(base, article)) return response;

    try {
      const multiResponse = await upstreamFetch('/api/article-summary-multisource?v=86', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ article })
      });
      if (!multiResponse.ok) return response;
      const multi = await multiResponse.json().catch(() => null);
      const summary = clean(multi?.summary || '');
      if (!multi?.ok || multi?.unavailable || !multi?.corroborated || Number(multi?.sourceCount || 0) < 2 || summary.length < 55) return response;
      return responseFrom(response, {
        ...base,
        ...multi,
        summary,
        unavailable: false,
        supplementedV86: true,
        provider: 'multisource-supplement-v86'
      });
    } catch {
      return response;
    }
  };
})();