// Opening book lookups (lichess chess-openings, CC0) + Vietnamese study notes.
import { Chess } from '../lib/chess.js';
import { keyOf } from './hash.js';

let DB = null;
const contCache = new Map();

export async function loadOpenings(url = 'data/openings.json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error('openings ' + r.status);
  DB = await r.json();
  return DB;
}
export function setOpeningsData(d) { DB = d; }
export function openingsReady() { return !!DB; }

function uciObj(u) {
  const o = { from: u.slice(0, 2), to: u.slice(2, 4) };
  if (u.length > 4) o.promotion = u[4];
  return o;
}

export function bookEntry(fen) {
  if (!DB) return null;
  const e = DB.p[keyOf(fen)];
  if (e == null) return null;
  return { c: e[0], n: e[1], kids: e[2] ? e[2].split(' ') : [] };
}

/* Book moves out of a position, each with its own entry. Only the listed moves are played, so this is cheap. */
function bookChildren(g) {
  const e = bookEntry(g.fen());
  if (!e) return [];
  const out = [];
  for (const u of e.kids) {
    let m;
    try { m = g.move(uciObj(u)); } catch { continue; }
    const ce = bookEntry(g.fen());
    g.undo();
    if (ce) out.push({ uci: u, san: m.san, c: ce.c, n: ce.n });
  }
  return out;
}
const isGambit = (id) => id >= 0 && /Gambit|Trap|Countergambit/.test(DB.o[id][1]);

export function opening(id) {
  const o = DB.o[id];
  return { id, eco: o[0], name: o[1], ucis: o[2] ? o[2].split(' ') : [] };
}

/* Walk a game and collect every point where the named opening changes. */
export function analyzeLine(ucis) {
  const out = { events: [], current: null, lastBookPly: 0, inBook: true };
  if (!DB) return out;
  const g = new Chess();
  ucis.forEach((u, i) => {
    try { g.move(uciObj(u)); } catch { return; }
    const e = bookEntry(g.fen());
    if (e) {
      out.lastBookPly = i + 1;
      if (e.n >= 0 && (!out.current || DB.o[out.current.id][1] !== DB.o[e.n][1])) {
        out.current = { id: e.n, ply: i + 1 };
        out.events.push(out.current);
      }
    }
  });
  out.inBook = out.lastBookPly === ucis.length;
  return out;
}

/* "Main line": follow the book move that the most named lines pass through.
   Gambits and traps collect many named sub-lines, so they are down-weighted to keep the line mainstream. */
export function mainLine(fen, maxPlies = 10) {
  const g = new Chess(fen);
  const line = [];
  for (let i = 0; i < maxPlies; i++) {
    let best = null;
    for (const k of bookChildren(g)) {
      const w = k.c * (isGambit(k.n) ? 0.3 : 1);
      if (!best || w > best.w) best = { ...k, w };
    }
    if (!best) break;
    g.move(uciObj(best.uci));
    line.push({ uci: best.uci, san: best.san, n: best.n });
  }
  return line;
}

/* Book moves from this position, most-studied first. The simulation line is built on demand. */
export function continuations(fen, limit = 6) {
  if (!DB) return [];
  if (contCache.has(fen)) return contCache.get(fen);
  const g = new Chess(fen);
  const kids = bookChildren(g).sort((a, b) => b.c - a.c).slice(0, limit);
  const top = kids.map((k) => {
    let id = k.n;
    if (id < 0) {
      g.move(uciObj(k.uci));
      const ahead = mainLine(g.fen(), 4).find((s) => s.n >= 0);
      g.undo();
      id = ahead ? ahead.n : -1;
    }
    return { uci: k.uci, san: k.san, count: k.c, id };
  });
  contCache.set(fen, top);
  return top;
}

export function simulationLine(fen, firstUci, maxPlies = 10) {
  const g = new Chess(fen);
  let m;
  try { m = g.move(uciObj(firstUci)); } catch { return []; }
  const e = bookEntry(g.fen());
  return [{ uci: firstUci, san: m.san, n: e ? e.n : -1 }, ...mainLine(g.fen(), maxPlies - 1)];
}

export function deepestName(line) {
  let id = -1;
  for (const s of line) if (s.n >= 0) id = s.n;
  return id;
}

/* A library line given in SAN, annotated with book names along the way. */
export function sanLine(sans) {
  const g = new Chess();
  const line = [];
  for (const s of sans.split(' ')) {
    const m = g.move(s);
    const e = bookEntry(g.fen());
    line.push({ uci: m.from + m.to + (m.promotion || ''), san: m.san, n: e ? e.n : -1 });
  }
  return line;
}

