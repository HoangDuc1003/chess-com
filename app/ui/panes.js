// Side panes: openings, mistake dictionary, opponents & settings, puzzles.
import { Chess } from '../../lib/chess.js';
import { BOARD_THEMES, MODES, TC_CATS, TCS } from '../core/config.js';
import { bot, fenAtPly, openingInfo, S, viewPly } from '../core/state.js';
import { $, esc, sanHtml, START_FEN, uciObj } from '../core/util.js';
import { LESSON_CATS, lessonById, LESSONS } from '../content/lessons.js';
import { guideFor, vnName } from '../content/opening-guides.js';
import { LIBRARY, LIBRARY_CATS } from '../content/opening-library.js';
import { bookEntry, continuations, deepestName, mainLine, opening, openingsReady, sanLine, simulationLine } from '../content/openings.js';
import { LEVELS, PUZZLE_GROUPS, puzzleCount, puzzlesReady, themeNames } from '../content/puzzles.js';
import { pvSan } from '../analysis/review.js';
import { eng } from '../analysis/scheduler.js';
import { BOTS, eloText } from '../game/bots.js';
import { renderTabs } from './render.js';
import { Sim } from './sim.js';

/* One mini board for opening lines, one for dictionary lessons. */
const simOpen = new Sim();
const simDict = new Sim();
let simOpenOn = false;
simOpen.onClose = () => { simOpenOn = false; renderOpen(); };
simDict.onClose = () => { S.lesson = null; renderDict(); };

