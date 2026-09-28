import { Chess } from '../lib/chess.js';
import { BoardView, badgeSvg } from './board.js';
import { Engine } from './engine.js';
import { BOTS, botById, eloText, humanPick, scoreCp } from './bots.js';
import { classify, explain, CLASSES, winPct, fmtCp, pvSan, TAG_LESSON, VAL } from './review.js';
import { loadOpenings, openingsReady, analyzeLine, continuations, simulationLine, deepestName, sanLine, opening, guideFor, vnName, LIBRARY, LIBRARY_CATS, bookEntry, mainLine } from './openings.js';
import { LESSONS, LESSON_CATS, lessonById } from './lessons.js';
import { play as sfx, unlockAudio, setSound } from './sound.js';
import { loadPuzzles, puzzlesReady, puzzleCount, pickPuzzle, rateAfter, themeNames, PUZZLE_GROUPS, LEVELS, chipById } from './puzzles.js';

const $ = (s) => document.querySelector(s);
const STORE = 'dau-stockfish-v2';
const START_FEN = new Chess().fen();
const HASH_MB = (navigator.deviceMemory || 4) >= 8 ? 256 : 128;
const MODES = {
  learn: { vn: 'Học tập', desc: 'Nhận xét từng nước, thanh đánh giá, dừng lại khi bạn đi sai', analysis: true, evalBar: true, pause: true, hints: true, takebacks: true },
  friendly: { vn: 'Thân thiện', desc: 'Chấm điểm từng nước, có gợi ý và đi lại', analysis: true, evalBar: false, pause: false, hints: true, takebacks: true },
  challenge: { vn: 'Thử thách', desc: 'Không trợ giúp. Chấm điểm sau khi hết ván', analysis: false, evalBar: false, pause: false, hints: false, takebacks: false },
};
const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uciObj = (u) => { const o = { from: u.slice(0, 2), to: u.slice(2, 4) }; if (u.length > 4) o.promotion = u[4]; return o; };
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
const THREADS = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
const BOARD_THEMES = [['green', 'Xanh lá', '#ebecd0', '#739552'], ['brown', 'Nâu gỗ', '#f0d9b5', '#b58863'], ['blue', 'Xanh biển', '#dee3e6', '#8ca2ad'], ['slate', 'Đá xám', '#dcdcd6', '#8a8f8a']];
function buzz(pattern) { if (!S.haptics || !navigator.vibrate) return; try { navigator.vibrate(pattern); } catch {} }
let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const isPhone = () => window.matchMedia('(max-width: 979px)').matches;