/* ---------- Vietnamese study notes ---------- */
// Ordered: the first pattern that matches the full lichess name wins, so specific lines come first.
const GUIDES = [
  { re: /Fried Liver/, vn: 'Tấn công Gan Rán (Fried Liver)',
    idea: 'Sau 4.Ng5 d5 5.exd5 Nxd5?!, Trắng thí Mã ở f7 để kéo Vua Đen ra giữa bàn rồi dồn quân tấn công.',
    white: ['Nxf7 rồi Qf3+ đưa Hậu vào cuộc, ghim Mã d5', 'Đưa thêm quân (Nc3, d4, O-O) trước khi Vua Đen kịp chạy'],
    black: ['Tránh 5...Nxd5; đi 5...Na5 là cách chuẩn', 'Nếu đã vào biến thí Mã, đưa Vua về e6 và phòng thủ bằng ...Ncb4, ...c6'],
    tip: 'Người mới cầm Đen thường thua nhanh ở đây. Nhớ: 5...Na5!, không ăn lại bằng Mã.' },
  { re: /Two Knights Defense/, vn: 'Phòng thủ Hai Mã',
    idea: 'Đen đi 3...Nf6 phản công tốt e4 thay vì 3...Bc5. Ván cờ có thể rất sắc bén nếu Trắng đánh 4.Ng5.',
    white: ['4.Ng5 tấn công f7 (sắc bén) hoặc 4.d3 chơi an toàn', 'Nhập thành sớm, đừng để Tượng c4 bị đổi mất tempo'],
    black: ['Sau 4.Ng5 đi 4...d5 và nhớ 5...Na5', 'Chấp nhận thí tốt để đổi lấy tốc độ phát triển'],
    tip: 'Điểm f7 chỉ được Vua bảo vệ. Luôn đếm số quân tấn công và bảo vệ f7.' },
  { re: /Evans Gambit/, vn: 'Gambit Evans',
    idea: 'Trắng thí tốt b4 để kéo Tượng c5 đi, đổi lại được đi c3 và d4 với tempo, trung tâm lớn và tấn công nhanh.',
    white: ['c3, d4 mở trung tâm, Qb3 nhắm f7', 'Tượng c1 lên a3 ngăn Đen nhập thành'],
    black: ['Nhận tốt rồi lui Tượng về a5 hoặc e7', 'Trả lại tốt khi cần để phát triển và nhập thành'],
    tip: 'Gambit cổ điển, rất hay để học tấn công.' },
  { re: /Giuoco Pian/, vn: 'Giuoco Piano (Ván êm)',
    idea: 'Cả hai Tượng đứng c4 và c5 nhắm vào f7 và f2. Trắng chuẩn bị c3 và d4 để chiếm trung tâm, hoặc d3 để xây dựng chậm.',
    white: ['c3 rồi d4 chiếm trung tâm', 'Nhập thành, Re1, Nbd2-f1-g3 kiểu hiện đại'],
    black: ['...Nf6, ...d6, nhập thành', 'Giữ Tượng c5 hoạt động; lui về b6 khi bị d4 đuổi'],
    tip: 'Khai cuộc tốt nhất để người mới học nguyên tắc: phát triển, trung tâm, nhập thành.' },
  { re: /Italian Game/, vn: 'Khai cuộc Ý',
    idea: 'Sau 1.e4 e5 2.Nf3 Nc6 3.Bc4, Tượng Trắng nhắm thẳng vào f7, điểm yếu nhất của Đen lúc đầu ván.',
    white: ['Nhập thành nhanh, sau đó c3 và d4', 'Hoặc d3 chắc chắn rồi tấn công cánh Vua'],
    black: ['3...Bc5 (Giuoco Piano) hoặc 3...Nf6 (Hai Mã)', 'Không để f7 bị khai thác, nhập thành sớm'],
    tip: 'Tránh 3...d6?! quá thụ động, và cẩn thận với Ng5 khi f7 yếu.' },
  { re: /Berlin Defense/, vn: 'Phòng thủ Berlin',
    idea: 'Đen đi 3...Nf6 phản công e4. Biến chính thường đổi Hậu sớm và vào tàn cuộc Berlin nổi tiếng là rất khó phá.',
    white: ['O-O rồi Re1 hoặc d3 chơi chậm', 'Trong tàn cuộc, dùng thế tốt đa số cánh Vua'],
    black: ['Chấp nhận mất quyền nhập thành để đổi lấy cặp Tượng', 'Phòng thủ bền, chờ Trắng quá tay'],
    tip: 'Nổi tiếng vì Kramnik dùng để hạ Kasparov năm 2000.' },
  { re: /Ruy Lopez/, vn: 'Khai cuộc Tây Ban Nha (Ruy Lopez)',
    idea: '3.Bb5 tấn công Mã c6, quân đang bảo vệ tốt e5. Trắng chưa ăn được tốt ngay mà tạo áp lực lâu dài lên trung tâm Đen.',
    white: ['Nhập thành, Re1, c3 rồi d4', 'Lui Tượng về a4, b3 và giữ đường chéo nhắm f7'],
    black: ['3...a6 đuổi Tượng (Phòng thủ Morphy), rồi ...Nf6, ...Be7, ...b5', 'Giữ e5 thật vững, nhập thành'],
    tip: 'Sau 3...a6 4.Bxc6 dxc6, 5.Nxe5? bị 5...Qd4! lấy lại tốt.' },
  { re: /Najdorf/, vn: 'Biến Najdorf',
    idea: '5...a6 là nước linh hoạt: ngăn Bb5 và Nb5, chuẩn bị ...e5 hoặc ...e6 và ...b5. Đây là biến sắc bén bậc nhất.',
    white: ['6.Be3, 6.Bg5 hoặc 6.Be2 tùy phong cách', 'Tấn công cánh Vua, thường với f3, g4'],
    black: ['Phản công cánh Hậu bằng ...b5, ...Bb7, cột c', 'Chiếm ô d5 hoặc phá bằng ...d5 đúng lúc'],
    tip: 'Lý thuyết rất dài, học ý tưởng trước khi học thuộc nước đi.' },
  { re: /Dragon/, vn: 'Biến Rồng (Dragon)',
    idea: 'Đen đưa Tượng lên g7 nhắm theo đường chéo dài. Trắng thường nhập thành cánh Hậu và đẩy tốt h4-h5 tấn công Vua Đen.',
    white: ['Be3, Qd2, f3, O-O-O rồi h4-h5', 'Đổi Tượng g7 bằng Bh6'],
    black: ['Phản công cột c, thường thí Xe ở c3', 'Giữ Tượng g7 càng lâu càng tốt'],
    tip: 'Hai bên tấn công ở hai cánh: ai nhanh hơn thường thắng.' },
  { re: /Smith-Morra/, vn: 'Gambit Smith-Morra',
    idea: 'Trắng thí tốt d4 rồi c3 để phát triển nhanh và mở cột c, cột d cho Xe.',
    white: ['Nxc3, Nf3, Bc4, O-O, Qe2, Rd1', 'Nhắm vào f7 và ô d6 yếu'],
    black: ['Nhận tốt nhưng phát triển thật cẩn thận', 'Tránh để Hậu đứng trên cột c hoặc d bị Xe đè'],
    tip: 'Bẫy Siberia là một cái bẫy nổi tiếng trong biến này.' },
  { re: /Sicilian Defense: Alapin/, vn: 'Sicilia, biến Alapin (2.c3)',
    idea: 'Trắng chuẩn bị d4 để có cặp tốt trung tâm d4 và e4. Đen thường đáp 2...Nf6 hoặc 2...d5 để đánh trung tâm ngay.',
    white: ['d4, lấy lại bằng tốt c3 nếu được', 'Tránh lý thuyết Sicilia mở rất dài'],
    black: ['2...d5 hoặc 2...Nf6 tấn công e4', 'Phát triển nhanh, không để Trắng có trung tâm miễn phí'],
    tip: 'Lựa chọn tốt cho người không muốn học Sicilia mở.' },
  { re: /Sicilian/, vn: 'Phòng thủ Sicilia',
    idea: '1...c5 kiểm soát d4 từ cánh. Đen sẵn sàng đổi tốt c lấy tốt d trung tâm để có thế cờ lệch và phản công.',
    white: ['Nf3 rồi d4 mở thế cờ (Sicilia mở)', 'Phát triển nhanh và tấn công cánh Vua'],
    black: ['Phản công cánh Hậu qua cột c nửa mở', 'Chọn cấu trúc ...d6, ...e6 hoặc ...g6'],
    tip: 'Phòng thủ phổ biến nhất trước 1.e4, dẫn tới những ván rất sắc bén.' },
  { re: /French Defense/, vn: 'Phòng thủ Pháp',
    idea: '1...e6 rồi 2...d5: Đen có thế chắc chắn nhưng Tượng c8 bị chính tốt e6 chặn.',
    white: ['Giữ trung tâm, thường đẩy e5 để chiếm không gian', 'Tấn công cánh Vua nơi Đen thiếu quân phòng thủ'],
    black: ['Phá trung tâm Trắng bằng ...c5 và ...f6', 'Tìm cách kích hoạt Tượng c8 (…b6 và …Ba6, hoặc đổi nó đi)'],
    tip: 'Trong biến Tiến (3.e5), mũi nhọn của Đen luôn là ...c5.' },
  { re: /Caro-Kann/, vn: 'Phòng thủ Caro-Kann',
    idea: '1...c6 rồi 2...d5. Giống Pháp nhưng Tượng c8 kịp ra ngoài (…Bf5 hoặc …Bg4) trước khi Đen đi …e6.',
    white: ['Biến Tiến 3.e5 chiếm không gian', 'Hoặc 3.Nc3 cổ điển, đuổi Tượng f5 bằng h4-h5'],
    black: ['Cấu trúc tốt vững, ít điểm yếu', 'Đổi quân và đi vào tàn cuộc tốt'],
    tip: 'Lựa chọn rất tốt cho người thích chơi chắc chắn.' },
  { re: /Scandinavian/, vn: 'Phòng thủ Scandinavia',
    idea: '1...d5 đánh thẳng vào e4. Sau 2.exd5 Qxd5 3.Nc3, Hậu Đen phải lui và Trắng được thêm một nhịp phát triển.',
    white: ['Nc3 đuổi Hậu, d4, Nf3, phát triển nhanh', 'Tận dụng việc Hậu Đen ra sớm để lấy tempo'],
    black: ['Hậu về a5 hoặc d6, rồi ...Nf6, ...Bf5 hoặc ...Bg4, ...c6', 'Chơi đơn giản, cấu trúc gọn'],
    tip: 'Dễ học vì Trắng khó tránh vào thế cờ này.' },
  { re: /Alekhine/, vn: 'Phòng thủ Alekhine',
    idea: '1...Nf6 dụ các tốt Trắng tiến lên (e5, c4, d4, f4), rồi Đen tấn công trung tâm đã bị kéo quá dài.',
    white: ['Chiếm không gian nhưng đừng đẩy tốt quá xa', 'Phát triển quân trước khi tấn công'],
    black: ['Lui Mã về b6, phá trung tâm bằng ...d6, ...c5', 'Kiên nhẫn chờ trung tâm Trắng lộ điểm yếu'],
    tip: 'Khai cuộc khiêu khích, cần hiểu rõ khi nào phản công.' },
  { re: /Pirc/, vn: 'Phòng thủ Pirc',
    idea: 'Đen đi ...d6, ...Nf6, ...g6, ...Bg7: để Trắng chiếm trung tâm rồi phản công sau.',
    white: ['Tấn công Áo (f4) hoặc Be3, Qd2 và nhập thành xa', 'Tận dụng không gian lớn'],
    black: ['Nhập thành, phá trung tâm bằng ...e5 hoặc ...c5', 'Dùng Tượng g7 trên đường chéo dài'],
    tip: 'Linh hoạt nhưng nhường Trắng nhiều không gian.' },
  { re: /Modern Defense/, vn: 'Phòng thủ Hiện đại',
    idea: 'Đen đi ...g6 và ...Bg7 trước, giữ thế linh hoạt, trì hoãn ...Nf6 để tùy biến.',
    white: ['Lập trung tâm e4, d4 và phát triển tự nhiên', 'Không vội tấn công khi chưa phát triển xong'],
    black: ['Phản công trung tâm bằng ...c5, ...d6, ...e5', 'Giữ Tượng g7 mạnh'],
    tip: 'Gần với Pirc, nhiều cách chuyển đổi qua lại.' },
  { re: /Stafford/, vn: 'Gambit Stafford',
    idea: 'Sau 3.Nxe5 Nc6!?, Đen thí tốt để phát triển nhanh và đặt nhiều bẫy chiếu hết quanh Vua Trắng.',
    white: ['4.Nxc6 dxc6 rồi d3 hoặc Nc3 là an toàn', 'Không tham ăn, không để Tượng c5 và Mã đè vào f2'],
    black: ['Phát triển thật nhanh: ...Bc5, ...Ng4, ...Qh4', 'Nhắm vào f2 và ô h2'],
    tip: 'Trắng chơi đúng thì Đen chỉ bị thiếu một tốt. Hay để biết, không nên phụ thuộc.' },
  { re: /Petrov/, vn: 'Phòng thủ Petrov (Ván Nga)',
    idea: 'Thay vì bảo vệ e5, Đen phản công tốt e4 bằng 2...Nf6. Thế cờ đối xứng, rất chắc chắn.',
    white: ['3.Nxe5 rồi Nf3, hoặc 3.d4 mở trung tâm', 'Phát triển nhanh để tận dụng lượt đi trước'],
    black: ['Sau 3.Nxe5 phải đi 3...d6 trước rồi mới ...Nxe4', 'Phát triển đối xứng, nhập thành'],
    tip: 'Bẫy kinh điển: 3.Nxe5 Nxe4? 4.Qe2! Nf6?? 5.Nc6+ mở đường chiếu, ăn Hậu Đen.' },
  { re: /Philidor/, vn: 'Phòng thủ Philidor',
    idea: '2...d6 bảo vệ e5 bằng tốt. Chắc chắn nhưng thụ động, vì Tượng f8 bị chính tốt d6 chặn.',
    white: ['d4 gây áp lực e5, phát triển tự nhiên', 'Chiếm không gian và dùng lợi thế phát triển'],
    black: ['...Nf6, ...Be7, ...O-O, giữ e5', 'Hoặc đổi ...exd4 để mở thế cờ'],
    tip: 'Có một cái bẫy nổi tiếng: chiếu hết Légal thường xuất hiện ở khai cuộc kiểu này.' },
  { re: /Scotch/, vn: 'Ván Scotland (Scotch)',
    idea: '3.d4 mở trung tâm ngay lập tức. Sau 3...exd4 4.Nxd4 Trắng có không gian và thế cờ thoáng.',
    white: ['Mã d4 mạnh, phát triển nhanh, nhập thành', 'Chuẩn bị e5 hoặc f4 để tấn công'],
    black: ['4...Bc5 hoặc 4...Nf6 tấn công ngay', 'Đổi Mã ở d4 khi có lợi'],
    tip: 'Đơn giản và mở, hợp với người thích quân hoạt động.' },
  { re: /Four Knights|Three Knights/, vn: 'Ván Bốn Mã',
    idea: 'Cả hai bên đưa Mã về ô tự nhiên nhất. Thế cờ cân bằng, dễ chơi, hợp để luyện nguyên tắc phát triển.',
    white: ['Bb5 (Tây Ban Nha) hoặc d4 (Scotch)', 'Nhập thành và mở trung tâm'],
    black: ['Phát triển đối xứng, nhập thành', 'Cẩn thận khi đối xứng quá lâu'],
    tip: 'Tốt cho người mới vì ít bẫy lý thuyết.' },
  { re: /Vienna/, vn: 'Ván Vienna',
    idea: '2.Nc3 phát triển Mã và chuẩn bị f4 để tấn công, hoặc Bc4 nhắm f7.',
    white: ['f4 mở cột f (Gambit Vienna)', 'Hoặc g3 và Bg2 chơi vị trí'],
    black: ['...Nf6 và phản công ...d5 đúng lúc', 'Không để bị cuốn vào tấn công quá sớm'],
    tip: 'Gambit Vienna có nhiều cú đánh nhanh, rất hợp ván chớp.' },
  { re: /King's Gambit/, vn: 'Gambit Vua',
    idea: '2.f4 thí tốt f để kéo tốt e5 khỏi trung tâm và mở cột f cho Xe tấn công f7.',
    white: ['Nf3, Bc4, d4, nhập thành nhanh', 'Dùng cột f mở và trung tâm để tấn công'],
    black: ['Nhận tốt rồi trả lại đúng lúc, hoặc từ chối bằng ...Bc5', 'Phản công trung tâm bằng ...d5'],
    tip: 'Khai cuộc lãng mạn của thế kỷ 19, đầy tấn công.' },
  { re: /Bishop's Opening/, vn: 'Khai cuộc Tượng',
    idea: '2.Bc4 đưa Tượng nhắm f7 ngay, giữ linh hoạt để chuyển sang Ý hoặc Vienna.',
    white: ['d3, Nf3, Nc3, nhập thành', 'Có thể chơi f4 như Gambit Vua'],
    black: ['2...Nf6 phản công e4', 'Phát triển nhanh và giữ f7'],
    tip: 'Đơn giản, ít lý thuyết.' },
  { re: /Center Game|Danish/, vn: 'Ván Trung tâm / Gambit Đan Mạch',
    idea: '2.d4 mở trung tâm ngay. Nếu Hậu ăn lại ở d4 thì Đen đuổi bằng ...Nc6 và được tempo. Gambit Đan Mạch thí tốt để phát triển siêu tốc.',
    white: ['Lấy lại tốt, phát triển nhanh', 'Trong Gambit Đan Mạch, hai Tượng nhắm vào Vua Đen'],
    black: ['...Nc6 đuổi Hậu, ...Nf6, nhập thành', 'Trả lại tốt để phát triển khi cần'],
    tip: 'Nhắc nhở: đưa Hậu ra quá sớm thường bị mất nhịp.' },
  { re: /Ponziani/, vn: 'Khai cuộc Ponziani',
    idea: '3.c3 chuẩn bị d4 để có trung tâm tốt, nhưng lấy mất ô c3 của Mã.',
    white: ['d4 chiếm trung tâm', 'Qa4 ghim Mã c6 trong một số biến'],
    black: ['Phản công ngay bằng ...Nf6 hoặc ...d5', 'Tận dụng việc Trắng phát triển chậm'],
    tip: 'Ít gặp, bất ngờ với đối thủ.' },
  { re: /Elephant/, vn: 'Gambit Voi (Elephant)',
    idea: 'Một gambit mạo hiểm: thí tốt để tạo biến động, nhưng nếu đối phương chơi đúng thì bên thí thường yếu thế.',
    white: ['Phát triển tự nhiên, không tham ăn thêm', 'Nhập thành sớm, giữ Vua an toàn'],
    black: ['Bên thí tốt cần tấn công ngay', 'Học các bẫy chính để không bị thua nhanh'],
    tip: 'Gặp những khai cuộc này, cứ chơi theo nguyên tắc là đủ.' },
  { re: /Latvian/, vn: 'Gambit Latvia',
    idea: 'Một gambit mạo hiểm: thí tốt để tạo biến động, nhưng nếu đối phương chơi đúng thì bên thí thường yếu thế.',
    white: ['Phát triển tự nhiên, không tham ăn thêm', 'Nhập thành sớm, giữ Vua an toàn'],
    black: ['Bên thí tốt cần tấn công ngay', 'Học các bẫy chính để không bị thua nhanh'],
    tip: 'Gặp những khai cuộc này, cứ chơi theo nguyên tắc là đủ.' },
  { re: /Englund/, vn: 'Gambit Englund',
    idea: 'Một gambit mạo hiểm: thí tốt để tạo biến động, nhưng nếu đối phương chơi đúng thì bên thí thường yếu thế.',
    white: ['Phát triển tự nhiên, không tham ăn thêm', 'Nhập thành sớm, giữ Vua an toàn'],
    black: ['Bên thí tốt cần tấn công ngay', 'Học các bẫy chính để không bị thua nhanh'],
    tip: 'Gặp những khai cuộc này, cứ chơi theo nguyên tắc là đủ.' },
  { re: /King's Knight Opening/, vn: 'Khai cuộc Mã Vua',
    idea: '2.Nf3 phát triển Mã và tấn công ngay tốt e5. Đen thường bảo vệ bằng 2...Nc6, hoặc 2...d6 (Philidor), hoặc phản công 2...Nf6 (Petrov).',
    white: ['Tiếp theo Bb5 (Tây Ban Nha), Bc4 (Ý) hoặc d4 (Scotch)', 'Phát triển Mã trước Tượng'],
    black: ['2...Nc6 là nước tự nhiên nhất', 'Đừng bảo vệ bằng 2...f6? (Phòng thủ Damiano) hay 2...Qf6'],
    tip: 'Sau 2...f6? Trắng có ngay 3.Nxe5! rất mạnh.' },
  { re: /King's Pawn Game/, vn: 'Ván Tốt Vua',
    idea: '1.e4 chiếm trung tâm và mở đường cho Hậu và Tượng f1. Đây là nước đi phổ biến nhất ở mọi trình độ.',
    white: ['Nf3, Bc4 hoặc Bb5, nhập thành', 'Phát triển Mã trước Tượng, không đi Hậu sớm'],
    black: ['1...e5 cân bằng, hoặc 1...c5, 1...e6, 1...c6', 'Giành phần trung tâm của mình'],
    tip: 'Nguyên tắc vàng: trung tâm, phát triển, nhập thành.' },
  { re: /London System/, vn: 'Hệ thống London',
    idea: 'Trắng đi d4, Bf4, e3, Nf3, c3, Bd3, Nbd2 gần như bất kể Đen làm gì. Hệ thống chắc chắn và dễ học.',
    white: ['Dựng đủ hệ thống rồi mới tấn công', 'Mã e5 kết hợp f4 hoặc Qf3 cho tấn công cánh Vua'],
    black: ['...c5 và ...Qb6 đánh vào b2', 'Hoặc ...Nh5 đổi Tượng f4'],
    tip: 'Rất hợp để lên trình: ít lý thuyết, kế hoạch rõ ràng.' },
  { re: /Queen's Gambit Accepted/, vn: 'Gambit Hậu chấp nhận',
    idea: 'Đen nhận tốt 2...dxc4 nhưng không cố giữ. Đen dùng thời gian đó để phát triển và đánh ...c5 hoặc ...e5.',
    white: ['e3 hoặc e4, rồi Bxc4 lấy lại tốt', 'Chiếm trung tâm bằng tốt'],
    black: ['...Nf6, ...e6, ...c5 và phát triển nhanh', 'Đừng cố giữ tốt c4 bằng ...b5'],
    tip: 'Giữ tốt thừa bằng ...b5 thường bị a4 phá và mất nhiều hơn.' },
  { re: /Queen's Gambit Declined/, vn: 'Gambit Hậu từ chối',
    idea: '2...e6 giữ tốt d5 vững chắc. Vấn đề lớn nhất của Đen là Tượng c8 bị kẹt sau tốt e6.',
    white: ['Nc3, Bg5 gây áp lực d5', 'Đổi cxd5 rồi tấn công thiểu số b4-b5'],
    black: ['...Nf6, ...Be7, ...O-O, chờ giải phóng bằng ...c5 hoặc ...e5', 'Đổi quân để giảm áp lực'],
    tip: 'Bẫy Voi (Elephant Trap): sau ...Nbd7, nếu Trắng tham ăn tốt d5 bằng Mã thì bị mất quân.' },
  { re: /Semi-Slav/, vn: 'Phòng thủ Bán Slav',
    idea: 'Đen kết hợp ...c6 và ...e6: trung tâm cực vững, sẵn sàng ăn tốt c4 rồi phản công ...b5 (biến Meran).',
    white: ['e3 và Bd3, hoặc Bg5 sắc bén', 'Chiếm e4 khi có thể'],
    black: ['...dxc4 và ...b5, ...Bb7, ...c5', 'Giữ thế cờ đàn hồi'],
    tip: 'Một trong những phòng thủ phức tạp nhất trước 1.d4.' },
  { re: /Slav/, vn: 'Phòng thủ Slav',
    idea: '2...c6 bảo vệ d5 mà vẫn để Tượng c8 ra được ô f5 hoặc g4 trước khi đi ...e6.',
    white: ['Nc3, Nf3, e3 hoặc a4 ngăn ...b5', 'Lấy lại tốt c4 nếu Đen ăn'],
    black: ['...Bf5 sớm, rồi ...e6', 'Cấu trúc tốt vững chắc'],
    tip: 'Giải quyết tốt vấn đề Tượng c8 của Gambit Hậu từ chối.' },
  { re: /Catalan/, vn: 'Khai cuộc Catalan',
    idea: 'Trắng kết hợp d4, c4 với g3 và Bg2: Tượng g2 đè đường chéo dài, tạo áp lực lâu dài lên cánh Hậu Đen.',
    white: ['Qc2 hoặc Qa4 lấy lại tốt c4', 'Áp lực bền bỉ trên đường chéo h1-a8'],
    black: ['...dxc4 rồi ...b5 hoặc ...c5', 'Hóa giải Tượng g2 bằng ...c6 hoặc đổi quân'],
    tip: 'Khai cuộc vị trí, hợp người kiên nhẫn.' },
  { re: /Queen's Gambit/, vn: 'Gambit Hậu',
    idea: '2.c4 thí tốt c để kéo tốt d5 khỏi trung tâm. Thật ra không phải thí thật, vì Trắng thường lấy lại tốt dễ dàng.',
    white: ['Nc3, Nf3, Bg5 hoặc Bf4', 'Chiếm trung tâm bằng e4 khi có thể'],
    black: ['Từ chối bằng 2...e6 hoặc 2...c6, hoặc nhận bằng 2...dxc4', 'Giữ trung tâm d5'],
    tip: 'Một trong những khai cuộc lâu đời và vững chắc nhất.' },
  { re: /Nimzo-Indian/, vn: 'Phòng thủ Nimzo-Ấn',
    idea: '3...Bb4 ghim Mã c3, sẵn sàng đổi Tượng lấy Mã để làm hỏng cấu trúc tốt Trắng và kiểm soát ô e4.',
    white: ['Qc2 hoặc a3 để có cặp Tượng', 'e3 và Bd3 phát triển chắc'],
    black: ['Đổi Bxc3 khi tốt Trắng bị chồng', 'Kiểm soát e4 bằng ...b6, ...Bb7 hoặc ...d5'],
    tip: 'Rất được các kiện tướng ưa chuộng.' },
  { re: /Bogo-Indian/, vn: 'Phòng thủ Bogo-Ấn',
    idea: '3...Bb4+ chiếu để đơn giản hóa phát triển, thường đổi Tượng lấy Tượng hoặc Mã.',
    white: ['Bd2 hoặc Nbd2 chặn chiếu', 'Giữ trung tâm, g3 và Bg2'],
    black: ['...Qe7 bảo vệ, ...O-O, ...d6', 'Chơi chắc, ít điểm yếu'],
    tip: 'Lựa chọn yên tĩnh trước 1.d4.' },
  { re: /Queen's Indian/, vn: 'Phòng thủ Ấn Độ Hậu',
    idea: '...b6 và ...Bb7 kiểm soát ô e4 từ xa. Thế cờ chắc chắn, ít rủi ro.',
    white: ['g3 và Bg2 đối đầu Tượng b7', 'a3 để ngăn ...Bb4'],
    black: ['...Bb7, ...Be7, ...O-O', 'Giữ e4 dưới tầm kiểm soát'],
    tip: 'Phòng thủ vững cho người thích chơi vị trí.' },
  { re: /King's Indian Attack/, vn: 'Tấn công Ấn Độ Vua',
    idea: 'Trắng dựng hệ thống Nf3, g3, Bg2, O-O, d3, e4: giống Phòng thủ Ấn Độ Vua nhưng đảo màu và hơn một nước.',
    white: ['e5 chiếm không gian, tấn công cánh Vua', 'Nbd2, Re1, h4 là các nước quen thuộc'],
    black: ['Chiếm trung tâm, phản công cánh Hậu', 'Không để Trắng tấn công cánh Vua dễ dàng'],
    tip: 'Một hệ thống dùng được trước gần như mọi phòng thủ.' },
  { re: /King's Indian/, vn: 'Phòng thủ Ấn Độ Vua',
    idea: 'Đen để Trắng lập trung tâm tốt lớn, nhập thành nhanh, rồi phản công bằng ...e5 hoặc ...c5 và thường tấn công cánh Vua bằng ...f5.',
    white: ['Chiếm không gian, tấn công cánh Hậu bằng c5', 'Giữ trung tâm vững'],
    black: ['...e5, ...Nc6 hoặc ...Na6, rồi ...f5', 'Tượng g7 là quân quan trọng nhất'],
    tip: 'Khai cuộc chiến đấu yêu thích của Fischer và Kasparov.' },
  { re: /Grünfeld/, vn: 'Phòng thủ Grünfeld',
    idea: 'Đen đi ...g6 và ...d5: cho Trắng lập trung tâm lớn rồi tấn công nó bằng Tượng g7, ...c5 và ...Nc6.',
    white: ['cxd5, e4 lập trung tâm lớn', 'Giữ trung tâm và tấn công cánh Vua'],
    black: ['Áp lực liên tục lên d4', '...c5, ...Nc6, ...Qa5 là các vũ khí chính'],
    tip: 'Sắc bén và giàu lý thuyết.' },
  { re: /Benko/, vn: 'Gambit Benko',
    idea: 'Đen thí tốt b5 để mở cột a và b cho Xe, tạo áp lực lâu dài cánh Hậu.',
    white: ['Nhận tốt và giữ chắc', 'Tìm cách chơi e4-e5 ở trung tâm'],
    black: ['Xe trên cột a, b; Tượng g7 đè đường chéo', 'Không vội lấy lại tốt'],
    tip: 'Thí tốt vì hoạt động, rất hợp để học chơi vị trí.' },
  { re: /Benoni/, vn: 'Phòng thủ Benoni',
    idea: '...c5 thách thức d4, tạo cấu trúc tốt lệch: Trắng nhiều quân ở trung tâm, Đen chơi cánh Hậu với ...a6, ...b5.',
    white: ['e4-e5 phá trung tâm', 'Kiểm soát ô c4 và b5'],
    black: ['Tượng g7, ...Re8, ...a6, ...b5', 'Chơi năng động, chấp nhận rủi ro'],
    tip: 'Sắc bén, cần tính toán chính xác.' },
  { re: /Dutch/, vn: 'Phòng thủ Hà Lan',
    idea: '1...f5 kiểm soát e4 và hướng tới tấn công cánh Vua, nhưng làm yếu Vua Đen trên đường chéo e8-h5.',
    white: ['g3 và Bg2, chiếm e4 khi có thể', 'Tấn công đường chéo yếu e8-h5'],
    black: ['Stonewall (...d5, ...e6, ...c6) hoặc Leningrad (...g6)', 'Tấn công cánh Vua bằng ...Qe8-h5'],
    tip: 'Cẩn thận các đòn chiếu sớm bằng Qh5.' },
  { re: /Tarrasch/, vn: 'Phòng thủ Tarrasch',
    idea: 'Đen đi ...c5 sớm, chấp nhận tốt d cô lập để đổi lấy quân hoạt động và không gian.',
    white: ['Phong tỏa tốt d5 cô lập', 'Đổi quân để tốt cô lập thành điểm yếu'],
    black: ['Dùng tốt d5 để quân hoạt động', 'Tấn công trước khi vào tàn cuộc'],
    tip: 'Bài học kinh điển về tốt cô lập.' },
  { re: /Budapest/, vn: 'Gambit Budapest',
    idea: '2...e5!? thí tốt để quân Đen hoạt động nhanh, thường lấy lại tốt e5 sau đó.',
    white: ['Giữ tốt e5 bằng Bf4, Nf3', 'Không tham giữ tốt bằng mọi giá'],
    black: ['...Ng4, ...Nc6, ...Bb4+ lấy lại tốt', 'Chơi nhanh, nhiều bẫy'],
    tip: 'Bẫy Kieninger là cái bẫy nổi tiếng trong gambit này.' },
  { re: /Indian Defense/, vn: 'Phòng thủ Ấn Độ',
    idea: '1...Nf6 linh hoạt: kiểm soát e4, chưa lộ cấu trúc tốt, có thể chuyển sang nhiều phòng thủ khác nhau.',
    white: ['2.c4 chiếm không gian, hoặc hệ thống London/Colle', 'Phát triển tự nhiên'],
    black: ['Chọn ...e6 (Nimzo, Ấn Độ Hậu) hoặc ...g6 (Ấn Độ Vua, Grünfeld)', 'Giữ linh hoạt'],
    tip: 'Nước đáp phổ biến nhất trước 1.d4.' },
  { re: /English/, vn: 'Khai cuộc Anh',
    idea: '1.c4 kiểm soát d5 từ cánh, thường giống Phòng thủ Sicilia nhưng đảo màu và hơn một nước.',
    white: ['Nc3, g3, Bg2 kiểm soát đường chéo trắng', 'Chơi vị trí, chuyển sang d4 khi thuận lợi'],
    black: ['1...e5 (Sicilia đảo màu) hoặc 1...c5 đối xứng', 'Chiếm trung tâm bằng tốt'],
    tip: 'Linh hoạt, nhiều cách chuyển sang khai cuộc 1.d4.' },
  { re: /Réti|Zukertort/, vn: 'Khai cuộc Réti / Zukertort (1.Nf3)',
    idea: '1.Nf3 phát triển Mã trước, giữ nhiều lựa chọn: d4, c4 hoặc g3. Trắng chờ xem Đen dựng thế cờ gì.',
    white: ['c4 và g3 (Réti), hoặc d4 chuyển sang 1.d4', 'Kiểm soát trung tâm từ xa'],
    black: ['...d5 và ...Nf6 chiếm trung tâm', 'Chơi chắc chắn, phát triển tự nhiên'],
    tip: 'Nước khai cuộc linh hoạt, ít bị bất ngờ.' },
  { re: /Bird/, vn: 'Khai cuộc Bird',
    idea: '1.f4 kiểm soát e5, giống Phòng thủ Hà Lan đảo màu. Nhưng làm yếu Vua Trắng trên đường chéo e1-h4.',
    white: ['Nf3, e3, b3 và Bb2 (Tượng đè e5)', 'Cẩn thận đường chéo e1-h4'],
    black: ['1...d5 chắc chắn, hoặc Gambit From 1...e5', 'Tấn công Vua Trắng yếu'],
    tip: 'Gambit From (1...e5) là phản đòn sắc bén.' },
  { re: /Queen's Pawn Game|Colle|Torre|Trompowsky|Richter-Veresov|Jobava/, vn: 'Ván Tốt Hậu',
    idea: '1.d4 chiếm trung tâm. Ván cờ thường khép kín hơn 1.e4, chơi theo kế hoạch và cấu trúc tốt nhiều hơn là đòn chiến thuật sớm.',
    white: ['Nf3, c4 hoặc một hệ thống như London, Colle', 'Phát triển ổn định, kiểm soát e5'],
    black: ['1...d5 hoặc 1...Nf6 giành trung tâm', 'Không để Trắng chiếm e4 miễn phí'],
    tip: 'Hợp với người thích kế hoạch dài hơi.' },
];

