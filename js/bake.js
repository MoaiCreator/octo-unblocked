// bake.js - writes admin edits (mods.json) into the game file itself.
//
//   bake(originalWasm, mods, defaults) -> { wasm, stats }
//
// Every edit is a write to the game's static memory, so the baked file is the original plus extra active
// data segments that the game applies at startup on top of the originals:
//   - numbers (prices, damage, colours...)  -> small segments over the original bytes
//   - new strings and map rows              -> one "pool" segment placed where the heap used to start;
//                                              the heap start (sbrk pointer) is moved past it
//   - names / map rows                      -> the pointers in the game's tables are rewritten to the pool
//   - Desert's layout                       -> 3 bytes in the map loader so Desert reads its rows from the
//                                              table like the other maps (offsets verified in defaults.json)
// No DOM; works in browsers and Node 18+.

const te = new TextEncoder();

function uleb(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; }
function sleb(n) { const out = []; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { out.push(b); return out; } out.push(b | 0x80); } }
function readUleb(b, i) { let r = 0, s = 0, x; do { x = b[i++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return [r, i]; }
function readSleb(b, i) { let r = 0, s = 0, x; do { x = b[i++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); if (s < 32 && (x & 0x40)) r |= -1 << s; return [r, i]; }

export function sections(b) {
  const out = []; let i = 8;
  while (i < b.length) { const id = b[i]; const [size, j] = readUleb(b, i + 1); out.push({ id, start: i, body: j, end: j + size }); i = j + size; }
  return out;
}
// active data segments of a module: [{ addr, data: Uint8Array }]
export function dataSegments(b) {
  const sec = sections(b).find((s) => s.id === 11); if (!sec) return [];
  let [n, i] = readUleb(b, sec.body); const out = [];
  while (n--) {
    let flag; [flag, i] = readUleb(b, i);
    let addr = null;
    if (flag === 0 || flag === 2) { if (flag === 2) [, i] = readUleb(b, i); i++; [addr, i] = readSleb(b, i); i++; }
    let len; [len, i] = readUleb(b, i);
    out.push({ addr, data: b.subarray(i, i + len) }); i += len;
  }
  return out;
}
// read static memory as the game sees it at startup
export function memReader(b) {
  const segs = dataSegments(b).filter((s) => s.addr !== null);
  const byte = (a) => { let v = 0; for (const s of segs) if (a >= s.addr && a < s.addr + s.data.length) v = s.data[a - s.addr]; return v; };
  const u32 = (a) => (byte(a) | (byte(a + 1) << 8) | (byte(a + 2) << 16) | (byte(a + 3) << 24)) >>> 0;
  const str = (a) => { let s = ''; for (let k = 0; k < 200; k++) { const c = byte(a + k); if (!c) break; s += String.fromCharCode(c); } return s; };
  const f32 = (a) => new DataView(new Uint8Array([byte(a), byte(a + 1), byte(a + 2), byte(a + 3)]).buffer).getFloat32(0, true);
  return { byte, u32, str, f32 };
}
export async function sha256hex(bytes) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
}
const validRows = (rows) => Array.isArray(rows) && rows.length === 40 && rows.every((r) => typeof r === 'string' && r.length === 48);
const cleanName = (s) => String(s).replace(/[^\x20-\x7e]/g, '').slice(0, 31);

export function bake(original, mods, defs) {
  const orig = original instanceof Uint8Array ? original : new Uint8Array(original);
  const L = defs.layout, mem = memReader(orig), heap = L.heap;
  // refuse to bake against a different build
  const sig = defs.signature;
  if (mem.str(mem.u32(L.weapons.addr)) !== sig.weapon0 || mem.str(mem.u32(L.weapons.addr + 17 * L.weapons.stride)) !== sig.weapon17 ||
      mem.str(mem.u32(L.skins.addr)) !== sig.skin0 || mem.u32(heap.sbrkAddr) !== heap.base) {
    throw new Error('This is not the original OpenStrike build that data/defaults.json describes');
  }
  const writes = [], pool = [], codePatches = [], stats = { weapons: 0, skins: 0, maps: 0 };
  let poolLen = 0;
  const alloc = (bytes, align = 1) => { const pad = (align - (poolLen % align)) % align; if (pad) { pool.push(new Uint8Array(pad)); poolLen += pad; } const addr = heap.base + poolLen; pool.push(bytes); poolLen += bytes.length; return addr; };
  const cstr = (s) => { const b = te.encode(cleanName(s)), out = new Uint8Array(b.length + 1); out.set(b); return alloc(out); };
  const le32 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const write = (addr, bytes) => writes.push({ addr, bytes });
  const writeVal = (addr, type, v) => {
    v = Number(v); if (!Number.isFinite(v)) return;
    if (type === 'u8') write(addr, new Uint8Array([Math.max(0, Math.min(255, Math.round(v)))]));
    else if (type === 'i32') { const dv = new DataView(new ArrayBuffer(4)); dv.setInt32(0, Math.round(v), true); write(addr, new Uint8Array(dv.buffer)); }
    else if (type === 'f32') { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, v, true); write(addr, new Uint8Array(dv.buffer)); }
  };

  for (const w of mods.weapons || []) {
    const d = defs.weapons[w.index]; if (!d) continue;
    const base = L.weapons.addr + w.index * L.weapons.stride; let any = false;
    for (const f of defs.weaponFields) {
      if (!(f.key in w) || w[f.key] === d[f.key] || f.key === 'category' || f.key === 'slot') continue;
      if (f.type === 'str') write(base + f.offset, le32(cstr(w[f.key]))); else writeVal(base + f.offset, f.type, w[f.key]);
      any = true;
    }
    if (any) stats.weapons++;
  }
  for (const s of mods.skins || []) {
    const d = defs.skins[s.index]; if (!d) continue;
    const base = L.skins.addr + s.index * L.skins.stride;
    if (s.name && s.name !== d.name) write(base, le32(cstr(s.name)));
    if ('rarity' in s) writeVal(base + 4, 'u8', Math.max(0, Math.min(4, s.rarity)));
    if ('pattern' in s) writeVal(base + 5, 'u8', s.pattern);
    (s.colors || []).slice(0, 3).forEach((c, k) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (m) { const x = parseInt(m[1], 16); write(base + 6 + 4 * k, new Uint8Array([x >> 16, (x >> 8) & 255, x & 255, 255])); } });
    stats.skins++;
  }
  for (const m of (mods.maps && mods.maps.builtin) || []) {
    const d = defs.maps[m.index]; if (!d) continue;
    if (m.name && m.name !== d.name) write(d.nameAddr, le32(cstr(m.name)));
    if (validRows(m.rows) && m.rows.join('') !== d.rows.join('')) {
      if (d.codePatch) {
        for (const p of d.codePatch) if (orig[p.offset] !== p.from) throw new Error(`${d.name}: map loader bytes are not what defaults.json expects`);
        codePatches.push(...d.codePatch);
      }
      const block = new Uint8Array(40 * 49);
      m.rows.forEach((row, r) => { for (let k = 0; k < 48; k++) block[r * 49 + k] = row.charCodeAt(k); });
      const addr = alloc(block, 4), ptrs = new Uint8Array(160);
      for (let r = 0; r < 40; r++) ptrs.set(le32(addr + r * 49), r * 4);
      write(d.rowsAddr, ptrs);
    }
    stats.maps++;
  }
  if (!writes.length && !codePatches.length) return { wasm: orig.slice(), stats, changed: false };

  // pool at the old heap start, heap moved past it
  const poolBytes = new Uint8Array(poolLen); let o = 0; for (const p of pool) { poolBytes.set(p, o); o += p.length; }
  const newHeap = heap.base + Math.ceil((poolLen + 16) / 16) * 16;
  const segs = [];
  if (poolLen) segs.push({ addr: heap.base, bytes: poolBytes });
  segs.push(...writes, { addr: heap.sbrkAddr, bytes: le32(newHeap) });

  // rebuild the data section: original segments first, ours after them so they win
  const out = orig.slice();
  for (const p of codePatches) out[p.offset] = p.to;
  const sec = sections(out).find((s) => s.id === 11);
  const [count, segStart] = readUleb(out, sec.body);
  const extra = [];
  for (const s of segs) extra.push(0x00, 0x41, ...sleb(s.addr), 0x0b, ...uleb(s.bytes.length), ...s.bytes);
  const countBytes = uleb(count + segs.length);
  const contentLen = countBytes.length + (sec.end - segStart) + extra.length;
  const head = [11, ...uleb(contentLen)];
  const result = new Uint8Array(sec.start + head.length + contentLen + (out.length - sec.end));
  let w = 0;
  const put = (arr) => { result.set(arr, w); w += arr.length; };
  put(out.subarray(0, sec.start)); put(head); put(countBytes); put(out.subarray(segStart, sec.end)); put(extra); put(out.subarray(sec.end));
  return { wasm: result, stats: { ...stats, poolBytes: poolLen, segments: segs.length, heapStart: newHeap }, changed: true };
}
