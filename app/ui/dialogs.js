// Stats and help dialogs.
import { TCS } from '../core/config.js';
import { S } from '../core/state.js';
import { $, esc, fmt1, X_SVG } from '../core/util.js';
import { CLASSES } from '../analysis/review.js';
import { eng } from '../analysis/scheduler.js';
import { botById, BOTS } from '../game/bots.js';
import { badgeSvg } from './board.js';
import { goTab } from './menu.js';

const sheet = $('#sheet');
export function isSheetOpen() { return sheet.open; }
/* Open the stats or help dialog, optionally scrolled to a section. */
export function openSheet(kind, anchorId) {
  const title = kind === 'stats' ? 'Thống kê của bạn' : 'Hướng dẫn';
  sheet.innerHTML = `<div class="sheet-h"><h2 id="sheetTitle">${title}</h2><button type="button" class="sheet-x" data-sheet="close" aria-label="Đóng">${X_SVG}</button></div><div class="sheet-b">${kind === 'stats' ? statsHtml() : helpHtml()}</div>`;
  if (typeof sheet.showModal === 'function') { if (!sheet.open) sheet.showModal(); } else sheet.setAttribute('open', '');
  const body = sheet.querySelector('.sheet-b');
  const target = anchorId && sheet.querySelector('#' + anchorId);
  body.scrollTop = target ? target.offsetTop - body.offsetTop - 8 : 0;
}
function closeSheet() { if (typeof sheet.close === 'function') sheet.close(); else sheet.removeAttribute('open'); }
export function bindDialogs() {
  // A click on the backdrop (the dialog element itself) closes it.
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-sheet="close"]')) { closeSheet(); return; }
    const t = e.target.closest('[data-sheet-go]');
    if (t) { closeSheet(); goTab(t.dataset.sheetGo, true); }
  });
}

/* ---------- stats ---------- */

