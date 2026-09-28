// Offline assistant: answers common questions instantly from Stockfish's analysis and the app's own data.
import { Chess } from '../../lib/chess.js';
import { CLASSES, fmtCp } from '../analysis/review.js';
import { evalText, loosePieces, materialOf, openingGuide, PIECE_VN, sideVn } from './context.js';

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const INTENTS = [
  ['rules', /nhap thanh|bat tot qua duong|phong cap|luat|en passant|castl/],
  ['why', /vi sao|tai sao|tao sao|sao lai|sai o dau|loi gi|nuoc vua|nuoc nay|nuoc do|co tot khong|danh gia nuoc/],
  ['threat', /de doa|nguy hiem|bi an|treo|mat quan|bi bat|threat|can than/],
  ['opening', /khai cuoc|opening|ten the co|ten van|dang choi gi/],
  ['plan', /ke hoach|plan|chien luoc|y tuong|nen lam gi|huong di/],
  ['eval', /ai (dang )?(hon|thang|loi)|danh gia|loi the|the co (the nao|ra sao)|diem|eval|dang hon|dang thua|dang thang|can bang/],
  ['best', /tot nhat|nen di|di gi|di nuoc nao|goi y|nuoc nao|best|tiep theo|nen choi|di dau|cuu/],
];
export function intentOf(q) {
  const f = fold(q);
  const hit = INTENTS.find(([, re]) => re.test(f));
  return hit ? hit[0] : 'summary';
}

const b = (s) => `**${s}**`;

