// Offline cache (service worker) and "install as an app".
import { $ } from '../core/util.js';
import { eng } from '../analysis/scheduler.js';
import { openSheet } from './dialogs.js';

let swOn = false;
export function warmOffline() {
  if (!swOn) return;
  const files = eng.threads > 1 ? ['engine/stockfish-mt.js', 'engine/stockfish-mt.wasm'] : ['engine/stockfish.js', 'engine/stockfish.wasm'];
  navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage({ type: 'warm', urls: files.map((f) => new URL(f, document.baseURI).href) })).catch(() => {});
}

export function setupPwa() {
  const btn = $('#btnInstall');
  if (!btn || window.claude) return;
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  swOn = true;
  navigator.serviceWorker.register('sw.js').then(() => { if (eng.ready) warmOffline(); }).catch(() => { swOn = false; });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('#nav [data-nav="install"]').hidden = standalone;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; btn.hidden = false; });
  btn.addEventListener('click', doInstall);
  window.addEventListener('appinstalled', () => { installPrompt = null; btn.hidden = true; $('#nav [data-nav="install"]').hidden = true; });
}
let installPrompt = null;
export async function doInstall() {
  if (!installPrompt) { openSheet('help', 'hInstall'); return; }
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch {}
  installPrompt = null;
  $('#btnInstall').hidden = true;
}
