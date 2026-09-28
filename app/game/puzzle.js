// Puzzle mode: plays a lichess puzzle on the main board while the current game is paused.
import { Chess } from '../../lib/chess.js';
import { pzCanMove, S } from '../core/state.js';
import { save } from '../core/storage.js';
import { isPhone, kingSq, toast, uciObj } from '../core/util.js';
import { pickPuzzle, puzzlesReady, rateAfter } from '../content/puzzles.js';
import { eng, schedule } from '../analysis/scheduler.js';
import { board, drawBoard } from '../ui/main-board.js';
import { renderAll } from '../ui/render.js';
import { buzz, sfx, unlockAudio } from '../ui/sound.js';

function moveSound(g, m) {
  sfx(g.inCheck() ? 'check' : (m.flags.includes('k') || m.flags.includes('q')) ? 'castle' : m.promotion ? 'promote' : m.captured ? 'capture' : 'move');
}
export function startPuzzle() {
  if (!puzzlesReady()) { toast('Đang tải thế cờ…'); return; }
  const p = pickPuzzle({ rating: S.pzRating, chip: S.pzChip, level: S.pzLevel, seen: new Set(S.pzSeen) });
  if (!p) { toast('Không có thế cờ phù hợp với bộ lọc này'); return; }
  unlockAudio();
  eng.cancel();
  board.cancelPremoves();
  S.hintOn = false;
  const g = new Chess(p.fen);
  let setup;
  try { setup = g.move(uciObj(p.moves[0])); } catch { toast('Thế cờ lỗi, chọn thế khác'); return; }
  S.pz = { p, game: g, step: 1, color: g.turn(), status: 'solving', failed: false, usedHint: false, rated: false,
    delta: 0, last: { from: setup.from, to: setup.to }, badge: null, arrows: [], hint: 0, busy: true, msg: '' };
  S.pzSeen.push(p.id);
  if (S.pzSeen.length > 400) S.pzSeen = S.pzSeen.slice(-400);
  S.tab = 'puzz';
  board.clearAnnotations();
  board.setOrientation(S.pz.color);
  if (isPhone()) window.scrollTo({ top: 0, behavior: 'smooth' });
  // Show the position first, then play the opponent's move that sets up the puzzle.
  board.set({ fen: p.fen });
  board.setBadge(null);
  board.setArrows([]);
  renderAll();
  const pz = S.pz;
  setTimeout(() => {
    if (S.pz !== pz) return;
    pz.busy = false;
    moveSound(g, setup);
    pzDraw({ from: setup.from, to: setup.to });
    renderAll();
  }, 550);
}

export function pzDraw(anim) {
  const pz = S.pz;
  const g = pz.game;
  board.set({ fen: g.fen(), lastMove: pz.last, check: g.inCheck() ? kingSq(g, g.turn()) : null, animate: anim });
  board.setBadge(pz.badge);
  board.setArrows(pz.arrows);
}
function pzRate(solved) {
  const pz = S.pz;
  if (pz.rated) return;
  pz.rated = true;
  if (pz.usedHint) { pz.delta = 0; S.pzHist.push({ id: pz.p.id, rating: pz.p.rating, ok: solved, hint: true }); return; }
  const before = S.pzRating;
  S.pzRating = rateAfter(S.pzRating, pz.p.rating, solved, S.pzGames);
  pz.delta = S.pzRating - before;
  S.pzGames++;
  if (solved) { S.pzSolved++; S.pzStreak++; S.pzBest = Math.max(S.pzBest, S.pzStreak); } else S.pzStreak = 0;
  S.pzHist.push({ id: pz.p.id, rating: pz.p.rating, ok: solved, r: S.pzRating });
  if (S.pzHist.length > 30) S.pzHist = S.pzHist.slice(-30);
}
export function pzMove(mv) {
  const pz = S.pz;
  if (!pzCanMove()) return;
  const g = pz.game;
  const uci = mv.from + mv.to + (mv.promotion || '');
  const expected = pz.p.moves[pz.step];
  let m;
  try { m = g.move(uciObj(uci)); } catch { return; }
  const ok = uci === expected || g.isCheckmate();
  pz.arrows = [];
  if (!ok) {
    // Show the wrong move briefly, then take it back.
    pz.failed = true;
    pzRate(false);
    pz.busy = true;
    pz.badge = { sq: m.to, cls: 'miss' };
    pz.msg = `${m.san} chưa đúng. Thử lại nhé.`;
    moveSound(g, m);
    sfx('bad');
    buzz(40);
    pzDraw(null);
    renderAll();
    setTimeout(() => {
      if (S.pz !== pz) return;
      g.undo();
      pz.badge = null;
      pz.busy = false;
      pzDraw(null);
      renderAll();
    }, 700);
    return;
  }
  moveSound(g, m);
  pz.step++;
  pz.last = { from: m.from, to: m.to };
  pz.badge = { sq: m.to, cls: 'best' };
  pz.hint = 0;
  if (pz.step >= pz.p.moves.length || g.isCheckmate()) {
    pz.status = 'solved';
    pzRate(true);
    pz.msg = '';
    sfx('good');
    buzz([15, 40, 15]);
    pzDraw(null);
    renderAll();
    save();
    return;
  }
  pz.msg = `${m.san} đúng! Tiếp tục…`;
  pz.busy = true;
  pzDraw(null);
  renderAll();
  setTimeout(() => {
    if (S.pz !== pz) return;
    const r = g.move(uciObj(pz.p.moves[pz.step]));
    pz.step++;
    pz.last = { from: r.from, to: r.to };
    pz.badge = null;
    pz.busy = false;
    pz.msg = `Đối thủ đáp ${r.san}. Tìm nước tiếp theo.`;
    moveSound(g, r);
    pzDraw({ from: r.from, to: r.to });
    renderAll();
  }, 500);
}
export function pzHint() {
  const pz = S.pz;
  if (!pz || !pzCanMove()) return;
  const u = pz.p.moves[pz.step];
  pz.usedHint = true;
  pz.hint = Math.min(2, pz.hint + 1);
  pz.arrows = pz.hint === 1 ? [{ from: u.slice(0, 2), to: u.slice(0, 2), color: 'hint' }] : [{ from: u.slice(0, 2), to: u.slice(2, 4), color: 'hint' }];
  if (pz.hint === 1) { board.clearAnnotations(); board.userSquares.set(u.slice(0, 2), 'g'); board.render(); pz.arrows = []; }
  pz.msg = pz.hint === 1 ? 'Gợi ý: quân cần đi đã được tô xanh.' : 'Gợi ý: mũi tên xanh là nước đúng.';
  pzDraw(null);
  renderAll();
}
export function pzSolution() {
  const pz = S.pz;
  if (!pz || pz.status !== 'solving') return;
  pzRate(false);
  pz.status = 'shown';
  pz.busy = true;
  const g = pz.game;
  const play = () => {
    if (S.pz !== pz) return;
    if (pz.step >= pz.p.moves.length) { pz.busy = false; renderAll(); save(); return; }
    const r = g.move(uciObj(pz.p.moves[pz.step]));
    pz.step++;
    pz.last = { from: r.from, to: r.to };
    pz.badge = null;
    moveSound(g, r);
    pzDraw({ from: r.from, to: r.to });
    renderAll();
    setTimeout(play, 750);
  };
  play();
}
export function exitPuzzle() {
  S.pz = null;
  board.clearAnnotations();
  board.setOrientation(S.orientation);
  S.tab = S.started ? 'play' : 'bots';
  drawBoard(null);
  renderAll();
  schedule();
}