/* ================= state ================= */
const S = {
  game: new Chess(),
  hist: [],
  userColor: 'w', orientation: 'w', sideChoice: 'w',
  botId: 'ti', customElo: 1600, mode: 'learn',
  movetime: 1000, sound: true, evalBarPref: true, pausePref: true, haptics: true, boardTheme: 'green',
  started: false, resigned: false, result: null, overDismissed: false,
  view: null, showBest: null,
  review: {}, pending: new Set(),
  hintOn: false, hintsUsed: 0,
  paused: false, botPending: null, thinking: null, mateNote: null,
  coachPly: null, botCoachPly: null,
  tab: 'bots', lesson: null, dictCat: 'all', preview: null,
  pz: null, pzRating: 800, pzGames: 0, pzSolved: 0, pzStreak: 0, pzBest: 0, pzChip: 'all', pzLevel: 'normal', pzSeen: [], pzHist: [],
  openCardClosed: null, lastOpenFam: null, libCat: 'e4e5',
  postReview: false,
  evalWhite: 20,
  games: [], gameId: 0, gameBot: null, navMini: false,
};
const cache = new Map();
const need = [];
const legalCache = new Map();
function legalCount(fen) {
  const k = posKey(fen);
  if (!legalCache.has(k)) legalCache.set(k, new Chess(fen).moves().length);
  return legalCache.get(k);
}
function flags() {
  const m = MODES[S.mode];
  return { ...m, evalBar: m.evalBar && S.evalBarPref, pause: m.pause && S.pausePref };
}
function bot() {
  if (S.botId === 'custom') return { id: 'custom', name: 'Tùy chỉnh', elo: S.customElo, icon: 'wr', tone: '#6b6f7a', blurb: 'Stockfish giới hạn ở mức Elo bạn chọn.', uciElo: S.customElo };
  return botById(S.botId) || BOTS[2];
}
const botColor = () => (S.userColor === 'w' ? 'b' : 'w');
const userTurn = () => S.game.turn() === S.userColor;
const viewPly = () => (S.view == null ? S.hist.length : S.view);
const fenAtPly = (p) => (p === 0 ? START_FEN : S.hist[p - 1].after);
const isOver = () => !!S.result;
function kingSq(g, color) {
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

/* ================= persistence ================= */
function snapshot() {
  return {
    moves: S.hist.map((h) => h.uci), userColor: S.userColor, orientation: S.orientation, sideChoice: S.sideChoice,
    botId: S.botId, customElo: S.customElo, mode: S.mode, movetime: S.movetime, sound: S.sound,
    evalBarPref: S.evalBarPref, pausePref: S.pausePref, haptics: S.haptics, boardTheme: S.boardTheme, started: S.started, resigned: S.resigned,
    review: S.review, hintsUsed: S.hintsUsed, tab: S.tab,
    pzRating: S.pzRating, pzGames: S.pzGames, pzSolved: S.pzSolved, pzStreak: S.pzStreak, pzBest: S.pzBest,
    pzChip: S.pzChip, pzLevel: S.pzLevel, pzSeen: S.pzSeen.slice(-400), pzHist: S.pzHist.slice(-30),
    games: S.games.slice(-100), gameId: S.gameId, gameBot: S.gameBot, navMini: S.navMini,
  };
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch {} }
function load() { try { const r = localStorage.getItem(STORE); return r ? JSON.parse(r) : null; } catch { return null; } }
function restore(d) {
  if (!d || typeof d !== 'object') return;
  const pick = (k, ok) => { if (ok(d[k])) S[k] = d[k]; };
  pick('userColor', (v) => v === 'w' || v === 'b');
  pick('orientation', (v) => v === 'w' || v === 'b');
  pick('sideChoice', (v) => ['w', 'b', 'r'].includes(v));
  pick('botId', (v) => v === 'custom' || !!botById(v));
  pick('customElo', (v) => Number.isFinite(v) && v >= 1320 && v <= 3190);
  pick('mode', (v) => !!MODES[v]);
  pick('movetime', (v) => [500, 1000, 2000, 5000].includes(v));
  for (const k of ['sound', 'evalBarPref', 'pausePref', 'haptics', 'started', 'resigned']) pick(k, (v) => typeof v === 'boolean');
  pick('boardTheme', (v) => ['green', 'brown', 'blue', 'slate'].includes(v));
  pick('hintsUsed', (v) => Number.isFinite(v) && v >= 0);
  pick('tab', (v) => ['play', 'open', 'puzz', 'dict', 'bots'].includes(v));
  for (const k of ['pzRating', 'pzGames', 'pzSolved', 'pzStreak', 'pzBest']) pick(k, (v) => Number.isFinite(v) && v >= 0 && v <= 100000);
  pick('pzChip', (v) => typeof v === 'string' && chipById(v).id === v);
  pick('pzLevel', (v) => ['easy', 'normal', 'hard'].includes(v));
  pick('pzSeen', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));
  pick('pzHist', (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object'));
  pick('games', (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && ['w', 'd', 'l'].includes(x.r)));
  pick('gameId', (v) => Number.isFinite(v) && v >= 0);
  pick('gameBot', (v) => v && typeof v === 'object' && typeof v.name === 'string');
  pick('navMini', (v) => typeof v === 'boolean');
  if (Array.isArray(d.moves)) {
    for (const u of d.moves) {
      try { pushMove(u); } catch { break; }
    }
  }
  if (d.review && typeof d.review === 'object') {
    for (const [k, v] of Object.entries(d.review)) if (+k <= S.hist.length && v && CLASSES[v.cls]) S.review[k] = v;
  }
  checkResult(true);
}

/* ================= moves ================= */
function pushMove(uci) {
  const before = S.game.fen();
  const m = S.game.move(uciObj(uci));
  const rec = { uci: m.from + m.to + (m.promotion || ''), san: m.san, before, after: S.game.fen(), color: m.color, captured: m.captured || null, piece: m.piece, from: m.from, to: m.to, flags: m.flags, promotion: m.promotion || null };
  S.hist.push(rec);
  return rec;
}
function applyMove(uci, animate) {
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
function checkResult(quiet) {
  const g = S.game;
  let r = null;
  if (S.resigned) r = { winner: botColor(), reason: 'Bạn đã đầu hàng' };
  else if (g.isCheckmate()) r = { winner: g.turn() === 'w' ? 'b' : 'w', reason: 'Chiếu hết' };
  else if (g.isStalemate()) r = { winner: null, reason: 'Hòa pat' };
  else if (g.isInsufficientMaterial()) r = { winner: null, reason: 'Không đủ quân để chiếu hết' };
  else if (g.isThreefoldRepetition()) r = { winner: null, reason: 'Lặp lại thế cờ 3 lần' };
  else if (g.isDrawByFiftyMoves()) r = { winner: null, reason: 'Luật 50 nước' };
  const fresh = r && !S.result;
  S.result = r;
  if (fresh && !quiet) { S.overDismissed = false; sfx('end'); S.hintOn = false; }
}

/* ================= engine ================= */
const eng = new Engine();
eng.onStatus = () => { renderPill(); if (eng.ready) { renderAll(); schedule(); warmOffline(); } };
let swOn = false;
function warmOffline() {
  if (!swOn) return;
  const files = eng.threads > 1 ? ['engine/stockfish-mt.js', 'engine/stockfish-mt.wasm'] : ['engine/stockfish.js', 'engine/stockfish.wasm'];
  navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage({ type: 'warm', urls: files.map((f) => new URL(f, document.baseURI).href) })).catch(() => {});
}
eng.onIdle = () => schedule();

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
function satisfied(fen, mpv, depth = 12) {
  if (legalCount(fen) === 0) return true;
  const e = cache.get(posKey(fen));
  if (!e) return false;
  if (e.reviewed) return true;
  return e.depth >= depth && e.lines.filter(Boolean).length >= Math.min(mpv, legalCount(fen));
}
function ensure(fen, mpv = 2) { if (!satisfied(fen, mpv) && !need.some((n) => n.fen === fen)) need.push({ fen, mpv }); }
function positionCmd() {
  const u = S.hist.map((h) => h.uci);
  return u.length ? 'position startpos moves ' + u.join(' ') : 'position startpos';
}

function schedule() {
  if (S.pz || !eng.ready || eng.busy) return;
  while (need.length && satisfied(need[0].fen, need[0].mpv)) need.shift();
  if (need.length) { runReview(need[0]); return; }
  if (finalizeReviews()) renderAll();
  if (S.result) {
    if (S.postReview && queuePostReview()) { schedule(); return; }
    if (S.postReview && !S.pending.size) { S.postReview = false; renderAll(); }
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

function runAnalysis() {
  if (S.game.isGameOver()) return;
  const fen = S.game.fen();
  eng.run({
    kind: 'analysis', multipv: Math.min(3, legalCount(fen)), position: positionCmd(), go: 'go infinite',
    onInfo: (i) => { cacheInfo(fen, i); live(); },
  });
}

function runBotMove() {
  const b = bot();
  const fen = S.game.fen();
  const job = { kind: 'move', position: positionCmd(), lines: [] };
  if (b.weak) { job.multipv = Math.min(5, legalCount(fen)); job.go = 'go depth ' + b.weak.depth; job.limited = false; }
  else if (b.uciElo) { job.limited = true; job.elo = Math.max(1320, Math.min(3190, b.uciElo)); job.fresh = true; job.multipv = 1; job.go = 'go movetime ' + S.movetime; }
  else { job.limited = false; job.multipv = 1; job.go = 'go movetime ' + (b.ultraMs || S.movetime); }
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
    const minThink = b.weak ? 450 + Math.random() * 650 : 0;
    const wait = Math.max(0, minThink - (performance.now() - job.startedAt));
    S.botPending = { uci, fen };
    setTimeout(() => commitBotMove(uci, fen, b.full && botScore), wait);
  };
  job.onCancel = () => { S.thinking = null; };
  eng.run(job);
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
  schedule();
}

/* ================= review ================= */
function finalizeReviews() {
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
function startPostReview() {
  S.postReview = true;
  eng.cancel();
  renderSummary();
  schedule();
}

/* ================= user actions ================= */
function canUserMove() { return S.view == null && !isOver() && userTurn() && !S.botPending; }
function onBoardMove(mv, animated) {
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

function rewindTo(len) {
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
function takeback() {
  if (!flags().takebacks || !S.hist.length) return;
  let len = S.hist.length;
  while (len > 0 && S.hist[len - 1].color !== S.userColor) len--;
  if (len > 0) len--;
  rewindTo(len);
}
function retry(p) { rewindTo(p - 1); }
function resign() {
  if (isOver() || !S.started || !S.hist.length) return;
  eng.cancel();
  S.resigned = true;
  checkResult(false);
  drawBoard(null);
  renderAll();
  save();
}
function newGame() {
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
  board.setOrientation(S.orientation);
  board.clearAnnotations();
  S.tab = 'play';
  drawBoard(null);
  renderAll();
  save();
  schedule();
}
function toggleHint() {
  if (!flags().hints || !canUserMove() || !S.started) return;
  S.hintOn = !S.hintOn;
  if (S.hintOn) { S.hintsUsed++; S.tab = 'play'; }
  if (S.hintOn && !eng.is('analysis') && !eng.busy) schedule();
  renderAll();
  save();
}
function go(p) {
  const n = S.hist.length;
  p = Math.max(0, Math.min(n, p));
  S.view = p === n ? null : p;
  if (S.showBest && S.view !== S.showBest - 1) S.showBest = null;
  drawBoard(null);
  renderAll();
}
function showBest(p) {
  if (!S.review[p]) return;
  S.showBest = p;
  S.view = p - 1;
  drawBoard(null);
  renderAll();
}

/* ================= board ================= */
const board = new BoardView($('#board'), {
  interactive: true,
  canMove: () => (S.pz ? pzCanMove() : canUserMove()),
  myColor: () => (S.pz ? S.pz.color : S.userColor),
  onMove: (mv, animated) => (S.pz ? pzMove(mv, animated) : onBoardMove(mv, animated)),
  onBlocked: () => { if (!S.pz && S.view != null) go(S.hist.length); },
  onIllegal: () => sfx('illegal'),
  onInteract: () => unlockAudio(),
});
function drawBoard(anim) {
  if (S.pz) { pzDraw(anim); return; }
  const vp = viewPly();
  const fen = fenAtPly(vp);
  const rec = S.hist[vp - 1];
  const g = new Chess(fen);
  board.set({ fen, lastMove: rec ? { from: rec.from, to: rec.to } : null, check: g.inCheck() ? kingSq(g, g.turn()) : null, animate: anim });
  drawBadge();
  board.setArrows(arrows());
}
function drawBadge() {
  if (S.pz) { board.setBadge(S.pz.badge || null); return; }
  const vp = viewPly();
  const rec = S.hist[vp - 1];
  const rv = S.review[vp];
  const showAll = flags().analysis || isOver();
  board.setBadge(rec && rv && showAll ? { sq: rec.to, cls: rv.cls } : null);
}
function arrows() {
  if (S.pz) return S.pz.arrows || [];
  const list = [];
  const vp = viewPly();
  if (S.showBest && vp === S.showBest - 1) {
    const rv = S.review[S.showBest];
    if (rv && rv.bestUci) list.push({ from: rv.bestUci.slice(0, 2), to: rv.bestUci.slice(2, 4), color: 'best' });
  }
  if (S.hintOn && S.view == null && userTurn()) {
    const e = cache.get(posKey(S.game.fen()));
    if (e && e.lines[0] && e.depth >= 8) { const u = e.lines[0].pv[0]; list.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: 'hint' }); }
  }
  if (S.preview) list.push({ from: S.preview.slice(0, 2), to: S.preview.slice(2, 4), color: 'preview' });
  return list;
}

/* ================= rendering ================= */
let raf = 0;
function live() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const changed = finalizeReviews();
    renderEval();
    renderBars();
    board.setArrows(arrows());
    if (changed) renderAll();
    else if (S.tab === 'play') renderHintBox();
  });
}

function renderPill() {
  const pill = $('#enginePill');
  pill.dataset.s = eng.status;
  $('#engineText').textContent = eng.status === 'ready' ? `${eng.flavor} sẵn sàng`
    : eng.status === 'error' ? 'Không tải được engine. Hãy tải lại trang.'
    : eng.status === 'fallback' ? 'Đang tải bản dự phòng…' : 'Đang tải Stockfish…';
}

function evalWhiteFor(fen) {
  const g = new Chess(fen);
  if (g.isCheckmate()) return g.turn() === 'w' ? -10000 : 10000;
  if (g.isGameOver()) return 0;
  const e = cache.get(posKey(fen));
  if (!e || !e.lines[0]) return null;
  const cp = scoreCp(e.lines[0].score);
  return fen.split(' ')[1] === 'w' ? cp : -cp;
}
function renderEval() {
  const show = !S.pz && (flags().evalBar || (isOver() && Object.keys(S.review).length > 0));
  const bar = $('#evalBar');
  bar.hidden = !show;
  document.querySelectorAll('.pbar').forEach((p) => p.classList.toggle('noeb', !show));
  if (!show) return;
  const v = evalWhiteFor(fenAtPly(viewPly()));
  if (v != null) S.evalWhite = v;
  const cp = S.evalWhite;
  const pct = Math.abs(cp) >= 9000 ? (cp > 0 ? 100 : 0) : Math.max(4, Math.min(96, winPct(cp)));
  bar.classList.toggle('flip', S.orientation === 'b');
  $('#ebFill').style.height = pct + '%';
  const num = $('#ebNum');
  num.textContent = fmtCp(Math.abs(cp)).replace('+', '');
  const whiteAhead = cp >= 0;
  const atBottom = (whiteAhead && S.orientation === 'w') || (!whiteAhead && S.orientation === 'b');
  num.className = 'eb-num ' + (atBottom ? 'low' : 'high');
  num.style.color = whiteAhead ? '#403d39' : '#f1f0ee';
}

function capsHtml(color) {
  const opp = color === 'w' ? 'b' : 'w';
  const g = new Chess(fenAtPly(viewPly()));
  const cnt = (c) => { const o = { p: 0, n: 0, b: 0, r: 0, q: 0 }; for (const row of g.board()) for (const p of row) if (p && p.color === c && p.type !== 'k') o[p.type]++; return o; };
  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const mine = cnt(color), theirs = cnt(opp);
  let out = '';
  for (const t of ['p', 'b', 'n', 'r', 'q']) {
    const miss = Math.max(0, START[t] - theirs[t]);
    for (let i = 0; i < miss; i++) out += `<span class="cp ${opp}${t}${i === 0 && out ? ' gap' : ''}"></span>`;
  }
  const mat = (o) => Object.entries(o).reduce((s, [t, n]) => s + VAL[t] * n, 0);
  const diff = mat(mine) - mat(theirs);
  if (diff > 0) out += `<em>+${diff}</em>`;
  return out;
}
function barHtml(color) {
  if (color === S.userColor) {
    const turn = S.started && !isOver() && userTurn() && S.view == null;
    return `<div class="ava" style="background:#5d5a55"><i class="${S.userColor}p"></i></div>
      <div class="who"><div class="nm"><b>Bạn</b>${S.hintsUsed ? `<span class="rt">· ${S.hintsUsed} gợi ý</span>` : ''}</div><div class="caps">${capsHtml(color)}</div></div>
      ${turn ? '<span class="chip on">Lượt bạn</span>' : ''}`;
  }
  const b = bot();
  let chip = '';
  const mn = S.mateNote && S.mateNote.fen === S.game.fen() && S.view == null ? S.mateNote : null;
  if (mn) chip = `<span class="chip mate">Chiếu hết sau ${mn.n} nước</span>`;
  else if (S.thinking || S.botPending) {
    const t = S.thinking || { depth: 0 };
    const nps = t.nps ? ` · ${t.nps >= 1e6 ? (t.nps / 1e6).toFixed(1).replace('.', ',') + 'M' : Math.round(t.nps / 1000) + 'k'} thế/s` : '';
    chip = `<span class="chip think"><span class="dots"><b></b><b></b><b></b></span>${t.depth ? 'độ sâu ' + t.depth + nps : 'đang nghĩ'}</span>`;
  } else if (S.paused) chip = '<span class="chip">Đang chờ bạn</span>';
  return `<div class="ava" style="background:${b.tone}"><i class="${b.icon}"></i></div>
    <div class="who"><div class="nm"><b>${esc(b.name)}</b><span class="rt">(${eloText(b)})</span></div><div class="caps">${capsHtml(color)}</div></div>${chip}`;
}
function pzBarHtml(top) {
  const pz = S.pz;
  if (top) {
    return `<div class="ava" style="background:#6a5a9e"><i class="${pz.color === 'w' ? 'bq' : 'wq'}"></i></div>
      <div class="who"><div class="nm"><b>Giải đố</b><span class="rt">độ khó ${pz.p.rating}</span></div><div class="caps"><span class="rt" style="color:var(--muted);font-size:12.5px">#${esc(pz.p.id)}</span></div></div>`;
  }
  const chip = pz.status === 'solved' ? `<span class="chip on" style="background:var(--green);color:#fff">Đã giải</span>`
    : pz.status === 'shown' ? '<span class="chip">Đã xem lời giải</span>'
    : pzCanMove() ? '<span class="chip on">Lượt bạn</span>' : '';
  return `<div class="ava" style="background:#5d5a55"><i class="${pz.color}p"></i></div>
    <div class="who"><div class="nm"><b>Bạn</b><span class="rt">điểm giải đố ${S.pzRating}</span></div><div class="caps"><span class="rt" style="color:var(--muted);font-size:12.5px">Chuỗi đúng: ${S.pzStreak}</span></div></div>${chip}`;
}
function renderBars() {
  if (S.pz) { $('#barTop').innerHTML = pzBarHtml(true); $('#barBottom').innerHTML = pzBarHtml(false); return; }
  const top = S.orientation === 'w' ? 'b' : 'w';
  $('#barTop').innerHTML = barHtml(top);
  $('#barBottom').innerHTML = barHtml(top === 'w' ? 'b' : 'w');
}

/* ---------- opening strip & info ---------- */
let openMemo = { key: null, val: null };
function openingInfo(ply) {
  const ucis = S.hist.slice(0, ply).map((h) => h.uci);
  const k = ucis.join(' ');
  if (openMemo.key === k) return openMemo.val;
  const val = openingsReady() ? analyzeLine(ucis) : null;
  openMemo = { key: k, val };
  return val;
}
function renderStrip() {
  const vp = viewPly();
  const el = $('#ostrip');
  if (S.pz) {
    el.innerHTML = `<span class="eco">Đố</span><span class="on">Giải đố · tìm nước tốt nhất cho ${S.pz.color === 'w' ? 'Trắng' : 'Đen'}</span><span class="off">Ván cờ đang tạm dừng</span>`;
    return;
  }
  if (!openingsReady()) { el.innerHTML = '<span class="off">Đang tải dữ liệu khai cuộc…</span>'; return; }
  if (vp === 0) { el.innerHTML = '<span class="eco">—</span><span class="on">Vị trí ban đầu</span>'; return; }
  const a = openingInfo(vp);
  if (!a || !a.current) { el.innerHTML = '<span class="on">Khai cuộc chưa có tên</span>'; return; }
  const o = opening(a.current.id);
  const out = !a.inBook ? `<span class="off">Ra khỏi lý thuyết · nước ${Math.floor(a.lastBookPly / 2) + 1}</span>` : '';
  el.innerHTML = `<span class="eco">${o.eco}</span><span class="on" title="${esc(o.name)}">${esc(vnName(o.name))}${o.name.includes(':') ? ` <span style="color:var(--muted);font-weight:500">· ${esc(o.name.split(':')[1].trim())}</span>` : ''}</span>${out}`;
}

/* ---------- play pane ---------- */
function sanHtml(san, color) {
  const m = san.match(/^([KQRBN])(.*)$/);
  return m ? `<i class="fig ${color}${m[1].toLowerCase()}"></i>${esc(m[2])}` : esc(san);
}
function accuracy(color) {
  const a = [];
  S.hist.forEach((h, i) => { const r = S.review[i + 1]; if (r && h.color === color) a.push(r.acc); });
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
function coachHtml() {
  const f = flags();
  const cav = `<div class="cav"><i class="wq"></i></div>`;
  const wrap = (inner) => `<div class="coach">${cav}<div class="bubble">${inner}</div></div>`;
  if (!S.started) {
    return wrap(`<div class="bt">Chào bạn!</div><p>Chọn đối thủ và chế độ ở tab <b>Đối thủ</b>, rồi bấm <b>Chơi</b>. ${f.analysis ? 'Mình sẽ nhận xét từng nước đi của bạn.' : ''}</p><div class="ba"><button type="button" class="go" data-act="tab" data-tab="bots">Chọn đối thủ</button></div>`);
  }
  if (isOver()) {
    const r = S.result;
    const t = r.winner == null ? 'Ván cờ hòa' : r.winner === S.userColor ? 'Bạn thắng!' : `${esc(bot().name)} thắng`;
    return wrap(`<div class="bt">${t}</div><p>${esc(r.reason)}. ${Object.keys(S.review).length < S.hist.length ? 'Bấm <b>Chấm điểm</b> để xem đánh giá từng nước.' : 'Dùng các nút mũi tên để xem lại ván cờ.'}</p><div class="ba">${Object.keys(S.review).length < S.hist.length ? '<button type="button" class="go" data-act="postreview">Chấm điểm ván đấu</button>' : ''}<button type="button" data-act="summary">Xem tổng kết</button><button type="button" data-act="new">Ván mới</button></div>`);
  }
  if (!f.analysis) return wrap(`<div class="bt">Chế độ Thử thách</div><p>Không có trợ giúp trong ván. Sau khi hết ván, bạn có thể chấm điểm cả ván đấu.</p>`);
  if (S.botCoachPly && S.botCoachPly === S.hist.length && userTurn()) {
    const rv = S.review[S.botCoachPly];
    const rec = S.hist[S.botCoachPly - 1];
    return wrap(`<div class="bt">${badgeSvg(rv.cls, 22)}Máy vừa đi ${CLASSES[rv.cls].vn.toLowerCase()}: ${esc(rec.san)}</div><p>Đây là cơ hội cho bạn. Hãy tìm nước tốt nhất!</p><div class="ba">${f.hints ? '<button type="button" class="go" data-act="hint">Gợi ý</button>' : ''}</div>`);
  }
  const p = S.coachPly;
  if (p && S.review[p] && S.hist[p - 1]) {
    const rv = S.review[p];
    const rec = S.hist[p - 1];
    const bad = BAD.has(rv.cls);
    let extra = '';
    if (rv.cls === 'book') {
      const a = openingInfo(p);
      if (a && a.current) extra = ` (${esc(vnName(opening(a.current.id).name))})`;
    }
    const lessonId = rv.tag && TAG_LESSON[rv.tag];
    const L = lessonId && lessonById(lessonId);
    const btns = [];
    if (bad && f.takebacks) btns.push(`<button type="button" class="go" data-act="retry" data-p="${p}">Thử lại</button>`);
    if (rv.bestUci && rv.bestUci !== rec.uci && !['book', 'forced'].includes(rv.cls)) btns.push(`<button type="button" data-act="best" data-p="${p}">Xem nước tốt nhất</button>`);
    if (L) btns.push(`<button type="button" data-act="lesson" data-id="${L.id}" title="${esc(L.title)}">Bài học: ${esc(L.title.split(':')[0])}</button>`);
    if (S.paused) btns.push(`<button type="button" data-act="continue">Tiếp tục</button>`);
    return wrap(`<div class="bt">${badgeSvg(rv.cls, 22)}${esc(rv.title)}${extra}</div><p>${esc(rv.text)}</p>${bad && rv.line ? `<p class="line">Diễn biến: ${esc(rv.line)}</p>` : ''}${btns.length ? `<div class="ba">${btns.join('')}</div>` : ''}`);
  }
  if (userTurn() && S.hist.length === 0) return wrap(`<div class="bt">Đến lượt bạn</div><p>Đi nước đầu tiên. Gợi ý: chiếm trung tâm với e4 hoặc d4.</p>`);
  if (!userTurn()) return wrap(`<div class="bt">${esc(bot().name)} đang nghĩ…</div><p>Trong lúc chờ, bạn có thể vẽ mũi tên bằng chuột phải để lên kế hoạch.</p>`);
  return wrap(`<div class="bt">Đến lượt bạn</div><p>Kiểm tra trước khi đi: chiếu, ăn quân, đe dọa, của cả hai bên.</p>`);
}
function hintBoxHtml() {
  if (!S.hintOn || !userTurn() || S.view != null) return '';
  const fen = S.game.fen();
  const e = cache.get(posKey(fen));
  if (!e || !e.lines[0] || e.depth < 8) return `<div class="hintbox"><div class="lab">Gợi ý <small>đang tìm…</small></div></div>`;
  const stm = fen.split(' ')[1];
  const rows = e.lines.filter(Boolean).slice(0, 3).map((l) => {
    const cp = scoreCp(l.score);
    const wcp = stm === 'w' ? cp : -cp;
    const line = pvSan(fen, l.pv, 6).split(' ');
    return `<div class="hl"><span class="ev ${wcp >= 0 ? 'w' : 'b'}">${fmtCp(wcp)}</span><span class="pv"><b>${esc(line[0] || '')}</b> ${esc(line.slice(1).join(' '))}</span></div>`;
  }).join('');
  return `<div class="hintbox"><div class="lab">Gợi ý của Stockfish <small>độ sâu ${e.depth}</small></div><div class="hlines">${rows}</div><p class="note">Mũi tên xanh là nước tốt nhất. Điểm số tính theo phía Trắng.</p></div>`;
}
function renderHintBox() {
  const el = $('#hintSlot');
  if (el) el.innerHTML = hintBoxHtml();
}
function movesHtml() {
  if (!S.hist.length) return '<div class="moves"><div class="empty">Chưa có nước đi nào.</div></div>';
  const vp = viewPly();
  const showCls = flags().analysis || isOver();
  let h = '';
  for (let i = 0; i < S.hist.length; i += 2) {
    const alt = (i / 2) % 2 === 1 ? ' row-alt' : '';
    h += `<div class="n${alt}">${i / 2 + 1}.</div>`;
    for (const j of [i, i + 1]) {
      const r = S.hist[j];
      if (!r) { h += `<div class="${alt}"></div>`; continue; }
      const rv = S.review[j + 1];
      h += `<div class="m${alt}${vp === j + 1 ? ' cur' : ''}" data-act="goto" data-p="${j + 1}">${rv && showCls ? badgeSvg(rv.cls, 16) : ''}${sanHtml(r.san, r.color)}</div>`;
    }
  }
  return `<div class="moves">${h}</div>`;
}
/* Opening card: in learning mode, show which opening is on the board, with a diagram. */
const openDiag = document.createElement('div');
openDiag.className = 'od';
const openDiagBoard = new BoardView(openDiag, { coords: false });
const GENERIC_OPENING = /^(King's Pawn Game|Queen's Pawn Game|King's Knight Opening|Indian Defense)$/;
function openCardData() {
  if (S.mode !== 'learn' || !openingsReady() || !S.started) return null;
  const vp = viewPly();
  if (!vp) return null;
  const a = openingInfo(vp);
  if (!a || !a.current) return null;
  if (!a.inBook && vp - a.lastBookPly > 8) return null;
  const o = opening(a.current.id);
  const fam = vnName(o.name);
  if (S.openCardClosed === fam) return null;
  return { ev: a.current, o, fam, inBook: a.inBook };
}
function openCardHtml() {
  const d = openCardData();
  if (!d) return '';
  const rec = S.hist[d.ev.ply - 1];
  const who = rec.color === S.userColor ? 'Bạn đang triển khai' : 'Máy vừa chọn';
  const idea = guideFor(d.o.name).idea.split(/(?<=\.)\s/)[0];
  const fresh = d.ev.ply === S.hist.length && S.view == null;
  return `<div class="ocard2${fresh ? ' fresh' : ''}"><div class="odslot"></div><div class="oi"><div class="lab">${who} <small>${esc(d.o.eco)}</small></div><b>${esc(d.fam)}</b><span class="en" title="${esc(d.o.name)}">${esc(d.o.name)}</span><p>${esc(idea)}</p><button type="button" class="lk" data-act="tab" data-tab="open">Xem ý tưởng và mô phỏng →</button></div><button type="button" class="x" data-act="hideopen" data-fam="${esc(d.fam)}" aria-label="Ẩn thẻ khai cuộc">✕</button></div>`;
}
function mountOpenCard() {
  const slot = document.querySelector('#panePlay .odslot');
  const d = slot && openCardData();
  if (!d) return;
  slot.appendChild(openDiag);
  const fen = fenAtPly(d.ev.ply);
  const rec = S.hist[d.ev.ply - 1];
  const g = new Chess(fen);
  openDiagBoard.setOrientation(S.orientation);
  openDiagBoard.set({ fen, lastMove: { from: rec.from, to: rec.to }, check: g.inCheck() ? kingSq(g, g.turn()) : null });
  const next = mainLine(fen, 1)[0];
  openDiagBoard.setArrows(next ? [{ from: next.uci.slice(0, 2), to: next.uci.slice(2, 4), color: 'preview', width: 0.18 }] : []);
}
function noteOpening() {
  if (S.mode !== 'learn' || !openingsReady()) return;
  const a = openingInfo(S.hist.length);
  if (!a || !a.current || a.current.ply !== S.hist.length) return;
  const name = opening(a.current.id).name;
  const fam = vnName(name);
  if (fam === S.lastOpenFam) return;
  S.lastOpenFam = fam;
  S.openCardClosed = null;
  if (!GENERIC_OPENING.test(name.split(':')[0])) toast('Khai cuộc: ' + fam, 2600);
}

function renderPlay() {
  const ua = accuracy(S.userColor), ba = accuracy(botColor());
  const accRow = ua != null || ba != null
    ? `<div class="accrow"><span>Độ chính xác của bạn <b>${ua != null ? ua.toFixed(1).replace('.', ',') : '—'}</b></span><span>Máy <b>${ba != null ? ba.toFixed(1).replace('.', ',') : '—'}</b></span></div>` : '';
  const pm0 = $('#playMoves');
  const wasAtEnd = !pm0 || pm0.scrollTop + pm0.clientHeight >= pm0.scrollHeight - 8;
  const prevTop = pm0 ? pm0.scrollTop : 0;
  $('#panePlay').innerHTML = `<div class="play-top">${openCardHtml()}${coachHtml()}<div id="hintSlot">${hintBoxHtml()}</div>${accRow}</div><div class="play-moves" id="playMoves">${movesHtml()}</div>`;
  mountOpenCard();
  const pm = $('#playMoves');
  const cur = pm.querySelector('.m.cur');
  if (S.view == null) { if (wasAtEnd) pm.scrollTop = pm.scrollHeight; else pm.scrollTop = prevTop; }
  else if (cur) {
    pm.scrollTop = prevTop;
    const top = cur.offsetTop - pm.offsetTop;
    if (top < pm.scrollTop || top + cur.offsetHeight > pm.scrollTop + pm.clientHeight) pm.scrollTop = top - pm.clientHeight / 2;
  }
}

/* ---------- simulation (mini board) ---------- */
class Sim {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'sim';
    this.el.innerHTML = `<div class="sim-head"><div><b class="st"></b><br><small class="ss"></small></div><button type="button" class="sx" aria-label="Đóng mô phỏng">✕</button></div>
      <div class="mini"><div class="mb" style="width:100%;height:100%"></div></div>
      <div class="cap"></div><div class="chips2"></div>
      <div class="simctl"><button class="btn" type="button" data-s="first" aria-label="Về đầu">⏮</button><button class="btn" type="button" data-s="prev" aria-label="Lùi">◀</button><button class="btn go" type="button" data-s="play" aria-label="Chạy">▶</button><button class="btn" type="button" data-s="next" aria-label="Tiến">▶|</button></div>`;
    this.board = new BoardView(this.el.querySelector('.mb'), { coords: true });
    this.timer = null;
    this.onClose = null;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]');
      if (b) {
        const s = b.dataset.s;
        if (s === 'play') { this.timer ? this.stop() : this.play(); return; }
        this.stop();
        if (s === 'first') this.jump(0);
        else if (s === 'prev') this.jump(this.i - 1);
        else if (s === 'next') this.jump(this.i + 1, true);
        return;
      }
      const c = e.target.closest('[data-i]');
      if (c) { this.stop(); this.jump(+c.dataset.i); return; }
      if (e.target.closest('.sx')) { this.stop(); this.onClose && this.onClose(); }
    });
  }
  load({ fen = START_FEN, line, title, sub = '', orient = 'w', speed = 1100, notes = null, openingNames = false, autoplay = true }) {
    this.stop();
    this.line = line; this.notes = notes || {}; this.speed = speed; this.openingNames = openingNames;
    const g = new Chess(fen);
    this.fens = [fen];
    this.moves = [];
    this.nums = [];
    for (const s of line) {
      const n = +g.fen().split(' ')[5], turn = g.turn();
      let m;
      try { m = g.move(s.uci ? uciObj(s.uci) : s.san); } catch { break; }
      this.nums.push(turn === 'w' ? `${n}.` : `${n}…`);
      this.fens.push(g.fen());
      this.moves.push({ from: m.from, to: m.to, san: m.san, color: m.color, n: s.n ?? -1 });
    }
    this.el.querySelector('.st').textContent = title;
    this.el.querySelector('.ss').textContent = sub;
    this.board.setOrientation(orient);
    let chips = '';
    this.moves.forEach((m, i) => {
      if (m.color === 'w' || i === 0) chips += `<span class="num">${this.nums[i]}</span>`;
      chips += `<button type="button" data-i="${i + 1}">${sanHtml(m.san, m.color)}</button>`;
    });
    this.el.querySelector('.chips2').innerHTML = chips;
    this.i = 0;
    this.draw(false);
    if (autoplay) setTimeout(() => this.play(), 500);
  }
  draw(anim) {
    const i = this.i;
    const m = this.moves[i - 1];
    const g = new Chess(this.fens[i]);
    this.board.set({ fen: this.fens[i], lastMove: m ? { from: m.from, to: m.to } : null, check: g.inCheck() ? kingSq(g, g.turn()) : null, animate: anim && m ? { from: m.from, to: m.to } : null });
    const nx = this.moves[i];
    this.board.setArrows(nx ? [{ from: nx.from, to: nx.to, color: 'preview', width: 0.13 }] : []);
    this.el.querySelectorAll('.chips2 button').forEach((b) => b.classList.toggle('cur', +b.dataset.i === i));
    const cap = this.el.querySelector('.cap');
    if (i === 0) cap.innerHTML = this.notes.start ? esc(this.notes.start) : 'Vị trí xuất phát. Bấm ▶ để xem diễn biến; mũi tên xanh dương là nước tiếp theo.';
    else {
      const note = this.notes[i - 1];
      let text = `<b>${this.nums[i - 1]} ${esc(m.san)}</b>`;
      if (note) text += ` — ${esc(note)}`;
      else if (this.openingNames) {
        let id = -1;
        for (let k = 0; k < i; k++) if (this.moves[k].n >= 0) id = this.moves[k].n;
        if (id >= 0) { const o = opening(id); text += ` — ${esc(vnName(o.name))}<br><small style="color:var(--muted)">${esc(o.eco)} · ${esc(o.name)}</small>`; }
      }
      if (i === this.moves.length && g.isCheckmate()) text += ' <b style="color:#ff8a7a">Chiếu hết!</b>';
      if (i === this.moves.length && g.isStalemate()) text += ' <b style="color:#efd98a">Hòa pat!</b>';
      cap.innerHTML = text;
    }
    this.el.querySelector('[data-s="play"]').textContent = this.timer ? '⏸' : '▶';
  }
  jump(i, anim) {
    i = Math.max(0, Math.min(this.moves.length, i));
    const a = anim !== undefined ? anim : i === this.i + 1;
    this.i = i;
    this.draw(a);
  }
  play() {
    if (this.timer) return;
    if (this.i >= this.moves.length) this.jump(0, false);
    this.timer = setInterval(() => {
      if (this.i >= this.moves.length) { this.stop(); return; }
      this.jump(this.i + 1, true);
      if (this.i >= this.moves.length) this.stop();
    }, this.speed);
    this.draw(false);
  }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const b = this.el.querySelector('[data-s="play"]');
    if (b) b.textContent = '▶';
  }
}
const simOpen = new Sim();
const simDict = new Sim();
let simOpenOn = false;
simOpen.onClose = () => { simOpenOn = false; renderOpen(); };
simDict.onClose = () => { S.lesson = null; renderDict(); };

