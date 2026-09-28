// Language-model backends for the chat, called straight from the browser with the player's own API key.
// Both stream their answer as server-sent events; `streamReply` yields text chunks as they arrive.

export const PROVIDERS = {
  local: { vn: 'Stockfish (offline)', short: 'Offline' },
  gemini: { vn: 'Google Gemini', short: 'Gemini', model: 'gemini-flash-latest', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'Có gói miễn phí' },
  claude: { vn: 'Anthropic Claude', short: 'Claude', model: 'claude-haiku-4-5-20251001', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'Trả phí theo lượt dùng' },
};

export class ChatError extends Error {
  constructor(message, { status = 0, network = false } = {}) { super(message); this.status = status; this.network = network; }
}

async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { yield JSON.parse(data); } catch { /* keep-alive or partial line */ }
    }
  }
}

async function failure(res, provider, model) {
  let msg = '';
  try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.status)) || ''; } catch {}
  const s = res.status;
  if (s === 400 && /api key|API_KEY/i.test(msg)) return new ChatError('API key không hợp lệ. Kiểm tra lại key trong phần cài đặt.', { status: s });
  if (s === 401 || s === 403) return new ChatError('API key không hợp lệ hoặc chưa được cấp quyền.', { status: s });
  if (s === 404) return new ChatError(`Không tìm thấy model "${model}". Sửa tên model trong phần cài đặt.`, { status: s });
  if (s === 429) return new ChatError('Hết lượt dùng hoặc hỏi quá nhanh. Đợi một chút rồi hỏi lại.', { status: s });
  if (s === 529 || s === 503) return new ChatError(`${PROVIDERS[provider].short} đang quá tải, thử lại sau.`, { status: s });
  return new ChatError(`Lỗi ${s}${msg ? ': ' + msg : ''}`, { status: s });
}

/* messages: [{ role: 'user' | 'assistant', text }], alternating and ending with the user's question. */
export async function* streamReply({ provider, key, model, system, messages, signal }) {
  let res;
  try {
    if (provider === 'gemini') {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        }),
      });
    } else if (provider === 'claude') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: {
          'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 1024, system, stream: true, messages: messages.map((m) => ({ role: m.role, content: m.text })) }),
      });
    } else throw new ChatError('Chưa chọn AI.');
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof ChatError) throw e;
    throw new ChatError('Không kết nối được tới máy chủ AI (mất mạng?).', { network: true });
  }
  if (!res.ok) throw await failure(res, provider, model);
  for await (const ev of sse(res)) {
    if (provider === 'gemini') {
      if (ev.error) throw new ChatError(ev.error.message || 'Lỗi từ Gemini');
      const parts = (ev.candidates && ev.candidates[0] && ev.candidates[0].content && ev.candidates[0].content.parts) || [];
      const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (text) yield text;
    } else {
      if (ev.type === 'error') throw new ChatError((ev.error && ev.error.message) || 'Lỗi từ Claude');
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') yield ev.delta.text;
    }
  }
}
