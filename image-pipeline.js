import { photoRecordByKey, resolvePhoto, commitPhoto, commitReplacement } from './services/article-photos.js?v=98.66';

const defaults = { intervalMs: 120, concurrency: 4, priorityCount: 12, rootMarginPx: 1200, timeoutMs: 14000 };
const config = { ...defaults, ...window.__ARTICLE_PHOTO_CONFIG };
config.intervalMs = Math.max(16, Math.min(1000, Number(config.intervalMs) || defaults.intervalMs));
config.concurrency = Math.max(1, Math.min(8, Number(config.concurrency) || defaults.concurrency));
window.__articlePhotoConfig = config;
const app = document.getElementById('app');
let jobs = [];
let active = 0;
let nextStart = 0;
let nextCommit = 0;
let timer = 0;
let retryTimer = 0;
let frame = 0;

function scan() {
  frame = 0;
  const previous = new Map(jobs.map(job => [job.record.key, job]));
  const next = new Map();
  app?.querySelectorAll('.article-card[data-article]').forEach((card, index) => {
    const image = card.querySelector('img.article-image');
    const record = photoRecordByKey(image?.dataset.photoKey);
    if (!image || !record) return;
    const rect = card.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < innerHeight;
    if (image.dataset.photoFinal === '1' || image.dataset.photoReplacement === '1') return;
    if (!visible && index >= config.priorityCount && (rect.top > innerHeight + config.rootMarginPx || rect.bottom < -config.rootMarginPx)) return;
    let job = next.get(record.key);
    if (!job) {
      job = previous.get(record.key) || { record, started: Boolean(record.promise), settled: record.status === 'ready' || record.status === 'failed' };
      if (record.status === 'failed' && record.attempts < 2 && Date.now() >= record.retryAt) { job.started = false; job.settled = false; }
      job.images = [];
      job.visible = visible;
      job.rank = index;
      next.set(record.key, job);
    }
    job.images.push(image);
  });
  // Visible cards first, then FIFO in current feed order. Started work survives
  // rerenders; obsolete nodes neither reset nor duplicate network requests.
  jobs = [...next.values()].sort((a, b) => Number(b.visible) - Number(a.visible) || a.rank - b.rank);
  clearTimeout(retryTimer);
  const retryAt = jobs.filter(job => job.record.status === 'failed' && job.record.attempts < 2).map(job => job.record.retryAt);
  if (retryAt.length) retryTimer = setTimeout(scheduleScan, Math.max(1, Math.min(...retryAt) - Date.now()));
  pump();
}

function scheduleScan() { if (!frame) frame = requestAnimationFrame(scan); }

function pump() {
  clearTimeout(timer);
  const now = performance.now();
  // Concurrent resolution, ordered presentation. No candidate enters the
  // visible DOM, and a slow card cannot trigger a reveal burst.
  while (jobs[0]?.settled) {
    const job = jobs[0];
    if (job.record.status === 'failed') {
      if (job.record.attempts >= 2 && job.record.fallbackUrl) {
        if (now < nextCommit) break;
        jobs.shift();
        let committed = false;
        for (const image of job.images) committed = commitReplacement(image, job.record) || committed;
        if (committed) { nextCommit = performance.now() + config.intervalMs; break; }
        continue;
      }
      for (const image of job.images) if (image.isConnected) {
        image.classList.remove('image-pending-v98');
        image.classList.add('image-fallback-v98');
      }
      jobs.shift();
      continue;
    }
    if (now < nextCommit) break;
    jobs.shift();
    let committed = false;
    for (const image of job.images) committed = commitPhoto(image, job.record) || committed;
    if (committed) nextCommit = performance.now() + config.intervalMs;
    break;
  }
  const waiting = jobs.find(job => !job.started && !job.settled);
  if (waiting && active < config.concurrency && now >= nextStart) {
    waiting.started = true;
    active++;
    nextStart = performance.now() + config.intervalMs;
    resolvePhoto(waiting.record, waiting.visible || waiting.rank < 4 ? 'high' : 'auto', config.timeoutMs).then(() => {
      waiting.settled = true;
      for (const job of jobs) if (job.record === waiting.record) job.settled = true;
    }).finally(() => {
      active--;
      // A successful decode needs no DOM walk, forced geometry read, or frame
      // delay. Only failures need a scan to arm their bounded retry deadline.
      if (waiting.record.status === 'failed') scheduleScan(); else pump();
    });
  }
  const delays = [];
  if (jobs[0]?.settled) delays.push(Math.max(1, nextCommit - performance.now()));
  if (jobs.some(job => !job.started && !job.settled) && active < config.concurrency) delays.push(Math.max(1, nextStart - performance.now()));
  if (delays.length) timer = setTimeout(pump, Math.min(...delays));
}

window.addEventListener('news:stable-render', scheduleScan);
window.addEventListener('pageshow', scheduleScan);
window.addEventListener('scroll', scheduleScan, { passive: true });
window.addEventListener('resize', scheduleScan, { passive: true });
window.addEventListener('online', scheduleScan);
scheduleScan();