function sparkSvg(vals) {
  if (vals.length < 2) return '';
  const W = 300, H = 56, p = 6;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(20, hi - lo);
  const pts = vals.map((v, i) => `${(p + ((W - 2 * p) * i) / (vals.length - 1)).toFixed(1)},${(H - p - ((H - 2 * p) * (v - lo)) / span).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Điểm giải đố qua ${vals.length} thế gần nhất, từ ${vals[0]} đến ${vals[vals.length - 1]}"><polyline points="${pts}" fill="none" stroke="#93c35a" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function statsHtml() {
  const G = S.games;
  const n = G.length;
  const cnt = (r) => G.filter((g) => g.r === r).length;
  const w = cnt('w'), d = cnt('d'), l = cnt('l');
  const accs = G.filter((g) => g.acc != null).map((g) => g.acc);
  const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null;
  let h = '<h3>Ván với máy</h3>';
  if (!n) {
    h += '<p>Chưa có ván nào kết thúc. Chơi hết một ván với máy (thắng, hòa hoặc đầu hàng) để bắt đầu có thống kê.</p><div><button type="button" class="btn go" data-sheet-go="bots">Chọn đối thủ</button></div>';
  } else {
    h += `<div class="kpis"><div><small>Ván đã chơi</small><b>${n}</b></div><div><small>Tỉ lệ thắng</small><b>${Math.round((w * 100) / n)}%</b></div><div><small>Độ chính xác TB</small><b>${avg == null ? '—' : fmt1(avg)}</b></div></div>`;
    h += `<div class="wdl" role="img" aria-label="Thắng ${w}, hòa ${d}, thua ${l}">${w ? `<i class="w" style="flex:${w}"></i>` : ''}${d ? `<i class="d" style="flex:${d}"></i>` : ''}${l ? `<i class="l" style="flex:${l}"></i>` : ''}</div>`;
    h += `<div class="wdl-k"><span><i style="background:var(--green)"></i>Thắng <b>${w}</b></span><span><i style="background:#8a8781"></i>Hòa <b>${d}</b></span><span><i style="background:var(--bad)"></i>Thua <b>${l}</b></span></div>`;
  }
  h += '<h3>Giải đố</h3>';
  h += `<div class="kpis"><div><small>Điểm giải đố</small><b>${S.pzRating}</b></div><div><small>Giải đúng</small><b>${S.pzSolved}/${S.pzGames}</b></div><div><small>Chuỗi dài nhất</small><b>${S.pzBest}</b></div></div>`;
  const rs = S.pzHist.filter((x) => Number.isFinite(x.r)).map((x) => x.r);
  h += rs.length >= 2 ? sparkSvg(rs) : `<p class="note">${S.pzGames ? 'Giải thêm vài thế để thấy biểu đồ điểm.' : 'Chưa giải thế cờ nào.'} <button type="button" class="btn ghost" data-sheet-go="puzz" style="padding:4px 8px">Giải đố ngay</button></p>`;
  if (n) {
    const by = new Map();
    for (const g of G) {
      const k = g.b === 'custom' ? `custom:${g.e}` : g.b;
      if (!by.has(k)) by.set(k, { g, w: 0, d: 0, l: 0 });
      by.get(k)[g.r]++;
    }
    const order = (k) => { const i = BOTS.findIndex((b) => b.id === k); return i < 0 ? 99 : i; };
    const rows = [...by.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([k, v]) => {
      const b = botById(v.g.b) || { tone: '#6b6f7a', icon: 'wr' };
      return `<div class="vs-r"><span class="ava" style="background:${b.tone}"><i class="${b.icon}"></i></span><div><b>${esc(v.g.nm)}</b><small>${esc(v.g.e)}${v.w ? ' · đã thắng' : ''}</small></div><div class="sc"><span class="w" title="Thắng">${v.w}</span><span title="Hòa">${v.d}</span><span class="l" title="Thua">${v.l}</span></div></div>`;
    }).join('');
    h += `<h3>Theo đối thủ</h3><div class="vs">${rows}</div>`;
    const RES = { w: 'Thắng', d: 'Hòa', l: 'Thua' };
    const recent = G.slice(-12).reverse().map((g) => {
      const dt = new Date(g.t);
      const when = `${dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
      return `<div class="gl-r"><span class="res ${g.r}">${RES[g.r]}</span><div class="who3"><b>${esc(g.nm)} <span style="color:var(--muted);font-weight:600">${esc(g.e)}</span></b><small>${g.tc && TCS[g.tc] ? TCS[g.tc].vn + ' · ' : ''}${g.c === 'w' ? 'Cầm Trắng' : 'Cầm Đen'} · ${Math.ceil(g.n / 2)} nước · ${esc(g.why)} · ${when}</small></div><div class="ac">${g.acc == null ? '—' : fmt1(g.acc)}<small>chính xác</small></div></div>`;
    }).join('');
    h += `<h3>Ván gần đây</h3><div class="gl">${recent}</div>`;
    h += '<p class="fine">Độ chính xác chỉ có ở ván đã được chấm điểm (chế độ Học tập, Thân thiện, hoặc bấm Chấm điểm sau ván Thử thách). Thống kê lưu trong trình duyệt này.</p>';
  }
  return h;
}
/* ---------- help ---------- */
function helpHtml() {
  const key = (k, t) => `<span>${k}</span><span>${t}</span>`;
  const legend = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']
    .map((k) => `<span>${badgeSvg(k, 20)}${CLASSES[k].vn}</span>`).join('');
  return `<h3>Phím tắt</h3>
    <div class="keys">
      ${key('<kbd>←</kbd> <kbd>→</kbd>', 'Xem lại nước trước, nước sau')}
      ${key('<kbd>H</kbd>', 'Bật hoặc tắt gợi ý. Trong giải đố: lần đầu tô ô, lần sau hiện mũi tên')}
      ${key('<kbd>G</kbd>', 'Đi lại, lùi về lượt của bạn')}
      ${key('<kbd>F</kbd>', 'Lật bàn cờ')}
      ${key('<kbd>N</kbd> <kbd>Enter</kbd>', 'Thế đố tiếp theo, sau khi giải xong')}
      ${key('<kbd>Esc</kbd>', 'Xóa mũi tên, tắt gợi ý, đóng menu')}
      ${key('<kbd>?</kbd>', 'Mở trang hướng dẫn này')}
    </div>
    <h3>Chuột và cảm ứng</h3>
    <p>Kéo thả quân, hoặc bấm quân rồi bấm ô muốn đi. Thả sai chỗ thì quân tự về chỗ cũ.</p>
    <p>Chuột phải kéo để vẽ mũi tên, chuột phải bấm để đánh dấu ô, bấm chuột trái lên bàn cờ để xóa. Giữ <kbd>Shift</kbd> (xanh lá), <kbd>Ctrl</kbd> (đỏ) hoặc <kbd>Alt</kbd> (xanh dương) để đổi màu. Trên điện thoại: chạm giữ một ô rồi kéo để vẽ mũi tên, chạm một lần để xóa.</p>
    <p>Lăn chuột trên bàn cờ để xem lại từng nước.</p>
    <h3>Đi trước (premove) và đồng hồ</h3>
    <p>Khi máy đang nghĩ, bạn vẫn đi quân được: nước đó được tô đỏ và tự đi ngay khi máy đi xong (nếu còn hợp lệ). Có thể xếp nhiều nước liên tiếp. Bấm chuột phải để hủy.</p>
    <p>Chọn thể thức Bullet, Blitz hoặc Rapid ở mục Đối thủ để chơi có đồng hồ. Đồng hồ chạy sau nước đầu tiên của mỗi bên; hết giờ là thua, trừ khi bên kia không đủ quân để chiếu hết.</p>
    <h3>Hỏi AI</h3>
    <p>Tab <b>Hỏi AI</b> nhìn thấy thế cờ đang hiện trên bàn (kể cả khi bạn xem lại nước cũ). Trợ lý offline dùng Stockfish trả lời ngay các câu thường gặp: nước tốt nhất, ai đang hơn, vì sao nước vừa rồi sai, quân nào bị đe dọa. Muốn hỏi tự do, chọn Gemini (có gói miễn phí) hoặc Claude và dán API key của bạn. Rê chuột hoặc chạm vào nước đi trong câu trả lời để thấy mũi tên trên bàn cờ.</p>
    <p class="note">Ở chế độ Thử thách, trợ lý không gợi ý nước đi cho tới khi hết ván. Sau ván, mũi tên xanh chỉ nước tốt nhất ở thế đang xem.</p>
    <h3>Ký hiệu chấm điểm</h3>
    <div class="legend">${legend}</div>
    <p class="note">Mỗi nước được so với nước tốt nhất của Stockfish theo xác suất thắng. Thiên tài là thí quân chính xác; Nước hay là nước duy nhất giữ được thế cờ.</p>
    <h3 id="hInstall">Cài như ứng dụng</h3>
    <p><b>Máy tính, Android</b> (Chrome, Edge): bấm <b>Cài ứng dụng</b> trong menu hoặc biểu tượng cài trên thanh địa chỉ.</p>
    <p><b>iPhone, iPad</b> (Safari): bấm nút Chia sẻ, chọn <b>Thêm vào MH chính</b>.</p>
    <p class="note">Sau khi cài, trang mở toàn màn hình và chơi được cả khi không có mạng.</p>
    <h3>Giới thiệu</h3>
    <p class="fine">Engine: Stockfish 17.1 (GPLv3)${eng.threads > 1 ? `, đang chạy ${eng.threads} luồng` : ''}. Khai cuộc và giải đố: dữ liệu lichess (CC0). Quân cờ: bộ cburnett (CC BY-SA 3.0). Phông chữ: Be Vietnam Pro (OFL). Mã nguồn: <a href="https://github.com/HoangDuc1003/chess-com" target="_blank" rel="noopener">github.com/HoangDuc1003/chess-com</a>. Dự án cá nhân để học cờ, không liên quan tới trang cờ nào khác.</p>`;
}