/* ---------- opening pane ---------- */
function renderOpen() {
  const pane = $('#paneOpen');
  if (!openingsReady()) { pane.innerHTML = '<p class="note">Đang tải dữ liệu khai cuộc…</p>'; return; }
  const vp = viewPly();
  const fen = fenAtPly(vp);
  const a = openingInfo(vp);
  const cur = a && a.current ? opening(a.current.id) : null;
  let html = '';
  if (cur) {
    const gd = guideFor(cur.name);
    html += `<div class="ocard"><div class="lab">Khai cuộc đang chơi <small>${cur.eco}</small></div><h3>${esc(gd.vn)}</h3><div class="en">${esc(cur.name)}</div><p>${esc(gd.idea)}</p>
      <div class="plans"><div><h4>Trắng muốn</h4><ul>${gd.white.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h4>Đen muốn</h4><ul>${gd.black.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <div class="tip"><b>Mẹo:</b> ${esc(gd.tip)}</div></div>`;
  } else {
    html += `<div class="ocard"><div class="lab">Khai cuộc</div><h3>Bắt đầu ván cờ</h3><p>Ba nguyên tắc khai cuộc: chiếm trung tâm bằng tốt, phát triển Mã và Tượng, nhập thành sớm. Chọn một nước bên dưới để xem mô phỏng.</p></div>`;
  }
  if (a && a.events.length) {
    html += `<div class="lab">Diễn biến khai cuộc</div><div class="tl">${a.events.map((ev) => {
      const rec = S.hist[ev.ply - 1];
      const me = rec.color === S.userColor;
      const n = Math.floor((ev.ply - 1) / 2) + 1;
      return `<button type="button" data-act="goto" data-p="${ev.ply}"><span class="who2${me ? ' me' : ''}">${n}${rec.color === 'w' ? '.' : '…'} ${esc(rec.san)} · ${me ? 'Bạn' : 'Máy'}</span><span class="nm2">${esc(vnName(opening(ev.id).name))}</span></button>`;
    }).join('')}</div>`;
  }
  const conts = continuations(fen, 6);
  const g = new Chess(fen);
  const whose = g.turn() === S.userColor ? 'Lượt bạn · các nước lý thuyết' : `${bot().name} có thể đáp`;
  if (conts.length) {
    html += `<div class="lab">Hướng đi tiếp theo <small>${esc(whose)}</small></div><div class="conts">${conts.map((c) => {
      const o = c.id >= 0 ? opening(c.id) : null;
      return `<button type="button" class="cont" data-act="simcont" data-uci="${c.uci}"><span class="mv">${sanHtml(c.san, g.turn())}</span><span class="cn"><b>${o ? esc(vnName(o.name)) : 'Nước lý thuyết'}</b><small>${o ? esc(o.name) : ''}</small></span><span class="ct">${c.count} biến ▶</span></button>`;
    }).join('')}</div>`;
  } else if (vp > 0) {
    html += `<div class="ocard"><p>Thế cờ này đã ra khỏi sách khai cuộc${a && a.lastBookPly ? ` từ nước ${Math.floor(a.lastBookPly / 2) + 1}` : ''}. Từ đây hãy chơi theo nguyên tắc và tính toán.</p>${cur ? `<div><button type="button" class="btn" data-act="simmain">Xem tuyến chính của ${esc(vnName(cur.name))}</button></div>` : ''}</div>`;
  }
  html += '<div id="simSlotOpen"></div>';
  html += `<div class="lab">Thư viện khai cuộc <small>${LIBRARY.length} tuyến chính · bấm để xem mô phỏng</small></div>
    <div class="cats">${LIBRARY_CATS.map((c) => `<button type="button" data-act="libcat" data-v="${c.id}" aria-pressed="${S.libCat === c.id}">${esc(c.vn)}</button>`).join('')}</div>
    <div class="libs">${LIBRARY.map((L, i) => (L.cat === S.libCat ? `<button type="button" data-act="simlib" data-i="${i}" title="${L.side === 'w' ? 'Góc nhìn Trắng' : 'Góc nhìn Đen'}"><span class="sd ${L.side}"></span>${esc(L.vn)}</button>` : '')).join('')}</div>`;
  pane.innerHTML = html;
  if (simOpenOn) $('#simSlotOpen').appendChild(simOpen.el);
}
function openSim(opts) {
  simOpenOn = true;
  S.tab = 'open';
  renderTabs();
  renderOpen();
  simOpen.load(opts);
  requestAnimationFrame(() => simOpen.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

/* ---------- dictionary pane ---------- */
function renderDict() {
  const pane = $('#paneDict');
  const L = S.lesson && lessonById(S.lesson);
  if (L) {
    const cat = LESSON_CATS.find((c) => c.id === L.cat);
    pane.innerHTML = `<div><button type="button" class="btn ghost" data-act="lessonback">← Tất cả bài</button></div>
      <div class="lv ocard"><span class="lesson"><span class="tg">${esc(cat.vn)}</span></span><h3>${esc(L.title)}</h3><p>${esc(L.summary)}</p></div>
      <div id="simSlotDict"></div>
      <div class="lv"><div class="avoid"><b>Cách tránh:</b> ${esc(L.avoid)}</div></div>`;
    $('#simSlotDict').appendChild(simDict.el);
    return;
  }
  const list = LESSONS.filter((x) => S.dictCat === 'all' || x.cat === S.dictCat);
  pane.innerHTML = `<p class="note">Các lỗi và bẫy hay gặp nhất, mỗi bài có mô phỏng từng nước. Khi bạn mắc lỗi giống bài nào, huấn luyện viên sẽ gợi ý mở bài đó.</p>
    <div class="cats">${[{ id: 'all', vn: 'Tất cả' }, ...LESSON_CATS].map((c) => `<button type="button" data-act="cat" data-id="${c.id}" aria-pressed="${S.dictCat === c.id}">${esc(c.vn)}</button>`).join('')}</div>
    <div class="lessons">${list.map((x) => `<button type="button" class="lesson" data-act="lesson" data-id="${x.id}"><span class="tg">${esc(LESSON_CATS.find((c) => c.id === x.cat).vn)} · ${x.loser === 'w' ? 'Trắng' : 'Đen'} mắc lỗi</span><b>${esc(x.title)}</b><small>${esc(x.summary)}</small></button>`).join('')}</div>`;
}
function openLesson(id) {
  const L = lessonById(id);
  if (!L) return;
  S.lesson = id;
  S.tab = 'dict';
  renderTabs();
  renderDict();
  const fen = L.fen || START_FEN;
  simDict.load({ fen, line: L.moves.split(' ').map((san) => ({ san })), title: L.title, sub: `Nhìn từ phía ${L.loser === 'w' ? 'Trắng' : 'Đen'} (bên mắc lỗi)`, orient: L.loser, speed: 1700, notes: L.notes });
  $('#sideBody').scrollTop = 0;
}

/* ---------- bots pane ---------- */
function renderBots() {
  const b = bot();
  const f = MODES[S.mode];
  const won = new Set(S.games.filter((g) => g.r === 'w').map((g) => g.b));
  const botBtn = (x) => `<button type="button" data-act="bot" data-id="${x.id}" aria-pressed="${S.botId === x.id}" title="${esc(x.name)}${won.has(x.id) ? ' · đã thắng' : ''}"><span class="ava" style="background:${x.tone}"><i class="${x.icon}"></i></span><small>${eloText(x)}</small>${won.has(x.id) ? '<em class="won" aria-hidden="true">✓</em>' : ''}</button>`;
  const custom = { id: 'custom', name: 'Tùy chỉnh', tone: '#6b6f7a', icon: 'wr' };
  $('#paneBots').innerHTML = `
    <div class="botsel"><span class="ava" style="background:${b.tone}"><i class="${b.icon}"></i></span><div><b>${esc(b.name)}</b> <span class="rt">${eloText(b)}</span><p>${esc(b.blurb)}</p></div></div>
    <div class="botgrid">${BOTS.map(botBtn).join('')}<button type="button" data-act="bot" data-id="custom" aria-pressed="${S.botId === 'custom'}" title="Tùy chỉnh Elo"><span class="ava" style="background:${custom.tone}"><i class="${custom.icon}"></i></span><small>Tùy chỉnh</small></button></div>
    ${S.botId === 'custom' ? `<div class="opt"><div class="lab">Elo tùy chỉnh <small>${S.customElo}</small></div><input type="range" id="customElo" min="1320" max="3190" step="10" value="${S.customElo}" aria-label="Elo tùy chỉnh"></div>` : ''}
    <div class="lab">Cầm quân</div>
    <div class="seg">${[['w', 'Trắng', 'wk'], ['r', 'Ngẫu nhiên', 'wn'], ['b', 'Đen', 'bk']].map(([v, t, ic]) => `<button type="button" data-act="side" data-v="${v}" aria-pressed="${S.sideChoice === v}"><i class="k ${ic}"></i>${t}</button>`).join('')}</div>
    <div class="lab">Chế độ</div>
    <div class="seg">${Object.entries(MODES).map(([k, m]) => `<button type="button" data-act="mode" data-v="${k}" aria-pressed="${S.mode === k}">${m.vn}<small>${m.desc}</small></button>`).join('')}</div>
    <button type="button" class="btn go big" data-act="new">Chơi</button>
    <details class="adv"><summary>Tùy chọn khác</summary>
      <div class="opt"><div class="lab">Thời gian nghĩ của máy <small>${b.weak ? 'bot dưới 1320 tự điều chỉnh' : b.ultraMs ? 'Siêu cấp: 10 giây' : ''}</small></div>
        <div class="segs">${[[500, '0,5 s'], [1000, '1 s'], [2000, '2 s'], [5000, '5 s']].map(([v, t]) => `<button type="button" data-act="time" data-v="${v}" aria-pressed="${S.movetime === v}" ${b.weak || b.ultraMs ? 'disabled' : ''}>${t}</button>`).join('')}</div></div>
      <div class="opt"><label class="sw"><input type="checkbox" id="optSound" ${S.sound ? 'checked' : ''}> Âm thanh</label>
        <label class="sw"><input type="checkbox" id="optEval" ${S.evalBarPref ? 'checked' : ''} ${f.evalBar ? '' : 'disabled'}> Thanh đánh giá (chế độ Học tập)</label>
        <label class="sw"><input type="checkbox" id="optPause" ${S.pausePref ? 'checked' : ''} ${f.pause ? '' : 'disabled'}> Dừng lại khi tôi đi sai (chế độ Học tập)</label>
        ${'vibrate' in navigator ? `<label class="sw"><input type="checkbox" id="optHaptics" ${S.haptics ? 'checked' : ''}> Rung khi ăn quân và khi đi sai</label>` : ''}</div>
      <div class="opt"><div class="lab">Màu bàn cờ</div>
        <div class="themes">${BOARD_THEMES.map(([id, vn, a, b2]) => `<button type="button" data-act="theme" data-v="${id}" aria-pressed="${S.boardTheme === id}"><span class="sw4" style="--a:${a};--b:${b2}"></span>${vn}</button>`).join('')}</div></div>
      <div class="opt"><div class="lab">Cài như ứng dụng</div>
        <p class="note">Android, máy tính: bấm <b>Cài ứng dụng</b> ở góc trên (nếu trình duyệt hỗ trợ). iPhone: mở bằng Safari, bấm Chia sẻ rồi <b>Thêm vào MH chính</b>. Sau lần mở đầu tiên, trang chơi được cả khi không có mạng.</p></div>
    </details>
    <p class="fine">Elo của các bot dưới 1320 là ước lượng. Từ 1320 trở lên dùng thang Elo engine của Stockfish, thường cao hơn Elo online. Đổi bot hoặc chế độ có hiệu lực ngay; bấm Chơi để bắt đầu ván mới. Engine: Stockfish 17.1 (GPLv3)${eng.threads > 1 ? `, đang chạy ${eng.threads} luồng` : ''}. Khai cuộc: lichess chess-openings (CC0). Quân cờ: bộ cburnett (CC BY-SA 3.0).</p>`;
}

/* ---------- summary overlay ---------- */
function renderSummary() {
  const over = $('#over');
  if (!isOver() || S.overDismissed) { over.hidden = true; return; }
  const r = S.result;
  const title = r.winner == null ? 'Hòa' : r.winner === S.userColor ? 'Bạn thắng!' : `${bot().name} thắng`;
  const ua = accuracy(S.userColor), ba = accuracy(botColor());
  const total = S.hist.length;
  const done = Object.keys(S.review).length;
  const counts = (color) => {
    const c = {};
    S.hist.forEach((h, i) => { const rv = S.review[i + 1]; if (rv && h.color === color) c[rv.cls] = (c[rv.cls] || 0) + 1; });
    return c;
  };
  const cu = counts(S.userColor), cb = counts(botColor());
  const rows = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']
    .map((k) => `<span class="n">${cu[k] || 0}</span><span>${badgeSvg(k, 18)}</span><span>${CLASSES[k].vn}</span><span class="n">${cb[k] || 0}</span>`).join('');
  const reviewing = S.postReview && done < total;
  over.innerHTML = `<div class="sum" role="dialog" aria-labelledby="sumTitle">
    <div class="sum-head"><h2 id="sumTitle">${esc(title)}</h2><p>${esc(r.reason)}${S.hintsUsed ? ` · dùng ${S.hintsUsed} gợi ý` : ''}</p></div>
    <div class="sum-body">
      <div class="acc2"><div><small>Độ chính xác của bạn</small><b>${ua != null ? ua.toFixed(1).replace('.', ',') : '—'}</b></div><div><small>${esc(bot().name)}</small><b>${ba != null ? ba.toFixed(1).replace('.', ',') : '—'}</b></div></div>
      ${done ? `<div class="ctab"><span class="h">Bạn</span><span></span><span></span><span class="h">Máy</span>${rows}</div>` : '<p class="note">Ván này chưa được chấm điểm.</p>'}
      ${reviewing ? `<div><div class="lab">Đang chấm điểm <small>${done}/${total} nước</small></div><div class="progress"><i style="width:${(done / Math.max(1, total)) * 100}%"></i></div></div>` : ''}
      <div class="sum-acts">
        ${done < total && !reviewing ? '<button type="button" class="btn go" data-act="postreview">Chấm điểm ván đấu</button>' : `<button type="button" class="btn" data-act="closesum">Xem lại ván</button>`}
        <button type="button" class="btn ${done < total && !reviewing ? '' : 'go'}" data-act="new">Ván mới</button>
      </div>
      ${done < total && !reviewing ? '<button type="button" class="btn ghost" data-act="closesum">Xem lại bàn cờ</button>' : ''}
    </div></div>`;
  over.hidden = false;
}

/* ================= puzzles ================= */
function moveSound(g, m) {
  sfx(g.inCheck() ? 'check' : (m.flags.includes('k') || m.flags.includes('q')) ? 'castle' : m.promotion ? 'promote' : m.captured ? 'capture' : 'move');
}
function startPuzzle() {
  if (!puzzlesReady()) { toast('Đang tải thế cờ…'); return; }
  const p = pickPuzzle({ rating: S.pzRating, chip: S.pzChip, level: S.pzLevel, seen: new Set(S.pzSeen) });
  if (!p) { toast('Không có thế cờ phù hợp với bộ lọc này'); return; }
  unlockAudio();
  eng.cancel();
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
function pzCanMove() { const pz = S.pz; return !!pz && pz.status === 'solving' && !pz.busy && pz.game.turn() === pz.color; }
function pzDraw(anim) {
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
function pzMove(mv) {
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
function pzHint() {
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
function pzSolution() {
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
function exitPuzzle() {
  S.pz = null;
  board.clearAnnotations();
  board.setOrientation(S.orientation);
  S.tab = S.started ? 'play' : 'bots';
  drawBoard(null);
  renderAll();
  schedule();
}
function renderPuzz() {
  const pane = $('#panePuzz');
  if (!puzzlesReady()) { pane.innerHTML = '<p class="note">Đang tải thế cờ…</p>'; return; }
  const pz = S.pz;
  const dots = S.pzHist.slice(-16).map((h) => `<i class="${h.ok ? 'ok' : 'no'}${h.hint ? ' hint' : ''}" title="Độ khó ${h.rating}"></i>`).join('');
  let html = `<div class="pzstats"><div><small>Điểm giải đố</small><b>${S.pzRating}</b></div><div><small>Chuỗi đúng</small><b>${S.pzStreak}</b></div><div><small>Đã giải đúng</small><b>${S.pzSolved}/${S.pzGames}</b></div></div>`;
  if (dots) html += `<div class="pzdots" aria-label="Kết quả gần đây">${dots}</div>`;
  if (pz) {
    const side = pz.color === 'w' ? 'Trắng' : 'Đen';
    const tags = themeNames(pz.p.themes).map((t) => `<span>${esc(t)}</span>`).join('');
    const delta = pz.rated && !pz.usedHint ? ` <span class="delta ${pz.delta >= 0 ? 'up' : 'down'}">${pz.delta >= 0 ? '+' : ''}${pz.delta}</span>` : '';
    let body;
    if (pz.status === 'solving') {
      body = `<h3>Lượt ${side}: tìm nước tốt nhất</h3><p>${esc(pz.msg || 'Đối thủ vừa đi. Hãy tìm nước mạnh nhất.')}</p>
        <div class="acts"><button type="button" class="btn go" data-act="pzhint">Gợi ý</button><button type="button" class="btn" data-act="pzsol">Xem lời giải</button><button type="button" class="btn" data-act="pznext">Bỏ qua</button></div>`;
    } else {
      const title = pz.status === 'shown' ? 'Lời giải' : pz.failed || pz.usedHint ? 'Đã giải xong' : 'Chính xác!';
      const sol = pvSan(new Chess(pz.p.fen).fen(), pz.p.moves, 12);
      body = `<h3>${title}${delta}</h3><p>${pz.usedHint ? 'Có dùng gợi ý nên thế này không tính điểm.' : pz.failed || pz.status === 'shown' ? 'Lần sau sẽ tốt hơn. Xem lại các nước bằng lời giải bên dưới.' : 'Bạn tìm ra toàn bộ lời giải ngay lần đầu.'}</p>
        <p class="sol">${esc(sol)}</p><div class="tags">${tags}</div>
        <div class="acts"><button type="button" class="btn go" data-act="pznext">Thế tiếp theo</button><button type="button" class="btn" data-act="pzexit">Về ván cờ</button></div>`;
    }
    html += `<div class="pzcard ${pz.status}${pz.failed ? ' failed' : ''}"><div class="lab"><span>Thế cờ <span class="pid">#${esc(pz.p.id)}</span></span><small>độ khó ${pz.p.rating}</small></div>${body}</div>`;
    if (pz.status === 'solving') html += '<button type="button" class="btn ghost" data-act="pzexit">← Về ván cờ (ván đang chơi được giữ nguyên)</button>';
  } else {
    html += `<div class="ocard"><h3>Giải thế cờ</h3><p>${puzzleCount().toLocaleString('vi-VN')} thế cờ thật từ lichess: chiếu hết, đòn chiến thuật, khai cuộc, trung cuộc, tàn cuộc. Độ khó tự điều chỉnh theo điểm của bạn. Ván cờ đang chơi được tạm dừng và giữ nguyên.</p><button type="button" class="btn go big" data-act="pzstart">Bắt đầu giải</button></div>`;
  }
  html += `<div class="lab">Độ khó</div><div class="segs">${LEVELS.map((l) => `<button type="button" data-act="pzlevel" data-v="${l.id}" aria-pressed="${S.pzLevel === l.id}">${l.vn}</button>`).join('')}</div>`;
  html += PUZZLE_GROUPS.map((g) => `<div class="chipgrp"><div class="lab">${esc(g.vn)}</div><div class="cats">${g.chips.map((c) => `<button type="button" data-act="pzchip" data-v="${c.id}" aria-pressed="${S.pzChip === c.id}">${esc(c.vn)}</button>`).join('')}</div></div>`).join('');
  html += '<p class="fine">Thế cờ lấy từ cơ sở dữ liệu giải đố của lichess.org (CC0). Mỗi thế bắt đầu bằng nước đi của đối thủ; bạn tìm đòn đáp trả. Ở nước chiếu hết cuối cùng, mọi nước chiếu hết đều được tính đúng.</p>';
  pane.innerHTML = html;
}

/* ---------- footer, tabs, all ---------- */
function renderFooter() {
  const f = flags();
  const n = S.hist.length, vp = viewPly();
  const set = (cmd, prop, val) => document.querySelectorAll(`[data-cmd="${cmd}"]`).forEach((b) => { b[prop] = val; });
  set('first', 'disabled', vp === 0);
  set('prev', 'disabled', vp === 0);
  set('next', 'disabled', vp >= n);
  set('last', 'disabled', vp >= n);
  set('hint', 'hidden', !f.hints);
  set('hint', 'disabled', !canUserMove() || !S.started);
  document.querySelectorAll('[data-hint-label]').forEach((el) => { el.textContent = S.hintOn ? 'Ẩn gợi ý' : 'Gợi ý'; });
  set('undo', 'hidden', !f.takebacks);
  set('undo', 'disabled', !n);
  set('resign', 'disabled', isOver() || !S.started || !n);
  if (S.pz) {
    for (const c of ['first', 'prev', 'next', 'last', 'undo', 'resign']) set(c, 'disabled', true);
    set('hint', 'hidden', false);
    set('hint', 'disabled', !pzCanMove());
    document.querySelectorAll('[data-hint-label]').forEach((el) => { el.textContent = 'Gợi ý'; });
  }
}
function renderTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  document.querySelectorAll('.side-body .pane').forEach((p) => { p.hidden = p.dataset.panel !== S.tab; });
}
function renderAll() {
  recordGame();
  renderNav();
  renderBars();
  renderEval();
  renderStrip();
  renderTabs();
  if (S.tab === 'play') renderPlay();
  else if (S.tab === 'open') renderOpen();
  else if (S.tab === 'dict') { if (!$('#paneDict').innerHTML || !S.lesson) renderDict(); }
  else if (S.tab === 'bots') renderBots();
  else if (S.tab === 'puzz') renderPuzz();
  renderFooter();
  renderSummary();
  board.setArrows(arrows());
  save();
}

/* ================= events ================= */
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) goTab(b.dataset.tab);
});
$('#ostrip').addEventListener('click', () => { S.tab = 'open'; renderAll(); });
$('#ostrip').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.tab = 'open'; renderAll(); } });

