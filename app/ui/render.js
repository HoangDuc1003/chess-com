// Top-level rendering: player bars, eval bar, opening strip, footer buttons, tabs, game summary.
import { Chess } from '../../lib/chess.js';
import { accuracy, bot, botColor, cache, canUserMove, fenAtPly, flags, isOver, openingInfo, pzCanMove, S, userTurn, viewPly } from '../core/state.js';
import { save } from '../core/storage.js';
import { $, esc, posKey } from '../core/util.js';
import { vnName } from '../content/opening-guides.js';
import { opening, openingsReady } from '../content/openings.js';
import { CLASSES, fmtCp, VAL, winPct } from '../analysis/review.js';
import { eng, finalizeReviews } from '../analysis/scheduler.js';
import { eloText, scoreCp } from '../game/bots.js';
import { clockHtml, syncClock } from '../game/clock.js';
import { recordGame } from '../game/game.js';
import { badgeSvg } from './board.js';
import { arrows, board } from './main-board.js';
import { renderNav } from './menu.js';
import { renderBots, renderDict, renderOpen, renderPuzz } from './panes.js';
import { renderHintBox, renderPlay } from './play-pane.js';

let raf = 0;
export function live() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const changed = finalizeReviews();
    renderEval();
    renderBars();
    board.setArrows(arrows());
    if (changed) renderAll();
    else if (S.tab === 'play') renderHintBox();
  });
}

export function renderPill() {
  const pill = $('#enginePill');
  pill.dataset.s = eng.status;
  $('#engineText').textContent = eng.status === 'ready' ? `${eng.flavor} sẵn sàng`
    : eng.status === 'error' ? 'Không tải được engine. Hãy tải lại trang.'
    : eng.status === 'fallback' ? 'Đang tải bản dự phòng…' : 'Đang tải Stockfish…';
}

function evalWhiteFor(fen) {
  const g = new Chess(fen);
  if (g.isCheckmate()) return g.turn() === 'w' ? -10000 : 10000;
  if (g.isGameOver()) return 0;
  const e = cache.get(posKey(fen));
  if (!e || !e.lines[0]) return null;
  const cp = scoreCp(e.lines[0].score);
  return fen.split(' ')[1] === 'w' ? cp : -cp;
}
export function renderEval() {
  const show = !S.pz && (flags().evalBar || (isOver() && Object.keys(S.review).length > 0));
  const bar = $('#evalBar');
  bar.hidden = !show;
  document.querySelectorAll('.pbar').forEach((p) => p.classList.toggle('noeb', !show));
  if (!show) return;
  const v = evalWhiteFor(fenAtPly(viewPly()));
  if (v != null) S.evalWhite = v;
  const cp = S.evalWhite;
  const pct = Math.abs(cp) >= 9000 ? (cp > 0 ? 100 : 0) : Math.max(4, Math.min(96, winPct(cp)));
  bar.classList.toggle('flip', S.orientation === 'b');
  $('#ebFill').style.height = pct + '%';
  const num = $('#ebNum');
  num.textContent = fmtCp(Math.abs(cp)).replace('+', '');
  const whiteAhead = cp >= 0;
  const atBottom = (whiteAhead && S.orientation === 'w') || (!whiteAhead && S.orientation === 'b');
  num.className = 'eb-num ' + (atBottom ? 'low' : 'high');
  num.style.color = whiteAhead ? '#403d39' : '#f1f0ee';
}