function bestText(v) {
  if (v.g.isCheckmate()) return 'Thế này đã chiếu hết, không còn nước nào để đi.';
  if (v.g.isStalemate()) return 'Đây là thế hòa pat: bên đến lượt không có nước hợp lệ nhưng không bị chiếu.';
  const [l1, l2, l3] = v.lines;
  if (!l1) return 'Stockfish chưa kịp phân tích thế này. Bạn hỏi lại sau một giây nhé.';
  const alts = [l2, l3].filter(Boolean).map((l) => `${b(l.first)} (${fmtCp(l.white)})`);
  return `Nước tốt nhất cho ${sideVn(v.stm)} là ${b(l1.first)} (${fmtCp(l1.white)}, ${evalText(l1.white)}).\n`
    + `Diễn biến Stockfish tính: ${l1.line}.`
    + (alts.length ? `\nLựa chọn khác: ${alts.join(', ')}.` : '')
    + '\nRê chuột hoặc chạm vào nước đi để thấy mũi tên trên bàn cờ.';
}
function evalAnswer(v) {
  const m = materialOf(v.g);
  const diff = m.w - m.b;
  const mat = diff === 0 ? 'Vật chất hai bên bằng nhau.' : `Về vật chất, ${diff > 0 ? 'Trắng' : 'Đen'} hơn ${Math.abs(diff)} điểm.`;
  const l1 = v.lines[0];
  if (!l1) return mat + ' Stockfish chưa kịp chấm điểm thế này.';
  return `Stockfish chấm ${b(fmtCp(l1.white))}: ${evalText(l1.white)}. ${mat}`
    + (Math.abs(l1.white) >= 150 && Math.abs(diff) < 2 ? '\nLợi thế đến từ vị trí quân (hoạt động, an toàn Vua, đe dọa) hơn là số quân.' : '');
}
function whyAnswer(v) {
  if (!v.rec) return 'Chưa có nước nào để nhận xét. Hãy đi một nước hoặc chọn một nước trong biên bản.';
  if (!v.rv) return `Nước ${b(v.rec.san)} chưa được chấm điểm. Sau ván, bấm "Chấm điểm ván đấu" để xem đánh giá từng nước.`;
  const c = CLASSES[v.rv.cls];
  let s = `${b(v.rec.san)} là nước ${b(c.vn)}. ${v.rv.text}`;
  if (v.rv.bestSan && v.rv.bestUci !== v.rec.uci && !['book', 'forced'].includes(v.rv.cls)) s += `\nNước tốt nhất lúc đó: ${b(v.rv.bestSan)}.`;
  if (v.rv.line && !c.good) s += `\nDiễn biến: ${v.rv.line}`;
  return s;
}
function threatAnswer(v) {
  const loose = loosePieces(v.g);
  const list = (c) => loose.filter((x) => x.color === c).map((x) => `${PIECE_VN[x.type]} ${x.square}${x.defended ? ' (bị quân rẻ hơn tấn công)' : ' (không có quân bảo vệ)'}`);
  const me = list(v.stm), them = list(v.stm === 'w' ? 'b' : 'w');
  const parts = [];
  if (v.g.inCheck()) parts.push(`${sideVn(v.stm)} đang bị chiếu, phải xử lý ngay.`);
  parts.push(me.length ? `Quân của ${sideVn(v.stm)} đang gặp nguy: ${me.join(', ')}.` : `Không có quân nào của ${sideVn(v.stm)} đang bị treo.`);
  if (them.length) parts.push(`Quân của đối phương có thể ăn được: ${them.join(', ')}.`);
  parts.push('Luôn kiểm tra: chiếu, ăn quân, đe dọa của cả hai bên trước khi đi.');
  return parts.join('\n');
}
function openingAnswer(v) {
  const o = openingGuide(v);
  if (!o) return 'Thế này chưa khớp tên khai cuộc nào trong dữ liệu (hoặc đã ra khỏi khai cuộc).';
  const g = o.guide;
  return `Đây là ${b(o.name)} (${o.en}, ${o.eco}).\n${g.idea}`
    + (g.tip ? `\nMẹo: ${g.tip}` : '') + '\nMở tab Khai cuộc để xem mô phỏng và các nước lý thuyết.';
}
function planAnswer(v) {
  const o = openingGuide(v);
  const side = v.stm === 'w' ? 'white' : 'black';
  const lines = [];
  if (o && o.guide && o.guide[side]) lines.push(`Kế hoạch điển hình cho ${sideVn(v.stm)} trong ${o.name}:`, ...o.guide[side].map((x) => `- ${x}`));
  else {
    lines.push((v.vp || 0) < 20 ? 'Nguyên tắc giai đoạn khai cuộc:' : 'Gợi ý chung:');
    lines.push('- Phát triển Mã, Tượng; nhập thành để Vua an toàn', '- Đưa Xe ra cột mở, nhắm vào điểm yếu của đối phương', '- Trước mỗi nước: kiểm tra chiếu, ăn quân, đe dọa');
  }
  if (!v.helpBlocked && v.lines[0]) lines.push(`Stockfish muốn bắt đầu bằng ${b(v.lines[0].first)}.`);
  return lines.join('\n');
}
const RULES = 'Luật nhanh:\n- **Nhập thành** (O-O / O-O-O): Vua đi 2 ô về phía Xe, Xe nhảy qua Vua. Cần: Vua và Xe chưa đi, không có quân ở giữa, Vua không đang bị chiếu và không đi qua ô bị kiểm soát.\n- **Bắt tốt qua đường**: khi tốt đối phương vừa tiến 2 ô và đứng cạnh tốt của bạn, bạn được ăn nó như thể nó chỉ tiến 1 ô, nhưng chỉ ngay nước tiếp theo.\n- **Phong cấp**: tốt đi tới hàng cuối được đổi thành Hậu, Xe, Tượng hoặc Mã (thường chọn Hậu).';

