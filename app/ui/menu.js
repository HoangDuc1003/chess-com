// Main menu: sidebar / icon rail on larger screens, slide-out drawer on phones, page titles.
import { PAGES } from '../core/config.js';
import { S } from '../core/state.js';
import { save } from '../core/storage.js';
import { $, isPhone } from '../core/util.js';
import { exitPuzzle } from '../game/puzzle.js';
import { closeMore, runCmd } from './controls.js';
import { openSheet } from './dialogs.js';
import { renderBots, renderDict } from './panes.js';
import { doInstall } from './pwa.js';
import { renderAll } from './render.js';
import { setSound, sfx, unlockAudio } from './sound.js';

/* Highlight the current section, set the page title and show the sound state. */
export function renderNav() {
  document.querySelectorAll('#nav [data-go]').forEach((b) => {
    if (b.dataset.go === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const [t, sub] = PAGES[S.tab] || PAGES.play;
  $('#pageTitle').textContent = t;
  $('#pageSub').textContent = sub;
  if (!window.claude) document.title = S.tab === 'play' ? 'Đấu Stockfish' : `${t} · Đấu Stockfish`;
  const snd = $('#nav [data-nav="sound"]');
  const lab = S.sound ? 'Âm thanh: bật' : 'Âm thanh: tắt';
  snd.querySelector('.l').textContent = lab;
  snd.title = lab + ' (bấm để ' + (S.sound ? 'tắt' : 'bật') + ')';
  snd.classList.toggle('muted', !S.sound);
}
export function applyNavMini() {
  document.documentElement.classList.toggle('nav-mini', S.navMini);
  const b = $('#nav [data-nav="collapse"]');
  const lab = S.navMini ? 'Mở rộng menu' : 'Thu gọn menu';
  b.setAttribute('aria-label', lab);
  b.title = lab;
}

/* Switch section; from the menu on a phone, also bring that section into view. */
export function goTab(tab, fromMenu) {
  if (S.pz && tab === 'play') exitPuzzle();
  else {
    S.tab = tab;
    if (tab === 'dict') renderDict();
    renderAll();
  }
  if (fromMenu && isPhone()) {
    requestAnimationFrame(() => {
      if (tab === 'play' || tab === 'puzz') window.scrollTo({ top: 0, behavior: 'smooth' });
      else document.querySelector('.side').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

/* ---------- phone drawer ---------- */
const DRAWER_Q = window.matchMedia('(max-width: 979px) and (min-height: 561px), (max-width: 599px)');
const LANDSCAPE_Q = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
function drawerMode() { return DRAWER_Q.matches && !LANDSCAPE_Q.matches; }
export function navOpen() { return document.documentElement.classList.contains('nav-open'); }
function openNav() {
  if (!drawerMode() || navOpen()) return;
  closeMore();
  document.documentElement.classList.add('nav-open');
  $('#scrim').hidden = false;
  $('#btnMenu').setAttribute('aria-expanded', 'true');
  $('.app').inert = true;
  $('#mbar').inert = true;
  requestAnimationFrame(() => ($('#nav [aria-current="page"]') || $('#nav .nav-i')).focus({ preventScroll: true }));
}
export function closeNav(returnFocus) {
  if (!navOpen()) return;
  document.documentElement.classList.remove('nav-open');
  $('#scrim').hidden = true;
  $('#btnMenu').setAttribute('aria-expanded', 'false');
  $('.app').inert = false;
  $('#mbar').inert = false;
  if (returnFocus) $('#btnMenu').focus({ preventScroll: true });
}

/* ---------- menu items ---------- */
function onNavClick(e) {
  if (e.target.closest('.nav-brand')) { e.preventDefault(); closeNav(false); goTab('play', true); return; }
  const g = e.target.closest('[data-go]');
  if (g) { closeNav(false); goTab(g.dataset.go, true); return; }
  const a = e.target.closest('[data-nav]');
  if (!a) { if (e.target.closest('a')) closeNav(false); return; }
  unlockAudio();
  switch (a.dataset.nav) {
    case 'close': closeNav(true); break;
    case 'newgame': closeNav(false); runCmd('newgame'); break;
    case 'stats': closeNav(false); openSheet('stats'); break;
    case 'help': closeNav(false); openSheet('help'); break;
    case 'install': closeNav(false); doInstall(); break;
    case 'sound':
      S.sound = !S.sound;
      setSound(S.sound);
      if (S.sound) sfx('move');
      renderNav();
      if (S.tab === 'bots') renderBots();
      save();
      break;
    case 'collapse': S.navMini = !S.navMini; applyNavMini(); save(); break;
  }
}

export function bindMenu() {
  const nav = $('#nav');
  nav.addEventListener('click', onNavClick);
  $('#btnMenu').addEventListener('click', () => (navOpen() ? closeNav(true) : openNav()));
  $('#scrim').addEventListener('click', () => closeNav(true));
  for (const q of [DRAWER_Q, LANDSCAPE_Q]) q.addEventListener?.('change', () => { if (!drawerMode()) closeNav(false); });
  // Swipe the drawer to the left to close it.
  let x0 = null, y0 = 0;
  nav.addEventListener('touchstart', (e) => { if (navOpen()) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
  nav.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) closeNav(false);
  }, { passive: true });
}
