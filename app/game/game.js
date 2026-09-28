// Game flow: making moves, results, and the player's actions (new game, takeback, resign, hints, navigation).
import { Chess } from '../../lib/chess.js';
import { TCS } from '../core/config.js';
import { accuracy, bot, botColor, botStamp, canUserMove, flags, isOver, legalCount, need, S } from '../core/state.js';
import { save } from '../core/storage.js';
import { toast, uciObj } from '../core/util.js';
import { eng, ensure, schedule } from '../analysis/scheduler.js';
import { chargeMove, resetClock } from './clock.js';
import { pzDraw } from './puzzle.js';
import { board, drawBoard } from '../ui/main-board.js';
import { noteOpening } from '../ui/play-pane.js';
import { renderAll } from '../ui/render.js';
import { buzz, sfx, unlockAudio } from '../ui/sound.js';

/* Add a move to the game record (no sound, no redraw). */
export function pushMove(uci) {
  const before = S.game.fen();
  const m = S.game.move(uciObj(uci));
  const rec = { uci: m.from + m.to + (m.promotion || ''), san: m.san, before, after: S.game.fen(), color: m.color, captured: m.captured || null, piece: m.piece, from: m.from, to: m.to, flags: m.flags, promotion: m.promotion || null };
  S.hist.push(rec);
  return rec;
}
/* Play a move in the live game: clock, sound, result check, redraw. */
export function applyMove(uci, animate) {
  chargeMove(S.game.turn());
  const rec = pushMove(uci);
  S.view = null;
  S.showBest = null;
  const f = rec.flags;
  sfx(S.game.inCheck() ? 'check' : (f.includes('k') || f.includes('q')) ? 'castle' : rec.promotion ? 'promote' : rec.captured ? 'capture' : 'move');
  if (rec.captured || S.game.inCheck()) buzz(12);
  checkResult(false);
  drawBoard(animate ? { from: rec.from, to: rec.to } : null);
  return rec;
}
/* Detect the end of the game (quiet: no sound, e.g. when restoring). */
export function checkResult(quiet) {
  const g = S.game;
  let r = null;
  if (S.resigned) r = { winner: botColor(), reason: 'Bạn đã đầu hàng' };
  else if (S.flagged) {
    const w = S.flagged === 'w' ? 'b' : 'w';
    r = canMate(g, w) ? { winner: w, reason: S.flagged === S.userColor ? 'Bạn hết giờ' : 'Máy hết giờ' } : { winner: null, reason: 'Hết giờ, nhưng bên kia không đủ quân để chiếu hết' };
  }
  else if (g.isCheckmate()) r = { winner: g.turn() === 'w' ? 'b' : 'w', reason: 'Chiếu hết' };
  else if (g.isStalemate()) r = { winner: null, reason: 'Hòa pat' };
  else if (g.isInsufficientMaterial()) r = { winner: null, reason: 'Không đủ quân để chiếu hết' };
  else if (g.isThreefoldRepetition()) r = { winner: null, reason: 'Lặp lại thế cờ 3 lần' };
  else if (g.isDrawByFiftyMoves()) r = { winner: null, reason: 'Luật 50 nước' };
  const fresh = r && !S.result;
  S.result = r;
  if (r) board.cancelPremoves();
  if (fresh && !quiet) { S.overDismissed = false; sfx('end'); S.hintOn = false; }
}
/* Enough material to ever give mate (simplified: a pawn, rook or queen, or two minor pieces). */
function canMate(g, color) {
  let minors = 0;
  for (const row of g.board()) for (const p of row) {
    if (!p || p.color !== color) continue;
    if (p.type === 'p' || p.type === 'r' || p.type === 'q') return true;
    if (p.type === 'n' || p.type === 'b') minors++;
  }
  return minors >= 2;
}

/* The player made a move on the board. */
export function onBoardMove(mv, animated) {
  if (!canUserMove()) return;
  unlockAudio();
  if (!S.started) S.started = true;
  S.paused = false;
  S.hintOn = false;
  S.botCoachPly = null;
  S.mateNote = null;
  board.clearAnnotations();
  const rec = applyMove(mv.from + mv.to + (mv.promotion || ''), animated);
  eng.cancel();
  if (flags().analysis) {
    const p = S.hist.length;
    S.pending.add(p);
    if (p > 1 && !S.review[p - 1]) S.pending.add(p - 1);
    for (const q of [...S.pending].sort((a, b) => a - b)) {
      const r = S.hist[q - 1];
      if (!r) continue;
      ensure(r.before, 2);
      if (legalCount(r.after)) ensure(r.after, 2);
    }
  }
  S.coachPly = null;
  noteOpening();
  if (S.tab === 'bots') S.tab = 'play';
  renderAll();
  save();
  schedule();
}

