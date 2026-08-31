const groqHandler = require('./article-summary-groq.js');

// Direct AI route used only when the user opens an article.
// It deliberately uses a different pathname so client-side source-first
// interception cannot replace the generated summary with an RSS/Bing excerpt.
module.exports = async function handler(req, res) {
  return groqHandler(req, res);
};
