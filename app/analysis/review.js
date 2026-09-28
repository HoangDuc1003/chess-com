// Move classification and plain-language feedback.
// Losses are measured in win probability (the lichess formula), so a lost pawn matters
// a lot in a balanced position and very little when the game is already decided.
import { Chess } from '../../lib/chess.js';
import { scoreCp } from '../game/bots.js';

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_VN = { p: 'tốt', n: 'Mã', b: 'Tượng', r: 'Xe', q: 'Hậu', k: 'Vua' };

export const CLASSES = {
  brilliant: { vn: 'Thiên tài', sym: '!!', color: '#1fb89a', good: true },
  great: { vn: 'Nước hay', sym: '!', color: '#5f93c2', good: true },
  best: { vn: 'Tốt nhất', sym: '★', color: '#7fb13f', good: true },
  excellent: { vn: 'Xuất sắc', sym: '✓', color: '#8fbd4a', good: true },
  good: { vn: 'Tốt', sym: '✓', color: '#8fa889', good: true },
  book: { vn: 'Lý thuyết', sym: 'book', color: '#a8865f', good: true },
  forced: { vn: 'Bắt buộc', sym: '□', color: '#8fa889', good: true },
  inaccuracy: { vn: 'Không chính xác', sym: '?!', color: '#f2c13a' },
  mistake: { vn: 'Sai lầm', sym: '?', color: '#f79a4e' },
  miss: { vn: 'Bỏ lỡ', sym: '✕', color: '#f06f62' },
  blunder: { vn: 'Sai lầm nghiêm trọng', sym: '??', color: '#e8412f' },
};
export const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export function winPct(cp) { return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

function uciObj(u) {
  const o = { from: u.slice(0, 2), to: u.slice(2, 4) };
  if (u.length > 4) o.promotion = u[4];
  return o;
}
export function sanOf(fen, uci) {
  try { return new Chess(fen).move(uciObj(uci)).san; } catch { return uci; }
}
export function pvSan(fen, pv, max = 6) {
  const g = new Chess(fen);
  const out = [];
  let n = +fen.split(' ')[5] || 1;
  let turn = g.turn();
  for (let i = 0; i < Math.min(pv.length, max); i++) {
    let m;
    try { m = g.move(uciObj(pv[i])); } catch { break; }
    if (turn === 'w') out.push(`${n}.${m.san}`);
    else out.push(i === 0 ? `${n}…${m.san}` : m.san);
    if (turn === 'b') n++;
    turn = turn === 'w' ? 'b' : 'w';
  }
  return out.join(' ');
}
export function fmtCp(cp) {
  if (Math.abs(cp) >= 9000) {
    const m = Math.round((10000 - Math.abs(cp)) / 10);
    return (cp > 0 ? '' : '−') + 'M' + Math.max(1, m);
  }
  const v = Math.round(cp / 10) / 10; // so that −0.04 shows as 0.0, not −0.0
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

/* Largest net material the mover leaves en prise after the move (pieces worth 3+ only). */
function sacrificedMaterial(fenBefore, uci) {
  const g = new Chess(fenBefore);
  const me = g.turn();
  const opp = me === 'w' ? 'b' : 'w';
  let m;
  try { m = g.move(uciObj(uci)); } catch { return 0; }
  if (g.isCheckmate()) return 0;
  const gained = m.captured ? VAL[m.captured] : 0;
  let worst = 0;
  for (const row of g.board()) for (const p of row) {
    if (!p || p.color !== me || p.type === 'k' || VAL[p.type] < 3) continue;
    const att = g.attackers(p.square, opp);
    if (!att.length) continue;
    const def = g.attackers(p.square, me);
    const minAtt = Math.min(...att.map((s) => VAL[g.get(s).type] || 100));
    let loss = 0;
    if (!def.length) loss = VAL[p.type];
    else if (minAtt < VAL[p.type]) loss = VAL[p.type] - minAtt;
    worst = Math.max(worst, loss);
  }
  return worst - gained;
}

/*
  ctx: {
    fenBefore, uci,
    before: { lines: [{score, pv}] }   // side to move = mover
    after:  { lines: [{score, pv}] }   // side to move = opponent (may be empty if the game ended)
    inBook, prev: { cls, to } | null  // opponent's previous move
  }
*/
export function classify(ctx) {
  const g = new Chess(ctx.fenBefore);
  const legal = g.moves().length;
  const played = g.move(uciObj(ctx.uci));
  const ended = g.isGameOver();
  const bl = ctx.before.lines.filter(Boolean);
  const best = bl[0];
  const bestUci = best && best.pv ? best.pv[0] : null;
  const bestCp = best ? scoreCp(best.score) : 0;
  let afterCp;
  if (g.isCheckmate()) afterCp = 10000;
  else if (ended) afterCp = 0;
  else if (ctx.after && ctx.after.lines[0]) afterCp = -scoreCp(ctx.after.lines[0].score);
  else {
    const k = bl.find((l) => l.pv && l.pv[0] === ctx.uci);
    afterCp = k ? scoreCp(k.score) : bestCp;
  }
  const isBest = bestUci === ctx.uci;
  const winBefore = winPct(bestCp);
  const winAfter = winPct(afterCp);
  let loss = isBest ? 0 : Math.max(0, winBefore - winAfter);
  let cls;
  const secondCp = bl[1] ? scoreCp(bl[1].score) : null;
  const trivialRecapture = ctx.prev && ctx.prev.captured && played.captured && played.to === ctx.prev.to;
  if (legal === 1) cls = 'forced';
  else if (loss <= 2 && winAfter >= 45 && winBefore <= 96 && sacrificedMaterial(ctx.fenBefore, ctx.uci) >= 2) cls = 'brilliant';
  else if (isBest && secondCp != null && winBefore - winPct(secondCp) >= 12 && winBefore <= 96 && winBefore >= 8 && !trivialRecapture) cls = 'great';
  else if (isBest || loss <= 0.5) cls = 'best';
  else if (loss <= 2) cls = 'excellent';
  else if (loss <= 5) cls = 'good';
  else if (ctx.prev && (ctx.prev.cls === 'mistake' || ctx.prev.cls === 'blunder') && loss <= 20) cls = 'miss';
  else if (loss <= 10) cls = 'inaccuracy';
  else if (loss <= 20) cls = 'mistake';
  else cls = 'blunder';
  // Named opening lines include famous traps, so "book" only applies when the engine agrees the move is sound.
  if (ctx.inBook && !['inaccuracy', 'mistake', 'miss', 'blunder'].includes(cls)) cls = 'book';
  if (cls === 'book' || cls === 'forced') loss = 0;
  return {
    cls, loss, acc: moveAccuracy(loss),
    bestUci, bestCp, afterCp, winBefore, winAfter,
    san: played.san, stalemate: g.isStalemate(),
  };
}

/* Why a move was bad (or good), in words, plus a dictionary tag when a pattern is recognised. */
export function explain(ctx, r) {
  const san = r.san;
  const bestSan = r.bestUci ? sanOf(ctx.fenBefore, r.bestUci) : '';
  const c = CLASSES[r.cls];
  const out = { title: `${san} là nước ${c.vn}`, text: '', tag: null, bestSan, line: '' };
  const g0 = new Chess(ctx.fenBefore);
  g0.move(uciObj(ctx.uci));
  const fenAfter = g0.fen();
  const me = ctx.fenBefore.split(' ')[1];

  if (c.good) {
    out.text = {
      brilliant: 'Bạn thí quân một cách chính xác. Đối phương ăn quân sẽ gặp rắc rối.',
      great: 'Đây là nước duy nhất giữ được thế cờ. Các nước khác đều kém hơn rõ rệt.',
      best: 'Đúng nước máy chọn.',
      excellent: 'Gần như tốt nhất.' + (bestSan && bestSan !== san ? ` Máy thích ${bestSan} hơn một chút.` : ''),
      good: `Nước ổn. Mạnh hơn là ${bestSan}.`,
      book: 'Nước đi đúng lý thuyết khai cuộc.',
      forced: 'Chỉ có một nước hợp lệ.',
    }[r.cls];
    return out;
  }

  const fmt = (cp) => fmtCp(cp);
  const evalShift = `Đánh giá của bạn: ${fmt(r.bestCp)} → ${fmt(r.afterCp)}.`;
  if (r.stalemate) {
    out.text = 'Đối phương không bị chiếu nhưng hết nước đi: hòa pat! Bạn đánh mất ván thắng.';
    out.tag = 'stalemate';
    return out;
  }
  const reply = ctx.after && ctx.after.lines[0] && ctx.after.lines[0].pv;
  if (r.cls === 'miss') {
    const g = new Chess(ctx.fenBefore);
    let what = 'giữ lợi thế lớn';
    const bm = r.bestUci ? g.move(uciObj(r.bestUci)) : null;
    if (r.bestCp >= 9000) what = 'dẫn tới chiếu hết';
    else if (bm && bm.captured) what = `ăn được ${PIECE_VN[bm.captured]}`;
    out.text = `Đối phương vừa đi sai, nhưng bạn bỏ lỡ cơ hội: ${bestSan} ${what}. ${evalShift}`;
    return out;
  }
  if (reply && reply.length) {
    const g = new Chess(fenAfter);
    const oppMate = ctx.after.lines[0].score && ctx.after.lines[0].score.mate > 0 ? ctx.after.lines[0].score.mate : 0;
    out.line = pvSan(fenAfter, reply, oppMate ? oppMate * 2 - 1 : 4);
    if (oppMate) {
      out.text = `Đối phương có đòn chiếu hết trong ${oppMate} nước: ${out.line}. Nước tốt hơn: ${bestSan}.`;
      out.tag = mateTag(fenAfter, reply.slice(0, oppMate * 2 - 1), me);
      return out;
    }
    let m;
    try { m = g.move(uciObj(reply[0])); } catch { m = null; }
    if (m) {
      const fork = forkTargets(g, m.to, me);
      if (fork.length >= 2) {
        out.text = `Đối phương có đòn chĩa ${m.san}: ${PIECE_VN[m.piece]} tấn công ${fork.map((f) => PIECE_VN[f.type] + ' ' + f.square).join(' và ')} cùng lúc. Nước tốt hơn: ${bestSan}.`;
        out.tag = m.piece === 'p' ? 'pawn-fork' : 'fork';
        return out;
      }
      if (m.captured && VAL[m.captured] >= 1) {
        out.text = `Bạn để mất ${PIECE_VN[m.captured]} ở ${m.to}: đối phương đáp ${m.san}. Nước tốt hơn: ${bestSan}.`;
        out.tag = VAL[m.captured] >= 3 ? 'hanging' : null;
        return out;
      }
      out.text = `Sau nước này, đối phương đáp ${m.san} và thế cờ nghiêng về họ. Nước tốt hơn: ${bestSan}. ${evalShift}`;
    }
  } else {
    out.text = `Nước tốt hơn: ${bestSan}. ${evalShift}`;
  }
  const ply = (+ctx.fenBefore.split(' ')[5] - 1) * 2 + (me === 'b' ? 1 : 0);
  if (!out.tag && ply < 16 && new Chess(ctx.fenBefore).get(ctx.uci.slice(0, 2))?.type === 'q') out.tag = 'queen-early';
  return out;
}

function forkTargets(g, sq, victim) {
  // squares attacked by the piece now standing on `sq`: probe each victim piece
  const out = [];
  for (const row of g.board()) for (const p of row) {
    if (!p || p.color !== victim) continue;
    if (p.type !== 'k' && VAL[p.type] < 3) continue;
    if (g.attackers(p.square, g.get(sq).color).includes(sq)) out.push({ type: p.type, square: p.square });
  }
  return out;
}

function mateTag(fen, pv, victim) {
  const g = new Chess(fen);
  let last = null;
  for (const u of pv) { try { last = g.move(uciObj(u)); } catch { break; } }
  if (!last || !g.isCheckmate()) return null;
  let k = null;
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === victim) k = p.square;
  if (!k) return null;
  const weak = victim === 'w' ? 'f2' : 'f7';
  if (last.piece === 'n') {
    const f = 'abcdefgh'.indexOf(k[0]), r = +k[1];
    let boxed = true;
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const ff = f + df, rr = r + dr;
      if (ff < 0 || ff > 7 || rr < 1 || rr > 8) continue;
      const p = g.get('abcdefgh'[ff] + rr);
      if (!p || p.color !== victim) boxed = false;
    }
    if (boxed) return 'smothered';
  }
  if (last.to === weak) return 'f7-mate';
  const backRank = victim === 'w' ? '1' : '8';
  if ((last.piece === 'r' || last.piece === 'q') && last.to[1] === backRank && k[1] === backRank) return 'backrank';
  const moves = pv.map((u) => u.slice(2, 4));
  if (moves.includes(weak)) return 'f7-sac';
  return null;
}

export const TAG_LESSON = {
  hanging: 'hanging-piece', fork: 'knight-fork', 'pawn-fork': 'pawn-fork', backrank: 'back-rank',
  smothered: 'smothered-mate', stalemate: 'stalemate', 'queen-early': 'queen-early',
  'f7-mate': 'scholars-mate', 'f7-sac': 'legal-mate',
};
