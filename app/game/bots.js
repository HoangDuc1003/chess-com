// Bot roster. Below 1320 (Stockfish's lowest UCI_Elo) the bots are custom:
// a shallow full-strength search with several candidate lines, then a human-like pick:
// sometimes a random move, otherwise a softmax over the candidates' scores.
// Their ratings are rough estimates, not measured.

export const BOTS = [
  { id: 'na', name: 'Bé Na', elo: 250, approx: true, icon: 'wp', tone: '#c98a5b',
    blurb: 'Mới học đi quân. Hay để quân treo, rất hợp để luyện ăn quân.',
    weak: { depth: 1, temp: 420, blunder: 0.45 } },
  { id: 'ti', name: 'Tí', elo: 400, approx: true, icon: 'bp', tone: '#8fa35a',
    blurb: 'Biết ăn quân nhưng hay quên bảo vệ Vua.',
    weak: { depth: 2, temp: 260, blunder: 0.3 } },
  { id: 'bin', name: 'Bin', elo: 600, approx: true, icon: 'wn', tone: '#5a8fa3',
    blurb: 'Thích tấn công sớm, thỉnh thoảng đi hớ.',
    weak: { depth: 3, temp: 160, blunder: 0.18 } },
  { id: 'mai', name: 'Chị Mai', elo: 800, approx: true, icon: 'bn', tone: '#a35a8f',
    blurb: 'Chơi theo nguyên tắc, mắc lỗi khi thế cờ phức tạp.',
    weak: { depth: 4, temp: 100, blunder: 0.1 } },
  { id: 'tu', name: 'Chú Tư', elo: 1000, approx: true, icon: 'wb', tone: '#a37a5a',
    blurb: 'Lão làng quán cà phê. Ít khi để quân treo.',
    weak: { depth: 6, temp: 60, blunder: 0.05 } },
  { id: 'minh', name: 'Minh', elo: 1200, approx: true, icon: 'bb', tone: '#5aa37a',
    blurb: 'Sinh viên câu lạc bộ cờ. Tính được đòn ngắn.',
    weak: { depth: 8, temp: 35, blunder: 0.025 } },
  { id: 'hung', name: 'Thầy Hùng', elo: 1500, icon: 'wr', tone: '#7a6fb0',
    blurb: 'Huấn luyện viên. Trừng phạt mọi nước đi lỏng lẻo.', uciElo: 1500 },
  { id: 'phong', name: 'Kiện tướng Phong', elo: 2000, icon: 'br', tone: '#b06f6f',
    blurb: 'Kỳ thủ mạnh cấp tỉnh.', uciElo: 2000 },
  { id: 'quan', name: 'Đại kiện tướng Quân', elo: 2500, icon: 'wq', tone: '#6f9fb0',
    blurb: 'Trình độ đại kiện tướng.', uciElo: 2500 },
  { id: 'sf3000', name: 'Stockfish 3000', elo: 3000, icon: 'bq', tone: '#4f5d6b',
    blurb: 'Máy ở mức 3000 Elo engine.', uciElo: 3000 },
  { id: 'full', name: 'Stockfish toàn lực', elo: null, icon: 'wk', tone: '#3b4a38',
    blurb: 'Không giới hạn sức mạnh.', full: true },
  { id: 'ultra', name: 'Siêu cấp', elo: null, icon: 'bk', tone: '#8a6a1f',
    blurb: 'Toàn lực, nghĩ 10 giây mỗi nước.', full: true, ultraMs: 10000 },
];

export const CUSTOM_ID = 'custom';

export function botById(id) { return BOTS.find((b) => b.id === id) || null; }

export function eloText(bot) {
  if (!bot) return '';
  if (bot.elo == null) return bot.ultraMs ? 'mạnh nhất' : 'toàn lực';
  return (bot.approx ? '≈' : '') + bot.elo;
}

/* Pick a move for a custom weak bot from engine candidate lines (scores from the bot's side). */
export function humanPick(lines, legalUcis, weak, rnd = Math.random) {
  if (legalUcis.length && rnd() < weak.blunder) return legalUcis[Math.floor(rnd() * legalUcis.length)];
  const scored = lines.filter((l) => l && l.pv && l.pv[0]).map((l) => ({ uci: l.pv[0], cp: scoreCp(l.score) }));
  if (!scored.length) return legalUcis[0] || null;
  const best = Math.max(...scored.map((s) => s.cp));
  const ws = scored.map((s) => Math.exp((s.cp - best) / weak.temp));
  const total = ws.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < scored.length; i++) { r -= ws[i]; if (r <= 0) return scored[i].uci; }
  return scored[0].uci;
}

export function scoreCp(score) {
  if (!score) return 0;
  if (score.mate != null) return score.mate > 0 ? 10000 - score.mate * 10 : -10000 - score.mate * 10;
  return score.cp;
}
