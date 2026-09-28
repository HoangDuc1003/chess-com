// Mini board that replays a line move by move, with captions (openings and lessons).
import { Chess } from '../../lib/chess.js';
import { esc, kingSq, sanHtml, START_FEN, uciObj } from '../core/util.js';
import { vnName } from '../content/opening-guides.js';
import { opening } from '../content/openings.js';
import { BoardView } from './board.js';

export class Sim {
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
