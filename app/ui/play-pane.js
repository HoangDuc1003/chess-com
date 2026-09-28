// The game pane: coach, hint, accuracy, opening card and move list.
import { Chess } from '../../lib/chess.js';
import { BAD } from '../core/config.js';
import { accuracy, bot, botColor, cache, fenAtPly, flags, isOver, openingInfo, S, userTurn, viewPly } from '../core/state.js';
import { $, esc, kingSq, posKey, sanHtml, toast } from '../core/util.js';
import { lessonById } from '../content/lessons.js';
import { guideFor, vnName } from '../content/opening-guides.js';
import { mainLine, opening, openingsReady } from '../content/openings.js';
import { CLASSES, fmtCp, pvSan, TAG_LESSON } from '../analysis/review.js';
import { scoreCp } from '../game/bots.js';
import { badgeSvg, BoardView } from './board.js';

function coachHtml() {
  const f = flags();
  const cav = `<div class="cav"><i class="wq"></i></div>`;
  const wrap = (inner) => `<div class="coach">${cav}<div class="bubble">${inner}</div></div>`;
  if (!S.started) {
    return wrap(`<div class="bt">Chào bạn!</div><p>Chọn đối thủ và chế độ ở tab <b>Đối thủ</b>, rồi bấm <b>Chơi</b>. ${f.analysis ? 'Mình sẽ nhận xét từng nước đi của bạn.' : ''}</p><div class="ba"><button type="button" class="go" data-act="tab" data-tab="bots">Chọn đối thủ</button></div>`);
  }
  if (isOver()) return wrap(reviewHtml());
  if (!f.analysis) return wrap(`<div class="bt">Chế độ Thử thách</div><p>Không có trợ giúp trong ván. Sau khi hết ván, bạn có thể chấm điểm cả ván đấu.</p>`);
  if (S.botCoachPly && S.botCoachPly === S.hist.length && userTurn()) {
    const rv = S.review[S.botCoachPly];
    const rec = S.hist[S.botCoachPly - 1];
    return wrap(`<div class="bt">${badgeSvg(rv.cls, 22)}Máy vừa đi ${CLASSES[rv.cls].vn.toLowerCase()}: ${esc(rec.san)}</div><p>Đây là cơ hội cho bạn. Hãy tìm nước tốt nhất!</p><div class="ba">${f.hints ? '<button type="button" class="go" data-act="hint">Gợi ý</button>' : ''}</div>`);
  }
  const p = S.coachPly;
  if (p && S.review[p] && S.hist[p - 1]) {
    const rv = S.review[p];
    const rec = S.hist[p - 1];
    const bad = BAD.has(rv.cls);
    let extra = '';
    if (rv.cls === 'book') {
      const a = openingInfo(p);
      if (a && a.current) extra = ` (${esc(vnName(opening(a.current.id).name))})`;
    }
    const lessonId = rv.tag && TAG_LESSON[rv.tag];
    const L = lessonId && lessonById(lessonId);
    const btns = [];
    if (bad && f.takebacks) btns.push(`<button type="button" class="go" data-act="retry" data-p="${p}">Thử lại</button>`);
    if (rv.bestUci && rv.bestUci !== rec.uci && !['book', 'forced'].includes(rv.cls)) btns.push(`<button type="button" data-act="best" data-p="${p}">Xem nước tốt nhất</button>`);
    if (L) btns.push(`<button type="button" data-act="lesson" data-id="${L.id}" title="${esc(L.title)}">Bài học: ${esc(L.title.split(':')[0])}</button>`);
    if (S.paused) btns.push(`<button type="button" data-act="continue">Tiếp tục</button>`);
    return wrap(`<div class="bt">${badgeSvg(rv.cls, 22)}${esc(rv.title)}${extra}</div><p>${esc(rv.text)}</p>${bad && rv.line ? `<p class="line">Diễn biến: ${esc(rv.line)}</p>` : ''}${btns.length ? `<div class="ba">${btns.join('')}</div>` : ''}`);
  }
  if (userTurn() && S.hist.length === 0) return wrap(`<div class="bt">Đến lượt bạn</div><p>Đi nước đầu tiên. Gợi ý: chiếm trung tâm với e4 hoặc d4.</p>`);
  if (!userTurn()) return wrap(`<div class="bt">${esc(bot().name)} đang nghĩ…</div><p>Trong lúc chờ, bạn có thể vẽ mũi tên bằng chuột phải để lên kế hoạch.</p>`);
  return wrap(`<div class="bt">Đến lượt bạn</div><p>Kiểm tra trước khi đi: chiếu, ăn quân, đe dọa, của cả hai bên.</p>`);
}
/* After the game: what happened on the move being viewed, what was better, and the best move from here. */
const sideVn = (c) => (c === 'w' ? 'Trắng' : 'Đen') + (c === S.userColor ? ' (bạn)' : '');
const moveLabel = (p) => `${Math.ceil(p / 2)}${p % 2 ? '.' : '…'}`;
function reviewHtml() {
  const n = S.hist.length, vp = viewPly();
  const reviewed = Object.keys(S.review).length >= n;
  const out = [];
  if (vp === n) {
    const r = S.result;
    const t = r.winner == null ? 'Ván cờ hòa' : r.winner === S.userColor ? 'Bạn thắng!' : `${esc(bot().name)} thắng`;
    out.push(`<div class="bt">${t}</div><p>${esc(r.reason)}. ${reviewed ? 'Dùng các nút mũi tên để xem lại từng nước; mũi tên xanh là nước tốt nhất ở mỗi thế.' : 'Bấm <b>Chấm điểm</b> để xem đánh giá từng nước.'}</p>`);
  } else if (vp === 0) {
    out.push('<div class="bt">Thế cờ ban đầu</div>');
  } else {
    const rec = S.hist[vp - 1], rv = S.review[vp];
    if (rv) {
      out.push(`<div class="bt">${badgeSvg(rv.cls, 22)}${moveLabel(vp)} ${esc(rv.title)}</div><p>${esc(rv.text)}</p>`);
      if (rv.bestUci && rv.bestUci !== rec.uci && !['book', 'forced'].includes(rv.cls) && rv.bestSan) {
        out.push(`<p class="line">Tốt nhất lúc đó: <b>${esc(rv.bestSan)}</b>${BAD.has(rv.cls) && rv.line ? ` · ${esc(rv.line)}` : ''}</p>`);
      }
    } else out.push(`<div class="bt">${moveLabel(vp)} ${esc(rec.san)}</div><p>Nước này chưa được chấm điểm.</p>`);
  }
  const fen = fenAtPly(vp);
  const e = S.bestArrow && cache.get(posKey(fen));
  const l = e && e.lines[0];
  if (l && l.pv && l.pv[0] && (e.viewed || e.reviewed || l.depth >= 10)) {
    const stm = fen.split(' ')[1];
    const cp = scoreCp(l.score);
    const line = pvSan(fen, l.pv, 6).split(' ');
    out.push(`<p class="line">Nước tốt nhất tiếp theo cho ${sideVn(stm)}: <b>${esc(line[0])}</b> (${fmtCp(stm === 'w' ? cp : -cp)}) · ${esc(line.slice(1).join(' '))}</p>`);
  } else if (S.bestArrow && new Chess(fen).moves().length) {
    out.push('<p class="line">Đang tìm nước tốt nhất…</p>');
  }
  const btns = [];
  if (!reviewed) btns.push('<button type="button" class="go" data-act="postreview">Chấm điểm ván đấu</button>');
  if (vp > 0) btns.push('<button type="button" data-cmd="prev" aria-label="Nước trước">◀</button>');
  if (vp < n) btns.push('<button type="button" data-cmd="next" aria-label="Nước sau">▶</button>');
  if (vp > 0 && S.review[vp] && S.review[vp].bestUci !== S.hist[vp - 1].uci && !['book', 'forced'].includes(S.review[vp].cls)) btns.push(`<button type="button" data-act="best" data-p="${vp}">Xem nước tốt nhất</button>`);
  btns.push('<button type="button" data-act="tab" data-tab="ai">Hỏi AI</button>');
  if (vp === n) btns.push('<button type="button" data-act="summary">Xem tổng kết</button><button type="button" data-act="new">Ván mới</button>');
  return out.join('') + `<div class="ba">${btns.join('')}</div>`;
}
function hintBoxHtml() {
  if (!S.hintOn || !userTurn() || S.view != null) return '';
  const fen = S.game.fen();
  const e = cache.get(posKey(fen));
  if (!e || !e.lines[0] || e.depth < 8) return `<div class="hintbox"><div class="lab">Gợi ý <small>đang tìm…</small></div></div>`;
  const stm = fen.split(' ')[1];
  const rows = e.lines.filter(Boolean).slice(0, 3).map((l) => {
    const cp = scoreCp(l.score);
    const wcp = stm === 'w' ? cp : -cp;
    const line = pvSan(fen, l.pv, 6).split(' ');
    return `<div class="hl"><span class="ev ${wcp >= 0 ? 'w' : 'b'}">${fmtCp(wcp)}</span><span class="pv"><b>${esc(line[0] || '')}</b> ${esc(line.slice(1).join(' '))}</span></div>`;
  }).join('');
  return `<div class="hintbox"><div class="lab">Gợi ý của Stockfish <small>độ sâu ${e.depth}</small></div><div class="hlines">${rows}</div><p class="note">Mũi tên xanh là nước tốt nhất. Điểm số tính theo phía Trắng.</p></div>`;
}
export function renderHintBox() {
  const el = $('#hintSlot');
  if (el) el.innerHTML = hintBoxHtml();
}
function movesHtml() {
  if (!S.hist.length) return '<div class="moves"><div class="empty">Chưa có nước đi nào.</div></div>';
  const vp = viewPly();
  const showCls = flags().analysis || isOver();
  let h = '';
  for (let i = 0; i < S.hist.length; i += 2) {
    const alt = (i / 2) % 2 === 1 ? ' row-alt' : '';
    h += `<div class="n${alt}">${i / 2 + 1}.</div>`;
    for (const j of [i, i + 1]) {
      const r = S.hist[j];
      if (!r) { h += `<div class="${alt}"></div>`; continue; }
      const rv = S.review[j + 1];
      h += `<div class="m${alt}${vp === j + 1 ? ' cur' : ''}" data-act="goto" data-p="${j + 1}">${rv && showCls ? badgeSvg(rv.cls, 16) : ''}${sanHtml(r.san, r.color)}</div>`;
    }
  }
  return `<div class="moves">${h}</div>`;
}
/* Opening card: in learning mode, show which opening is on the board, with a diagram. */
const openDiag = document.createElement('div');
openDiag.className = 'od';
const openDiagBoard = new BoardView(openDiag, { coords: false });
const GENERIC_OPENING = /^(King's Pawn Game|Queen's Pawn Game|King's Knight Opening|Indian Defense)$/;
function openCardData() {
  if (S.mode !== 'learn' || !openingsReady() || !S.started) return null;
  const vp = viewPly();
  if (!vp) return null;
  const a = openingInfo(vp);
  if (!a || !a.current) return null;
  if (!a.inBook && vp - a.lastBookPly > 8) return null;
  const o = opening(a.current.id);
  const fam = vnName(o.name);
  if (S.openCardClosed === fam) return null;
  return { ev: a.current, o, fam, inBook: a.inBook };
}
function openCardHtml() {
  const d = openCardData();
  if (!d) return '';
  const rec = S.hist[d.ev.ply - 1];
  const who = rec.color === S.userColor ? 'Bạn đang triển khai' : 'Máy vừa chọn';
  const idea = guideFor(d.o.name).idea.split(/(?<=\.)\s/)[0];
  const fresh = d.ev.ply === S.hist.length && S.view == null;
  return `<div class="ocard2${fresh ? ' fresh' : ''}"><div class="odslot"></div><div class="oi"><div class="lab">${who} <small>${esc(d.o.eco)}</small></div><b>${esc(d.fam)}</b><span class="en" title="${esc(d.o.name)}">${esc(d.o.name)}</span><p>${esc(idea)}</p><button type="button" class="lk" data-act="tab" data-tab="open">Xem ý tưởng và mô phỏng →</button></div><button type="button" class="x" data-act="hideopen" data-fam="${esc(d.fam)}" aria-label="Ẩn thẻ khai cuộc">✕</button></div>`;
}
function mountOpenCard() {
  const slot = document.querySelector('#panePlay .odslot');
  const d = slot && openCardData();
  if (!d) return;
  slot.appendChild(openDiag);
  const fen = fenAtPly(d.ev.ply);
  const rec = S.hist[d.ev.ply - 1];
  const g = new Chess(fen);
  openDiagBoard.setOrientation(S.orientation);
  openDiagBoard.set({ fen, lastMove: { from: rec.from, to: rec.to }, check: g.inCheck() ? kingSq(g, g.turn()) : null });
  const next = mainLine(fen, 1)[0];
  openDiagBoard.setArrows(next ? [{ from: next.uci.slice(0, 2), to: next.uci.slice(2, 4), color: 'preview', width: 0.18 }] : []);
}
export function noteOpening() {
  if (S.mode !== 'learn' || !openingsReady()) return;
  const a = openingInfo(S.hist.length);
  if (!a || !a.current || a.current.ply !== S.hist.length) return;
  const name = opening(a.current.id).name;
  const fam = vnName(name);
  if (fam === S.lastOpenFam) return;
  S.lastOpenFam = fam;
  S.openCardClosed = null;
  if (!GENERIC_OPENING.test(name.split(':')[0])) toast('Khai cuộc: ' + fam, 2600);
}

export function renderPlay() {
  const ua = accuracy(S.userColor), ba = accuracy(botColor());
  const accRow = ua != null || ba != null
    ? `<div class="accrow"><span>Độ chính xác của bạn <b>${ua != null ? ua.toFixed(1).replace('.', ',') : '—'}</b></span><span>Máy <b>${ba != null ? ba.toFixed(1).replace('.', ',') : '—'}</b></span></div>` : '';
  const pm0 = $('#playMoves');
  const wasAtEnd = !pm0 || pm0.scrollTop + pm0.clientHeight >= pm0.scrollHeight - 8;
  const prevTop = pm0 ? pm0.scrollTop : 0;
  $('#panePlay').innerHTML = `<div class="play-top">${openCardHtml()}${coachHtml()}<div id="hintSlot">${hintBoxHtml()}</div>${accRow}</div><div class="play-moves" id="playMoves">${movesHtml()}</div>`;
  mountOpenCard();
  const pm = $('#playMoves');
  const cur = pm.querySelector('.m.cur');
  if (S.view == null) { if (wasAtEnd) pm.scrollTop = pm.scrollHeight; else pm.scrollTop = prevTop; }
  else if (cur) {
    pm.scrollTop = prevTop;
    const top = cur.offsetTop - pm.offsetTop;
    if (top < pm.scrollTop || top + cur.offsetHeight > pm.scrollTop + pm.clientHeight) pm.scrollTop = top - pm.clientHeight / 2;
  }
}