/* A move written in the question ("nc4", "Bxf7", "o-o"), if it is legal in the viewed position. */
function mentionedMove(q, v) {
  const toks = q.match(/\b(?:[kqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=[qrbn])?|o-o(?:-o)?|0-0(?:-0)?)(?![a-z0-9])/gi) || [];
  for (const t of toks) {
    const base = t.replace(/0/g, 'O');
    const cands = /^o-o/i.test(base) ? [base.toUpperCase()] : [base[0].toUpperCase() + base.slice(1).toLowerCase(), base.toLowerCase()];
    for (const c of cands) {
      try { const m = new Chess(v.fen).move(c); if (m) return m; } catch { /* not legal as written */ }
    }
  }
  return null;
}
function moveAnswer(m, v) {
  const g = new Chess(v.fen);
  g.move(m.san);
  const opp = m.color === 'w' ? 'b' : 'w';
  const facts = [];
  if (m.captured) facts.push(`ăn ${PIECE_VN[m.captured]} ở ${m.to}`);
  if (g.isCheckmate()) facts.push('chiếu hết');
  else if (g.inCheck()) facts.push('chiếu Vua');
  const hits = [];
  for (const row of g.board()) for (const p of row) {
    if (p && p.color === opp && p.type !== 'p' && g.attackers(p.square, m.color).includes(m.to)) hits.push(`${PIECE_VN[p.type]} ${p.square}`);
  }
  if (hits.length) facts.push(`tấn công ${hits.join(', ')}`);
  if (m.flags.includes('k') || m.flags.includes('q')) facts.push('nhập thành, đưa Vua vào nơi an toàn');
  const uci = m.from + m.to + (m.promotion || '');
  const i = v.lines.findIndex((l) => l.uci === uci);
  const best = v.lines[0];
  let head;
  if (i === 0) head = `${b(m.san)} chính là nước tốt nhất theo Stockfish (${fmtCp(best.white)}).`;
  else if (i > 0) head = `${b(m.san)} là lựa chọn tốt thứ ${i + 1} (${fmtCp(v.lines[i].white)}), gần bằng nước tốt nhất ${b(best.first)} (${fmtCp(best.white)}).`;
  else if (best) head = `${b(m.san)} không nằm trong 3 nước tốt nhất. Stockfish thích ${b(best.first)} (${fmtCp(best.white)}) hơn.`;
  else head = `Stockfish chưa kịp phân tích thế này.`;
  const lines = [head];
  if (facts.length) lines.push(`Nước ${m.san} ${facts.join(', ')}.`);
  if (i >= 0) lines.push(`Diễn biến Stockfish tính: ${v.lines[i].line}.`);
  else if (best) lines.push(`Diễn biến với ${best.first}: ${best.line}.`);
  return lines.join('\n');
}

/* Answer a question about the viewed position (markdown-ish text). */
export function localAnswer(q, v) {
  const intent = intentOf(q);
  if (v.helpBlocked && ['best', 'eval'].includes(intent)) {
    return `${v.blockReason}\nNguyên tắc chung: kiểm tra chiếu, ăn quân, đe dọa; phát triển quân và giữ Vua an toàn.`;
  }
  // "Why Nc4?": a move named in the question gets its own explanation (unless it is the move just played).
  const named = !v.helpBlocked && mentionedMove(q, v);
  if (named && intent !== 'rules') return moveAnswer(named, v);
  switch (intent) {
    case 'best': return bestText(v);
    case 'eval': return evalAnswer(v);
    case 'why': return whyAnswer(v);
    case 'threat': return threatAnswer(v);
    case 'opening': return openingAnswer(v);
    case 'plan': return planAnswer(v);
    case 'rules': return RULES;
    default: {
      const parts = [`Mình đang nhìn: ${v.label}.`];
      if (!v.helpBlocked && v.lines[0]) parts.push(`Stockfish: ${fmtCp(v.lines[0].white)} (${evalText(v.lines[0].white)}), nước tốt nhất ${b(v.lines[0].first)}.`);
      const loose = loosePieces(v.g);
      if (loose.length) parts.push(`Chú ý quân đang bị đe dọa: ${loose.map((x) => `${PIECE_VN[x.type]} ${x.square}`).join(', ')}.`);
      parts.push('Trợ lý offline trả lời được: nước tốt nhất, ai đang hơn, vì sao nước vừa rồi sai, quân nào bị đe dọa, khai cuộc, kế hoạch, luật. Để hỏi tự do bằng lời, chọn Gemini hoặc Claude trong phần cài đặt bên dưới.');
      return parts.join('\n');
    }
  }
}
