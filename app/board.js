// Board view: squares, pieces, highlights, arrows, badges, drag & drop, right-click annotations.
import { Chess } from '../lib/chess.js';
import { CLASSES } from './review.js';

const FILES = 'abcdefgh';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const ARROW_COLORS = {
  o: 'rgba(255,170,0,.82)', g: 'rgba(98,178,56,.85)', b: 'rgba(72,178,240,.82)', r: 'rgba(235,80,64,.82)',
  hint: 'rgba(98,178,56,.9)', preview: 'rgba(72,178,240,.75)', best: 'rgba(98,178,56,.9)', threat: 'rgba(235,80,64,.8)',
};
const SQUARE_MARK = { r: 'rgba(235,97,80,.78)', g: 'rgba(98,178,56,.7)', b: 'rgba(72,178,240,.7)', o: 'rgba(255,170,0,.72)' };
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function parseBoard(fen) {
  const map = new Map();
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map.set(FILES[f] + (8 - r), color + ch.toLowerCase());
      f++;
    }
  });
  return map;
}

export function badgeSvg(cls, size = 20) {
  const c = CLASSES[cls];
  if (!c) return '';
  let inner;
  if (c.sym === 'book') {
    inner = '<path d="M5 6.2c1.6-.9 3.6-.9 5 .3 1.4-1.2 3.4-1.2 5-.3v8c-1.6-.9-3.6-.9-5 .3-1.4-1.2-3.4-1.2-5-.3z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 6.5v8" stroke="#fff" stroke-width="1.3"/>';
  } else if (c.sym === '★') {
    inner = '<path d="M10 4.2l1.75 3.6 3.95.55-2.87 2.77.7 3.93L10 13.2l-3.53 1.85.7-3.93L4.3 8.35l3.95-.55z" fill="#fff"/>';
  } else if (c.sym === '✓') {
    inner = '<path d="M6 10.3l2.6 2.6L14.2 7.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if (c.sym === '✕') {
    inner = '<path d="M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>';
  } else if (c.sym === '□') {
    inner = '<rect x="6.3" y="6.3" width="7.4" height="7.4" rx="1" fill="none" stroke="#fff" stroke-width="1.8"/>';
  } else {
    const fs = c.sym.length > 1 ? 9.2 : 11.5;
    inner = `<text x="10" y="10.4" text-anchor="middle" dominant-baseline="central" font-family="Be Vietnam Pro,system-ui,sans-serif" font-weight="800" font-size="${fs}" fill="#fff" letter-spacing="-.4">${c.sym}</text>`;
  }
  return `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><circle cx="10" cy="10" r="9.3" fill="${c.color}" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>${inner}</svg>`;
}

