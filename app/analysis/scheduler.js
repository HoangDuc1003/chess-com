// Drives Stockfish: one queue for move reviews, live analysis and bot moves, plus premoves and move grading.
import { Chess } from '../../lib/chess.js';
import { BAD } from '../core/config.js';
import { bot, botColor, cache, canUserMove, fenAtPly, flags, isOver, legalCount, need, S, userTurn, viewPly } from '../core/state.js';
import { save } from '../core/storage.js';
import { posKey } from '../core/util.js';
import { bookEntry, openingsReady } from '../content/openings.js';
import { Engine } from './engine.js';
import { classify, explain } from './review.js';
import { humanPick } from '../game/bots.js';
import { clockLeft, syncClock } from '../game/clock.js';
import { applyMove, onBoardMove } from '../game/game.js';
import { arrows, board, drawBadge, drawBoard } from '../ui/main-board.js';
import { noteOpening, renderPlay } from '../ui/play-pane.js';
import { warmOffline } from '../ui/pwa.js';
import { live, renderAll, renderBars, renderPill, renderSummary } from '../ui/render.js';
import { buzz, sfx } from '../ui/sound.js';

export const eng = new Engine();
eng.onStatus = () => { renderPill(); if (eng.ready) { renderAll(); schedule(); warmOffline(); } };
eng.onIdle = () => schedule();

/* ---------- engine results cache ---------- */
function cacheInfo(fen, i) {
  if (!i.pv || !i.score || i.bound) return;
  const k = posKey(fen);
  let e = cache.get(k);
  if (!e) { e = { lines: [], depth: 0, reviewed: false }; cache.set(k, e); }
  const idx = (i.multipv || 1) - 1;
  const cur = e.lines[idx];
  if (cur && cur.depth > i.depth) return;
  e.lines[idx] = { score: i.score, pv: i.pv, depth: i.depth };
  const present = e.lines.filter(Boolean);
  e.depth = Math.min(...present.map((l) => l.depth));
}
/* Enough depth and lines for this position to grade a move? */
function satisfied(fen, mpv, depth = 12) {
  if (legalCount(fen) === 0) return true;
  const e = cache.get(posKey(fen));
  if (!e) return false;
  if (e.reviewed) return true;
  return e.depth >= depth && e.lines.filter(Boolean).length >= Math.min(mpv, legalCount(fen));
}
export function ensure(fen, mpv = 2) { if (!satisfied(fen, mpv) && !need.some((n) => n.fen === fen)) need.push({ fen, mpv }); }
function positionCmd() {
  const u = S.hist.map((h) => h.uci);
  return u.length ? 'position startpos moves ' + u.join(' ') : 'position startpos';
}

/* ---------- scheduling ---------- */
/* Pick the next engine job: pending reviews first, then the bot's move, then live analysis for the player. */
export function schedule() {
  if (S.pz || !eng.ready || eng.busy) return;
  while (need.length && satisfied(need[0].fen, need[0].mpv)) need.shift();
  if (need.length) { runReview(need[0]); return; }
  if (finalizeReviews()) renderAll();
  if (S.result) {
    if (S.postReview && queuePostReview()) { schedule(); return; }
    if (S.postReview && !S.pending.size) { S.postReview = false; renderAll(); }
    if (!S.postReview && S.bestArrow) runViewAnalysis();
    return;
  }
  if (!S.started) return;
  if (!userTurn()) {
    if (S.paused || S.botPending) return;
    runBotMove();
    return;
  }
  if (flags().analysis || S.hintOn) runAnalysis();
}

function runReview(n) {
  const fen = n.fen;
  eng.run({
    kind: 'review', multipv: Math.min(n.mpv, legalCount(fen)), position: 'position fen ' + fen, go: 'go depth 16 movetime 450',
    onInfo: (i) => cacheInfo(fen, i),
    onBest: () => {
      const k = posKey(fen);
      const e = cache.get(k) || { lines: [], depth: 0 };
      e.reviewed = true;
      cache.set(k, e);
      if (S.postReview) renderSummary();
    },
  });
}