function onAct(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  unlockAudio();
  switch (act) {
    case 'tab': S.tab = t.dataset.tab; renderAll(); break;
    case 'goto': go(+t.dataset.p); break;
    case 'retry': retry(+t.dataset.p); break;
    case 'best': showBest(+t.dataset.p); break;
    case 'continue': S.paused = false; renderAll(); schedule(); break;
    case 'hint': toggleHint(); break;
    case 'hideopen': S.openCardClosed = t.dataset.fam; renderPlay(); break;
    case 'pzstart': case 'pznext': startPuzzle(); break;
    case 'pzhint': pzHint(); break;
    case 'pzsol': pzSolution(); break;
    case 'pzexit': exitPuzzle(); break;
    case 'libcat': S.libCat = t.dataset.v; renderOpen(); break;
    case 'pzchip': S.pzChip = t.dataset.v; renderPuzz(); save(); break;
    case 'pzlevel': S.pzLevel = t.dataset.v; renderPuzz(); save(); break;
    case 'lesson': openLesson(t.dataset.id); break;
    case 'lessonback': simDict.stop(); S.lesson = null; renderDict(); break;
    case 'cat': S.dictCat = t.dataset.id; renderDict(); break;
    case 'new': newGame(); break;
    case 'postreview': startPostReview(); break;
    case 'closesum': S.overDismissed = true; renderSummary(); break;
    case 'summary': S.overDismissed = false; renderSummary(); break;
    case 'bot': S.botId = t.dataset.id; renderAll(); break;
    case 'side': S.sideChoice = t.dataset.v; if (!S.hist.length) { S.userColor = S.sideChoice === 'b' ? 'b' : 'w'; S.orientation = S.userColor; board.setOrientation(S.orientation); } renderAll(); break;
    case 'mode': S.mode = t.dataset.v; if (!flags().analysis) { S.hintOn = false; if (eng.is('analysis')) eng.cancel(); } renderAll(); drawBadge(); schedule(); break;
    case 'time': S.movetime = +t.dataset.v; renderAll(); break;
    case 'theme': S.boardTheme = t.dataset.v; document.documentElement.dataset.board = S.boardTheme; renderAll(); break;
    case 'simcont': {
      const fen = fenAtPly(viewPly());
      const line = simulationLine(fen, t.dataset.uci, 12);
      const id = deepestName(line);
      openSim({ fen, line, title: id >= 0 ? vnName(opening(id).name) : 'Mô phỏng', sub: id >= 0 ? opening(id).name : '', orient: S.orientation, openingNames: true });
      break;
    }
    case 'simmain': {
      const a = openingInfo(viewPly());
      if (!a || !a.current) break;
      const o = opening(a.current.id);
      const g = new Chess();
      const line = [];
      for (const u of o.ucis) { const m = g.move(uciObj(u)); const be = bookEntry(g.fen()); line.push({ uci: u, san: m.san, n: be ? be.n : -1 }); }
      for (const s of mainLine(g.fen(), 8)) line.push(s);
      openSim({ line, title: vnName(o.name), sub: o.name, orient: S.orientation, openingNames: true });
      break;
    }
    case 'simlib': {
      const L = LIBRARY[+t.dataset.i];
      const line = sanLine(L.san);
      const id = deepestName(line);
      openSim({ line, title: L.vn, sub: id >= 0 ? opening(id).name : '', orient: L.side, openingNames: true });
      break;
    }
  }
}
$('#sideBody').addEventListener('click', onAct);
$('#over').addEventListener('click', onAct);
$('#sideBody').addEventListener('input', (e) => {
  if (e.target.id === 'customElo') { S.customElo = +e.target.value; const l = e.target.previousElementSibling; if (l) l.querySelector('small').textContent = S.customElo; renderBars(); save(); }
});
$('#sideBody').addEventListener('change', (e) => {
  if (e.target.id === 'optSound') { S.sound = e.target.checked; setSound(S.sound); renderNav(); save(); }
  if (e.target.id === 'optHaptics') { S.haptics = e.target.checked; buzz(20); save(); }
  if (e.target.id === 'optEval') { S.evalBarPref = e.target.checked; renderEval(); save(); }
  if (e.target.id === 'optPause') { S.pausePref = e.target.checked; if (!S.pausePref && S.paused) { S.paused = false; schedule(); } save(); }
});
$('#sideBody').addEventListener('mouseover', (e) => {
  const c = e.target.closest('.cont');
  const u = c ? c.dataset.uci : null;
  if (u !== S.preview) { S.preview = u; board.setArrows(arrows()); }
});
$('#sideBody').addEventListener('mouseleave', () => { if (S.preview) { S.preview = null; board.setArrows(arrows()); } });

