import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = `${fs.readFileSync('lib/article-photo-resolver.js', 'utf8')}\nmodule.exports.__test = { queryVariants, sameEvent };`;
const context = {
  require: spec => spec === './article-photo-cache.js' ? require('../lib/article-photo-cache.js') : require(spec),
  module: { exports: {} },
  exports: {},
  Buffer,
  URL,
  URLSearchParams,
  TextDecoder,
  AbortSignal,
  fetch
};
vm.runInNewContext(source, context, { filename: 'api/article-thumbnail.js' });

const { queryVariants, sameEvent } = context.module.exports.__test;
const rollingTitle = 'DIRECT. «Quotidien» pulvérise Lena Situations et Julien Odoul, le couple Hanouna - Loustau star de «TBT9»... Suivez la rentrée des talk-shows - leparisien.fr';
const stablePublisherTitle = 'DIRECT. Hanouna, « Quotidien », « C à vous »... Suivez la rentrée des talk-shows télé';
const variants = queryVariants(rollingTitle);

assert.ok(variants.includes('Suivez la rentrée des talk-shows'),
  `the stable live-blog tail must be searched independently: ${JSON.stringify(variants)}`);
assert.equal(sameEvent(stablePublisherTitle, rollingTitle), true,
  'the canonical publisher headline must remain an exact-enough event match');
assert.ok(variants.length <= 3, 'thumbnail recovery must keep its bounded search budget');

if (process.env.LIVE_THUMBNAIL_TEST === '1') {
  const headers = {};
  let body = Buffer.alloc(0);
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers[String(name).toLowerCase()] = String(value); },
    end(value = '') { body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); }
  };
  await context.module.exports({
    method: 'GET',
    query: {
      url: 'https://news.google.com/rss/articles/CBMi7wFBVV95cUxPY0MzblF0eEpCbFEtNTlKYlNYWmJGVzJJdS1pMzBKbDduc0d3Q0xkTXZvOHpQa0ZadVF0OHZ3YW83STV6SDMyQVF0N3RjY21GZVcxMjFZQ0hwV0xMUUlmUU1JQ2J4cllLcms2aHl0Y29ZdnRBWnVEX29tWnRBdnJxekpFcXk4YmpCTzFrYi11UEJQR0RueUtEcmhyQlBkd2ZBVEVkcG5WakdRdTNmbGNWVjRWZE1aYjJvVjdOcjQ1SmNzem1tYlotOE53Q0EtZDVDdFMycE93MnRfbThnamFTWHZpVTR2dzluV1dVTU44RQ?oc=5',
      title: rollingTitle,
      source: 'leparisien.fr'
    }
  }, response);
  assert.match(headers['x-thumbnail-status'] || '', /^(?:publisher|google-news|bing-news)/,
    `the real live article must return a publisher photo, got ${headers['x-thumbnail-status'] || 'no status'}`);
  assert.match(headers['content-type'] || '', /^image\/(?!svg)/,
    `the real live article must return a raster image, got ${headers['content-type'] || 'no type'}`);
  assert.ok(body.byteLength >= 3500, `the real live article image is unexpectedly small: ${body.byteLength}`);
  console.log(`live thumbnail: ${headers['x-thumbnail-status']} ${headers['content-type']} ${body.byteLength} bytes`);
}

console.log('v91.36 live-title thumbnail checks passed');
