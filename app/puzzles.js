// Puzzles from the lichess puzzle database (CC0). Each puzzle starts one move before the task:
// moves[0] is the opponent's move, then the solver and the opponent alternate.

let DB = null;
let themeIdx = null;

export async function loadPuzzles(url = 'data/puzzles.json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error('puzzles ' + r.status);
  DB = await r.json();
  themeIdx = new Map(DB.t.map((t, i) => [t, i]));
  return DB;
}
export const puzzlesReady = () => !!DB;
export const puzzleCount = () => (DB ? DB.p.length : 0);

export const THEME_VN = {
  mateIn1: 'Chiếu hết 1 nước', mateIn2: 'Chiếu hết 2 nước', mateIn3: 'Chiếu hết 3 nước', mateIn4: 'Chiếu hết 4 nước', mateIn5: 'Chiếu hết 5 nước',
  mate: 'Chiếu hết', fork: 'Đòn chĩa', pin: 'Đòn ghim', skewer: 'Đòn xiên', hangingPiece: 'Quân treo',
  discoveredAttack: 'Tấn công mở', discoveredCheck: 'Chiếu mở', doubleCheck: 'Chiếu đôi', sacrifice: 'Thí quân',
  deflection: 'Dẫn dụ quân đi', attraction: 'Thu hút', trappedPiece: 'Nhốt quân', quietMove: 'Nước lặng',
  promotion: 'Phong cấp', underPromotion: 'Phong cấp dưới Hậu', backRankMate: 'Chiếu hết hàng cuối', smotheredMate: 'Chiếu hết ngột ngạt',
  defensiveMove: 'Phòng thủ', zugzwang: 'Buộc phải đi (zugzwang)', intermezzo: 'Nước trung gian', xRayAttack: 'Tấn công xuyên',
  capturingDefender: 'Diệt quân phòng thủ', attackingF2F7: 'Tấn công f2/f7', kingsideAttack: 'Tấn công cánh Vua',
  queensideAttack: 'Tấn công cánh Hậu', exposedKing: 'Vua hở', clearance: 'Giải phóng đường', interference: 'Chặn đường',
  enPassant: 'Bắt tốt qua đường', castling: 'Nhập thành', equality: 'Cầm hòa', advantage: 'Giành lợi thế', crushing: 'Thắng lớn',
  advancedPawn: 'Tốt tiến xa', opening: 'Khai cuộc', middlegame: 'Trung cuộc', endgame: 'Tàn cuộc',
  rookEndgame: 'Tàn cuộc Xe', pawnEndgame: 'Tàn cuộc tốt', queenEndgame: 'Tàn cuộc Hậu', bishopEndgame: 'Tàn cuộc Tượng',
  knightEndgame: 'Tàn cuộc Mã', queenRookEndgame: 'Tàn cuộc Hậu Xe', short: 'Ngắn', long: 'Dài', veryLong: 'Rất dài', oneMove: 'Một nước',
  operaMate: 'Chiếu hết Opera', pillsburysMate: 'Chiếu hết Pillsbury', epauletteMate: 'Chiếu hết cầu vai', anastasiaMate: 'Chiếu hết Anastasia',
  arabianMate: 'Chiếu hết Ả Rập', hookMate: 'Chiếu hết móc câu', bodenMate: 'Chiếu hết Boden', doubleBishopMate: 'Chiếu hết hai Tượng',
  dovetailMate: 'Chiếu hết đuôi én', swallowstailMate: 'Chiếu hết đuôi nhạn', cornerMate: 'Chiếu hết góc', morphysMate: 'Chiếu hết Morphy',
  triangleMate: 'Chiếu hết tam giác', killBoxMate: 'Chiếu hết hộp', blindSwineMate: 'Chiếu hết hai Xe hàng 7', vukovicMate: 'Chiếu hết Vuković',
  balestraMate: 'Chiếu hết Balestra', collinearMove: 'Nước thẳng hàng',
};

