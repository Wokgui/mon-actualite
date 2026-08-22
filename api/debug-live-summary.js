const smartHandler = require('./article-summary-smart.js');

module.exports = async function handler(req, res) {
  const url = String(req.query?.url || '').trim();
  const title = String(req.query?.title || 'EN DIRECT').trim();
  if (!/^https?:\/\//i.test(url)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'url requise' }));
  }
  const fakeReq = Object.create(req);
  fakeReq.method = 'POST';
  fakeReq.body = { mode: 'article', article: { url, title, summary: '' } };
  return smartHandler(fakeReq, res);
};