/* After the game: analyse the position on screen a little deeper, so its best move can be shown while reviewing. */
function runViewAnalysis() {
  const fen = fenAtPly(viewPly());
  const legal = legalCount(fen);
  if (!legal) return;
  const e = cache.get(posKey(fen));
  if (e && (e.viewed || (e.depth >= 18 && e.lines.filter(Boolean).length >= Math.min(3, legal)))) return;
  let last = 0;
  eng.run({
    kind: 'view', multipv: Math.min(3, legal), position: 'position fen ' + fen, go: 'go depth 18 movetime 2500',
    onInfo: (i) => {
      cacheInfo(fen, i);
      const now = performance.now();
      if (now - last > 400) { last = now; reviewUpdated(); }
    },
    onBest: () => { const x = cache.get(posKey(fen)); if (x) x.viewed = true; reviewUpdated(); },
  });
}
function reviewUpdated() {
  board.setArrows(arrows());
  if (S.tab === 'play') renderPlay();
}
/* The player moved through a finished game: analyse the new position instead. */
export function viewChanged() {
  if (!isOver() || S.pz) return;
  if (eng.is('view')) eng.cancel();
  else schedule();
}

/* Analyse a position soon (before anything but a running bot search) and resolve with its engine lines. */
export function analyzeSoon(fen, mpv = 3, timeout = 3500) {
  if (!legalCount(fen)) return Promise.resolve(null);
  if (!satisfied(fen, mpv)) {
    ensure(fen, mpv);
    if (eng.is('analysis') || eng.is('view')) eng.cancel();
    else schedule();
  }
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (satisfied(fen, mpv) || performance.now() - t0 > timeout) resolve(cache.get(posKey(fen)) || null);
      else setTimeout(tick, 80);
    };
    tick();
  });
}

function runAnalysis() {
  if (S.game.isGameOver()) return;
  const fen = S.game.fen();
  eng.run({
    kind: 'analysis', multipv: Math.min(3, legalCount(fen)), position: positionCmd(), go: 'go infinite',
    onInfo: (i) => { cacheInfo(fen, i); live(); },
  });
}

/* ---------- bot moves & premoves ---------- */
function runBotMove() {
  const b = bot();
  const fen = S.game.fen();
  const job = { kind: 'move', position: positionCmd(), lines: [] };
  // With a clock, Stockfish manages its own time (capped by the chosen think time); 250 ms is kept for overhead.
  const tm = S.clock ? `wtime ${Math.max(50, clockLeft('w') - 250) | 0} btime ${Math.max(50, clockLeft('b') - 250) | 0} winc ${S.clock.inc} binc ${S.clock.inc} ` : '';
  if (b.weak) { job.multipv = Math.min(5, legalCount(fen)); job.go = 'go depth ' + b.weak.depth; job.limited = false; }
  else if (b.uciElo) { job.limited = true; job.elo = Math.max(1320, Math.min(3190, b.uciElo)); job.fresh = true; job.multipv = 1; job.go = `go ${tm}movetime ${S.movetime}`; }
  else { job.limited = false; job.multipv = 1; job.go = `go ${tm}movetime ${b.ultraMs || S.movetime}`; }
  S.thinking = { depth: 0, nps: 0 };
  let botScore = null;
  job.onInfo = (i) => {
    S.thinking.depth = i.depth;
    if (i.nps) S.thinking.nps = i.nps;
    if (i.pv && i.score && !i.bound) {
      job.lines[(i.multipv || 1) - 1] = { score: i.score, pv: i.pv };
      if ((i.multipv || 1) === 1) botScore = i.score;
    }
    if (b.full) cacheInfo(fen, i);
    live();
  };
  job.onBest = (mv) => {
    let uci = mv;
    if (b.weak) {
      const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
      uci = humanPick(job.lines, legal, b.weak) || mv;
    }
    let minThink = b.weak ? 450 + Math.random() * 650 : 0;
    if (S.clock) minThink = Math.min(minThink, clockLeft(botColor()) / 40);
    const wait = Math.max(0, minThink - (performance.now() - job.startedAt));
    S.botPending = { uci, fen };
    setTimeout(() => commitBotMove(uci, fen, b.full && botScore), wait);
  };
  job.onCancel = () => { S.thinking = null; };
  eng.run(job);
  syncClock();
  renderBars();
}