function flip() {
  if (S.pz) { board.setOrientation(board.orientation === 'w' ? 'b' : 'w'); pzDraw(null); return; }
  S.orientation = S.orientation === 'w' ? 'b' : 'w'; board.setOrientation(S.orientation); drawBoard(null); renderAll();
}
let resignArmed = 0;
function askResign() {
  if (isOver() || !S.started || !S.hist.length) return;
  if (Date.now() - resignArmed < 3000) { resignArmed = 0; resign(); return; }
  resignArmed = Date.now();
  toast('Bấm Đầu hàng lần nữa để xác nhận');
}
function closeMore() {
  const m = $('#moreMenu');
  if (m.hidden) return;
  m.hidden = true;
  document.querySelector('[data-cmd="more"]')?.setAttribute('aria-expanded', 'false');
}
function runCmd(cmd) {
  unlockAudio();
  if (cmd === 'more') {
    const m = $('#moreMenu');
    m.hidden = !m.hidden;
    document.querySelector('[data-cmd="more"]')?.setAttribute('aria-expanded', String(!m.hidden));
    return;
  }
  closeMore();
  switch (cmd) {
    case 'first': go(0); break;
    case 'prev': go(viewPly() - 1); break;
    case 'next': go(viewPly() + 1); break;
    case 'last': go(S.hist.length); break;
    case 'hint': S.pz ? pzHint() : toggleHint(); break;
    case 'undo': if (!S.pz) takeback(); break;
    case 'flip': flip(); break;
    case 'resign': askResign(); break;
    case 'newgame':
      S.tab = 'bots';
      renderAll();
      if (isPhone()) requestAnimationFrame(() => document.querySelector('.side').scrollIntoView({ behavior: 'smooth', block: 'start' }));
      break;
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) { runCmd(b.dataset.cmd); return; }
  if (!e.target.closest('#moreMenu')) closeMore();
});
$('#board').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  let seen = false;
  try { seen = localStorage.getItem('dau-stockfish-tip-arrow') === '1'; } catch {}
  if (seen) return;
  try { localStorage.setItem('dau-stockfish-tip-arrow', '1'); } catch {}
  setTimeout(() => toast('Mẹo: chạm giữ một ô rồi kéo để vẽ mũi tên', 3500), 600);
}, { passive: true });