/* Take the game back to `len` plies (takeback, retry). */
function rewindTo(len) {
  if (S.flagged) { toast('Ván đã hết giờ, không đi lại được'); return; }
  board.cancelPremoves();
  eng.cancel();
  S.botPending = null;
  S.thinking = null;
  while (S.hist.length > len) { S.hist.pop(); S.game.undo(); }
  for (const k of Object.keys(S.review)) if (+k > len) delete S.review[k];
  for (const p of [...S.pending]) if (p > len) S.pending.delete(p);
  need.length = 0;
  S.resigned = false; S.result = null; S.paused = false; S.hintOn = false;
  S.view = null; S.showBest = null; S.mateNote = null;
  S.coachPly = null; S.botCoachPly = null;
  checkResult(true);
  drawBoard(null);
  renderAll();
  save();
  schedule();
}
export function takeback() {
  if (!flags().takebacks || !S.hist.length) return;
  let len = S.hist.length;
  while (len > 0 && S.hist[len - 1].color !== S.userColor) len--;
  if (len > 0) len--;
  rewindTo(len);
}
export function retry(p) { rewindTo(p - 1); }
function resign() {
  if (isOver() || !S.started || !S.hist.length) return;
  eng.cancel();
  S.resigned = true;
  checkResult(false);
  drawBoard(null);
  renderAll();
  save();
}
export function newGame() {
  if (S.pz) { S.pz = null; board.clearAnnotations(); }
  eng.cancel();
  unlockAudio();
  S.game = new Chess();
  S.hist = [];
  S.review = {};
  S.pending.clear();
  need.length = 0;
  S.result = null; S.resigned = false; S.overDismissed = false; S.postReview = false;
  S.started = true; S.paused = false; S.botPending = null; S.thinking = null; S.mateNote = null;
  S.userColor = S.sideChoice === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : S.sideChoice;
  S.orientation = S.userColor;
  S.hintsUsed = 0; S.hintOn = false;
  S.view = null; S.showBest = null; S.coachPly = null; S.botCoachPly = null;
  S.gameId = Date.now();
  S.gameBot = botStamp(bot());
  resetClock(TCS[S.tc]);
  board.cancelPremoves();
  sfx('start');
  board.setOrientation(S.orientation);
  board.clearAnnotations();
  S.tab = 'play';
  drawBoard(null);
  renderAll();
  save();
  schedule();
}
export function toggleHint() {
  if (!flags().hints || !canUserMove() || !S.started) return;
  S.hintOn = !S.hintOn;
  if (S.hintOn) { S.hintsUsed++; S.tab = 'play'; }
  if (S.hintOn && !eng.is('analysis') && !eng.busy) schedule();
  renderAll();
  save();
}
/* Show ply p on the board (move list, arrows, wheel). */
export function go(p) {
  const n = S.hist.length;
  p = Math.max(0, Math.min(n, p));
  S.view = p === n ? null : p;
  if (S.showBest && S.view !== S.showBest - 1) S.showBest = null;
  drawBoard(null);
  renderAll();
}
/* Show the position before ply p with the engine's best move. */
export function showBest(p) {
  if (!S.review[p]) return;
  S.showBest = p;
  S.view = p - 1;
  drawBoard(null);
  renderAll();
}

export function flip() {
  if (S.pz) { board.setOrientation(board.orientation === 'w' ? 'b' : 'w'); pzDraw(null); return; }
  S.orientation = S.orientation === 'w' ? 'b' : 'w'; board.setOrientation(S.orientation); drawBoard(null); renderAll();
}
/* Resigning needs a second press within 3 seconds. */
let resignArmed = 0;
export function askResign() {
  if (isOver() || !S.started || !S.hist.length) return;
  if (Date.now() - resignArmed < 3000) { resignArmed = 0; resign(); return; }
  resignArmed = Date.now();
  toast('Bấm Đầu hàng lần nữa để xác nhận');
}

/* Keep one record per game (upsert by id), so reloads, takebacks and a later review update it instead of adding a new one. */
export function recordGame() {
  if (!S.started || !isOver() || !S.hist.length) return;
  if (!S.gameId) S.gameId = Date.now();
  const gb = S.gameBot || botStamp(bot());
  const r = S.result;
  const acc = accuracy(S.userColor);
  const rec = {
    id: S.gameId, t: Date.now(), b: gb.id, nm: gb.name, e: gb.e, c: S.userColor,
    r: r.winner == null ? 'd' : r.winner === S.userColor ? 'w' : 'l', why: r.reason, n: S.hist.length,
    acc: acc == null ? null : Math.round(acc * 10) / 10, m: S.mode, h: S.hintsUsed, tc: S.clock ? S.clock.tc : null,
  };
  const i = S.games.findIndex((g) => g.id === rec.id);
  if (i < 0) { S.games.push(rec); if (S.games.length > 100) S.games = S.games.slice(-100); return; }
  const old = S.games[i];
  if (old.r === rec.r && old.n === rec.n && old.acc === rec.acc && old.h === rec.h) return;
  rec.t = old.t;
  S.games[i] = rec;
}
