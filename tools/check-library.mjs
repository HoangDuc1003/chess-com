// Replays every opening library line and reports the deepest named opening it reaches.
// Usage: node tools/check-library.mjs
import fs from 'fs';
import { setOpeningsData, sanLine, deepestName, opening, LIBRARY, guideFor } from '../app/openings.js';
setOpeningsData(JSON.parse(fs.readFileSync(new URL('../data/openings.json', import.meta.url))));
let bad = 0;
for (const L of LIBRARY) {
  try {
    const line = sanLine(L.san);
    const id = deepestName(line);
    const name = id >= 0 ? opening(id).name : '(không có tên)';
    console.log('OK ', L.cat.padEnd(9), L.vn.padEnd(36), line.length, '→', name, '|', guideFor(name).vn);
  } catch (e) { bad++; console.log('BAD', L.vn, e.message); }
}
console.log(LIBRARY.length, 'lines,', bad, 'illegal');
process.exit(bad ? 1 : 0);
