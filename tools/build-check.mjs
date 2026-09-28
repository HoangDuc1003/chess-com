// Replays every dictionary line with chess.js and checks the final position with Stockfish.
// Usage: node tools/build-check.mjs
import { Chess } from '../lib/chess.js';
import { LESSONS } from '../app/content/lessons.js';
import { spawn } from 'child_process';
const sf = spawn(process.execPath, [new URL('../engine/stockfish.js', import.meta.url).pathname]);
let buf = '', waiters = [];
sf.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); for (const w of waiters.slice()) w(l); } });
const send = c => sf.stdin.write(c + '\n');
function evalFen(fen, ms = 800) { return new Promise(res => { let last = null; const w = l => { const m = l.match(/score (cp|mate) (-?\d+)/); if (m && !/bound/.test(l)) last = m[1] + ' ' + m[2]; if (l.startsWith('bestmove')) { waiters = waiters.filter(x => x !== w); res(last); } }; waiters.push(w); send('position fen ' + fen); send('go movetime ' + ms); }); }
send('uci'); send('setoption name Hash value 64');
let bad = 0;
for (const L of LESSONS) {
  const g = new Chess(L.fen || undefined);
  const sans = L.moves.split(' ');
  const plies = [];
  try { for (const s of sans) plies.push(g.move(s).san); }
  catch (e) { console.log('ILLEGAL', L.id, e.message); bad++; continue; }
  const endMate = g.isCheckmate(), endStale = g.isStalemate();
  const claimsMate = sans[sans.length - 1].endsWith('#');
  const flags = [];
  if (claimsMate && !endMate) flags.push('CLAIMS MATE BUT NOT');
  if (L.id === 'stalemate' && !endStale) flags.push('NOT STALEMATE');
  let ev = '';
  if (!g.isGameOver()) {
    const s = await evalFen(g.fen());
    // convert to loser's perspective
    const [k, v] = s.split(' '); const stm = g.turn();
    const val = (stm === L.loser ? 1 : -1) * +v;
    ev = `loser-eval ${k} ${val}`;
    if (!L.mild && ((k === 'cp' && val > -150) || (k === 'mate' && val > 0))) flags.push('LOSER NOT CLEARLY WORSE');
  }
  const noteCheck = Object.keys(L.notes || {}).map(i => `${i}:${plies[i] ?? '??'}`).join(' ');
  console.log((flags.length ? 'CHECK ' : 'OK    ') + L.id.padEnd(20), endMate ? 'mate' : endStale ? 'stalemate' : ev, flags.join(','), '|', noteCheck);
  if (flags.length) bad++;
}
console.log('problems:', bad);
send('quit');