const FALLBACK = {
  vn: 'Khai cuộc ít gặp',
  idea: 'Đây là một khai cuộc ít phổ biến. Hãy dựa vào nguyên tắc chung: chiếm trung tâm, phát triển quân nhẹ, nhập thành sớm.',
  white: ['Phát triển Mã và Tượng về phía trung tâm', 'Nhập thành trong khoảng 10 nước đầu'],
  black: ['Giành phần trung tâm bằng tốt', 'Không đi một quân hai lần khi chưa cần'],
  tip: 'Khai cuộc lạ không nguy hiểm nếu bạn chơi đúng nguyên tắc.',
};

export function guideFor(name) {
  if (!name) return null;
  const g = GUIDES.find((x) => x.re.test(name));
  return g || FALLBACK;
}

export function vnName(name) {
  const g = guideFor(name);
  if (g && g !== FALLBACK) return g.vn;
  const fam = name.split(':')[0].split(',')[0].trim();
  const rules = [
    [/^(.*) Gambit Accepted$/, 'Gambit $1 chấp nhận'], [/^(.*) Gambit Declined$/, 'Gambit $1 từ chối'],
    [/^(.*) Countergambit$/, 'Phản gambit $1'], [/^(.*) Gambit$/, 'Gambit $1'], [/^(.*) Defense$/, 'Phòng thủ $1'],
    [/^(.*) Opening$/, 'Khai cuộc $1'], [/^(.*) Game$/, 'Ván $1'], [/^(.*) Attack$/, 'Tấn công $1'], [/^(.*) System$/, 'Hệ thống $1'],
  ];
  for (const [re, out] of rules) if (re.test(fam)) return fam.replace(re, out);
  return fam;
}

