import fs from 'fs';
// Usage: node tools/build-openings.mjs path/to/chess-openings   (clone of github.com/lichess-org/chess-openings)
import { Chess } from '../lib/chess.js';
import { keyOf } from '../app/hash.js';
const SRC = process.argv[2] || '../chess-openings';
const OUT = new URL('../data/openings.json', import.meta.url);
const rows = [];
for (const f of 'abcde') {
  const lines = fs.readFileSync(`${SRC}/${f}.tsv`, 'utf8').trim().split('\n').slice(1);
  for (const l of lines) { const [eco, name, pgn] = l.split('\t'); rows.push({ eco, name, pgn }); }
}
const openings = [];
const pos = new Map(); // key -> {c, n}
let bad = 0;
for (const r of rows) {
  const g = new Chess();
  const sans = r.pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
  const ucis = [];
  const keys = [keyOf(g.fen())];
  let ok = true;
  for (const s of sans) {
    try { const m = g.move(s); ucis.push(m.from + m.to + (m.promotion || '')); keys.push(keyOf(g.fen())); }
    catch { ok = false; break; }
  }
  if (!ok) { bad++; continue; }
  const id = openings.length;
  openings.push([r.eco, r.name, ucis.join(' ')]);
  const seen = new Set();
  keys.forEach((k, i) => {
    const e0 = pos.get(k) || { c: 0, n: -1, len: 1e9, kids: new Set() };
    if (i < ucis.length) e0.kids.add(ucis[i]);
    pos.set(k, e0);
    if (seen.has(k)) return; seen.add(k);
    const e = e0;
    e.c++;
    if (i === keys.length - 1 && ucis.length < e.len) { e.n = id; e.len = ucis.length; }
    pos.set(k, e);
  });
}
const p = {};
for (const [k, e] of pos) p[k] = e.kids.size ? [e.c, e.n, [...e.kids].join(' ')] : [e.c, e.n];
fs.writeFileSync(OUT, JSON.stringify({ o: openings, p }));
console.log('openings', openings.length, 'bad', bad, 'positions', pos.size, 'bytes', fs.statSync(OUT).size);
// Collision sanity: count distinct EPDs vs keys on a sample