/* PWA: offline cache and install button (only on a real web origin, not inside an embed). */
function setupPwa() {
  const btn = $('#btnInstall');
  if (!btn || window.claude) return;
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  swOn = true;
  navigator.serviceWorker.register('sw.js').then(() => { if (eng.ready) warmOffline(); }).catch(() => { swOn = false; });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('#nav [data-nav="install"]').hidden = standalone;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; btn.hidden = false; });
  btn.addEventListener('click', doInstall);
  window.addEventListener('appinstalled', () => { installPrompt = null; btn.hidden = true; $('#nav [data-nav="install"]').hidden = true; });
}
let installPrompt = null;
async function doInstall() {
  if (!installPrompt) { openSheet('help', 'hInstall'); return; }
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch {}
  installPrompt = null;
  $('#btnInstall').hidden = true;
}
document.addEventListener('keydown', (e) => {
  if (sheet.open) return;
  if (document.documentElement.classList.contains('nav-open')) { if (e.key === 'Escape') { e.preventDefault(); closeNav(true); } return; }
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); openSheet('help'); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(viewPly() - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(viewPly() + 1); }
  else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); S.pz ? pzHint() : toggleHint(); }
  else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); if (!S.pz) takeback(); }
  else if ((e.key === 'n' || e.key === 'N' || e.key === 'Enter') && S.pz && S.pz.status !== 'solving') { e.preventDefault(); startPuzzle(); }
  else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flip(); }
  else if (e.key === 'Escape') { board.clearAnnotations(); closeMore(); if (S.hintOn) toggleHint(); }
});