function commitBotMove(uci, fen, score) {
  S.botPending = null;
  if (!uci || S.game.fen() !== fen || isOver() || userTurn()) { S.thinking = null; schedule(); return; }
  S.thinking = null;
  const rec = applyMove(uci, true);
  S.mateNote = score && score.mate > 1 ? { fen: S.game.fen(), n: score.mate - 1 } : null;
  if (flags().analysis) { S.pending.add(S.hist.length); ensure(rec.before, 2); }
  S.botCoachPly = null;
  noteOpening();
  renderAll();
  if (board.premoves.length) {
    // Let the bot's move show for a moment, then play the premove (if it is still legal).
    const n = S.hist.length;
    setTimeout(() => { if (S.hist.length === n) playPremove(); }, 110);
  }
  schedule();
}
/* Play the first queued premove if it is legal now, otherwise drop the queue. */
function playPremove() {
  const pm = board.takePremove();
  if (!pm || !canUserMove()) { board.cancelPremoves(); return false; }
  const m = S.game.moves({ verbose: true }).find((x) => x.from === pm.from && x.to === pm.to && (!x.promotion || x.promotion === (pm.promotion || 'q')));
  if (!m) { board.cancelPremoves(); drawBoard(null); return false; }
  onBoardMove({ from: m.from, to: m.to, promotion: m.promotion }, true);
  return true;
}

/* ---------- grading ---------- */
/* Grade every pending move whose positions (before and after) have been analysed. */
export function finalizeReviews() {
  let changed = false;
  for (const p of [...S.pending].sort((a, b) => a - b)) {
    const rec = S.hist[p - 1];
    if (!rec) { S.pending.delete(p); continue; }
    const before = cache.get(posKey(rec.before));
    const terminal = legalCount(rec.after) === 0;
    const after = terminal ? null : cache.get(posKey(rec.after));
    const okBefore = before && (before.reviewed || before.depth >= 10) && before.lines[0];
    const okAfter = terminal || (after && (after.reviewed || after.depth >= 10) && after.lines[0]);
    if (!okBefore || !okAfter) continue;
    const prevRec = S.hist[p - 2];
    const prev = prevRec && S.review[p - 1] ? { cls: S.review[p - 1].cls, to: prevRec.to, captured: prevRec.captured } : null;
    const ctx = {
      fenBefore: rec.before, uci: rec.uci,
      before: { lines: before.lines.filter(Boolean) },
      after: { lines: after ? after.lines.filter(Boolean) : [] },
      inBook: p <= 30 && openingsReady() && !!bookEntry(rec.after), prev,
    };
    const r = classify(ctx);
    const e = explain(ctx, r);
    S.review[p] = { cls: r.cls, acc: r.acc, loss: r.loss, bestUci: r.bestUci, bestCp: r.bestCp, afterCp: r.afterCp, title: e.title, text: e.text, tag: e.tag, line: e.line, bestSan: e.bestSan };
    S.pending.delete(p);
    changed = true;
    if (!S.postReview) onClassified(p, rec);
  }
  if (changed) { save(); drawBadge(); }
  return changed;
}

/* React to a newly graded move: coach, sounds, pause on a mistake in Learn mode. */
function onClassified(p, rec) {
  const rv = S.review[p];
  if (rec.color === S.userColor) {
    S.coachPly = p;
    if (rv.cls === 'brilliant' || rv.cls === 'great') { sfx('good'); buzz([15, 40, 15]); }
    if (rv.cls === 'blunder' || rv.cls === 'mistake') buzz(45);
    if (BAD.has(rv.cls) && flags().pause && !isOver() && p === S.hist.length && !userTurn()) S.paused = true;
  } else if (BAD.has(rv.cls) && p === S.hist.length) {
    S.botCoachPly = p;
  }
}

/* After the game: queue every ungraded move for review. */
function queuePostReview() {
  let queued = false;
  for (let p = 1; p <= S.hist.length; p++) {
    if (S.review[p]) continue;
    const rec = S.hist[p - 1];
    S.pending.add(p);
    if (!satisfied(rec.before, 2)) { ensure(rec.before, 2); queued = true; }
    if (legalCount(rec.after) && !satisfied(rec.after, 2)) { ensure(rec.after, 2); queued = true; }
  }
  if (!queued && finalizeReviews()) renderAll();
  return queued;
}
export function startPostReview() {
  S.postReview = true;
  eng.cancel();
  renderSummary();
  schedule();
}
