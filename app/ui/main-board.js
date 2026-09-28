// The main board instance and what is drawn on it (position, badges, arrows).
import { Chess } from '../../lib/chess.js';
import { cache, canUserMove, fenAtPly, flags, isOver, pzCanMove, S, userTurn, viewPly } from '../core/state.js';
import { $, kingSq, posKey } from '../core/util.js';
import { go, onBoardMove } from '../game/game.js';
import { pzDraw, pzMove } from '../game/puzzle.js';
import { BoardView } from './board.js';
import { sfx, unlockAudio } from './sound.js';

export const board = new BoardView($('#board'), {
  interactive: true,
  canMove: () => (S.pz ? pzCanMove() : canUserMove()),
  myColor: () => (S.pz ? S.pz.color : S.userColor),
  onMove: (mv, animated) => (S.pz ? pzMove(mv, animated) : onBoardMove(mv, animated)),
  // During a game, touching the board while browsing old moves returns to the live position; after the game it stays put.
  onBlocked: () => { if (!S.pz && S.view != null && !isOver()) go(S.hist.length); },
  onIllegal: () => sfx('illegal'),
  onInteract: () => unlockAudio(),
  canPremove: () => !S.pz && S.premovePref && S.started && !isOver() && S.view == null && !userTurn(),
  onPremove: (list) => { if (list.length) sfx('premove'); },
  autoQueen: () => S.autoQueen,
  showTargets: () => S.showDots,
});
export function drawBoard(anim) {
  if (S.pz) { pzDraw(anim); return; }
  const vp = viewPly();
  const fen = fenAtPly(vp);
  const rec = S.hist[vp - 1];
  const g = new Chess(fen);
  board.set({ fen, lastMove: rec ? { from: rec.from, to: rec.to } : null, check: g.inCheck() ? kingSq(g, g.turn()) : null, animate: anim });
  drawBadge();
  board.setArrows(arrows());
}
export function drawBadge() {
  if (S.pz) { board.setBadge(S.pz.badge || null); return; }
  const vp = viewPly();
  const rec = S.hist[vp - 1];
  const rv = S.review[vp];
  const showAll = flags().analysis || isOver();
  board.setBadge(rec && rv && showAll ? { sq: rec.to, cls: rv.cls } : null);
}
export function arrows() {
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
  const best = !S.showBest && reviewBest(vp);
  if (best) list.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: 'best' });
  if (S.preview) list.push({ from: S.preview.slice(0, 2), to: S.preview.slice(2, 4), color: 'preview' });
  return list;
}
/* After the game, the engine's best move in the position after ply p (null while unknown or switched off). */
export function reviewBest(p) {
  if (!isOver() || !S.bestArrow || S.pz) return null;
  const e = cache.get(posKey(fenAtPly(p)));
  const l = e && e.lines[0];
  return l && l.pv && l.pv[0] && (e.viewed || e.reviewed || l.depth >= 10) ? l.pv[0] : null;
}
