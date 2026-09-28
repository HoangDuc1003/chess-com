// Opening book lookups (lichess chess-openings, CC0) + Vietnamese study notes.
import { Chess } from '../../lib/chess.js';
import { keyOf } from './hash.js';

let DB = null;
const contCache = new Map();

export async function loadOpenings(url = 'data/openings.json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error('openings ' + r.status);
  DB = await r.json();
  return DB;
}
export function setOpeningsData(d) { DB = d; }
export function openingsReady() { return !!DB; }

function uciObj(u) {
  const o = { from: u.slice(0, 2), to: u.slice(2, 4) };
  if (u.length > 4) o.promotion = u[4];
  return o;
}

export function bookEntry(fen) {
  if (!DB) return null;
  const e = DB.p[keyOf(fen)];
  if (e == null) return null;
  return { c: e[0], n: e[1], kids: e[2] ? e[2].split(' ') : [] };
}

/* Book moves out of a position, each with its own entry. Only the listed moves are played, so this is cheap. */
function bookChildren(g) {
  const e = bookEntry(g.fen());
  if (!e) return [];
  const out = [];
  for (const u of e.kids) {
    let m;
    try { m = g.move(uciObj(u)); } catch { continue; }
    const ce = bookEntry(g.fen());
    g.undo();
    if (ce) out.push({ uci: u, san: m.san, c: ce.c, n: ce.n });
  }
  return out;
}
const isGambit = (id) => id >= 0 && /Gambit|Trap|Countergambit/.test(DB.o[id][1]);

export function opening(id) {
  const o = DB.o[id];
  return { id, eco: o[0], name: o[1], ucis: o[2] ? o[2].split(' ') : [] };
}

/* Walk a game and collect every point where the named opening changes. */
export function analyzeLine(ucis) {
  const out = { events: [], current: null, lastBookPly: 0, inBook: true };
  if (!DB) return out;
  const g = new Chess();
  ucis.forEach((u, i) => {
    try { g.move(uciObj(u)); } catch { return; }
    const e = bookEntry(g.fen());
    if (e) {
      out.lastBookPly = i + 1;
      if (e.n >= 0 && (!out.current || DB.o[out.current.id][1] !== DB.o[e.n][1])) {
        out.current = { id: e.n, ply: i + 1 };
        out.events.push(out.current);
      }
    }
  });
  out.inBook = out.lastBookPly === ucis.length;
  return out;
}

/* "Main line": follow the book move that the most named lines pass through.
   Gambits and traps collect many named sub-lines, so they are down-weighted to keep the line mainstream. */
export function mainLine(fen, maxPlies = 10) {
  const g = new Chess(fen);
  const line = [];
  for (let i = 0; i < maxPlies; i++) {
    let best = null;
    for (const k of bookChildren(g)) {
      const w = k.c * (isGambit(k.n) ? 0.3 : 1);
      if (!best || w > best.w) best = { ...k, w };
    }
    if (!best) break;
    g.move(uciObj(best.uci));
    line.push({ uci: best.uci, san: best.san, n: best.n });
  }
  return line;
}

/* Book moves from this position, most-studied first. The simulation line is built on demand. */
export function continuations(fen, limit = 6) {
  if (!DB) return [];
  if (contCache.has(fen)) return contCache.get(fen);
  const g = new Chess(fen);
  const kids = bookChildren(g).sort((a, b) => b.c - a.c).slice(0, limit);
  const top = kids.map((k) => {
    let id = k.n;
    if (id < 0) {
      g.move(uciObj(k.uci));
      const ahead = mainLine(g.fen(), 4).find((s) => s.n >= 0);
      g.undo();
      id = ahead ? ahead.n : -1;
    }
    return { uci: k.uci, san: k.san, count: k.c, id };
  });
  contCache.set(fen, top);
  return top;
}

export function simulationLine(fen, firstUci, maxPlies = 10) {
  const g = new Chess(fen);
  let m;
  try { m = g.move(uciObj(firstUci)); } catch { return []; }
  const e = bookEntry(g.fen());
  return [{ uci: firstUci, san: m.san, n: e ? e.n : -1 }, ...mainLine(g.fen(), maxPlies - 1)];
}

export function deepestName(line) {
  let id = -1;
  for (const s of line) if (s.n >= 0) id = s.n;
  return id;
}

/* A library line given in SAN, annotated with book names along the way. */
export function sanLine(sans) {
  const g = new Chess();
  const line = [];
  for (const s of sans.split(' ')) {
    const m = g.move(s);
    const e = bookEntry(g.fen());
    line.push({ uci: m.from + m.to + (m.promotion || ''), san: m.san, n: e ? e.n : -1 });
  }
  return line;
}
