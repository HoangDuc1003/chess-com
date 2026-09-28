// The "Hỏi AI" pane: chat about the position on the board. Offline answers come from Stockfish;
// with a Gemini or Claude key the question goes to that model together with a description of the position.
import { Chess } from '../../lib/chess.js';
import { S } from '../core/state.js';
import { $, esc } from '../core/util.js';
import { analyzeSoon } from '../analysis/scheduler.js';
import { fmtCp } from '../analysis/review.js';
import { describe, engineLines, SYSTEM_PROMPT, viewInfo } from '../ai/context.js';
import { localAnswer } from '../ai/local.js';
import { PROVIDERS, streamReply } from '../ai/providers.js';
import { arrows, board } from './main-board.js';

const AI_STORE = 'dau-stockfish-ai';
const ai = { provider: 'local', keys: {}, models: {}, log: [] };
let busy = null; // AbortController while an answer is streaming
let built = false;

const QUICK = ['Nước tốt nhất là gì?', 'Ai đang hơn?', 'Vì sao nước vừa rồi chưa tốt?', 'Có quân nào đang bị đe dọa?', 'Kế hoạch tiếp theo?'];
const WELCOME = 'Chào bạn! Mình là trợ lý cờ và **nhìn được thế cờ đang hiện trên bàn**, kể cả khi bạn xem lại nước cũ. Hỏi mình bất cứ điều gì về thế cờ, hoặc bấm một câu gợi ý bên dưới.';

/* ---------- settings and history (this browser only) ---------- */
function loadAi() {
  try {
    const d = JSON.parse(localStorage.getItem(AI_STORE) || 'null');
    if (!d) return;
    if (PROVIDERS[d.provider]) ai.provider = d.provider;
    if (d.keys && typeof d.keys === 'object') ai.keys = d.keys;
    if (d.models && typeof d.models === 'object') ai.models = d.models;
    if (Array.isArray(d.log)) ai.log = d.log.filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant')).slice(-40);
  } catch {}
}
function saveAi() {
  const log = ai.log.filter((m) => !m.pending).slice(-40).map(({ role, text, at, src, fen, note }) => ({ role, text, at, src, fen, note }));
  try { localStorage.setItem(AI_STORE, JSON.stringify({ provider: ai.provider, keys: ai.keys, models: ai.models, log })); } catch {}
}
const modelOf = (p) => ai.models[p] || PROVIDERS[p].model;
const usingModel = () => ai.provider !== 'local' && !!ai.keys[ai.provider];