/* Famous openings for the library: hand-picked mainstream lines (SAN), validated at build time. */
export const LIBRARY = [
  { vn: 'Khai cuộc Ý (Giuoco Piano)', side: 'w', san: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6' },
  { vn: 'Khai cuộc Tây Ban Nha', side: 'w', san: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O' },
  { vn: 'Ván Scotland (Scotch)', side: 'w', san: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4' },
  { vn: 'Hệ thống London', side: 'w', san: 'd4 d5 Nf3 Nf6 Bf4 e6 e3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3' },
  { vn: 'Gambit Hậu từ chối', side: 'w', san: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6' },
  { vn: 'Gambit Vienna', side: 'w', san: 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O' },
  { vn: 'Khai cuộc Anh', side: 'w', san: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7' },
  { vn: 'Sicilia Najdorf', side: 'b', san: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7' },
  { vn: 'Sicilia Rồng (Dragon)', side: 'b', san: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6 Bc4 Bd7 O-O-O' },
  { vn: 'Sicilia Alapin (2.c3)', side: 'b', san: 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6' },
  { vn: 'Phòng thủ Pháp, biến Tiến', side: 'b', san: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4 Nbd2 Na5' },
  { vn: 'Caro-Kann, biến Tiến', side: 'b', san: 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7' },
  { vn: 'Phòng thủ Scandinavia', side: 'b', san: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 Bf5 Bc4 e6 Bd2 c6' },
  { vn: 'Phòng thủ Petrov', side: 'b', san: 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7 c4 Nb4' },
  { vn: 'Hai Mã: phòng thủ đúng 5...Na5', side: 'b', san: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5' },
  { vn: 'Phòng thủ Ấn Độ Vua', side: 'b', san: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7' },
  { vn: 'Phòng thủ Nimzo-Ấn', side: 'b', san: 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6' },
  { vn: 'Phòng thủ Slav', side: 'b', san: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O' },
  { vn: 'Gambit Hậu chấp nhận', side: 'b', san: 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6' },
];
