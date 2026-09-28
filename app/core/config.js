// App-wide constants: game modes, time controls, board themes, page titles, storage and engine sizing.

/* Saved game and preferences (localStorage). */
export const STORE = 'dau-stockfish-v2';

/* Stockfish hash size and threads, from the device's memory and cores. */
export const HASH_MB = (navigator.deviceMemory || 4) >= 8 ? 256 : 128;
export const THREADS = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));

/* Game modes: how much help the player gets. */
export const MODES = {
  learn: { vn: 'Học tập', desc: 'Nhận xét từng nước, thanh đánh giá, dừng lại khi bạn đi sai', analysis: true, evalBar: true, pause: true, hints: true, takebacks: true },
  friendly: { vn: 'Thân thiện', desc: 'Chấm điểm từng nước, có gợi ý và đi lại', analysis: true, evalBar: false, pause: false, hints: true, takebacks: true },
  challenge: { vn: 'Thử thách', desc: 'Không trợ giúp. Chấm điểm sau khi hết ván', analysis: false, evalBar: false, pause: false, hints: false, takebacks: false },
};

/* Move classes that count as errors (coach, pause in Learn mode). */
export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

/* Time controls (minutes | increment in seconds), grouped like the big sites. */
export const TCS = {
  none: { vn: 'Không giới hạn' },
  '1+0': { vn: '1 phút', base: 60e3, inc: 0 }, '1+1': { vn: '1 | 1', base: 60e3, inc: 1e3 }, '2+1': { vn: '2 | 1', base: 120e3, inc: 1e3 },
  '3+0': { vn: '3 phút', base: 180e3, inc: 0 }, '3+2': { vn: '3 | 2', base: 180e3, inc: 2e3 }, '5+0': { vn: '5 phút', base: 300e3, inc: 0 },
  '10+0': { vn: '10 phút', base: 600e3, inc: 0 }, '15+10': { vn: '15 | 10', base: 900e3, inc: 10e3 }, '30+0': { vn: '30 phút', base: 1800e3, inc: 0 },
};
export const TC_CATS = [['Bullet', '#e6b33a', ['1+0', '1+1', '2+1']], ['Blitz', '#f0c85a', ['3+0', '3+2', '5+0']], ['Rapid', '#7fb04a', ['10+0', '15+10', '30+0']]];

/* Board colours: id, name, light square, dark square. */
export const BOARD_THEMES = [['green', 'Xanh lá', '#ebecd0', '#739552'], ['brown', 'Nâu gỗ', '#f0d9b5', '#b58863'], ['blue', 'Xanh biển', '#dee3e6', '#8ca2ad'], ['slate', 'Đá xám', '#dcdcd6', '#8a8f8a']];

/* Title and subtitle of each section, shown in the header. */
export const PAGES = {
  play: ['Chơi với máy', 'Chấm điểm từng nước, có huấn luyện viên đi kèm'],
  puzz: ['Giải đố', 'Thế cờ thật từ lichess, độ khó theo điểm của bạn'],
  open: ['Khai cuộc', 'Tên khai cuộc, ý tưởng và mô phỏng từng nước'],
  dict: ['Từ điển lỗi', 'Bẫy khai cuộc, lỗi chiến thuật, mẫu chiếu hết'],
  bots: ['Đối thủ & cài đặt', 'Chọn bot, chế độ chơi, bàn cờ và âm thanh'],
};
