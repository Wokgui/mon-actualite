const feedlyImageResolver = require('./article-thumbnail.js');

// Backward-compatible endpoint kept for older installed PWA caches. The new
// resolver already performs feed, publisher metadata/content, Google News and
// Bing News checks, so maintaining a separate Parisien-only pipeline would
// create two behaviours again.
module.exports = async function handler(req, res) {
  req.query = { ...(req.query || {}), exact: '0' };
  return feedlyImageResolver(req, res);
};