function capsHtml(color) {
  const opp = color === 'w' ? 'b' : 'w';
  const g = new Chess(fenAtPly(viewPly()));
  const cnt = (c) => { const o = { p: 0, n: 0, b: 0, r: 0, q: 0 }; for (const row of g.board()) for (const p of row) if (p && p.color === c && p.type !== 'k') o[p.type]++; return o; };
  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const mine = cnt(color), theirs = cnt(opp);
  let out = '';
  for (const t of ['p', 'b', 'n', 'r', 'q']) {
    const miss = Math.max(0, START[t] - theirs[t]);
    for (let i = 0; i < miss; i++) out += `<span class="cp ${opp}${t}${i === 0 && out ? ' gap' : ''}"></span>`;
  }
  const mat = (o) => Object.entries(o).reduce((s, [t, n]) => s + VAL[t] * n, 0);
  const diff = mat(mine) - mat(theirs);
  if (diff > 0) out += `<em>+${diff}</em>`;
  return out;
}
function barHtml(color) {
  if (color === S.userColor) {
    const turn = S.started && !isOver() && userTurn() && S.view == null;
    return `<div class="ava" style="background:#5d5a55"><i class="${S.userColor}p"></i></div>
      <div class="who"><div class="nm"><b>Bạn</b>${S.hintsUsed ? `<span class="rt">· ${S.hintsUsed} gợi ý</span>` : ''}</div><div class="caps">${capsHtml(color)}</div></div>
      ${turn && !S.clock ? '<span class="chip on">Lượt bạn</span>' : ''}${clockHtml(color)}`;
  }
  const b = bot();
  let chip = '';
  const mn = S.mateNote && S.mateNote.fen === S.game.fen() && S.view == null ? S.mateNote : null;
  if (mn) chip = `<span class="chip mate">Chiếu hết sau ${mn.n} nước</span>`;
  else if (S.thinking || S.botPending) {
    const t = S.thinking || { depth: 0 };
    const nps = t.nps ? ` · ${t.nps >= 1e6 ? (t.nps / 1e6).toFixed(1).replace('.', ',') + 'M' : Math.round(t.nps / 1000) + 'k'} thế/s` : '';
    chip = `<span class="chip think"><span class="dots"><b></b><b></b><b></b></span>${t.depth ? 'độ sâu ' + t.depth + nps : 'đang nghĩ'}</span>`;
  } else if (S.paused) chip = '<span class="chip">Đang chờ bạn</span>';
  return `<div class="ava" style="background:${b.tone}"><i class="${b.icon}"></i></div>
    <div class="who"><div class="nm"><b>${esc(b.name)}</b><span class="rt">(${eloText(b)})</span></div><div class="caps">${capsHtml(color)}</div></div>${chip}${clockHtml(color)}`;
}

function pzBarHtml(top) {
  const pz = S.pz;
  if (top) {
    return `<div class="ava" style="background:#6a5a9e"><i class="${pz.color === 'w' ? 'bq' : 'wq'}"></i></div>
      <div class="who"><div class="nm"><b>Giải đố</b><span class="rt">độ khó ${pz.p.rating}</span></div><div class="caps"><span class="rt" style="color:var(--muted);font-size:12.5px">#${esc(pz.p.id)}</span></div></div>`;
  }
  const chip = pz.status === 'solved' ? `<span class="chip on" style="background:var(--green);color:#fff">Đã giải</span>`
    : pz.status === 'shown' ? '<span class="chip">Đã xem lời giải</span>'
    : pzCanMove() ? '<span class="chip on">Lượt bạn</span>' : '';
  return `<div class="ava" style="background:#5d5a55"><i class="${pz.color}p"></i></div>
    <div class="who"><div class="nm"><b>Bạn</b><span class="rt">điểm giải đố ${S.pzRating}</span></div><div class="caps"><span class="rt" style="color:var(--muted);font-size:12.5px">Chuỗi đúng: ${S.pzStreak}</span></div></div>${chip}`;
}
export function renderBars() {
  if (S.pz) { $('#barTop').innerHTML = pzBarHtml(true); $('#barBottom').innerHTML = pzBarHtml(false); return; }
  const top = S.orientation === 'w' ? 'b' : 'w';
  $('#barTop').innerHTML = barHtml(top);
  $('#barBottom').innerHTML = barHtml(top === 'w' ? 'b' : 'w');
}

function renderStrip() {
  const vp = viewPly();
  const el = $('#ostrip');
  if (S.pz) {
    el.innerHTML = `<span class="eco">Đố</span><span class="on">Giải đố · tìm nước tốt nhất cho ${S.pz.color === 'w' ? 'Trắng' : 'Đen'}</span><span class="off">Ván cờ đang tạm dừng</span>`;
    return;
  }
  if (!openingsReady()) { el.innerHTML = '<span class="off">Đang tải dữ liệu khai cuộc…</span>'; return; }
  if (vp === 0) { el.innerHTML = '<span class="eco">—</span><span class="on">Vị trí ban đầu</span>'; return; }
  const a = openingInfo(vp);
  if (!a || !a.current) { el.innerHTML = '<span class="on">Khai cuộc chưa có tên</span>'; return; }
  const o = opening(a.current.id);
  const out = !a.inBook ? `<span class="off">Ra khỏi lý thuyết · nước ${Math.floor(a.lastBookPly / 2) + 1}</span>` : '';
  el.innerHTML = `<span class="eco">${o.eco}</span><span class="on" title="${esc(o.name)}">${esc(vnName(o.name))}${o.name.includes(':') ? ` <span style="color:var(--muted);font-weight:500">· ${esc(o.name.split(':')[1].trim())}</span>` : ''}</span>${out}`;
}