export class BoardView {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = { interactive: false, coords: true, ...opts };
    this.orientation = 'w';
    this.fen = START;
    this.pieces = parseBoard(START);
    this.lastMove = null;
    this.checkSq = null;
    this.selected = null;
    this.targets = new Map();
    this.userArrows = [];
    this.userSquares = new Map();
    this.sysArrows = [];
    this.badge = null;
    this.drag = null;
    this.rc = null;
    this.hover = null;
    this.premoves = [];
    this.selMode = 'move';
    root.classList.add('cb');
    root.innerHTML = '<div class="cb-sq"></div><svg class="cb-arrows" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="cb-badge" hidden></div><div class="cb-promo" hidden></div>';
    this.sqEl = root.querySelector('.cb-sq');
    this.svg = root.querySelector('.cb-arrows');
    this.badgeEl = root.querySelector('.cb-badge');
    this.promoEl = root.querySelector('.cb-promo');
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    if (this.opts.interactive) this._bind();
    this.render();
  }

  /* ---------- geometry ---------- */
  sqAt(r, c) { return this.orientation === 'w' ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1); }
  rc2(sq) {
    const f = FILES.indexOf(sq[0]), r = +sq[1];
    return this.orientation === 'w' ? [8 - r, f] : [r - 1, 7 - f];
  }
  center(sq) { const [r, c] = this.rc2(sq); return [c + 0.5, r + 0.5]; }
  squareFromPoint(x, y) {
    const b = this.sqEl.getBoundingClientRect();
    const c = Math.floor(((x - b.left) / b.width) * 8);
    const r = Math.floor(((y - b.top) / b.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return this.sqAt(r, c);
  }

  /* ---------- state ---------- */
  set({ fen, lastMove = null, check = null, animate = null } = {}) {
    if (fen) { this.fen = fen; this.pieces = parseBoard(fen); }
    this.lastMove = lastMove;
    this.checkSq = check;
    this.selected = null;
    this.targets.clear();
    const d = this.drag;
    if (d) {
      // The position changed under a dragged piece (the opponent moved): keep dragging with fresh targets.
      const mode = this._mode();
      const p = this._view().get(d.from);
      if (mode && p && p[0] === this.opts.myColor()) this._select(d.from, mode, true);
      else this._dropDrag();
    }
    this.render();
    if (animate) this.animate(animate.from, animate.to);
  }
  setOrientation(o) { this.orientation = o; this.render(); this.renderOverlays(); }
  setArrows(list) { this.sysArrows = list || []; this.renderOverlays(); }
  setBadge(b) { this.badge = b; this.renderOverlays(); }
  /* Premoves: queued moves made during the opponent's turn, shown on a virtual board. */
  setPremoves(list) {
    this.premoves = list || [];
    if (this.selMode === 'pre') { this.selected = null; this.targets.clear(); }
    this.render();
  }
  cancelPremoves() {
    if (!this.premoves.length && this.selMode !== 'pre') return;
    this.premoves = [];
    if (this.selMode === 'pre') { this.selected = null; this.targets.clear(); }
    this.render();
    this.opts.onPremove && this.opts.onPremove(this.premoves);
  }
  takePremove() { return this.premoves.shift() || null; }
  _view() {
    if (!this.premoves.length) return this.pieces;
    const m = new Map(this.pieces);
    for (const pm of this.premoves) {
      const p = m.get(pm.from);
      if (!p) continue;
      m.delete(pm.from);
      if (p[1] === 'k' && Math.abs(FILES.indexOf(pm.from[0]) - FILES.indexOf(pm.to[0])) === 2) {
        const r = pm.to[1], ks = pm.to[0] === 'g';
        const rp = m.get((ks ? 'h' : 'a') + r);
        if (rp) { m.delete((ks ? 'h' : 'a') + r); m.set((ks ? 'f' : 'd') + r, rp); }
      }
      m.set(pm.to, p[1] === 'p' && (pm.to[1] === '8' || pm.to[1] === '1') ? p[0] + (pm.promotion || 'q') : p);
    }
    return m;
  }
  clearAnnotations() {
    if (!this.userArrows.length && !this.userSquares.size) return;
    this.userArrows = []; this.userSquares.clear();
    this.render(); this.renderOverlays();
  }

  /* ---------- drawing ---------- */
  render() {
    const pcs = this._view();
    const lm = this.lastMove;
    const pm = new Set(this.premoves.flatMap((m) => [m.from, m.to]));
    const dots = !this.opts.showTargets || this.opts.showTargets();
    const mine = this.opts.interactive && this._mode() ? this.opts.myColor() : null;
    let html = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = this.sqAt(r, c);
        const f = FILES.indexOf(sq[0]), rank = +sq[1];
        const light = (f + rank) % 2 === 0;
        const cls = ['s', light ? 'l' : 'd'];
        if (lm && (sq === lm.from || sq === lm.to)) cls.push('lm');
        if (sq === this.selected) cls.push('sel');
        if (sq === this.checkSq) cls.push('chk');
        if (sq === this.hover) cls.push('hov');
        if (pm.has(sq)) cls.push('pm');
        const t = dots && this.targets.get(sq);
        if (t) cls.push(t.captured || pcs.get(sq) ? 'tgt cap' : 'tgt');
        const mark = this.userSquares.get(sq);
        let inner = mark ? `<i class="mk" style="background:${SQUARE_MARK[mark]}"></i>` : '';
        if (this.opts.coords) {
          if (c === 0) inner += `<span class="co r">${rank}</span>`;
          if (r === 7) inner += `<span class="co f">${sq[0]}</span>`;
        }
        const p = pcs.get(sq);
        if (p) inner += `<div class="pc ${p}${this.drag && this.drag.from === sq && this.drag.ghost ? ' lift' : ''}${mine && p[0] === mine ? ' my' : ''}"></div>`;
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
      }
    }
    this.sqEl.innerHTML = html;
  }

  arrowSvg(from, to, color, width = 0.16) {
    const [x1, y1] = this.center(from);
    const [x2, y2] = this.center(to);
    const dx = x2 - x1, dy = y2 - y1;
    const head = width * 2.7, half = width * 1.75;
    const pts = [[x1, y1]];
    const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
    if (knight) pts.push(Math.abs(dy) === 2 ? [x1, y2] : [x2, y1]);
    pts.push([x2, y2]);
    const [px, py] = pts[pts.length - 2];
    const len = Math.hypot(x2 - px, y2 - py) || 1;
    const ux = (x2 - px) / len, uy = (y2 - py) / len;
    const tip = [x2 - ux * 0.08, y2 - uy * 0.08];
    const base = [tip[0] - ux * head, tip[1] - uy * head];
    const shaft = pts.slice(0, -1).concat([base]).map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ');
    const nx = -uy, ny = ux;
    const poly = [tip, [base[0] + nx * half, base[1] + ny * half], [base[0] - nx * half, base[1] - ny * half]]
      .map((p) => p.map((v) => v.toFixed(3)).join(',')).join(' ');
    return `<g><polyline points="${shaft}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/><polygon points="${poly}" fill="${color}"/></g>`;
  }

  renderOverlays() {
    let s = '';
    for (const a of this.sysArrows) s += this.arrowSvg(a.from, a.to, ARROW_COLORS[a.color] || a.color, a.width || 0.16);
    for (const a of this.userArrows) s += this.arrowSvg(a.from, a.to, ARROW_COLORS[a.color], 0.17);
    if (this.rc && this.rc.to && this.rc.to !== this.rc.from) s += this.arrowSvg(this.rc.from, this.rc.to, ARROW_COLORS[this.rc.color], 0.17);
    this.svg.innerHTML = s;
    const b = this.badge;
    if (b && CLASSES[b.cls]) {
      const [r, c] = this.rc2(b.sq);
      this.badgeEl.style.left = `min(calc(${(c + 1) * 12.5}% - 3.4%), calc(100% - var(--bw)))`;
      this.badgeEl.style.top = `calc(${r * 12.5}% - 3%)`;
      this.badgeEl.innerHTML = badgeSvg(b.cls, 100);
      this.badgeEl.hidden = false;
    } else this.badgeEl.hidden = true;
  }

  animate(from, to) {
    if (reduceMotion()) return;
    const el = this.sqEl.querySelector(`[data-sq="${to}"] .pc`);
    if (!el) return;
    const [x1, y1] = this.center(from);
    const [x2, y2] = this.center(to);
    const sz = this.sqEl.getBoundingClientRect().width / 8;
    const dx = (x1 - x2) * sz, dy = (y1 - y2) * sz;
    el.style.zIndex = 6;
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 170, easing: 'cubic-bezier(.2,.7,.3,1)' });
    // castling: slide the rook as well
    const piece = this.pieces.get(to);
    if (piece && piece[1] === 'k' && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
      const rank = to[1];
      const kingSide = to[0] === 'g';
      this.animate(kingSide ? 'h' + rank : 'a' + rank, kingSide ? 'f' + rank : 'd' + rank);
    }
  }

  /* ---------- interaction ---------- */
  _game() { try { return new Chess(this.fen); } catch { return null; } }
  /* 'move' on your turn, 'pre' when a premove is allowed, otherwise null. */
  _mode() {
    if (this.opts.canMove && this.opts.canMove()) return 'move';
    if (this.opts.canPremove && this.opts.canPremove()) return 'pre';
    return null;
  }
  _select(sq, mode = this._mode(), quiet = false) {
    this.selected = sq;
    this.selMode = mode || 'move';
    this.targets.clear();
    if (sq && mode === 'move') {
      const g = this._game();
      if (g) for (const m of g.moves({ square: sq, verbose: true })) this.targets.set(m.to, m);
    } else if (sq && mode === 'pre') {
      const v = this._view();
      for (const to of this._premoveTargets(sq, v)) { const q = v.get(to); this.targets.set(to, { to, captured: q && q[0] !== v.get(sq)[0] ? q[1] : null }); }
    }
    if (!quiet) this.render();
  }
  /* Squares a piece could reach if the board changed in its favour (the usual premove rule). */
  _premoveTargets(sq, pcs) {
    const p = pcs.get(sq);
    if (!p) return [];
    const color = p[0], type = p[1];
    const f = FILES.indexOf(sq[0]), r = +sq[1];
    const out = [];
    const ok = (nf, nr) => nf >= 0 && nf < 8 && nr >= 1 && nr <= 8;
    const add = (df, dr) => { if (ok(f + df, r + dr)) out.push(FILES[f + df] + (r + dr)); };
    const ray = (df, dr) => { for (let k = 1; k < 8 && ok(f + df * k, r + dr * k); k++) out.push(FILES[f + df * k] + (r + dr * k)); };
    const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], LINE = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (type === 'p') {
      const dir = color === 'w' ? 1 : -1;
      add(0, dir); add(-1, dir); add(1, dir);
      if (r === (color === 'w' ? 2 : 7)) add(0, 2 * dir);
    } else if (type === 'n') {
      for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(a, b);
    } else if (type === 'b') DIAG.forEach(([a, b]) => ray(a, b));
    else if (type === 'r') LINE.forEach(([a, b]) => ray(a, b));
    else if (type === 'q') [...DIAG, ...LINE].forEach(([a, b]) => ray(a, b));
    else if (type === 'k') {
      [...DIAG, ...LINE].forEach(([a, b]) => add(a, b));
      const home = color === 'w' ? '1' : '8';
      const rights = (this.fen.split(' ')[2] || '-');
      if (sq === 'e' + home) {
        const moved = this.premoves.some((m) => m.from === 'e' + home);
        if (!moved && rights.includes(color === 'w' ? 'K' : 'k') && pcs.get('h' + home) === color + 'r') out.push('g' + home);
        if (!moved && rights.includes(color === 'w' ? 'Q' : 'q') && pcs.get('a' + home) === color + 'r') out.push('c' + home);
      }
    }
    return out;
  }
  _movable(sq, mode = this._mode()) {
    if (!mode) return false;
    const p = (mode === 'pre' ? this._view() : this.pieces).get(sq);
    return !!p && p[0] === this.opts.myColor();
  }
  _tryMove(from, to, animated) {
    const m = this.targets.get(to);
    if (!m) return false;
    if (this.selMode === 'pre') {
      const p = this._view().get(from);
      const promo = p && p[1] === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
      if (this.premoves.length < 12) this.premoves.push({ from, to, promotion: promo });
      this.selected = null; this.targets.clear();
      this.render();
      this.opts.onPremove && this.opts.onPremove(this.premoves);
      return true;
    }
    const g = this._game();
    const all = g.moves({ square: from, verbose: true }).filter((x) => x.to === to);
    if (all.some((x) => x.promotion)) {
      if (this.opts.autoQueen && this.opts.autoQueen()) { this.selected = null; this.targets.clear(); this.opts.onMove({ from, to, promotion: 'q' }, animated); return true; }
      this._promo(from, to);
      return true;
    }
    this.selected = null; this.targets.clear();
    this.opts.onMove({ from, to }, animated);
    return true;
  }
  /* Lift the piece: it follows the pointer with its centre under the pointer (touch: a bit larger). */
  _lift(x, y) {
    const d = this.drag;
    if (!d || d.ghost) return;
    const sqSize = this.sqEl.getBoundingClientRect().width / 8;
    const size = d.touch ? sqSize * 1.5 : sqSize;
    const g = document.createElement('div');
    g.className = 'cb-ghost ' + this._view().get(d.from);
    g.style.width = g.style.height = size + 'px';
    g.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
    document.body.appendChild(g);
    document.documentElement.classList.add('cb-grabbing');
    d.ghost = g; d.size = size; d.sqSize = sqSize;
    this.render();
  }
  _dropDrag() {
    const d = this.drag;
    if (!d) return;
    if (d.ghost) d.ghost.remove();
    document.documentElement.classList.remove('cb-grabbing');
    this.drag = null;
    this.hover = null;
  }
  _promo(from, to) {
    const col = this.opts.myColor();
    const [, c] = this.rc2(to);
    const atTop = this.rc2(to)[0] === 0;
    this.promoEl.innerHTML = `<div class="cb-promo-col" style="left:${c * 12.5}%;${atTop ? 'top:0' : 'bottom:0'}">${['q', 'n', 'r', 'b']
      .map((t) => `<button type="button" class="${col}${t}" data-p="${t}" aria-label="${{ q: 'Hậu', n: 'Mã', r: 'Xe', b: 'Tượng' }[t]}"></button>`).join('')}<button type="button" class="x" data-p="" aria-label="Hủy">✕</button></div>`;
    this.promoEl.hidden = false;
    const onClick = (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b) return;
      this.promoEl.hidden = true;
      this.promoEl.removeEventListener('click', onClick);
      this.selected = null; this.targets.clear();
      if (b.dataset.p) this.opts.onMove({ from, to, promotion: b.dataset.p }, true);
      else this.render();
    };
    this.promoEl.addEventListener('click', onClick);
  }

  _bind() {
    const el = this.sqEl;
    el.addEventListener('pointerdown', (e) => {
      const sq = this.squareFromPoint(e.clientX, e.clientY);
      if (!sq) return;
      if (e.button === 2) {
        if (this.premoves.length || (this.selected && this.selMode === 'pre')) { this.cancelPremoves(); e.preventDefault(); return; }
        const color = e.shiftKey ? 'g' : e.altKey ? 'b' : (e.ctrlKey || e.metaKey) ? 'r' : null;
        this.rc = { from: sq, to: sq, color: color || 'o', sqColor: color || 'r', id: e.pointerId };
        try { el.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      this.opts.onInteract && this.opts.onInteract();
      if (e.pointerType === 'touch') {
        // Touch has no right button: press and hold a square, then drag, to draw an arrow.
        if (this.lp) clearTimeout(this.lp.timer);
        const lp = { id: e.pointerId, sq, x: e.clientX, y: e.clientY, fired: false };
        lp.timer = setTimeout(() => {
          lp.fired = true;
          if (this.drag && this.drag.id === lp.id) this._dropDrag();
          this.selected = null; this.targets.clear();
          this.rc = { from: lp.sq, to: lp.sq, color: 'o', sqColor: 'r', id: lp.id };
          try { el.setPointerCapture(lp.id); } catch {}
          try { navigator.vibrate && navigator.vibrate(10); } catch {}
          this.render(); this.renderOverlays();
        }, 430);
        this.lp = lp;
      } else {
        this.clearAnnotations();
      }
      const mode = this._mode();
      if (!mode) {
        if (this.opts.onBlocked) this.opts.onBlocked(sq);
        return;
      }
      if (this.selected && this.selMode !== mode) this._select(null, mode);
      if (this.selected && sq !== this.selected && !this._movable(sq, mode)) {
        if (!this._tryMove(this.selected, sq, true)) { this._select(null, mode); if (mode === 'pre') this.cancelPremoves(); }
        return;
      }
      if (this._movable(sq, mode)) {
        const was = this.selected === sq;
        this._select(sq, mode);
        this.drag = { from: sq, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null, was, moved: false, touch: e.pointerType === 'touch' };
        try { el.setPointerCapture(e.pointerId); } catch {}
        if (!this.drag.touch) this._lift(e.clientX, e.clientY);
        e.preventDefault();
      } else {
        if (this.selected) this._select(null, mode);
        if (mode === 'pre' && this.premoves.length) this.cancelPremoves();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.lp && e.pointerId === this.lp.id && !this.lp.fired && Math.hypot(e.clientX - this.lp.x, e.clientY - this.lp.y) > 8) {
        clearTimeout(this.lp.timer);
        this.lp.moved = true;
      }
      if (this.rc && e.pointerId === this.rc.id) {
        const sq = this.squareFromPoint(e.clientX, e.clientY);
        if (sq && sq !== this.rc.to) { this.rc.to = sq; this.renderOverlays(); }
        return;
      }
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (!d.ghost) {
        if (far < 4) return;
        this._lift(e.clientX, e.clientY);
      }
      const over = this.squareFromPoint(e.clientX, e.clientY);
      if (far > 6 || over !== d.from) d.moved = true;
      d.ghost.style.transform = `translate(${e.clientX - d.size / 2}px, ${e.clientY - d.size / 2}px)`;
      if (over !== this.hover) {
        const prev = this.hover && this.sqEl.querySelector(`[data-sq="${this.hover}"]`);
        if (prev) prev.classList.remove('hov');
        this.hover = over;
        const cur = over && this.sqEl.querySelector(`[data-sq="${over}"]`);
        if (cur) cur.classList.add('hov');
      }
    });
    const end = (e, cancelled) => {
      let tap = false;
      if (this.lp && e.pointerId === this.lp.id) {
        clearTimeout(this.lp.timer);
        tap = !this.lp.fired && !this.lp.moved && !cancelled;
        this.lp = null;
      }
      if (this.rc && e.pointerId === this.rc.id) {
        const { from, to, color, sqColor } = this.rc;
        this.rc = null;
        if (!cancelled && to) {
          if (to === from) {
            if (this.userSquares.get(from) === sqColor) this.userSquares.delete(from);
            else this.userSquares.set(from, sqColor);
            this.render();
          } else {
            const i = this.userArrows.findIndex((a) => a.from === from && a.to === to);
            if (i >= 0 && this.userArrows[i].color === color) this.userArrows.splice(i, 1);
            else { if (i >= 0) this.userArrows.splice(i, 1); this.userArrows.push({ from, to, color }); }
          }
        }
        this.renderOverlays();
        return;
      }
      const d = this.drag;
      if (tap) this.clearAnnotations();
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.hover = null;
      document.documentElement.classList.remove('cb-grabbing');
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (d.ghost && !d.moved) {
        // A click: the piece drops back into its square and stays selected (click again to unselect).
        d.ghost.remove();
        if (d.was) this._select(null); else this.render();
        return;
      }
      if (d.ghost) {
        const to = cancelled ? null : this.squareFromPoint(e.clientX, e.clientY);
        if (to && to !== d.from && this.targets.has(to)) {
          d.ghost.remove();
          this._tryMove(d.from, to, false);
          return;
        }
        // Snap back to the starting square.
        const [cx, cy] = this.center(d.from);
        const b = this.sqEl.getBoundingClientRect();
        const tx = b.left + (cx / 8) * b.width - d.size / 2;
        const ty = b.top + (cy / 8) * b.height - d.size / 2;
        const ghost = d.ghost;
        if (d.touch) ghost.style.width = ghost.style.height = d.size + 'px';
        if (to && to !== d.from) this.opts.onIllegal && this.opts.onIllegal();
        if (reduceMotion()) { ghost.remove(); this.render(); return; }
        ghost.style.transition = 'transform .16s cubic-bezier(.2,.7,.3,1)';
        requestAnimationFrame(() => { ghost.style.transform = `translate(${tx}px, ${ty}px)`; });
        setTimeout(() => { ghost.remove(); this.render(); }, 170);
      } else if (d.was) {
        this._select(null);
      }
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }
}
