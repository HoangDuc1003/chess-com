// Persist the game and preferences in localStorage, and restore them on load.
import { MODES, STORE, TCS } from './config.js';
import { S } from './state.js';
import { chipById } from '../content/puzzles.js';
import { CLASSES } from '../analysis/review.js';
import { botById } from '../game/bots.js';
import { clockLeft } from '../game/clock.js';
import { checkResult, pushMove } from '../game/game.js';

/* Everything worth keeping across reloads (the game is stored as its moves). */
export function snapshot() {
  return {
    moves: S.hist.map((h) => h.uci), userColor: S.userColor, orientation: S.orientation, sideChoice: S.sideChoice,
    botId: S.botId, customElo: S.customElo, mode: S.mode, movetime: S.movetime, sound: S.sound,
    evalBarPref: S.evalBarPref, pausePref: S.pausePref, haptics: S.haptics, boardTheme: S.boardTheme, started: S.started, resigned: S.resigned,
    review: S.review, hintsUsed: S.hintsUsed, tab: S.tab,
    pzRating: S.pzRating, pzGames: S.pzGames, pzSolved: S.pzSolved, pzStreak: S.pzStreak, pzBest: S.pzBest,
    pzChip: S.pzChip, pzLevel: S.pzLevel, pzSeen: S.pzSeen.slice(-400), pzHist: S.pzHist.slice(-30),
    games: S.games.slice(-100), gameId: S.gameId, gameBot: S.gameBot, navMini: S.navMini,
    tc: S.tc, clock: S.clock ? { ...S.clock, w: clockLeft('w'), b: clockLeft('b') } : null, flagged: S.flagged,
    premovePref: S.premovePref, autoQueen: S.autoQueen, showDots: S.showDots, bestArrow: S.bestArrow,
  };
}
export function save() { try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch {} }
export function load() { try { const r = localStorage.getItem(STORE); return r ? JSON.parse(r) : null; } catch { return null; } }
/* Load a snapshot back into S, validating each field; the moves are replayed. */
export function restore(d) {
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
  pick('tab', (v) => ['play', 'open', 'puzz', 'dict', 'bots', 'ai'].includes(v));
  for (const k of ['pzRating', 'pzGames', 'pzSolved', 'pzStreak', 'pzBest']) pick(k, (v) => Number.isFinite(v) && v >= 0 && v <= 100000);
  pick('pzChip', (v) => typeof v === 'string' && chipById(v).id === v);
  pick('pzLevel', (v) => ['easy', 'normal', 'hard'].includes(v));
  pick('pzSeen', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));
  pick('pzHist', (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object'));
  pick('games', (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && ['w', 'd', 'l'].includes(x.r)));
  pick('gameId', (v) => Number.isFinite(v) && v >= 0);
  pick('gameBot', (v) => v && typeof v === 'object' && typeof v.name === 'string');
  pick('navMini', (v) => typeof v === 'boolean');
  pick('tc', (v) => !!TCS[v]);
  pick('clock', (v) => v && Number.isFinite(v.w) && Number.isFinite(v.b) && Number.isFinite(v.base) && Number.isFinite(v.inc));
  pick('flagged', (v) => v === 'w' || v === 'b');
  for (const k of ['premovePref', 'autoQueen', 'showDots', 'bestArrow']) pick(k, (v) => typeof v === 'boolean');
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