/* ---------- light markdown; legal moves become buttons that show an arrow ---------- */
const SAN_RE = /(^|[\s(“"'.,;:])((?:\d+(?:\.\.\.|…|\.))?)((?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)[+#]?)(?=$|[\s),.;:!?”"'])/g;
function linkMoves(html, fen) {
  let legal;
  try { legal = new Map(new Chess(fen).moves({ verbose: true }).map((m) => [m.san.replace(/[+#]/g, ''), m.from + m.to + (m.promotion || '')])); } catch { return html; }
  const [, stm, , , , full] = fen.split(' ');
  // "6.h3" further down a line is not a move from this position, even if h3 happens to be legal.
  const numberOk = (num) => !num || (parseInt(num, 10) === +full && /(\.\.|…)$/.test(num) === (stm === 'b'));
  let bold = false;
  return html.split(/(<[^>]+>)/).map((seg) => {
    if (seg.startsWith('<')) { if (seg === '<b>') bold = true; else if (seg === '</b>') bold = false; return seg; }
    return seg.replace(SAN_RE, (all, pre, num, san) => {
      const u = legal.get(san.replace(/[+#]/g, ''));
      // A bare pawn push like "e4" is often just a square name: only link it when bold or numbered.
      if (!u || !numberOk(num) || (/^[a-h][1-8]/.test(san) && !bold && !num)) return all;
      return `${pre}${num}<button type="button" class="mvl" data-uci="${u}" title="Xem trên bàn cờ">${san}</button>`;
    });
  }).join('');
}
function mdHtml(text, fen) {
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', list = null;
  for (const raw of esc(text).split('\n')) {
    const ln = raw.trim().replace(/^#{1,6}\s+(.*)$/, '**$1**');
    const m = ln.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const kind = m ? (/^\d/.test(ln) ? 'ol' : 'ul') : null;
    if (list && list !== kind) { html += `</${list}>`; list = null; }
    if (kind) { if (!list) { html += `<${kind}>`; list = kind; } html += `<li>${inline(m[1])}</li>`; }
    else if (ln) html += `<p>${inline(ln)}</p>`;
  }
  if (list) html += `</${list}>`;
  return fen ? linkMoves(html, fen) : html;
}

/* ---------- rendering ---------- */
function msgHtml(m, showAt = true) {
  if (m.role === 'user') return `<div class="msg me"><div class="bub">${esc(m.text)}</div>${m.at && showAt ? `<small>${esc(m.at)}</small>` : ''}</div>`;
  const body = m.pending && !m.text ? '<span class="dots"><b></b><b></b><b></b></span>' : mdHtml(m.text, m.fen);
  return `<div class="msg bot"><div class="av"><i class="wq"></i></div><div class="bub">${m.note ? `<p class="err">${esc(m.note)}</p>` : ''}${body}${m.src ? `<small>${esc(m.src)}</small>` : ''}</div></div>`;
}
function renderLog() {
  const log = $('#aiLog');
  if (!log) return;
  // Under a question, say which position it was about, but only when that changed since the last question.
  let prevAt = null;
  log.innerHTML = msgHtml({ role: 'assistant', text: WELCOME }) + ai.log.map((m) => {
    if (m.role !== 'user') return msgHtml(m);
    const show = m.at !== prevAt;
    prevAt = m.at;
    return msgHtml(m, show);
  }).join('');
  log.scrollTop = log.scrollHeight;
}
function renderLast() {
  const log = $('#aiLog');
  const last = log && log.lastElementChild;
  if (!last) return;
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
  last.outerHTML = msgHtml(ai.log[ai.log.length - 1]);
  if (atEnd) log.scrollTop = log.scrollHeight;
}
function renderSettings() {
  const p = ai.provider;
  $('#aiProv').textContent = PROVIDERS[p].vn + (p !== 'local' && !ai.keys[p] ? ' · chưa có key' : '');
  const who = p === 'gemini' ? 'Google' : p === 'nvidia' ? 'NVIDIA (qua máy chủ của trang, không lưu lại)' : 'Anthropic';
  $('#aiOpts').innerHTML = `<div class="segs">${Object.entries(PROVIDERS).map(([id, x]) => `<button type="button" data-ai="prov" data-v="${id}" aria-pressed="${p === id}">${x.short}</button>`).join('')}</div>`
    + (p === 'local'
      ? '<p class="note">Trả lời tức thì bằng Stockfish, không cần mạng hay tài khoản. Hiểu các câu hỏi thường gặp: nước tốt nhất, ai đang hơn, vì sao nước vừa rồi sai, quân bị đe dọa, khai cuộc, kế hoạch, luật.</p>'
      : `<label class="fld">API key<input type="password" id="aiKey" autocomplete="off" spellcheck="false" placeholder="Dán key vào đây" value="${esc(ai.keys[p] || '')}"></label>
         <label class="fld">Model<input type="text" id="aiModel" spellcheck="false" value="${esc(modelOf(p))}"></label>
         <p class="note">${PROVIDERS[p].keyHint}. Lấy key tại <a href="${PROVIDERS[p].keyUrl}" target="_blank" rel="noopener">${PROVIDERS[p].keyUrl.replace('https://', '')}</a>. Key chỉ lưu trong trình duyệt này và gửi thẳng tới ${who}. Nếu AI lỗi hoặc mất mạng, trợ lý offline sẽ trả lời thay.</p>`)
    + '<button type="button" class="btn ghost" data-ai="clear">Xóa cuộc trò chuyện</button>';
}
function setBusy(on) {
  const b = $('#aiSend');
  if (!b) return;
  b.classList.toggle('stop', on);
  b.setAttribute('aria-label', on ? 'Dừng' : 'Gửi');
  b.innerHTML = `<svg aria-hidden="true"><use href="#i-${on ? 'stop' : 'send'}"/></svg>`;
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }

function build() {
  const pane = $('#paneAi');
  pane.innerHTML = `
    <div class="ai-ctx"><svg aria-hidden="true"><use href="#i-eye"/></svg><span id="aiCtx"></span></div>
    <div class="ai-log" id="aiLog" aria-live="polite"></div>
    <div class="ai-quick">${QUICK.map((q) => `<button type="button" data-ai="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <form class="ai-form" id="aiForm"><textarea id="aiInput" rows="1" maxlength="600" placeholder="Hỏi về thế cờ đang xem…" aria-label="Câu hỏi cho trợ lý"></textarea><button type="submit" class="btn go" id="aiSend" aria-label="Gửi"><svg aria-hidden="true"><use href="#i-send"/></svg></button></form>
    <details class="adv ai-set"><summary>Trợ lý: <b id="aiProv"></b></summary><div class="opt" id="aiOpts"></div></details>`;
  const input = $('#aiInput');
  $('#aiForm').addEventListener('submit', (e) => { e.preventDefault(); if (busy) busy.abort(); else ask(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) ask(input.value); } });
  input.addEventListener('input', () => autosize(input));
  pane.addEventListener('click', (e) => {
    const mv = e.target.closest('.mvl');
    if (mv) { S.preview = mv.dataset.uci; board.setArrows(arrows()); return; }
    const t = e.target.closest('[data-ai]');
    if (!t) return;
    if (t.dataset.ai === 'ask') ask(t.dataset.q);
    else if (t.dataset.ai === 'prov') { ai.provider = t.dataset.v; saveAi(); renderSettings(); }
    else if (t.dataset.ai === 'clear') { if (busy) busy.abort(); ai.log = []; saveAi(); renderLog(); }
  });
  pane.addEventListener('change', (e) => {
    const p = ai.provider;
    if (e.target.id === 'aiKey') { ai.keys[p] = e.target.value.trim(); saveAi(); $('#aiProv').textContent = PROVIDERS[p].vn + (ai.keys[p] ? '' : ' · chưa có key'); }
    if (e.target.id === 'aiModel') { ai.models[p] = e.target.value.trim() || PROVIDERS[p].model; saveAi(); }
  });
  built = true;
  renderLog();
  renderSettings();
}

/* Called on every render while the pane is open: keep the "what I see" line current. */
export function renderChat() {
  if (!built) build();
  const v = viewInfo();
  const l = !v.helpBlocked && engineLines(v.fen)[0];
  $('#aiCtx').innerHTML = `Đang nhìn: <b>${esc(v.label)}</b>${l ? ` · Stockfish ${fmtCp(l.white)}` : ''}`;
}

/* Messages for the model: alternating, starting with the player, ending with the new question. */
function history() {
  const out = [];
  for (const m of ai.log.slice(-11, -1)) {
    if (!m.text || m.note) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += '\n' + m.text;
    else out.push({ role: m.role, text: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function ask(q) {
  q = (q || '').trim();
  if (!q || busy) return;
  const input = $('#aiInput');
  input.value = '';
  autosize(input);
  const v = viewInfo();
  ai.log.push({ role: 'user', text: q, at: v.label });
  const reply = { role: 'assistant', text: '', pending: true, fen: v.fen, src: '' };
  ai.log.push(reply);
  renderLog();
  const ctrl = new AbortController();
  busy = ctrl;
  setBusy(true);
  try {
    if (!v.helpBlocked && !v.puzzle && !v.g.isGameOver()) {
      await analyzeSoon(v.fen, 3, 2500);
      v.lines = engineLines(v.fen);
    }
    if (!usingModel()) {
      reply.text = localAnswer(q, v);
      reply.src = 'Trợ lý Stockfish · offline';
    } else {
      const p = ai.provider;
      reply.src = `${PROVIDERS[p].short} · ${modelOf(p)}`;
      const system = `${SYSTEM_PROMPT}\n\n=== DỮ LIỆU THẾ CỜ ===\n${describe(v)}`;
      for await (const chunk of streamReply({ provider: p, key: ai.keys[p], model: modelOf(p), system, messages: history(), signal: ctrl.signal, onModel: (m) => { reply.src = `${PROVIDERS[p].short} · ${m}`; } })) {
        reply.text += chunk;
        reply.pending = false;
        renderLast();
      }
      if (!reply.text.trim()) reply.text = '(Không nhận được câu trả lời.)';
    }
  } catch (e) {
    if (e.name === 'AbortError') reply.text += reply.text ? '\n_(đã dừng)_' : '_(đã dừng)_';
    else {
      reply.note = e.message || 'Có lỗi xảy ra.';
      reply.text = localAnswer(q, v);
      reply.src = 'Trợ lý Stockfish · offline (dự phòng)';
    }
  } finally {
    reply.pending = false;
    busy = null;
    setBusy(false);
    renderLast();
    saveAi();
  }
}

loadAi();