/* ---------- openings ---------- */
export function renderOpen() {
  const pane = $('#paneOpen');
  if (!openingsReady()) { pane.innerHTML = '<p class="note">Đang tải dữ liệu khai cuộc…</p>'; return; }
  const vp = viewPly();
  const fen = fenAtPly(vp);
  const a = openingInfo(vp);
  const cur = a && a.current ? opening(a.current.id) : null;
  let html = '';
  if (cur) {
    const gd = guideFor(cur.name);
    html += `<div class="ocard"><div class="lab">Khai cuộc đang chơi <small>${cur.eco}</small></div><h3>${esc(gd.vn)}</h3><div class="en">${esc(cur.name)}</div><p>${esc(gd.idea)}</p>
      <div class="plans"><div><h4>Trắng muốn</h4><ul>${gd.white.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h4>Đen muốn</h4><ul>${gd.black.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <div class="tip"><b>Mẹo:</b> ${esc(gd.tip)}</div></div>`;
  } else {
    html += `<div class="ocard"><div class="lab">Khai cuộc</div><h3>Bắt đầu ván cờ</h3><p>Ba nguyên tắc khai cuộc: chiếm trung tâm bằng tốt, phát triển Mã và Tượng, nhập thành sớm. Chọn một nước bên dưới để xem mô phỏng.</p></div>`;
  }
  if (a && a.events.length) {
    html += `<div class="lab">Diễn biến khai cuộc</div><div class="tl">${a.events.map((ev) => {
      const rec = S.hist[ev.ply - 1];
      const me = rec.color === S.userColor;
      const n = Math.floor((ev.ply - 1) / 2) + 1;
      return `<button type="button" data-act="goto" data-p="${ev.ply}"><span class="who2${me ? ' me' : ''}">${n}${rec.color === 'w' ? '.' : '…'} ${esc(rec.san)} · ${me ? 'Bạn' : 'Máy'}</span><span class="nm2">${esc(vnName(opening(ev.id).name))}</span></button>`;
    }).join('')}</div>`;
  }
  const conts = continuations(fen, 6);
  const g = new Chess(fen);
  const whose = g.turn() === S.userColor ? 'Lượt bạn · các nước lý thuyết' : `${bot().name} có thể đáp`;
  if (conts.length) {
    html += `<div class="lab">Hướng đi tiếp theo <small>${esc(whose)}</small></div><div class="conts">${conts.map((c) => {
      const o = c.id >= 0 ? opening(c.id) : null;
      return `<button type="button" class="cont" data-act="simcont" data-uci="${c.uci}"><span class="mv">${sanHtml(c.san, g.turn())}</span><span class="cn"><b>${o ? esc(vnName(o.name)) : 'Nước lý thuyết'}</b><small>${o ? esc(o.name) : ''}</small></span><span class="ct">${c.count} biến ▶</span></button>`;
    }).join('')}</div>`;
  } else if (vp > 0) {
    html += `<div class="ocard"><p>Thế cờ này đã ra khỏi sách khai cuộc${a && a.lastBookPly ? ` từ nước ${Math.floor(a.lastBookPly / 2) + 1}` : ''}. Từ đây hãy chơi theo nguyên tắc và tính toán.</p>${cur ? `<div><button type="button" class="btn" data-act="simmain">Xem tuyến chính của ${esc(vnName(cur.name))}</button></div>` : ''}</div>`;
  }
  html += '<div id="simSlotOpen"></div>';
  html += `<div class="lab">Thư viện khai cuộc <small>${LIBRARY.length} tuyến chính · bấm để xem mô phỏng</small></div>
    <div class="cats">${LIBRARY_CATS.map((c) => `<button type="button" data-act="libcat" data-v="${c.id}" aria-pressed="${S.libCat === c.id}">${esc(c.vn)}</button>`).join('')}</div>
    <div class="libs">${LIBRARY.map((L, i) => (L.cat === S.libCat ? `<button type="button" data-act="simlib" data-i="${i}" title="${L.side === 'w' ? 'Góc nhìn Trắng' : 'Góc nhìn Đen'}"><span class="sd ${L.side}"></span>${esc(L.vn)}</button>` : '')).join('')}</div>`;
  pane.innerHTML = html;
  if (simOpenOn) $('#simSlotOpen').appendChild(simOpen.el);
}
/* Build a line for the openings mini board: a book move from here, the main line of the current opening, or a library line. */
export function simulate(kind, d) {
  if (kind === 'simcont') {
    const fen = fenAtPly(viewPly());
    const line = simulationLine(fen, d.uci, 12);
    const id = deepestName(line);
    openSim({ fen, line, title: id >= 0 ? vnName(opening(id).name) : 'Mô phỏng', sub: id >= 0 ? opening(id).name : '', orient: S.orientation, openingNames: true });
  } else if (kind === 'simmain') {
    const a = openingInfo(viewPly());
    if (!a || !a.current) return;
    const o = opening(a.current.id);
    const g = new Chess();
    const line = [];
    for (const u of o.ucis) { const m = g.move(uciObj(u)); const be = bookEntry(g.fen()); line.push({ uci: u, san: m.san, n: be ? be.n : -1 }); }
    for (const s of mainLine(g.fen(), 8)) line.push(s);
    openSim({ line, title: vnName(o.name), sub: o.name, orient: S.orientation, openingNames: true });
  } else if (kind === 'simlib') {
    const L = LIBRARY[+d.i];
    const line = sanLine(L.san);
    const id = deepestName(line);
    openSim({ line, title: L.vn, sub: id >= 0 ? opening(id).name : '', orient: L.side, openingNames: true });
  }
}
function openSim(opts) {
  simOpenOn = true;
  S.tab = 'open';
  renderTabs();
  renderOpen();
  simOpen.load(opts);
  requestAnimationFrame(() => simOpen.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

/* ---------- mistake dictionary ---------- */
export function renderDict() {
  const pane = $('#paneDict');
  const L = S.lesson && lessonById(S.lesson);
  if (L) {
    const cat = LESSON_CATS.find((c) => c.id === L.cat);
    pane.innerHTML = `<div><button type="button" class="btn ghost" data-act="lessonback">← Tất cả bài</button></div>
      <div class="lv ocard"><span class="lesson"><span class="tg">${esc(cat.vn)}</span></span><h3>${esc(L.title)}</h3><p>${esc(L.summary)}</p></div>
      <div id="simSlotDict"></div>
      <div class="lv"><div class="avoid"><b>Cách tránh:</b> ${esc(L.avoid)}</div></div>`;
    $('#simSlotDict').appendChild(simDict.el);
    return;
  }
  const list = LESSONS.filter((x) => S.dictCat === 'all' || x.cat === S.dictCat);
  pane.innerHTML = `<p class="note">Các lỗi và bẫy hay gặp nhất, mỗi bài có mô phỏng từng nước. Khi bạn mắc lỗi giống bài nào, huấn luyện viên sẽ gợi ý mở bài đó.</p>
    <div class="cats">${[{ id: 'all', vn: 'Tất cả' }, ...LESSON_CATS].map((c) => `<button type="button" data-act="cat" data-id="${c.id}" aria-pressed="${S.dictCat === c.id}">${esc(c.vn)}</button>`).join('')}</div>
    <div class="lessons">${list.map((x) => `<button type="button" class="lesson" data-act="lesson" data-id="${x.id}"><span class="tg">${esc(LESSON_CATS.find((c) => c.id === x.cat).vn)} · ${x.loser === 'w' ? 'Trắng' : 'Đen'} mắc lỗi</span><b>${esc(x.title)}</b><small>${esc(x.summary)}</small></button>`).join('')}</div>`;
}
export function openLesson(id) {
  const L = lessonById(id);
  if (!L) return;
  S.lesson = id;
  S.tab = 'dict';
  renderTabs();
  renderDict();
  const fen = L.fen || START_FEN;
  simDict.load({ fen, line: L.moves.split(' ').map((san) => ({ san })), title: L.title, sub: `Nhìn từ phía ${L.loser === 'w' ? 'Trắng' : 'Đen'} (bên mắc lỗi)`, orient: L.loser, speed: 1700, notes: L.notes });
  $('#sideBody').scrollTop = 0;
}

export function closeLesson() {
  simDict.stop();
  S.lesson = null;
  renderDict();
}

/* ---------- opponents & settings ---------- */
export function renderBots() {
  const b = bot();
  const f = MODES[S.mode];
  const won = new Set(S.games.filter((g) => g.r === 'w').map((g) => g.b));
  const botBtn = (x) => `<button type="button" data-act="bot" data-id="${x.id}" aria-pressed="${S.botId === x.id}" title="${esc(x.name)}${won.has(x.id) ? ' · đã thắng' : ''}"><span class="ava" style="background:${x.tone}"><i class="${x.icon}"></i></span><small>${eloText(x)}</small>${won.has(x.id) ? '<em class="won" aria-hidden="true">✓</em>' : ''}</button>`;
  const custom = { id: 'custom', name: 'Tùy chỉnh', tone: '#6b6f7a', icon: 'wr' };
  $('#paneBots').innerHTML = `
    <div class="botsel"><span class="ava" style="background:${b.tone}"><i class="${b.icon}"></i></span><div><b>${esc(b.name)}</b> <span class="rt">${eloText(b)}</span><p>${esc(b.blurb)}</p></div></div>
    <div class="botgrid">${BOTS.map(botBtn).join('')}<button type="button" data-act="bot" data-id="custom" aria-pressed="${S.botId === 'custom'}" title="Tùy chỉnh Elo"><span class="ava" style="background:${custom.tone}"><i class="${custom.icon}"></i></span><small>Tùy chỉnh</small></button></div>
    ${S.botId === 'custom' ? `<div class="opt"><div class="lab">Elo tùy chỉnh <small>${S.customElo}</small></div><input type="range" id="customElo" min="1320" max="3190" step="10" value="${S.customElo}" aria-label="Elo tùy chỉnh"></div>` : ''}
    <div class="lab">Cầm quân</div>
    <div class="seg">${[['w', 'Trắng', 'wk'], ['r', 'Ngẫu nhiên', 'wn'], ['b', 'Đen', 'bk']].map(([v, t, ic]) => `<button type="button" data-act="side" data-v="${v}" aria-pressed="${S.sideChoice === v}"><i class="k ${ic}"></i>${t}</button>`).join('')}</div>
    <div class="lab">Chế độ</div>
    <div class="seg">${Object.entries(MODES).map(([k, m]) => `<button type="button" data-act="mode" data-v="${k}" aria-pressed="${S.mode === k}">${m.vn}<small>${m.desc}</small></button>`).join('')}</div>
    <div class="lab">Thể thức <small>${S.tc === 'none' ? 'không tính giờ' : 'áp dụng từ ván mới'}</small></div>
    <div class="tcs">
      <button type="button" class="tc-none" data-act="tc" data-v="none" aria-pressed="${S.tc === 'none'}">Không giới hạn thời gian</button>
      ${TC_CATS.map(([cat, col, ids]) => `<div class="tcrow"><span style="color:${col}">${cat}</span>${ids.map((id) => `<button type="button" data-act="tc" data-v="${id}" aria-pressed="${S.tc === id}">${TCS[id].vn}</button>`).join('')}</div>`).join('')}
    </div>
    <button type="button" class="btn go big" data-act="new">Chơi${S.tc !== 'none' ? ` <small class="tcb">${TCS[S.tc].vn}</small>` : ''}</button>
    <details class="adv"><summary>Tùy chọn khác</summary>
      <div class="opt"><div class="lab">Thời gian nghĩ của máy <small>${b.weak ? 'bot dưới 1320 tự điều chỉnh' : b.ultraMs ? 'Siêu cấp: 10 giây' : ''}</small></div>
        <div class="segs">${[[500, '0,5 s'], [1000, '1 s'], [2000, '2 s'], [5000, '5 s']].map(([v, t]) => `<button type="button" data-act="time" data-v="${v}" aria-pressed="${S.movetime === v}" ${b.weak || b.ultraMs ? 'disabled' : ''}>${t}</button>`).join('')}</div></div>
      <div class="opt"><div class="lab">Bàn cờ</div>
        <label class="sw"><input type="checkbox" id="optPremove" ${S.premovePref ? 'checked' : ''}> Cho đi trước (premove) khi máy đang nghĩ</label>
        <label class="sw"><input type="checkbox" id="optAutoQ" ${S.autoQueen ? 'checked' : ''}> Tự động phong Hậu</label>
        <label class="sw"><input type="checkbox" id="optDots" ${S.showDots ? 'checked' : ''}> Hiện chấm các nước đi hợp lệ</label>
        <label class="sw"><input type="checkbox" id="optBest" ${S.bestArrow ? 'checked' : ''}> Hiện nước tốt nhất khi xem lại ván đã xong</label></div>
      <div class="opt"><label class="sw"><input type="checkbox" id="optSound" ${S.sound ? 'checked' : ''}> Âm thanh</label>
        <label class="sw"><input type="checkbox" id="optEval" ${S.evalBarPref ? 'checked' : ''} ${f.evalBar ? '' : 'disabled'}> Thanh đánh giá (chế độ Học tập)</label>
        <label class="sw"><input type="checkbox" id="optPause" ${S.pausePref ? 'checked' : ''} ${f.pause ? '' : 'disabled'}> Dừng lại khi tôi đi sai (chế độ Học tập)</label>
        ${'vibrate' in navigator ? `<label class="sw"><input type="checkbox" id="optHaptics" ${S.haptics ? 'checked' : ''}> Rung khi ăn quân và khi đi sai</label>` : ''}</div>
      <div class="opt"><div class="lab">Màu bàn cờ</div>
        <div class="themes">${BOARD_THEMES.map(([id, vn, a, b2]) => `<button type="button" data-act="theme" data-v="${id}" aria-pressed="${S.boardTheme === id}"><span class="sw4" style="--a:${a};--b:${b2}"></span>${vn}</button>`).join('')}</div></div>
      <div class="opt"><div class="lab">Cài như ứng dụng</div>
        <p class="note">Android, máy tính: bấm <b>Cài ứng dụng</b> ở góc trên (nếu trình duyệt hỗ trợ). iPhone: mở bằng Safari, bấm Chia sẻ rồi <b>Thêm vào MH chính</b>. Sau lần mở đầu tiên, trang chơi được cả khi không có mạng.</p></div>
    </details>
    <p class="fine">Elo của các bot dưới 1320 là ước lượng. Từ 1320 trở lên dùng thang Elo engine của Stockfish, thường cao hơn Elo online. Đổi bot hoặc chế độ có hiệu lực ngay; bấm Chơi để bắt đầu ván mới. Engine: Stockfish 17.1 (GPLv3)${eng.threads > 1 ? `, đang chạy ${eng.threads} luồng` : ''}. Khai cuộc: lichess chess-openings (CC0). Quân cờ: bộ cburnett (CC BY-SA 3.0).</p>`;
}

/* ---------- puzzles ---------- */
export function renderPuzz() {
  const pane = $('#panePuzz');
  if (!puzzlesReady()) { pane.innerHTML = '<p class="note">Đang tải thế cờ…</p>'; return; }
  const pz = S.pz;
  const dots = S.pzHist.slice(-16).map((h) => `<i class="${h.ok ? 'ok' : 'no'}${h.hint ? ' hint' : ''}" title="Độ khó ${h.rating}"></i>`).join('');
  let html = `<div class="pzstats"><div><small>Điểm giải đố</small><b>${S.pzRating}</b></div><div><small>Chuỗi đúng</small><b>${S.pzStreak}</b></div><div><small>Đã giải đúng</small><b>${S.pzSolved}/${S.pzGames}</b></div></div>`;
  if (dots) html += `<div class="pzdots" aria-label="Kết quả gần đây">${dots}</div>`;
  if (pz) {
    const side = pz.color === 'w' ? 'Trắng' : 'Đen';
    const tags = themeNames(pz.p.themes).map((t) => `<span>${esc(t)}</span>`).join('');
    const delta = pz.rated && !pz.usedHint ? ` <span class="delta ${pz.delta >= 0 ? 'up' : 'down'}">${pz.delta >= 0 ? '+' : ''}${pz.delta}</span>` : '';
    let body;
    if (pz.status === 'solving') {
      body = `<h3>Lượt ${side}: tìm nước tốt nhất</h3><p>${esc(pz.msg || 'Đối thủ vừa đi. Hãy tìm nước mạnh nhất.')}</p>
        <div class="acts"><button type="button" class="btn go" data-act="pzhint">Gợi ý</button><button type="button" class="btn" data-act="pzsol">Xem lời giải</button><button type="button" class="btn" data-act="pznext">Bỏ qua</button></div>`;
    } else {
      const title = pz.status === 'shown' ? 'Lời giải' : pz.failed || pz.usedHint ? 'Đã giải xong' : 'Chính xác!';
      const sol = pvSan(new Chess(pz.p.fen).fen(), pz.p.moves, 12);
      body = `<h3>${title}${delta}</h3><p>${pz.usedHint ? 'Có dùng gợi ý nên thế này không tính điểm.' : pz.failed || pz.status === 'shown' ? 'Lần sau sẽ tốt hơn. Xem lại các nước bằng lời giải bên dưới.' : 'Bạn tìm ra toàn bộ lời giải ngay lần đầu.'}</p>
        <p class="sol">${esc(sol)}</p><div class="tags">${tags}</div>
        <div class="acts"><button type="button" class="btn go" data-act="pznext">Thế tiếp theo</button><button type="button" class="btn" data-act="pzexit">Về ván cờ</button></div>`;
    }
    html += `<div class="pzcard ${pz.status}${pz.failed ? ' failed' : ''}"><div class="lab"><span>Thế cờ <span class="pid">#${esc(pz.p.id)}</span></span><small>độ khó ${pz.p.rating}</small></div>${body}</div>`;
    if (pz.status === 'solving') html += '<button type="button" class="btn ghost" data-act="pzexit">← Về ván cờ (ván đang chơi được giữ nguyên)</button>';
  } else {
    html += `<div class="ocard"><h3>Giải thế cờ</h3><p>${puzzleCount().toLocaleString('vi-VN')} thế cờ thật từ lichess: chiếu hết, đòn chiến thuật, khai cuộc, trung cuộc, tàn cuộc. Độ khó tự điều chỉnh theo điểm của bạn. Ván cờ đang chơi được tạm dừng và giữ nguyên.</p><button type="button" class="btn go big" data-act="pzstart">Bắt đầu giải</button></div>`;
  }
  html += `<div class="lab">Độ khó</div><div class="segs">${LEVELS.map((l) => `<button type="button" data-act="pzlevel" data-v="${l.id}" aria-pressed="${S.pzLevel === l.id}">${l.vn}</button>`).join('')}</div>`;
  html += PUZZLE_GROUPS.map((g) => `<div class="chipgrp"><div class="lab">${esc(g.vn)}</div><div class="cats">${g.chips.map((c) => `<button type="button" data-act="pzchip" data-v="${c.id}" aria-pressed="${S.pzChip === c.id}">${esc(c.vn)}</button>`).join('')}</div></div>`).join('');
  html += '<p class="fine">Thế cờ lấy từ cơ sở dữ liệu giải đố của lichess.org (CC0). Mỗi thế bắt đầu bằng nước đi của đối thủ; bạn tìm đòn đáp trả. Ở nước chiếu hết cuối cùng, mọi nước chiếu hết đều được tính đúng.</p>';
  pane.innerHTML = html;
}
