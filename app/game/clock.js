// Chess clocks: a side's clock runs once both sides have moved; the bot's only while it is thinking.
import { botColor, isOver, S, userTurn } from '../core/state.js';
import { save } from '../core/storage.js';
import { eng } from '../analysis/scheduler.js';
import { checkResult } from './game.js';
import { drawBoard } from '../ui/main-board.js';
import { renderAll } from '../ui/render.js';
import { sfx } from '../ui/sound.js';

let clk = { side: null, since: 0 }; // the running side and since when (performance.now)
let clockTimer = 0;
let lowWarned = false;

/* Set up the clocks for a new game (null for an untimed game). */
export function resetClock(tc) {
  S.clock = tc && tc.base ? { w: tc.base, b: tc.base, base: tc.base, inc: tc.inc, tc: S.tc } : null;
  S.flagged = null;
  clk = { side: null, since: 0 };
  lowWarned = false;
}
/* A side's clock runs once both sides have made a move; the bot's only while it is actually thinking. */
function clockRunning() {
  if (!S.clock || !S.started || isOver() || S.pz || S.paused || S.hist.length < 2) return false;
  return userTurn() || !!(S.thinking || S.botPending);
}
/* Time left on a side's clock, in ms. */
export function clockLeft(c) {
  if (!S.clock) return 0;
  let v = S.clock[c];
  if (clk.side === c) v -= performance.now() - clk.since;
  return Math.max(0, v);
}
/* Start or stop the running clock to match the game state. Called on every render. */
export function syncClock() {
  const want = clockRunning() ? S.game.turn() : null;
  if (want !== clk.side) {
    if (clk.side) S.clock[clk.side] = clockLeft(clk.side);
    clk = { side: want, since: performance.now() };
  }
  if (want && !clockTimer) clockTimer = setInterval(tickClock, 100);
  if (!want && clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
  updateClocks();
}
/* Call just before a move is made: charge the mover for the time used and add the increment. */
export function chargeMove(mover) {
  if (!S.clock || clk.side !== mover) return;
  S.clock[mover] = clockLeft(mover) + S.clock.inc;
  clk = { side: null, since: 0 };
}
function lowTime() { return S.clock ? Math.min(20e3, S.clock.base * 0.1) : 0; }
function fmtClock(ms) {
  if (ms < 20e3) { const t = Math.floor(ms / 100); return `0:${String(Math.floor(t / 10)).padStart(2, '0')},${t % 10}`; }
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
function updateClocks() {
  document.querySelectorAll('[data-clock]').forEach((el) => {
    const c = el.dataset.clock, ms = clockLeft(c);
    const txt = fmtClock(ms);
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('run', clk.side === c);
    el.classList.toggle('low', ms <= lowTime());
  });
}
function tickClock() {
  const c = clk.side;
  if (!c) return;
  const left = clockLeft(c);
  updateClocks();
  if (c === S.userColor && !lowWarned && left <= lowTime()) { lowWarned = true; sfx('lowtime'); }
  if (left <= 0) flagSide(c);
}
/* A side ran out of time. */
function flagSide(c) {
  S.clock[c] = 0;
  clk = { side: null, since: 0 };
  S.flagged = c;
  if (c === botColor()) { eng.cancel(); S.botPending = null; S.thinking = null; }
  checkResult(false);
  drawBoard(null);
  renderAll();
  save();
}

export function clockHtml(color) {
  if (!S.clock) return '';
  const ms = clockLeft(color);
  return `<span class="clock${clk.side === color ? ' run' : ''}${ms <= lowTime() ? ' low' : ''}" data-clock="${color}" role="timer" aria-label="Đồng hồ ${color === S.userColor ? 'của bạn' : 'của máy'}">${fmtClock(ms)}</span>`;
}
