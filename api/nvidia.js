// Vercel serverless function: forwards chat requests to NVIDIA's API (build.nvidia.com), which a web page
// cannot call directly. The player's own key comes in the x-nvidia-key header; it is used for this request
// only and never stored. The answer is streamed back as server-sent events.
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: { message: 'Chỉ nhận POST' } }); }
  const key = String(req.headers['x-nvidia-key'] || '').trim();
  if (!key) return res.status(401).json({ error: { message: 'Thiếu API key NVIDIA' } });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body.model !== 'string' || !/^[\w.\-/]{3,120}$/.test(body.model) || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: { message: 'Yêu cầu không hợp lệ' } });
  }
  const payload = {
    model: body.model,
    messages: body.messages.slice(-24).map((m) => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: String(m.content || '').slice(0, 20000) })),
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
    max_tokens: Math.min(Number(body.max_tokens) || 1024, 4096),
    stream: true,
  };
  let up;
  try {
    up = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
  } catch {
    return res.status(502).json({ error: { message: 'Không kết nối được tới NVIDIA' } });
  }
  if (!up.ok) {
    const text = await up.text().catch(() => '');
    let msg = text.slice(0, 500);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.detail || j.title || msg; } catch {}
    return res.status(up.status).json({ error: { message: typeof msg === 'string' ? msg : JSON.stringify(msg) } });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  try {
    for await (const chunk of up.body) res.write(chunk);
  } catch { /* client went away */ }
  res.end();
};
