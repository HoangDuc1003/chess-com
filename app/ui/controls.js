// Input: clicks in the side panel and toolbars, settings, keyboard shortcuts, mouse wheel.
import { flags, S, viewPly } from '../core/state.js';
import { save } from '../core/storage.js';
import { $, isPhone, toast } from '../core/util.js';
import { eng, schedule, startPostReview, viewChanged } from '../analysis/scheduler.js';
import { askResign, flip, go, newGame, retry, showBest, takeback, toggleHint } from '../game/game.js';
import { exitPuzzle, pzHint, pzSolution, startPuzzle } from '../game/puzzle.js';
import { isSheetOpen, openSheet } from './dialogs.js';
import { arrows, board, drawBadge } from './main-board.js';
import { closeNav, goTab, navOpen, renderNav } from './menu.js';
import { closeLesson, openLesson, renderDict, renderOpen, renderPuzz, simulate } from './panes.js';
import { renderPlay } from './play-pane.js';
import { renderAll, renderBars, renderEval, renderSummary } from './render.js';
import { buzz, setHaptics, setSound, unlockAudio } from './sound.js';

/* Buttons inside panes and the game summary carry data-act. */
function onAct(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const d = t.dataset;
  unlockAudio();
  switch (act) {
    // game pane
    case 'tab': S.tab = d.tab; renderAll(); break;
    case 'goto': go(+d.p); break;
    case 'retry': retry(+d.p); break;
    case 'best': showBest(+d.p); break;
    case 'continue': S.paused = false; renderAll(); schedule(); break;
    case 'hint': toggleHint(); break;
    case 'hideopen': S.openCardClosed = d.fam; renderPlay(); break;
    case 'new': newGame(); break;
    case 'postreview': startPostReview(); break;
    case 'closesum': S.overDismissed = true; renderSummary(); break;
    case 'summary': S.overDismissed = false; renderSummary(); break;
    // puzzles
    case 'pzstart': case 'pznext': startPuzzle(); break;
    case 'pzhint': pzHint(); break;
    case 'pzsol': pzSolution(); break;
    case 'pzexit': exitPuzzle(); break;
    case 'pzchip': S.pzChip = d.v; renderPuzz(); save(); break;
    case 'pzlevel': S.pzLevel = d.v; renderPuzz(); save(); break;
    // openings & dictionary
    case 'libcat': S.libCat = d.v; renderOpen(); break;
    case 'simcont': case 'simmain': case 'simlib': simulate(act, d); break;
    case 'lesson': openLesson(d.id); break;
    case 'lessonback': closeLesson(); break;
    case 'cat': S.dictCat = d.id; renderDict(); break;
    // opponents & settings
    case 'bot': S.botId = d.id; renderAll(); break;
    case 'side':
      S.sideChoice = d.v;
      if (!S.hist.length) { S.userColor = S.sideChoice === 'b' ? 'b' : 'w'; S.orientation = S.userColor; board.setOrientation(S.orientation); }
      renderAll();
      break;
    case 'mode':
      S.mode = d.v;
      if (!flags().analysis) { S.hintOn = false; if (eng.is('analysis')) eng.cancel(); }
      renderAll(); drawBadge(); schedule();
      break;
    case 'time': S.movetime = +d.v; renderAll(); break;
    case 'tc': S.tc = d.v; renderAll(); break;
    case 'theme': S.boardTheme = d.v; document.documentElement.dataset.board = S.boardTheme; renderAll(); break;
  }
}

/* Checkboxes and the Elo slider in the settings. */
function onSetting(e) {
  const el = e.target;
  switch (el.id) {
    case 'optSound': S.sound = el.checked; setSound(S.sound); renderNav(); break;
    case 'optHaptics': S.haptics = el.checked; setHaptics(S.haptics); buzz(20); break;
    case 'optPremove': S.premovePref = el.checked; if (!S.premovePref) board.cancelPremoves(); break;
    case 'optAutoQ': S.autoQueen = el.checked; break;
    case 'optDots': S.showDots = el.checked; board.render(); break;
    case 'optBest': S.bestArrow = el.checked; board.setArrows(arrows()); viewChanged(); break;
    case 'optEval': S.evalBarPref = el.checked; renderEval(); break;
    case 'optPause': S.pausePref = el.checked; if (!S.pausePref && S.paused) { S.paused = false; schedule(); } break;
    default: return;
  }
  save();
}
function onEloInput(e) {
  if (e.target.id !== 'customElo') return;
  S.customElo = +e.target.value;
  const l = e.target.previousElementSibling;
  if (l) l.querySelector('small').textContent = S.customElo;
  renderBars();
  save();
}

