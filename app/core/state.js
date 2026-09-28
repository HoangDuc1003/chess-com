// The single app state object S, shared caches, and read-only selectors over them.
import { Chess } from '../../lib/chess.js';
import { MODES } from './config.js';
import { posKey, START_FEN } from './util.js';
import { analyzeLine, openingsReady } from '../content/openings.js';
import { botById, BOTS, eloText } from '../game/bots.js';

export const S = {
  // current game
  game: new Chess(),
  hist: [],
  userColor: 'w', orientation: 'w', sideChoice: 'w',
  botId: 'ti', customElo: 1600, mode: 'learn',
  started: false, resigned: false, result: null, overDismissed: false,
  view: null, showBest: null,
  review: {}, pending: new Set(),
  hintOn: false, hintsUsed: 0,
  paused: false, botPending: null, thinking: null, mateNote: null,
  coachPly: null, botCoachPly: null,
  postReview: false,
  evalWhite: 20,
  gameId: 0, gameBot: null,
  tc: 'none', clock: null, flagged: null,
  // preferences
  movetime: 1000, sound: true, evalBarPref: true, pausePref: true, haptics: true, boardTheme: 'green',
  premovePref: true, autoQueen: false, showDots: true, navMini: false,
  // panes
  tab: 'bots', lesson: null, dictCat: 'all', preview: null,
  openCardClosed: null, lastOpenFam: null, libCat: 'e4e5',
  // puzzles
  pz: null, pzRating: 800, pzGames: 0, pzSolved: 0, pzStreak: 0, pzBest: 0, pzChip: 'all', pzLevel: 'normal', pzSeen: [], pzHist: [],
  // history of finished games (stats)
  games: [],
};

/* Engine results per position (posKey -> { lines, depth, reviewed }) and positions still waiting for a review. */
export const cache = new Map();
export const need = [];

const legalCache = new Map();
export function legalCount(fen) {
  const k = posKey(fen);
  if (!legalCache.has(k)) legalCache.set(k, new Chess(fen).moves().length);
  return legalCache.get(k);
}

/* What the current mode allows, combined with the player's preferences. */
export function flags() {
  const m = MODES[S.mode];
  return { ...m, evalBar: m.evalBar && S.evalBarPref, pause: m.pause && S.pausePref };
}
export function bot() {
  if (S.botId === 'custom') return { id: 'custom', name: 'Tùy chỉnh', elo: S.customElo, icon: 'wr', tone: '#6b6f7a', blurb: 'Stockfish giới hạn ở mức Elo bạn chọn.', uciElo: S.customElo };
  return botById(S.botId) || BOTS[2];
}
export function botStamp(b) { return { id: b.id, name: b.name, e: eloText(b) }; }
export function botColor() { return S.userColor === 'w' ? 'b' : 'w'; }
export function userTurn() { return S.game.turn() === S.userColor; }
export function isOver() { return !!S.result; }
export function canUserMove() { return S.view == null && !isOver() && userTurn() && !S.botPending; }
export function pzCanMove() { const pz = S.pz; return !!pz && pz.status === 'solving' && !pz.busy && pz.game.turn() === pz.color; }

/* The ply shown on the board (the last one unless the player is looking back) and its position. */
export function viewPly() { return S.view == null ? S.hist.length : S.view; }
export function fenAtPly(p) { return p === 0 ? START_FEN : S.hist[p - 1].after; }

/* Average accuracy of one side over its graded moves. */
export function accuracy(color) {
  const a = [];
  S.hist.forEach((h, i) => { const r = S.review[i + 1]; if (r && h.color === color) a.push(r.acc); });
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

/* Named openings reached in the first `ply` moves (memoised; null until the opening data has loaded). */
let openMemo = { key: null, val: null };
export function openingInfo(ply) {
  if (!openingsReady()) return null;
  const k = S.hist.slice(0, ply).map((h) => h.uci).join(' ');
  if (openMemo.key !== k) openMemo = { key: k, val: analyzeLine(k ? k.split(' ') : []) };
  return openMemo.val;
}
