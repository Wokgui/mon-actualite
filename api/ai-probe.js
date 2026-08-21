module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const { generateText } = await import('ai');
    const { text } = await generateText({ model: 'openai/gpt-5.6-sol', prompt: 'Réponds uniquement par OK.', maxOutputTokens: 12 });
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, text: String(text || '').trim() }));
  } catch (error) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 300) }));
  }
};
