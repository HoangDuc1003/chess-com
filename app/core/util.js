// Small DOM and chess helpers shared by every module.
import { Chess } from '../../lib/chess.js';

export const $ = (s) => document.querySelector(s);
export const START_FEN = new Chess().fen();

/* Escape text for HTML templates. */
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 'e7e8q' -> { from: 'e7', to: 'e8', promotion: 'q' } */
export const uciObj = (u) => { const o = { from: u.slice(0, 2), to: u.slice(2, 4) }; if (u.length > 4) o.promotion = u[4]; return o; };
/* A position without the move counters, used as a cache key. */
export const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/* Short message over the board. */
let toastTimer = 0;
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
export const isPhone = () => window.matchMedia('(max-width: 979px)').matches;

export function kingSq(g, color) {
  for (const row of g.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

/* SAN with a piece figurine instead of the letter. */
export function sanHtml(san, color) {
  const m = san.match(/^([KQRBN])(.*)$/);
  return m ? `<i class="fig ${color}${m[1].toLowerCase()}"></i>${esc(m[2])}` : esc(san);
}

export const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
/* 91.54 -> '91,5' (Vietnamese decimal comma). */
export const fmt1 = (x) => x.toFixed(1).replace('.', ',');
