import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../lib/news-core.js');
const fast = require('../lib/news-fast.js');
const originalFetch = global.fetch;
const requests = [];
const rss = '<?xml version="1.0"?><rss><channel><title>Test</title></channel></rss>';
global.fetch = async input => { requests.push(String(input)); return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }); };

function responseCapture() {
  let body = '';
  return { statusCode: 0, headers: new Map(), setHeader(name,value){this.headers.set(name,value);}, getHeader(name){return this.headers.get(name);}, end(chunk=''){body += String(chunk); this.body=body; return this;} };
}

try {
  const coreResponse = responseCapture();
  await core({ method:'POST', query:{}, body:{ language:'ja', locale:'ja-JP', country:'JP', sources:[], keywords:['technology'], preferredCategories:[], webSearch:true }, headers:{} }, coreResponse);
  assert.equal(coreResponse.statusCode, 200);
  const japaneseRequests = requests.splice(0);
  assert.ok(japaneseRequests.length >= 6);
  assert.ok(japaneseRequests.every(url => { const parsed=new URL(url); return parsed.searchParams.get('hl')==='ja' && parsed.searchParams.get('gl')==='JP' && parsed.searchParams.get('ceid')==='JP:ja'; }), 'all default and search feeds must follow selected Japanese country');

  const fastResponse = responseCapture();
  await fast({ method:'GET', query:{ language:'id', interests:'Tech' }, headers:{} }, fastResponse);
  assert.equal(fastResponse.statusCode, 200);
  assert.ok(requests.length >= 6);
  assert.ok(requests.every(url => { const parsed=new URL(url); return parsed.searchParams.get('hl')==='id' && parsed.searchParams.get('gl')==='ID' && parsed.searchParams.get('ceid')==='ID:id'; }), 'fast feeds must follow selected Indonesian country');
  console.log(JSON.stringify({ coreFeeds:japaneseRequests.length, fastFeeds:requests.length, localeRouting:'passed' }));
} finally { global.fetch = originalFetch; }