export function renderSummary() {
  const over = $('#over');
  if (!isOver() || S.overDismissed) { over.hidden = true; return; }
  const r = S.result;
  const title = r.winner == null ? 'Hòa' : r.winner === S.userColor ? 'Bạn thắng!' : `${bot().name} thắng`;
  const ua = accuracy(S.userColor), ba = accuracy(botColor());
  const total = S.hist.length;
  const done = Object.keys(S.review).length;
  const counts = (color) => {
    const c = {};
    S.hist.forEach((h, i) => { const rv = S.review[i + 1]; if (rv && h.color === color) c[rv.cls] = (c[rv.cls] || 0) + 1; });
    return c;
  };
  const cu = counts(S.userColor), cb = counts(botColor());
  const rows = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']
    .map((k) => `<span class="n">${cu[k] || 0}</span><span>${badgeSvg(k, 18)}</span><span>${CLASSES[k].vn}</span><span class="n">${cb[k] || 0}</span>`).join('');
  const reviewing = S.postReview && done < total;
  over.innerHTML = `<div class="sum" role="dialog" aria-labelledby="sumTitle">
    <div class="sum-head"><h2 id="sumTitle">${esc(title)}</h2><p>${esc(r.reason)}${S.hintsUsed ? ` · dùng ${S.hintsUsed} gợi ý` : ''}</p></div>
    <div class="sum-body">
      <div class="acc2"><div><small>Độ chính xác của bạn</small><b>${ua != null ? ua.toFixed(1).replace('.', ',') : '—'}</b></div><div><small>${esc(bot().name)}</small><b>${ba != null ? ba.toFixed(1).replace('.', ',') : '—'}</b></div></div>
      ${done ? `<div class="ctab"><span class="h">Bạn</span><span></span><span></span><span class="h">Máy</span>${rows}</div>` : '<p class="note">Ván này chưa được chấm điểm.</p>'}
      ${reviewing ? `<div><div class="lab">Đang chấm điểm <small>${done}/${total} nước</small></div><div class="progress"><i style="width:${(done / Math.max(1, total)) * 100}%"></i></div></div>` : ''}
      <div class="sum-acts">
        ${done < total && !reviewing ? '<button type="button" class="btn go" data-act="postreview">Chấm điểm ván đấu</button>' : `<button type="button" class="btn" data-act="closesum">Xem lại ván</button>`}
        <button type="button" class="btn ${done < total && !reviewing ? '' : 'go'}" data-act="new">Ván mới</button>
      </div>
      ${done < total && !reviewing ? '<button type="button" class="btn ghost" data-act="closesum">Xem lại bàn cờ</button>' : ''}
    </div></div>`;
  over.hidden = false;
}

function renderFooter() {
  const f = flags();
  const n = S.hist.length, vp = viewPly();
  const set = (cmd, prop, val) => document.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((b) => { b[prop] = val; });
  set('first', 'disabled', vp === 0);
  set('prev', 'disabled', vp === 0);
  set('next', 'disabled', vp >= n);
  set('last', 'disabled', vp >= n);
  set('hint', 'hidden', !f.hints);
  set('hint', 'disabled', !canUserMove() || !S.started);
  document.querySelectorAll('[data-hint-label]').forEach((el) => { el.textContent = S.hintOn ? 'Ẩn gợi ý' : 'Gợi ý'; });
  set('undo', 'hidden', !f.takebacks);
  set('undo', 'disabled', !n);
  set('resign', 'disabled', isOver() || !S.started || !n);
  if (S.pz) {
    for (const c of ['first', 'prev', 'next', 'last', 'undo', 'resign']) set(c, 'disabled', true);
    set('hint', 'hidden', false);
    set('hint', 'disabled', !pzCanMove());
    document.querySelectorAll('[data-hint-label]').forEach((el) => { el.textContent = 'Gợi ý'; });
  }
}
export function renderTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  document.querySelectorAll('.side-body .pane').forEach((p) => { p.hidden = p.dataset.panel !== S.tab; });
}
export function renderAll() {
  syncClock();
  recordGame();
  renderNav();
  renderBars();
  renderEval();
  renderStrip();
  renderTabs();
  if (S.tab === 'play') renderPlay();
  else if (S.tab === 'open') renderOpen();
  else if (S.tab === 'dict') { if (!$('#paneDict').innerHTML || !S.lesson) renderDict(); }
  else if (S.tab === 'bots') renderBots();
  else if (S.tab === 'puzz') renderPuzz();
  renderFooter();
  renderSummary();
  board.setArrows(arrows());
  save();
}