/* ================= menu, stats, help ================= */
const PAGES = {
  play: ['Chơi với máy', 'Chấm điểm từng nước, có huấn luyện viên đi kèm'],
  puzz: ['Giải đố', 'Thế cờ thật từ lichess, độ khó theo điểm của bạn'],
  open: ['Khai cuộc', 'Tên khai cuộc, ý tưởng và mô phỏng từng nước'],
  dict: ['Từ điển lỗi', 'Bẫy khai cuộc, lỗi chiến thuật, mẫu chiếu hết'],
  bots: ['Đối thủ & cài đặt', 'Chọn bot, chế độ chơi, bàn cờ và âm thanh'],
};
const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const botStamp = (b) => ({ id: b.id, name: b.name, e: eloText(b) });
const fmt1 = (x) => x.toFixed(1).replace('.', ',');

/* Keep one record per game (upsert by id), so reloads, takebacks and a later review update it instead of adding a new one. */
function recordGame() {
  if (!S.started || !isOver() || !S.hist.length) return;
  if (!S.gameId) S.gameId = Date.now();
  const gb = S.gameBot || botStamp(bot());
  const r = S.result;
  const acc = accuracy(S.userColor);
  const rec = {
    id: S.gameId, t: Date.now(), b: gb.id, nm: gb.name, e: gb.e, c: S.userColor,
    r: r.winner == null ? 'd' : r.winner === S.userColor ? 'w' : 'l', why: r.reason, n: S.hist.length,
    acc: acc == null ? null : Math.round(acc * 10) / 10, m: S.mode, h: S.hintsUsed,
  };
  const i = S.games.findIndex((g) => g.id === rec.id);
  if (i < 0) { S.games.push(rec); if (S.games.length > 100) S.games = S.games.slice(-100); return; }
  const old = S.games[i];
  if (old.r === rec.r && old.n === rec.n && old.acc === rec.acc && old.h === rec.h) return;
  rec.t = old.t;
  S.games[i] = rec;
}