/* Toolbar buttons (desktop footer, phone bar, "more" menu) carry data-cmd. */
export function closeMore() {
  const m = $('#moreMenu');
  if (m.hidden) return;
  m.hidden = true;
  document.querySelector('[data-cmd="more"]')?.setAttribute('aria-expanded', 'false');
}
export function runCmd(cmd) {
  unlockAudio();
  if (cmd === 'more') {
    const m = $('#moreMenu');
    m.hidden = !m.hidden;
    document.querySelector('[data-cmd="more"]')?.setAttribute('aria-expanded', String(!m.hidden));
    return;
  }
  closeMore();
  switch (cmd) {
    case 'first': go(0); break;
    case 'prev': go(viewPly() - 1); break;
    case 'next': go(viewPly() + 1); break;
    case 'last': go(S.hist.length); break;
    case 'hint': S.pz ? pzHint() : toggleHint(); break;
    case 'undo': if (!S.pz) takeback(); break;
    case 'flip': flip(); break;
    case 'resign': askResign(); break;
    case 'newgame':
      S.tab = 'bots';
      renderAll();
      if (isPhone()) requestAnimationFrame(() => document.querySelector('.side').scrollIntoView({ behavior: 'smooth', block: 'start' }));
      break;
  }
}

function onKey(e) {
  if (isSheetOpen()) return;
  if (navOpen()) { if (e.key === 'Escape') { e.preventDefault(); closeNav(true); } return; }
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === '?') { e.preventDefault(); openSheet('help'); }
  else if (k === 'ArrowLeft') { e.preventDefault(); go(viewPly() - 1); }
  else if (k === 'ArrowRight') { e.preventDefault(); go(viewPly() + 1); }
  else if (k === 'h') { e.preventDefault(); S.pz ? pzHint() : toggleHint(); }
  else if (k === 'g') { e.preventDefault(); if (!S.pz) takeback(); }
  else if ((k === 'n' || k === 'Enter') && S.pz && S.pz.status !== 'solving') { e.preventDefault(); startPuzzle(); }
  else if (k === 'f') { e.preventDefault(); flip(); }
  else if (k === 'Escape') { board.clearAnnotations(); closeMore(); if (S.hintOn) toggleHint(); }
}

/* Mouse wheel over the board steps through the moves (down = forward). */
function wheelStepper() {
  let acc = 0, last = 0;
  return (e) => {
    if (S.pz || isPhone() || !S.hist.length || e.ctrlKey) return;
    e.preventDefault();
    const now = performance.now();
    if (now - last > 350) acc = 0;
    last = now;
    acc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    while (Math.abs(acc) >= 60) { const d = Math.sign(acc); acc -= d * 60; go(viewPly() + d); }
  };
}

/* First touch on the board: tell phone users how to draw arrows (once). */
function touchTip(e) {
  if (e.pointerType !== 'touch') return;
  try {
    if (localStorage.getItem('dau-stockfish-tip-arrow') === '1') return;
    localStorage.setItem('dau-stockfish-tip-arrow', '1');
  } catch { return; }
  setTimeout(() => toast('Mẹo: chạm giữ một ô rồi kéo để vẽ mũi tên', 3500), 600);
}

export function bindControls() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) goTab(b.dataset.tab);
  });
  const openStrip = () => { S.tab = 'open'; renderAll(); };
  $('#ostrip').addEventListener('click', openStrip);
  $('#ostrip').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStrip(); } });

  const side = $('#sideBody');
  side.addEventListener('click', onAct);
  side.addEventListener('input', onEloInput);
  side.addEventListener('change', onSetting);
  // Hovering a book move (openings pane) or a move in a chat answer previews it on the board.
  // Mouse only: on touch screens a tap would fire a hover and a leave around the click.
  side.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const c = e.target.closest('.cont, .mvl');
    const u = c ? c.dataset.uci : null;
    if (u !== S.preview) { S.preview = u; board.setArrows(arrows()); }
  });
  side.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && S.preview) { S.preview = null; board.setArrows(arrows()); } });
  $('#over').addEventListener('click', onAct);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) { runCmd(b.dataset.cmd); return; }
    if (!e.target.closest('#moreMenu')) closeMore();
  });
  document.addEventListener('keydown', onKey);
  $('#boardWrap').addEventListener('wheel', wheelStepper(), { passive: false });
  $('#board').addEventListener('pointerdown', touchTip, { passive: true });
}