/* Filter chips shown in the puzzle tab, grouped. `any` lists lichess themes that count for the chip. */
export const PUZZLE_GROUPS = [
  { vn: 'Giai đoạn', chips: [
    { id: 'all', vn: 'Tất cả', any: [] },
    { id: 'opening', vn: 'Khai cuộc', any: ['opening'] },
    { id: 'middlegame', vn: 'Trung cuộc', any: ['middlegame'] },
    { id: 'endgame', vn: 'Tàn cuộc', any: ['endgame'] },
  ] },
  { vn: 'Chiếu hết', chips: [
    { id: 'm1', vn: '1 nước', any: ['mateIn1'] },
    { id: 'm2', vn: '2 nước', any: ['mateIn2'] },
    { id: 'm3', vn: '3+ nước', any: ['mateIn3', 'mateIn4', 'mateIn5'] },
    { id: 'backrank', vn: 'Hàng cuối', any: ['backRankMate'] },
    { id: 'smothered', vn: 'Ngột ngạt', any: ['smotheredMate'] },
  ] },
  { vn: 'Chiến thuật', chips: [
    { id: 'fork', vn: 'Đòn chĩa', any: ['fork'] },
    { id: 'pin', vn: 'Đòn ghim', any: ['pin'] },
    { id: 'skewer', vn: 'Đòn xiên', any: ['skewer'] },
    { id: 'hanging', vn: 'Quân treo', any: ['hangingPiece'] },
    { id: 'discovered', vn: 'Tấn công mở', any: ['discoveredAttack', 'discoveredCheck', 'doubleCheck'] },
    { id: 'sacrifice', vn: 'Thí quân', any: ['sacrifice'] },
    { id: 'deflection', vn: 'Dẫn dụ / thu hút', any: ['deflection', 'attraction', 'capturingDefender'] },
    { id: 'trapped', vn: 'Nhốt quân', any: ['trappedPiece'] },
    { id: 'quiet', vn: 'Nước lặng', any: ['quietMove', 'intermezzo', 'zugzwang'] },
    { id: 'f7', vn: 'Tấn công f2/f7', any: ['attackingF2F7'] },
    { id: 'kingattack', vn: 'Tấn công Vua', any: ['kingsideAttack', 'exposedKing'] },
    { id: 'defense', vn: 'Phòng thủ', any: ['defensiveMove', 'equality'] },
  ] },
  { vn: 'Tàn cuộc', chips: [
    { id: 'rook', vn: 'Xe', any: ['rookEndgame', 'queenRookEndgame'] },
    { id: 'pawn', vn: 'Tốt', any: ['pawnEndgame'] },
    { id: 'minor', vn: 'Mã / Tượng', any: ['bishopEndgame', 'knightEndgame'] },
    { id: 'queen', vn: 'Hậu', any: ['queenEndgame'] },
    { id: 'promo', vn: 'Phong cấp', any: ['promotion', 'underPromotion', 'advancedPawn'] },
  ] },
];
const CHIP = new Map(PUZZLE_GROUPS.flatMap((g) => g.chips).map((c) => [c.id, c]));
export const chipById = (id) => CHIP.get(id) || CHIP.get('all');

export const LEVELS = [
  { id: 'easy', vn: 'Dễ', delta: -250 },
  { id: 'normal', vn: 'Vừa sức', delta: 0 },
  { id: 'hard', vn: 'Khó', delta: 250 },
];

export function puzzleAt(i) {
  const r = DB.p[i];
  return {
    i, id: r[0], fen: r[1], moves: r[2].split(' '), rating: r[3],
    themes: r[4] ? r[4].split('.').map((x) => DB.t[+x]) : [],
  };
}

/* Pick a puzzle for this rating, chip and level, avoiding recently seen ones. */
export function pickPuzzle({ rating, chip = 'all', level = 'normal', seen = new Set(), rnd = Math.random }) {
  if (!DB) return null;
  const c = chipById(chip);
  const want = c.any.map((t) => themeIdx.get(t)).filter((x) => x != null).map(String);
  const target = rating + (LEVELS.find((l) => l.id === level) || LEVELS[1]).delta;
  const matches = [];
  for (let i = 0; i < DB.p.length; i++) {
    const r = DB.p[i];
    if (want.length) {
      const ts = r[4].split('.');
      if (!want.some((w) => ts.includes(w))) continue;
    }
    matches.push(i);
  }
  if (!matches.length) return null;
  for (const width of [100, 175, 275, 450, 5000]) {
    const pool = matches.filter((i) => Math.abs(DB.p[i][3] - target) <= width && !seen.has(DB.p[i][0]));
    if (pool.length) return puzzleAt(pool[Math.floor(rnd() * pool.length)]);
  }
  return puzzleAt(matches[Math.floor(rnd() * matches.length)]);
}

/* Simple Elo update for the solver's puzzle rating. */
export function rateAfter(user, puzzle, solved, games) {
  const k = games < 10 ? 60 : games < 30 ? 40 : 24;
  const expected = 1 / (1 + Math.pow(10, (puzzle - user) / 400));
  return Math.round(Math.max(100, Math.min(3000, user + k * ((solved ? 1 : 0) - expected))));
}

export function themeNames(themes) {
  const skip = new Set(['short', 'long', 'veryLong', 'oneMove', 'crushing', 'advantage', 'mate']);
  return themes.filter((t) => !skip.has(t) && THEME_VN[t]).map((t) => THEME_VN[t]);
}
