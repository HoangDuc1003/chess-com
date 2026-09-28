// What the chat assistant "sees": the position on the board, the game so far and Stockfish's view of it.
import { Chess } from '../../lib/chess.js';
import { MODES } from '../core/config.js';
import { bot, cache, fenAtPly, flags, isOver, openingInfo, S, viewPly } from '../core/state.js';
import { posKey } from '../core/util.js';
import { guideFor, vnName } from '../content/opening-guides.js';
import { opening } from '../content/openings.js';
import { CLASSES, fmtCp, pvSan, VAL } from '../analysis/review.js';
import { scoreCp } from '../game/bots.js';

export const PIECE_VN = { k: 'Vua', q: 'Hậu', r: 'Xe', b: 'Tượng', n: 'Mã', p: 'Tốt' };
export const sideVn = (c) => (c === 'w' ? 'Trắng' : 'Đen');
const moveLabel = (p) => `${Math.ceil(p / 2)}${p % 2 ? '.' : '…'}`;

/* Everything about the position currently on the board, gathered once per question. */
export function viewInfo() {
  if (S.pz) {
    const g = new Chess(S.pz.game.fen());
    const solving = S.pz.status === 'solving';
    return {
      fen: g.fen(), g, stm: g.turn(), puzzle: true, over: false, rec: null, rv: null, vp: 0, n: 0,
      label: `Thế giải đố #${S.pz.p.id} · ${sideVn(g.turn())} đi`,
      helpBlocked: solving, blockReason: 'Bạn đang giải đố: hãy tự tìm nước, hoặc bấm Gợi ý nếu bí.',
      lines: solving ? [] : engineLines(g.fen()),
    };
  }
  const vp = viewPly();
  const fen = fenAtPly(vp);
  const g = new Chess(fen);
  const live = S.started && !isOver() && S.view == null;
  const helpBlocked = S.started && !isOver() && !flags().hints;
  const rec = S.hist[vp - 1] || null;
  const where = vp === 0 ? 'Thế cờ ban đầu' : S.view == null ? `Thế cờ hiện tại (sau ${moveLabel(vp)}${rec.san})` : `Sau ${moveLabel(vp)}${rec.san}`;
  return {
    fen, g, stm: g.turn(), puzzle: false, over: isOver(), live, vp, n: S.hist.length, rec, rv: S.review[vp] || null,
    label: `${where} · ${sideVn(g.turn())} đi`,
    helpBlocked, blockReason: 'Đang ở chế độ Thử thách (không trợ giúp), nên mình không nói nước nên đi hay điểm số cho tới khi hết ván.',
    lines: helpBlocked ? [] : engineLines(fen),
  };
}

/* Stockfish's lines for a position: best move first, scores from White's side. */
export function engineLines(fen) {
  const e = cache.get(posKey(fen));
  if (!e) return [];
  const stm = fen.split(' ')[1];
  return e.lines.filter((l) => l && l.pv && l.pv.length).map((l) => {
    const cp = scoreCp(l.score);
    const san = pvSan(fen, l.pv, 8);
    return { uci: l.pv[0], first: san.split(' ')[0].replace(/^\d+[.…]+/, ''), line: san, white: stm === 'w' ? cp : -cp, depth: l.depth || e.depth };
  });
}

export function materialOf(g) {
  const m = { w: 0, b: 0 };
  for (const row of g.board()) for (const p of row) if (p) m[p.color] += VAL[p.type];
  return m;
}
export function pieceList(g, color) {
  const order = 'kqrbnp';
  const ps = [];
  for (const row of g.board()) for (const p of row) if (p && p.color === color) ps.push(p);
  ps.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.square.localeCompare(b.square));
  return ps.map((p) => (p.type === 'p' ? p.square : p.type.toUpperCase() + p.square)).join(', ');
}

/* Pieces (knight and up) that are attacked and not safely defended. */
export function loosePieces(g) {
  const out = [];
  for (const row of g.board()) for (const p of row) {
    if (!p || p.type === 'k' || p.type === 'p') continue;
    const opp = p.color === 'w' ? 'b' : 'w';
    const att = g.attackers(p.square, opp);
    if (!att.length) continue;
    const def = g.attackers(p.square, p.color);
    const cheapest = Math.min(...att.map((s) => VAL[g.get(s).type] || 100));
    if (!def.length || cheapest < VAL[p.type]) out.push({ color: p.color, type: p.type, square: p.square, defended: def.length > 0 });
  }
  return out;
}

export const evalText = (white) => {
  if (Math.abs(white) >= 9000) return white > 0 ? 'Trắng có đòn chiếu hết' : 'Đen có đòn chiếu hết';
  const a = Math.abs(white);
  if (a < 40) return 'cân bằng';
  const who = white > 0 ? 'Trắng' : 'Đen';
  if (a < 100) return `${who} nhỉnh hơn một chút`;
  if (a < 250) return `${who} hơn rõ`;
  return `${who} đang thắng thế`;
};

