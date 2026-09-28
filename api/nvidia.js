// Vercel serverless function: forwards chat requests to NVIDIA's API (build.nvidia.com), which a web page
// cannot call directly. The player's own key comes in the x-nvidia-key header; it is used for this request
// only and never stored. The answer is streamed back as server-sent events.
// Response headers go out at once (with keep-alive comments) so a slow model cannot stall the connection;
// errors after that point are sent as an SSE event: data: {"error":{"message","status"}}.
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, message: 'Hàm NVIDIA của Đấu Stockfish đang chạy.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: { message: 'Chỉ nhận POST' } }); }
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

  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  res.write(': connected\n\n');
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 5000);
  const fail = (status, message) => res.write(`data: ${JSON.stringify({ error: { status, message } })}\n\n`);
  try {
    let up;
    try {
      up = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      fail(502, 'Máy chủ không kết nối được tới NVIDIA: ' + (e && e.message ? e.message : e));
      return;
    }
    if (!up.ok) {
      const text = await up.text().catch(() => '');
      let msg = text.slice(0, 500);
      try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.detail || j.title || msg; } catch {}
      fail(up.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
      return;
    }
    const reader = up.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (e) {
    try { fail(500, 'Lỗi khi nhận câu trả lời từ NVIDIA: ' + (e && e.message ? e.message : e)); } catch {}
  } finally {
    clearInterval(beat);
    res.end();
  }
}
module.exports = handler;
module.exports.config = { maxDuration: 60 };