function renderNav() {
  document.querySelectorAll('#nav [data-go]').forEach((b) => {
    if (b.dataset.go === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const [t, sub] = PAGES[S.tab] || PAGES.play;
  $('#pageTitle').textContent = t;
  $('#pageSub').textContent = sub;
  if (!window.claude) document.title = S.tab === 'play' ? 'Đấu Stockfish' : `${t} · Đấu Stockfish`;
  const snd = $('#nav [data-nav="sound"]');
  const lab = S.sound ? 'Âm thanh: bật' : 'Âm thanh: tắt';
  snd.querySelector('.l').textContent = lab;
  snd.title = lab + ' (bấm để ' + (S.sound ? 'tắt' : 'bật') + ')';
  snd.classList.toggle('muted', !S.sound);
}
function applyNavMini() {
  document.documentElement.classList.toggle('nav-mini', S.navMini);
  const b = $('#nav [data-nav="collapse"]');
  const lab = S.navMini ? 'Mở rộng menu' : 'Thu gọn menu';
  b.setAttribute('aria-label', lab);
  b.title = lab;
}

/* Switch section; from the menu on a phone, also bring that section into view. */
function goTab(tab, fromMenu) {
  if (S.pz && tab === 'play') exitPuzzle();
  else {
    S.tab = tab;
    if (tab === 'dict') renderDict();
    renderAll();
  }
  if (fromMenu && isPhone()) {
    requestAnimationFrame(() => {
      if (tab === 'play' || tab === 'puzz') window.scrollTo({ top: 0, behavior: 'smooth' });
      else document.querySelector('.side').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

const DRAWER_Q = window.matchMedia('(max-width: 979px) and (min-height: 561px), (max-width: 599px)');
const LANDSCAPE_Q = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
const drawerMode = () => DRAWER_Q.matches && !LANDSCAPE_Q.matches;
const navOpen = () => document.documentElement.classList.contains('nav-open');
function openNav() {
  if (!drawerMode() || navOpen()) return;
  closeMore();
  document.documentElement.classList.add('nav-open');
  $('#scrim').hidden = false;
  $('#btnMenu').setAttribute('aria-expanded', 'true');
  $('.app').inert = true;
  $('#mbar').inert = true;
  requestAnimationFrame(() => ($('#nav [aria-current="page"]') || $('#nav .nav-i')).focus({ preventScroll: true }));
}
function closeNav(returnFocus) {
  if (!navOpen()) return;
  document.documentElement.classList.remove('nav-open');
  $('#scrim').hidden = true;
  $('#btnMenu').setAttribute('aria-expanded', 'false');
  $('.app').inert = false;
  $('#mbar').inert = false;
  if (returnFocus) $('#btnMenu').focus({ preventScroll: true });
}
$('#btnMenu').addEventListener('click', () => (navOpen() ? closeNav(true) : openNav()));
$('#scrim').addEventListener('click', () => closeNav(true));
for (const q of [DRAWER_Q, LANDSCAPE_Q]) q.addEventListener?.('change', () => { if (!drawerMode()) closeNav(false); });
/* Swipe the drawer to the left to close it. */
{
  let x0 = null, y0 = 0;
  $('#nav').addEventListener('touchstart', (e) => { if (navOpen()) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
  $('#nav').addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) closeNav(false);
  }, { passive: true });
}
$('#nav').addEventListener('click', (e) => {
  if (e.target.closest('.nav-brand')) { e.preventDefault(); closeNav(false); goTab('play', true); return; }
  const g = e.target.closest('[data-go]');
  if (g) { closeNav(false); goTab(g.dataset.go, true); return; }
  const a = e.target.closest('[data-nav]');
  if (!a) { if (e.target.closest('a')) closeNav(false); return; }
  unlockAudio();
  switch (a.dataset.nav) {
    case 'close': closeNav(true); break;
    case 'newgame': closeNav(false); runCmd('newgame'); break;
    case 'stats': closeNav(false); openSheet('stats'); break;
    case 'help': closeNav(false); openSheet('help'); break;
    case 'install': closeNav(false); doInstall(); break;
    case 'sound':
      S.sound = !S.sound;
      setSound(S.sound);
      if (S.sound) sfx('move');
      renderNav();
      if (S.tab === 'bots') renderBots();
      save();
      break;
    case 'collapse': S.navMini = !S.navMini; applyNavMini(); save(); break;
  }
});

const sheet = $('#sheet');
function openSheet(kind, anchorId) {
  const title = kind === 'stats' ? 'Thống kê của bạn' : 'Hướng dẫn';
  sheet.innerHTML = `<div class="sheet-h"><h2 id="sheetTitle">${title}</h2><button type="button" class="sheet-x" data-sheet="close" aria-label="Đóng">${X_SVG}</button></div><div class="sheet-b">${kind === 'stats' ? statsHtml() : helpHtml()}</div>`;
  if (typeof sheet.showModal === 'function') { if (!sheet.open) sheet.showModal(); } else sheet.setAttribute('open', '');
  const body = sheet.querySelector('.sheet-b');
  const target = anchorId && sheet.querySelector('#' + anchorId);
  body.scrollTop = target ? target.offsetTop - body.offsetTop - 8 : 0;
}
function closeSheet() { if (typeof sheet.close === 'function') sheet.close(); else sheet.removeAttribute('open'); }
sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-sheet="close"]')) { closeSheet(); return; }
  const t = e.target.closest('[data-sheet-go]');
  if (t) { closeSheet(); goTab(t.dataset.sheetGo, true); }
});

function sparkSvg(vals) {
  if (vals.length < 2) return '';
  const W = 300, H = 56, p = 6;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(20, hi - lo);
  const pts = vals.map((v, i) => `${(p + ((W - 2 * p) * i) / (vals.length - 1)).toFixed(1)},${(H - p - ((H - 2 * p) * (v - lo)) / span).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Điểm giải đố qua ${vals.length} thế gần nhất, từ ${vals[0]} đến ${vals[vals.length - 1]}"><polyline points="${pts}" fill="none" stroke="#93c35a" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function statsHtml() {
  const G = S.games;
  const n = G.length;
  const cnt = (r) => G.filter((g) => g.r === r).length;
  const w = cnt('w'), d = cnt('d'), l = cnt('l');
  const accs = G.filter((g) => g.acc != null).map((g) => g.acc);
  const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null;
  let h = '<h3>Ván với máy</h3>';
  if (!n) {
    h += '<p>Chưa có ván nào kết thúc. Chơi hết một ván với máy (thắng, hòa hoặc đầu hàng) để bắt đầu có thống kê.</p><div><button type="button" class="btn go" data-sheet-go="bots">Chọn đối thủ</button></div>';
  } else {
    h += `<div class="kpis"><div><small>Ván đã chơi</small><b>${n}</b></div><div><small>Tỉ lệ thắng</small><b>${Math.round((w * 100) / n)}%</b></div><div><small>Độ chính xác TB</small><b>${avg == null ? '—' : fmt1(avg)}</b></div></div>`;
    h += `<div class="wdl" role="img" aria-label="Thắng ${w}, hòa ${d}, thua ${l}">${w ? `<i class="w" style="flex:${w}"></i>` : ''}${d ? `<i class="d" style="flex:${d}"></i>` : ''}${l ? `<i class="l" style="flex:${l}"></i>` : ''}</div>`;
    h += `<div class="wdl-k"><span><i style="background:var(--green)"></i>Thắng <b>${w}</b></span><span><i style="background:#8a8781"></i>Hòa <b>${d}</b></span><span><i style="background:var(--bad)"></i>Thua <b>${l}</b></span></div>`;
  }
  h += '<h3>Giải đố</h3>';
  h += `<div class="kpis"><div><small>Điểm giải đố</small><b>${S.pzRating}</b></div><div><small>Giải đúng</small><b>${S.pzSolved}/${S.pzGames}</b></div><div><small>Chuỗi dài nhất</small><b>${S.pzBest}</b></div></div>`;
  const rs = S.pzHist.filter((x) => Number.isFinite(x.r)).map((x) => x.r);
  h += rs.length >= 2 ? sparkSvg(rs) : `<p class="note">${S.pzGames ? 'Giải thêm vài thế để thấy biểu đồ điểm.' : 'Chưa giải thế cờ nào.'} <button type="button" class="btn ghost" data-sheet-go="puzz" style="padding:4px 8px">Giải đố ngay</button></p>`;
  if (n) {
    const by = new Map();
    for (const g of G) {
      const k = g.b === 'custom' ? `custom:${g.e}` : g.b;
      if (!by.has(k)) by.set(k, { g, w: 0, d: 0, l: 0 });
      by.get(k)[g.r]++;
    }
    const order = (k) => { const i = BOTS.findIndex((b) => b.id === k); return i < 0 ? 99 : i; };
    const rows = [...by.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([k, v]) => {
      const b = botById(v.g.b) || { tone: '#6b6f7a', icon: 'wr' };
      return `<div class="vs-r"><span class="ava" style="background:${b.tone}"><i class="${b.icon}"></i></span><div><b>${esc(v.g.nm)}</b><small>${esc(v.g.e)}${v.w ? ' · đã thắng' : ''}</small></div><div class="sc"><span class="w" title="Thắng">${v.w}</span><span title="Hòa">${v.d}</span><span class="l" title="Thua">${v.l}</span></div></div>`;
    }).join('');
    h += `<h3>Theo đối thủ</h3><div class="vs">${rows}</div>`;
    const RES = { w: 'Thắng', d: 'Hòa', l: 'Thua' };
    const recent = G.slice(-12).reverse().map((g) => {
      const dt = new Date(g.t);
      const when = `${dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
      return `<div class="gl-r"><span class="res ${g.r}">${RES[g.r]}</span><div class="who3"><b>${esc(g.nm)} <span style="color:var(--muted);font-weight:600">${esc(g.e)}</span></b><small>${g.c === 'w' ? 'Cầm Trắng' : 'Cầm Đen'} · ${Math.ceil(g.n / 2)} nước · ${esc(g.why)} · ${when}</small></div><div class="ac">${g.acc == null ? '—' : fmt1(g.acc)}<small>chính xác</small></div></div>`;
    }).join('');
    h += `<h3>Ván gần đây</h3><div class="gl">${recent}</div>`;
    h += '<p class="fine">Độ chính xác chỉ có ở ván đã được chấm điểm (chế độ Học tập, Thân thiện, hoặc bấm Chấm điểm sau ván Thử thách). Thống kê lưu trong trình duyệt này.</p>';
  }
  return h;
}
function helpHtml() {
  const key = (k, t) => `<span>${k}</span><span>${t}</span>`;
  const legend = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']
    .map((k) => `<span>${badgeSvg(k, 20)}${CLASSES[k].vn}</span>`).join('');
  return `<h3>Phím tắt</h3>
    <div class="keys">
      ${key('<kbd>←</kbd> <kbd>→</kbd>', 'Xem lại nước trước, nước sau')}
      ${key('<kbd>H</kbd>', 'Bật hoặc tắt gợi ý. Trong giải đố: lần đầu tô ô, lần sau hiện mũi tên')}
      ${key('<kbd>G</kbd>', 'Đi lại, lùi về lượt của bạn')}
      ${key('<kbd>F</kbd>', 'Lật bàn cờ')}
      ${key('<kbd>N</kbd> <kbd>Enter</kbd>', 'Thế đố tiếp theo, sau khi giải xong')}
      ${key('<kbd>Esc</kbd>', 'Xóa mũi tên, tắt gợi ý, đóng menu')}
      ${key('<kbd>?</kbd>', 'Mở trang hướng dẫn này')}
    </div>
    <h3>Chuột và cảm ứng</h3>
    <p>Kéo thả quân, hoặc bấm quân rồi bấm ô muốn đi. Thả sai chỗ thì quân tự về chỗ cũ.</p>
    <p>Chuột phải kéo để vẽ mũi tên, chuột phải bấm để đánh dấu ô, bấm chuột trái lên bàn cờ để xóa. Trên điện thoại: chạm giữ một ô rồi kéo để vẽ mũi tên, chạm một lần để xóa.</p>
    <h3>Ký hiệu chấm điểm</h3>
    <div class="legend">${legend}</div>
    <p class="note">Mỗi nước được so với nước tốt nhất của Stockfish theo xác suất thắng. Thiên tài là thí quân chính xác; Nước hay là nước duy nhất giữ được thế cờ.</p>
    <h3 id="hInstall">Cài như ứng dụng</h3>
    <p><b>Máy tính, Android</b> (Chrome, Edge): bấm <b>Cài ứng dụng</b> trong menu hoặc biểu tượng cài trên thanh địa chỉ.</p>
    <p><b>iPhone, iPad</b> (Safari): bấm nút Chia sẻ, chọn <b>Thêm vào MH chính</b>.</p>
    <p class="note">Sau khi cài, trang mở toàn màn hình và chơi được cả khi không có mạng.</p>
    <h3>Giới thiệu</h3>
    <p class="fine">Engine: Stockfish 17.1 (GPLv3)${eng.threads > 1 ? `, đang chạy ${eng.threads} luồng` : ''}. Khai cuộc và giải đố: dữ liệu lichess (CC0). Quân cờ: bộ cburnett (CC BY-SA 3.0). Phông chữ: Be Vietnam Pro (OFL). Mã nguồn: <a href="https://github.com/HoangDuc1003/chess-com" target="_blank" rel="noopener">github.com/HoangDuc1003/chess-com</a>. Dự án cá nhân để học cờ, không liên quan tới trang cờ nào khác.</p>`;
}

/* ================= boot ================= */
function start(hotData) {
  restore(hotData && Object.keys(hotData).length ? hotData : load());
  setSound(S.sound);
  document.documentElement.dataset.board = S.boardTheme;
  if (S.started && !S.gameBot) S.gameBot = botStamp(bot());
  if (S.started && !S.gameId) S.gameId = Date.now();
  applyNavMini();
  setupPwa();
  if (!S.started) S.tab = S.tab === 'play' ? 'bots' : S.tab;
  board.setOrientation(S.orientation);
  drawBoard(null);
  renderPill();
  renderAll();
  loadPuzzles().then(() => { if (S.tab === 'puzz') renderAll(); }).catch(() => {});
  loadOpenings().then(() => { openMemo.key = null; renderAll(); }).catch(() => { $('#ostrip').innerHTML = '<span class="off">Không tải được dữ liệu khai cuộc</span>'; });
  eng.boot(HASH_MB, THREADS);
}
window.claude?.hot?.snapshot?.(() => snapshot());
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
