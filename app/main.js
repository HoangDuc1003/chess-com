// Entry point: restore the saved game, draw the first frame, load data and start Stockfish.
import { HASH_MB, THREADS } from './core/config.js';
import { bot, botStamp, S } from './core/state.js';
import { load, restore, snapshot } from './core/storage.js';
import { $ } from './core/util.js';
import { loadOpenings } from './content/openings.js';
import { loadPuzzles } from './content/puzzles.js';
import { eng } from './analysis/scheduler.js';
import { bindControls } from './ui/controls.js';
import { bindDialogs } from './ui/dialogs.js';
import { board, drawBoard } from './ui/main-board.js';
import { applyNavMini, bindMenu } from './ui/menu.js';
import { setupPwa } from './ui/pwa.js';
import { renderAll, renderPill } from './ui/render.js';
import { setHaptics, setSound } from './ui/sound.js';

function start(hotData) {
  restore(hotData && Object.keys(hotData).length ? hotData : load());
  setSound(S.sound);
  setHaptics(S.haptics);
  document.documentElement.dataset.board = S.boardTheme;
  if (S.started && !S.gameBot) S.gameBot = botStamp(bot());
  if (S.started && !S.gameId) S.gameId = Date.now();
  if (!S.started) S.tab = S.tab === 'play' ? 'bots' : S.tab;

  bindControls();
  bindMenu();
  bindDialogs();
  applyNavMini();
  setupPwa();

  board.setOrientation(S.orientation);
  drawBoard(null);
  renderPill();
  renderAll();

  loadPuzzles().then(() => { if (S.tab === 'puzz') renderAll(); }).catch(() => {});
  loadOpenings().then(() => renderAll()).catch(() => { $('#ostrip').innerHTML = '<span class="off">Không tải được dữ liệu khai cuộc</span>'; });
  eng.boot(HASH_MB, THREADS);
}

// Inside a Claude artifact the page can be hot-reloaded with its state kept.
window.claude?.hot?.snapshot?.(() => snapshot());
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