/* The position and game, written out for a language model. */
export function describe(v) {
  const g = v.g;
  const L = [];
  if (v.puzzle) {
    L.push(`Người chơi đang giải một thế đố (độ khó ${S.pz.p.rating}); bên cần tìm nước: ${sideVn(S.pz.color)}.`);
  } else {
    const b = bot();
    L.push(`Người chơi (người đang hỏi) cầm quân ${sideVn(S.userColor)}. Đối thủ là bot "${b.name}" (${b.elo || 'toàn lực'} Elo). Chế độ: ${MODES[S.mode].vn}.`);
    if (!S.started) L.push('Ván chưa bắt đầu.');
    else if (v.over) L.push(`Ván đã kết thúc: ${S.result.winner == null ? 'hòa' : S.result.winner === S.userColor ? 'người chơi thắng' : 'bot thắng'} (${S.result.reason}).`);
    else L.push('Ván đang diễn ra.');
    L.push(`Thế cờ đang xem: ${v.label} (nước thứ ${v.vp}/${v.n} của ván).`);
  }
  L.push(`Đến lượt: ${sideVn(v.stm)}.${g.inCheck() ? ' Bên này đang bị chiếu.' : ''}${g.isCheckmate() ? ' Đây là thế chiếu hết.' : g.isStalemate() ? ' Đây là thế hòa pat.' : ''}`);
  L.push(`FEN: ${v.fen}`);
  L.push('Sơ đồ (hàng 8 ở trên, chữ hoa là quân Trắng, chữ thường là quân Đen):');
  L.push(g.ascii().trimEnd());
  L.push(`Quân Trắng: ${pieceList(g, 'w')}`);
  L.push(`Quân Đen: ${pieceList(g, 'b')}`);
  const m = materialOf(g);
  L.push(`Vật chất (Tốt=1, Mã/Tượng=3, Xe=5, Hậu=9): Trắng ${m.w}, Đen ${m.b}.`);
  if (!v.puzzle && v.vp) {
    const moves = [];
    for (let i = 0; i < v.vp; i++) moves.push((i % 2 ? '' : `${i / 2 + 1}.`) + S.hist[i].san);
    L.push(`Biên bản tới thế này: ${moves.join(' ')}`);
    const a = openingInfo(v.vp);
    if (a && a.current) { const o = opening(a.current.id); L.push(`Khai cuộc: ${vnName(o.name)} (${o.name}, ${o.eco}).`); }
  }
  if (v.rec && v.rv && !v.helpBlocked) {
    L.push(`Nước vừa đi: ${moveLabel(v.vp)}${v.rec.san} (${v.rec.color === S.userColor ? 'của người chơi' : 'của bot'}) — Stockfish chấm "${CLASSES[v.rv.cls].vn}". ${v.rv.text}${v.rv.bestSan && v.rv.bestUci !== v.rec.uci ? ` Nước tốt nhất lúc đó: ${v.rv.bestSan}.` : ''}`);
  }
  const loose = loosePieces(g);
  if (loose.length) L.push(`Quân đang bị tấn công mà không được bảo vệ an toàn: ${loose.map((x) => `${PIECE_VN[x.type]} ${sideVn(x.color)} ở ${x.square}`).join('; ')}.`);
  if (v.helpBlocked) L.push(`LƯU Ý: ${v.blockReason} Không được nói nước nên đi, không đưa điểm số của thế này.`);
  else if (v.lines.length) {
    L.push(`Phân tích Stockfish (độ sâu ${v.lines[0].depth}), điểm tính theo phía Trắng, nước đầu là của ${sideVn(v.stm)}:`);
    v.lines.slice(0, 3).forEach((l, i) => L.push(`${i + 1}) ${l.first} (${fmtCp(l.white)}): ${l.line}`));
    L.push(`Nhận định: ${evalText(v.lines[0].white)}.`);
  } else if (!g.isGameOver()) L.push('Chưa có phân tích Stockfish cho thế này.');
  return L.join('\n');
}

/* Opening guide for the viewed position, if any. */
export function openingGuide(v) {
  if (v.puzzle || !v.vp) return null;
  const a = openingInfo(v.vp);
  if (!a || !a.current) return null;
  const o = opening(a.current.id);
  return { name: vnName(o.name), en: o.name, eco: o.eco, guide: guideFor(o.name) };
}

export const SYSTEM_PROMPT = `Bạn là "Trợ lý cờ" trong ứng dụng Đấu Stockfish, một huấn luyện viên cờ vua thân thiện cho người mới chơi.
- Luôn trả lời bằng tiếng Việt, ngắn gọn (thường 2–6 câu hoặc vài gạch đầu dòng), đi thẳng vào câu hỏi.
- Bạn nhìn thấy thế cờ qua dữ liệu bên dưới (FEN, sơ đồ, danh sách quân, phân tích Stockfish). Coi phân tích Stockfish là đúng. Không bịa nước đi; chỉ nêu nước hợp lệ.
- Ghi nước đi bằng ký hiệu SAN (Nf3, Bxc4, O-O) và có thể kèm tên quân tiếng Việt: Vua (K), Hậu (Q), Xe (R), Tượng (B), Mã (N), Tốt.
- Điểm số: +1.0 nghĩa là Trắng hơn khoảng một Tốt; số âm là Đen hơn; M3 là chiếu hết sau 3 nước.
- Giải thích bằng ý tưởng (đe dọa, quân treo, trung tâm, an toàn Vua, kế hoạch), không chỉ đọc số.
- Nếu dữ liệu ghi LƯU Ý không được gợi ý, hãy tôn trọng điều đó và chỉ nói nguyên tắc chung.
- Câu hỏi không liên quan tới cờ vua: trả lời rất ngắn rồi mời quay lại ván cờ.`;
