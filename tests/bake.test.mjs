// node tests/bake.test.mjs - edits are written into the game file correctly
import { readFileSync } from 'node:fs';
import { bake, memReader, dataSegments, sha256hex } from '../js/bake.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const defs = JSON.parse(readFileSync(new URL('../data/defaults.json', import.meta.url)));
const orig = new Uint8Array(readFileSync(new URL('../data/openstrike.original.wasm', import.meta.url)));
ok((await sha256hex(orig)).startsWith(defs.build), 'data/openstrike.original.wasm is the build defaults.json describes');

const none = bake(orig, { maps: { builtin: [], custom: [] }, weapons: [], skins: [] }, defs);
ok(!none.changed && none.wasm.length === orig.length && none.wasm.every((b, i) => b === orig[i]), 'no edits -> identical file');

const desert = defs.maps.find((m) => m.gameId === 0), rows = desert.rows.slice();
rows[33] = rows[33].slice(0, 4) + 'CCCC' + rows[33].slice(8);
const roof = defs.maps[2].rows.slice(); roof[10] = roof[10].slice(0, 5) + 'k' + roof[10].slice(6);
const mods = {
  maps: { builtin: [{ index: desert.index, name: 'Desert Remix', rows }, { index: 2, rows: roof }], custom: [] },
  weapons: [{ index: 17, name: 'AK-99', price: 1234, damage: 40.5, auto: 0, team: 0 }],
  skins: [{ index: 0, name: 'Admin Camo', rarity: 4, pattern: 7, colors: ['#ff0000', '#00ff00', '#0000ff'] }],
};
const { wasm, stats } = bake(orig, mods, defs);
ok(WebAssembly.validate(wasm), `baked file is valid WebAssembly (${wasm.length} bytes, ${stats.segments} new segments)`);
await WebAssembly.compile(wasm).then(() => ok(true, 'baked file compiles'), (e) => ok(false, 'compile: ' + e.message));
const m = memReader(wasm), L = defs.layout, W = (k, off) => L.weapons.addr + k * L.weapons.stride + off;
ok(m.str(m.u32(W(17, 0))) === 'AK-99' && m.u32(W(17, 8)) === 1234 && Math.abs(m.f32(W(17, 20)) - 40.5) < 1e-6, 'AK-47 renamed, repriced, damage changed');
ok(m.u32(W(17, 60)) === 0 && m.byte(W(17, 72)) === 0, 'AK-47 auto and team changed');
ok(m.u32(W(18, 8)) === 3100 && m.str(m.u32(W(18, 0))) === 'M4A4', 'other guns untouched');
const S = L.skins.addr;
ok(m.str(m.u32(S)) === 'Admin Camo' && m.byte(S + 4) === 4 && m.byte(S + 5) === 7 && m.byte(S + 6) === 255 && m.byte(S + 11) === 255 && m.byte(S + 16) === 255, 'skin renamed, rarity, pattern and colours written');
const readRows = (addr) => Array.from({ length: 40 }, (_, r) => m.str(m.u32(addr + 4 * r)));
ok(JSON.stringify(readRows(desert.rowsAddr)) === JSON.stringify(rows) && m.str(m.u32(desert.nameAddr)) === 'Desert Remix', 'Desert rows and name are in the game\'s map table');
ok(JSON.stringify(readRows(defs.maps[2].rowsAddr)) === JSON.stringify(roof), 'Rooftops rows replaced');
ok(JSON.stringify(readRows(defs.maps[0].rowsAddr)) === JSON.stringify(defs.maps[0].rows), 'Sandstone untouched');
ok(desert.codePatch.every((p) => wasm[p.offset] === p.to), 'map loader bytes changed so Desert reads from the table');
const heap = m.u32(L.heap.sbrkAddr);
ok(heap > L.heap.base && heap % 16 === 0 && heap - L.heap.base >= stats.poolBytes, `heap start moved past the new data (${L.heap.base} -> ${heap})`);
ok(dataSegments(wasm).length === dataSegments(orig).length + stats.segments, 'original data segments kept, new ones appended');
const rebake = bake(orig, mods, defs).wasm; ok(rebake.length === wasm.length && rebake.every((b, i) => b === wasm[i]), 'baking is deterministic');
let threw = false; try { bake(wasm, mods, defs); } catch (_) { threw = true; } ok(threw, 'refuses to bake on top of an already-baked file');
const pub = JSON.parse(readFileSync(new URL('../data/mods.json', import.meta.url)));
ok(WebAssembly.validate(bake(orig, pub, defs).wasm), 'the published mods.json bakes into a valid file');
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
