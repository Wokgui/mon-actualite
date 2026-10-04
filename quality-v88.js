(() => {
  'use strict';

  const CACHE_KEY = 'news-live-cache';
  const STORY_KEY = 'news-story-history-v81';
  const INTEL_KEY = 'news-story-intelligence-cache-v81';
  const PERF_KEY = 'news-performance-v81';
  const PROVENANCE_KEY = 'news-provenance-v88';
  const REPORT_KEY = 'news-diagnostic-v88';
  const ERRORS_KEY = 'news-client-errors-v88';
  const VERSION_LABEL = 'v88';
  let decorateQueued = false;
  let testRunning = false;

  function clean(value = '') { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function normalize(value = '') { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function readJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function canonicalUrl(value = '') {
    try {
      const url = new URL(value, location.href);
      url.hash = '';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
      return url.href.replace(/\/$/, '');
    } catch { return clean(value); }
  }
  function escapeHtml(value = '') { return clean(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }

  function cachedArticles() {
    const cache = readJson(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }

  function articleFromModal(modal) {
    const articles = cachedArticles();
    const title = normalize(modal?.querySelector('.quick-summary-head h2, h2')?.textContent || '');
    const source = normalize(modal?.querySelector('.quick-summary-meta span')?.textContent || '');
    return articles.find(article => title && normalize(article.title || '') === title && (!source || normalize(article.source || '') === source))
      || articles.find(article => title && normalize(article.title || '').includes(title))
      || articles.find(article => title && title.includes(normalize(article.title || '')))
      || null;
  }

  function storyFor(article = {}) {
    const memory = readJson(STORY_KEY, { stories: [] });
    const stories = Array.isArray(memory?.stories) ? memory.stories : [];
    const key = clean(article.storyMemoryV81?.key || '');
    if (key) {
      const exact = stories.find(story => clean(story.key || '') === key);
      if (exact) return exact;
    }
    const event = normalize(article.eventKeyV78 || '');
    if (event) {
      const found = stories.find(story => normalize(story.key || '').includes(event));
      if (found) return found;
    }
    return null;
  }

  function provenanceAliases(article = {}) {
    return [...new Set([
      article.id ? `id:${article.id}` : '',
      article.url ? `url:${canonicalUrl(article.url)}` : '',
      article.title ? `title:${normalize(article.title)}` : '',
      article.eventKeyV78 ? `event:${normalize(article.eventKeyV78)}` : ''
    ].filter(Boolean))];
  }

  function provenanceFor(article = {}) {
    const store = readJson(PROVENANCE_KEY, {});
    let entry = null;
    for (const alias of provenanceAliases(article)) {
      if (store[alias]) { entry = store[alias]; break; }
    }
    const sources = [...new Set([
      ...(Array.isArray(entry?.sources) ? entry.sources : []),
      article.source,
      ...(Array.isArray(article.sources) ? article.sources : [])
    ].map(clean).filter(Boolean))].slice(0, 12);
    return {
      sources,
      sourceCount: Math.max(sources.length, Number(entry?.sourceCount || 0)),
      corroborated: Boolean(entry?.corroborated || article.corroboratedV79 || sources.length >= 2),
      provider: clean(entry?.provider || '')
    };
  }

  function formatDate(value) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time)) return '';
    try { return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(time)); }
    catch { return ''; }
  }

  function timelineMarkup(article) {
    const story = storyFor(article);
    const snapshots = Array.isArray(story?.snapshots) ? story.snapshots.slice(-6) : [];
    if (!snapshots.length) return '<p class="quality-empty-v88">Pas encore assez d’historique pour afficher une chronologie.</p>';
    return `<ol class="timeline-v88">${snapshots.map((snapshot, index) => {
      const when = formatDate(snapshot.publishedAt) || formatDate(snapshot.seenAt) || `Étape ${index + 1}`;
      const text = clean(snapshot.title || snapshot.summary || '').slice(0, 260);
      const source = clean(snapshot.source || (Array.isArray(snapshot.sources) ? snapshot.sources[0] : '') || '');
      return `<li><time>${escapeHtml(when)}</time><span>${escapeHtml(text)}</span>${source ? `<small>${escapeHtml(source)}</small>` : ''}</li>`;
    }).join('')}</ol>`;
  }

  function provenanceMarkup(article) {
    const provenance = provenanceFor(article);
    if (!provenance.sources.length) return '<p class="quality-empty-v88">Aucune provenance supplémentaire enregistrée pour cette synthèse.</p>';
    const lead = provenance.corroborated && provenance.sourceCount >= 2
      ? `Synthèse recoupée avec ${provenance.sourceCount} sources disponibles.`
      : 'Cette information repose actuellement sur une seule source identifiable.';
    return `<p class="provenance-lead-v88">${escapeHtml(lead)}</p><div class="provenance-sources-v88">${provenance.sources.map(source => `<span>${escapeHtml(source)}</span>`).join('')}</div>`;
  }

  function decorateModal() {
    const modal = document.querySelector('.quick-summary-backdrop');
    if (!modal || modal.querySelector('.quality-details-v88')) return;
    const article = articleFromModal(modal);
    if (!article) return;
    const details = document.createElement('details');
    details.className = 'quality-details-v88';
    const provenance = provenanceFor(article);
    const story = storyFor(article);
    const steps = Array.isArray(story?.snapshots) ? story.snapshots.length : 0;
    details.innerHTML = `<summary>Chronologie et sources <small>${steps > 1 ? `${steps} étapes` : ''}${steps > 1 && provenance.sourceCount ? ' · ' : ''}${provenance.sourceCount ? `${provenance.sourceCount} source${provenance.sourceCount > 1 ? 's' : ''}` : ''}</small></summary>
      <div class="quality-block-v88"><h3>Chronologie</h3>${timelineMarkup(article)}</div>
      <div class="quality-block-v88"><h3>Provenance de la synthèse</h3>${provenanceMarkup(article)}</div>`;
    const target = modal.querySelector('.why-modal-v85, .verification-note-v83, .quick-summary-meta');
    if (target) target.insertAdjacentElement('afterend', details);
  }

  function recordClientError(kind, message) {
    const list = readJson(ERRORS_KEY, []);
    const sanitized = clean(message).replace(/https?:\/\/\S+/g, '[url]').slice(0, 500);
    list.push({ kind, message: sanitized, at: Date.now() });
    writeJson(ERRORS_KEY, list.slice(-30));
  }

  window.addEventListener('error', event => recordClientError('error', event?.message || event?.error?.message || 'Erreur JavaScript'));
  window.addEventListener('unhandledrejection', event => recordClientError('rejection', event?.reason?.message || event?.reason || 'Promesse rejetée'));

  async function fetchStatus(path) {
    const started = performance.now();
    try {
      const response = await fetch(path, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok && payload?.ok !== false, status: response.status, ms: Math.round(performance.now() - started), provider: clean(payload?.provider || '') };
    } catch (error) {
      return { ok: false, status: 0, ms: Math.round(performance.now() - started), error: clean(error?.message || error).slice(0, 180) };
    }
  }

  async function runSelfTests({ force = false } = {}) {
    if (testRunning) return readJson(REPORT_KEY, null);
    const previous = readJson(REPORT_KEY, null);
    if (!force && previous && Date.now() - Number(previous.at || 0) < 10 * 60 * 1000) return previous;
    testRunning = true;
    const tests = [];
    const add = (name, ok, detail = '') => tests.push({ name, ok: Boolean(ok), detail: clean(detail).slice(0, 300) });

    try {
      const articles = cachedArticles();
      add('Cache du fil lisible', Array.isArray(articles), `${articles.length} articles`);
      add('Aucun marqueur technique V86 visible', !articles.some(article => /\[v86b\d+\]/i.test(clean(article.title || '')) || /:v86b\d+$/i.test(clean(article.eventKeyV78 || ''))), 'Titres et clés nettoyés');
      add('Pipeline consolidé chargé', Boolean(document.querySelector('script[src*="news-pipeline-v88.js"]')), 'news-pipeline-v88.js');
      add('Anciens wrappers consolidés retirés', ![...document.scripts].some(script => /story-boundary-clean-v86|summary-supplement-v86|feed-balance-v87/.test(script.src)), '3 wrappers remplacés par 1');
      add('Navigation principale présente', Boolean(document.querySelector('.bottom-nav [data-view="home"]')) && Boolean(document.querySelector('.bottom-nav [data-view="brief"]')), 'Accueil + Brief');

      const version = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
      add('Version v88 publiée', clean(version?.label || '').toLowerCase().includes(VERSION_LABEL), clean(version?.label || 'version indisponible'));

      const swText = await fetch(`./sw.js?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
      add('Service worker v88 complet', /v88-core/.test(swText) && /news-pipeline-v88\.js\?v=88/.test(swText) && /quality-v88\.js\?v=88/.test(swText), swText ? 'Cache v88 trouvé' : 'sw.js indisponible');

      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
        add('Service worker enregistré', Boolean(registration), registration?.active ? 'Actif' : registration ? 'Enregistré' : 'Absent');
      }

      if (navigator.onLine) {
        const [groq, multi] = await Promise.all([
          fetchStatus('/api/article-summary-groq?status=1'),
          fetchStatus('/api/article-summary-multisource?status=1')
        ]);
        add('API résumé', groq.ok, `${groq.status || 'erreur'} · ${groq.ms} ms${groq.provider ? ` · ${groq.provider}` : ''}`);
        add('API multi-sources', multi.ok, `${multi.status || 'erreur'} · ${multi.ms} ms${multi.provider ? ` · ${multi.provider}` : ''}`);
      } else {
        add('API résumé', true, 'Non testée hors connexion');
        add('API multi-sources', true, 'Non testée hors connexion');
      }
    } catch (error) {
      add('Exécution du diagnostic', false, error?.message || error);
    }

    const report = {
      version: 88,
      at: Date.now(),
      ok: tests.every(test => test.ok),
      passed: tests.filter(test => test.ok).length,
      failed: tests.filter(test => !test.ok).length,
      tests
    };
    writeJson(REPORT_KEY, report);
    testRunning = false;
    scheduleDecorate();
    return report;
  }

  function settingsPage() {
    return document.querySelector('.settings-page, main.settings-page, .page.settings-page')
      || [...document.querySelectorAll('.page, main')].find(node => node.querySelector('.app-version-section, [data-check-update], [data-reset]'));
  }

  function formatReportStatus(report) {
    if (!report) return 'Contrôle automatique pas encore exécuté';
    return report.ok ? `${report.passed}/${report.tests.length} contrôles réussis` : `${report.failed} contrôle${report.failed > 1 ? 's' : ''} à vérifier sur ${report.tests.length}`;
  }

  function decorateSettings() {
    const page = settingsPage();
    if (!page) return;
    let section = page.querySelector('.quality-diagnostic-v88');
    if (!section) {
      section = document.createElement('section');
      section.className = 'settings-section quality-diagnostic-v88';
      const maintenance = page.querySelector('.maintenance-v84');
      if (maintenance) maintenance.insertAdjacentElement('afterend', section);
      else page.appendChild(section);
    }
    const report = readJson(REPORT_KEY, null);
    const errors = readJson(ERRORS_KEY, []);
    const statusClass = report?.ok ? 'ok' : report ? 'warn' : '';
    section.innerHTML = `<h2>Contrôle qualité</h2>
      <div class="quality-status-v88 ${statusClass}"><strong>${escapeHtml(formatReportStatus(report))}</strong><small>${errors.length ? `${errors.length} erreur${errors.length > 1 ? 's' : ''} client récente${errors.length > 1 ? 's' : ''} enregistrée${errors.length > 1 ? 's' : ''}` : 'Aucune erreur client enregistrée par la v88'}</small></div>
      <p>Le contrôle vérifie le cache du fil, les scripts actifs, le service worker, la navigation et les API de résumé. Le rapport exporté ne contient aucune clé API.</p>
      <div class="quality-actions-v88"><button type="button" class="secondary-btn compact-btn" data-run-tests-v88>Relancer les contrôles</button><button type="button" class="secondary-btn compact-btn" data-export-diagnostic-v88>Exporter le diagnostic</button></div>`;
  }

  function buildDiagnostic() {
    const cache = readJson(CACHE_KEY, {});
    const articles = Array.isArray(cache.articles) ? cache.articles : [];
    const perf = readJson(PERF_KEY, []);
    const story = readJson(STORY_KEY, { stories: [] });
    const report = readJson(REPORT_KEY, null);
    const errors = readJson(ERRORS_KEY, []);
    const stats = cache.stats && typeof cache.stats === 'object' ? cache.stats : {};
    return {
      type: 'mon-actualite-diagnostic',
      schema: 88,
      exportedAt: new Date().toISOString(),
      page: { origin: location.origin, path: location.pathname, online: navigator.onLine, visibility: document.visibilityState },
      device: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        connection: navigator.connection ? { effectiveType: navigator.connection.effectiveType, saveData: navigator.connection.saveData, downlink: navigator.connection.downlink } : null
      },
      app: {
        articleCount: articles.length,
        essentialCount: articles.filter(article => article.essential).length,
        multiSourceCount: articles.filter(article => article.corroboratedV79 || Number(article.mergedCount || 0) >= 2).length,
        discoveryCount: articles.filter(article => article.discoveryV87).length,
        storyCount: Array.isArray(story?.stories) ? story.stories.length : 0,
        stats
      },
      selfTest: report,
      recentPerformance: Array.isArray(perf) ? perf.slice(-80) : [],
      recentClientErrors: Array.isArray(errors) ? errors.slice(-20) : []
    };
  }

  function exportDiagnostic() {
    const data = buildDiagnostic();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mon-actualite-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  document.addEventListener('click', async event => {
    if (event.target.closest?.('[data-run-tests-v88]')) {
      event.preventDefault();
      const button = event.target.closest('[data-run-tests-v88]');
      button.disabled = true;
      button.textContent = 'Contrôle…';
      await runSelfTests({ force: true });
      return;
    }
    if (event.target.closest?.('[data-export-diagnostic-v88]')) {
      event.preventDefault();
      exportDiagnostic();
    }
  }, true);

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateModal();
      decorateSettings();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(scheduleDecorate).observe(document.body, { childList: true, subtree: true });
    scheduleDecorate();
    setTimeout(() => runSelfTests().catch(() => {}), 1800);
  }, { once: true });
  window.addEventListener('focus', scheduleDecorate);
})();
