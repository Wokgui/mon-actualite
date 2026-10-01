# Article photos — 98.31

## Diagnosis before modification

The active startup loaded two independent photo owners: the classic
photo-single-owner script and the module image-pipeline. The renderer assigned
a local source tile and exposed a network candidate; both loaders then mutated
the same visible image, with different article maps and readiness checks.
Legacy backfill/pin flags could claim an unvalidated selection was ready.
API selection used Promise.any: network arrival order decided which discovery
or publisher photo won. Worker cache keys also depended on title/image hints
and concurrent callers could receive the same consumed Response stream.
Startup backend prefetch launched bursts. Rerenders and changed synchronization
IDs invalidated the separate locks.

The baseline settings/images browser test failed with **91 simultaneous photo
requests**, against its existing eight-request limit. Old inactive image
scripts were audited but are not part of the index startup runtime.

## Ownership and state

Renderer and pipeline import exactly services/article-photos.js?v=98.31.
Its canonical article URL key strips tracking/hash and survives ID/title
changes. The state is idle -> loading -> decoded -> committed, or failed.
Only commitPhoto assigns a real photo to a connected card. Fetch and decode
all candidates outside the DOM; keep an immutable decoded blob URL after the
first commit. Rerenders read that same URL. Failed attempts leave the neutral
tile intact; they do not overwrite an existing real photo.

Large originals are downscaled off-DOM to at most 720 x 540 while preserving
aspect ratio. Card layout and existing text-scaling dimensions are unchanged.
The obsolete photo-single-owner startup script is removed.

## Queue and configuration

Set window.__ARTICLE_PHOTO_CONFIG before the image-pipeline module runs.
Defaults: intervalMs=120, concurrency=4, priorityCount=12,
rootMarginPx=1200, timeoutMs=14000.
Visible cards have first priority; eligible following cards use feed-order
FIFO. Network starts and decoded-photo commits are both spaced by intervalMs.
Resolution may overlap within the concurrency bound, while commits stay
ordered. Slow/failed photos may increase a gap: the interval is a minimum,
not a guarantee of network availability. One retry after eight seconds is
allowed; a persistent failure is not retried forever.

## Selection and caches

All three public photo endpoints delegate to one resolver. Fixed authority
order replaces arrival-order races: supplied/publisher metadata (6s budget),
then ranked news/image discovery, then remaining recovery, within a 12s total
fetch budget. Candidate batches settle together and retain ranking order.
Backend positive raster selections share canonical identity, single-flight
and a bounded 64MiB, seven-day memory cache. No negative/fallback selection is
cached. Response ETag and seven-day HTTP/CDN cache preserve a positive result.
Memory caches are per server instance; fixed ranking, browser lock and HTTP/
worker caching provide continuity rather than a new distributed database.

localStorage news-photo-selections-v1 holds only validated request URLs,
maximum 500 entries, seven days. Reloading still decodes the response before
display; old ready/pin flags are not trusted. SW thumbnail cache v10 uses the
same article identity across endpoint aliases and hint changes, raster-only
positives, a seven-day TTL and cloned Response bodies for each caller.
Old app caches are migrated without deleting unrelated caches.
Startup prewarm uses the final catalogue, same versioned request format,
16 articles maximum, concurrency four, starts spaced 120ms.

## Evidence and regression gates

window.__articlePhotoMetrics records firstImageMs, requests, active/maxActive,
per-article attempts, commits/timestamps, failures and accidental URL changes.
Tests additionally audit DOM mutations independently of those metrics.

- v9831-photo-selection: canonical identity, authority independent of arrival,
  single-flight, positive-only cache, cancellation budget.
- v9831-photo-cache-worker: endpoint aliases, independent streams, expiration,
  negative rejection and scoped cache migration.
- v9831-photos-browser: first image under 1.2s in controlled mobile fixture;
  >=115ms commit gaps with 120ms configuration; no visible network candidates;
  no swaps after eight settings/home cycles and changed sync IDs/hints;
  bounded concurrency/requests; corrupt/neutral responses and stable geometry.
- Existing current-UI and settings/images tests remain active. Obsolete theme
  expectations were aligned to the already-current theme; geometry, image
  concurrency and new timing gates are not weakened.
- v9831-photos-live: full current frontend, actual catalogue and real current
  photo handlers; screenshots, navigation/scroll and API header evidence.

Controlled mobile run: first image 661ms, first ten successful photos 1806ms,
normal commit gaps 121–146ms, maximum active three, no visible candidate or
final-image change, geometry 119 x 80. Real local-handler run: first image
2468ms including catalogue synchronization, first commit gaps 123–191ms,
maximum active four, 25 raster responses with publisher metadata and no
image change after navigation. These are single-run observations, not
production percentile guarantees. The baseline did not record comparable
first-image latency; only its concurrency failure supports a before/after.

Browser emulation is not a physical Android-device test. Android compilation
and APK contents must be checked separately during release.

Final PWA live run with the real worker controlling the page: first image
2479ms, active maximum four, 20 real raster responses, zero swaps/errors.
Its first six commit gaps were 122–284ms: real response availability can
increase the configured 120ms minimum. The exact historical Le Parisien
cover test also passed (publisher-metadata JPEG, 131878 bytes).

The four-case historical network suite is not wholly green: Olympics and
ANVOL recover real covers (about 1.2s and 5.2s). info.gouv.fr and L'essentiel
return unavailable; the original 6ad53c9 resolver also returned neutral SVG
for these same two cases. A first 3s publisher budget regressed ANVOL, so it
was corrected to 6s within the unchanged 12s global bound. Do not relax the
historical real-photo assertions or silently treat neutral tiles as photos.
