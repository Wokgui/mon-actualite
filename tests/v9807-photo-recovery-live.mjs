import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../api/article-photo-fast.js');

const cases = [
  {
    source: 'olympics.com',
    title: 'EuroVolley 2026 : Qui est qualifié en demi-finale du Championnat d’Europe CEV hommes ? | Programme et tableau du dernier carré • Volleyball - olympics.com',
    url: 'https://news.google.com/rss/articles/CBMikAJBVV95cUxPb0FwdDNrLVd2M213MXdqek1fMjVDbzlyc05FdGN2RVFwLVkwZGh3ZEpaRXFyd3Qxazk3Z0o0NEdMV3FOUEFNdG1XbnhIRERIWkJjakdMNnhYaGZ4SkdSSGtubG5jd0dHZW1fU0tMblFUVEpXV09zWG41SG0tX2NhaTZadVZFVHNsNmpIZ041UldFOVFTX0VTOXJkRTdxYm5idFlzT2xWd0xlZjl6eTM4S3NqX1dqdnRNWXJOQlFqZEwwRWxfbWo4MXNWWWltd2s3TjRrcWpEQlVVYldzeFZLbXY4WjU4bHJZZzVISHdXRXVCcmtYVnluSllIcDhWZ2VMekNUTXJDczhQVkk4eERHVw?oc=5'
  },
  {
    source: 'ANVOL',
    title: "Importations de volailles thaïlandaises : l'Union européenne découvre des failles majeures, les professionnels appellent à la suspension des importations - ANVOL",
    url: 'https://news.google.com/rss/articles/CBMihwJBVV95cUxQcWJCd2ZaNEk1Y0N0cVBsMG42cldlUXNFeG5TaWF0MWJIS1BoUEIxNVN2ZXA2RmlISTN6d1J5VVdsWW5iNnFnTnEzYzNLSV9TTVJtYUR2bEJJdTUxcG1oekIzTUw1Q0lxSTZUVVl5R1RPd1pGcUlnWUpKRkpGbVhIbENoRUFQaUVLM2dkTlNfWGZzck1vd0FRSmR5M21Yc21KX0ZDNGgzenVTa25EdDRoaExEczBIU2J3Z1pPUU9uZ2ZWelM0MTdsajRDUV8wQ0tHOFNnZUtKeEl3YnFna24tWjBRUzc4VTU0Ti00QjczVDBFelNtV0xYUVkxVUU4dHc1S1plQ0JkQQ?oc=5'
  },
  {
    source: 'info.gouv.fr',
    title: 'Génocide arménien : le Premier ministre rend hommage aux victimes - info.gouv.fr',
    url: 'https://news.google.com/rss/articles/CBMinwFBVV95cUxOZXZhU3RSZFF2c0Y2ZjBScHZRTmF2dnJZWWw3Z1VpNElUV21ySFBmalZvMGZXdzdXQmRIeXp2MGNUVGJMZDFaT2FiX0Z5X2g2R0xDY0hrZ0RUYjg0d3pjS3JVazVVbEVqcjJIZjdpLS1XdGNoZ3ZrYkpnQm1fNTN2cTQzS2ozSEZyNE43dGNIQklGZjVBX3NxTWhvNnF5OG8?oc=5'
  },
  {
    source: "L'essentiel",
    title: "GO electric day 2026 : tester des véhicules et découvrir les solutions pour recharger - L'essentiel",
    url: 'https://news.google.com/rss/articles/CBMitwFBVV95cUxNRXdBcnQzUUFRdWlYUHducjkzT01CMjBYMkRJdUJBZTE1Q0RVcXRhTkhSeXhuZkxmQ0ZaeFdvYnZmcFVOLWF6TFdKWUtYZlZQOFJlUnM0cEdIc3RIeVcySGltUmQ2QmdWSE9qc2FYZXlremFqNHpyNWxzX2NRMk9GVFRMM1VQV3I2eHB3dEp2TDcyWEZPUmxWUEZ6b2xZZ1BVRVkxOXBsUG1ZY3MxN3lld0NtMkEtem8?oc=5'
  }
];

function resolvePhoto(article) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const chunks = [];
    const timer = setTimeout(() => reject(new Error(`timeout: ${article.title}`)), 18000);
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
      getHeader(name) { return headers.get(String(name).toLowerCase()); },
      write(chunk) { if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
      end(chunk) {
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        clearTimeout(timer);
        resolve({ statusCode: this.statusCode, headers, buffer: Buffer.concat(chunks) });
      }
    };
    Promise.resolve(handler({ method: 'GET', query: article }, res)).catch(error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const results = [];
for (const article of cases) {
  const started = performance.now();
  const result = await resolvePhoto(article);
  const type = result.headers.get('content-type') || '';
  const status = result.headers.get('x-thumbnail-status') || '';
  const entry = { title: article.title.slice(0, 55), statusCode: result.statusCode, status, type, bytes: result.buffer.byteLength, ms: Math.round(performance.now() - started) };
  results.push(entry);
}

console.log(JSON.stringify(results, null, 2));
for (const result of results) {
  assert.equal(result.statusCode, 200);
  assert.match(result.type, /^image\/(?:jpeg|png|webp|avif)/i, result.title);
  assert.doesNotMatch(result.status, /fallback|neutral/i, result.title);
  assert.ok(result.bytes > 3500, result.title);
}
