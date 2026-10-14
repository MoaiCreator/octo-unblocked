// node tests/admin.test.mjs - map checker + GitHub publishing (mocked) + defaults sanity
import { readFileSync } from 'node:fs';
import { checkMap, emptyMap, isGrid } from '../js/mapcheck.js';
import { GitHub, guessRepo } from '../js/github.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const defs = JSON.parse(readFileSync(new URL('../data/defaults.json', import.meta.url)));

// defaults extracted from the wasm look right
ok(defs.maps.length === 6 && defs.maps.every(m => isGrid(m.rows)), '6 built-in maps (Desert + 5 grid maps), 40x48 each');
const desert = defs.maps.find(m => m.gameId === 0);
ok(desert && desert.name === 'Desert' && desert.rowsAddr === 39344 && desert.nameAddr === 39312, 'Desert is map 0 with its table slot at 39344');
const wasm = readFileSync(new URL('../data/openstrike.original.wasm', import.meta.url));
ok(desert.codePatch.length === 3 && desert.codePatch.every(p => wasm[p.offset] === p.from && p.from !== p.to), 'Desert loader patch bytes match openstrike.wasm');
ok(defs.maps.filter(m => m.gameId > 0).every((m, i) => m.rowsAddr === 39504 + 160 * i), 'grid maps use the same table (39344 + id*160)');
ok(defs.weapons.length === 30 && defs.weapons[17].name === 'AK-47' && defs.weapons[17].price === 2700 && defs.weapons[23].damage === 115, 'weapon table decoded (AK-47 $2700, AWP 115 dmg)');
ok(defs.skins.length === 34 && defs.skins.every(s => s.rarity <= 4 && /^#[0-9a-f]{6}$/.test(s.colors[0])), '34 skins decoded');
ok(defs.palette.length === 15 && defs.palette[0].ch === '#', 'editor palette decoded');

// the checker accepts every built-in map (they are all playable in the game)
for (const m of defs.maps) { const c = checkMap(m.rows, defs.palette); ok(c.errors.length === 0, `built-in "${m.name}" passes (${c.errors.join('; ') || 'ok'})`); }
// rules measured in the game: crates block, tunnels/ladders pass, platform needs a ladder
const freight = defs.maps[1].rows, rowWith = (ch) => { const r = freight.slice(); r[4] = '#' + ch.repeat(46) + '#'; return r; };
ok(checkMap(rowWith('c')).errors.some(e => /CT spawn/.test(e)), 'a wall of crates cuts off the CT spawn');
ok(checkMap(rowWith('h')).errors.length > 0 && checkMap(rowWith('P')).errors.length > 0, 'sandbags and a bare platform row block (as in game)');
ok(checkMap(rowWith('u')).errors.length === 0 && checkMap(rowWith('L')).errors.length === 0, 'tunnel and ladder rows are passable (as in game)');
ok(checkMap(emptyMap()).errors.length === 4, 'empty map reports missing spawns and sites');
ok(checkMap(['#']).errors.length === 1, 'wrong size is rejected');
const bad = defs.maps[0].rows.slice(); bad[10] = bad[10].slice(0, 5) + 'Z' + bad[10].slice(6);
ok(checkMap(bad, defs.palette).errors.some(e => /Unknown tile/.test(e)), 'unknown tiles are rejected');

// GitHub publishing against a fake API
const files = { 'data/mods.json': { sha: 'abc', content: Buffer.from('{"version":3}').toString('base64') } }; const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push([opts.method || 'GET', url, opts.headers && opts.headers.Authorization]);
  const m = /\/repos\/o\/r(\/contents\/([^?]+))?/.exec(url);
  const res = (status, body) => ({ ok: status < 300, status, statusText: '', json: async () => body });
  if (!m) return res(404, { message: 'Not Found' });
  if (!m[1]) return res(200, { permissions: { push: true }, default_branch: 'main' });
  const path = decodeURIComponent(m[2]);
  if ((opts.method || 'GET') === 'GET') return files[path] ? res(200, files[path]) : res(404, { message: 'Not Found' });
  const body = JSON.parse(opts.body); if (files[path] && body.sha !== files[path].sha) return res(409, { message: 'sha mismatch' });
  files[path] = { sha: 'new' + calls.length, content: body.content }; return res(200, { commit: { sha: 'c1', html_url: 'https://github.com/o/r/commit/c1' } });
};
const gh = new GitHub({ owner: 'o', repo: 'r', branch: 'main', token: 'tok' });
ok((await gh.check()).canPush, 'check() reports push access');
const cur = await gh.getFile('data/mods.json'); ok(cur && JSON.parse(cur.text).version === 3, 'getFile decodes base64 content');
const text = JSON.stringify({ version: 4, maps: { custom: [{ slot: 0, name: 'Ünïcode map', rows: defs.maps[0].rows }] } });
const r = await gh.putFile('data/mods.json', text, 'test');
ok(r.commitUrl.includes('/commit/'), 'putFile commits with the current sha');
ok(Buffer.from(files['data/mods.json'].content, 'base64').toString('utf8') === text, 'uploaded content round-trips (incl. unicode)');
ok(calls.every(c => c[2] === 'Bearer tok'), 'every request carries the token');
ok(await gh.getFile('data/none.json') === null, 'missing file returns null');
ok(JSON.stringify(guessRepo({ hostname: 'moaicreator.github.io', pathname: '/octo-unblocked/admin.html' })) === '{"owner":"moaicreator","repo":"octo-unblocked"}', 'repo is guessed from the Pages URL');
// one commit with a binary + a text file through the Git Data API
{
  const store = { blobs: {}, trees: {}, commits: { base: { tree: { sha: 't0' } } }, ref: 'base' }; let n = 0; const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET', path = url.replace('https://api.github.com/repos/o/r', ''), body = opts.body ? JSON.parse(opts.body) : null;
    seen.push(method + ' ' + path.replace(/[0-9a-f]{6,}/g, '*'));
    const res = (b) => ({ ok: true, status: 200, json: async () => b });
    if (method === 'GET' && path === '/git/ref/heads/main') return res({ object: { sha: store.ref } });
    if (method === 'GET' && path.startsWith('/git/commits/')) return res(store.commits[path.split('/').pop()]);
    if (method === 'POST' && path === '/git/blobs') { const sha = 'b' + (++n); store.blobs[sha] = body; return res({ sha }); }
    if (method === 'POST' && path === '/git/trees') { const sha = 't' + (++n); store.trees[sha] = body; return res({ sha }); }
    if (method === 'POST' && path === '/git/commits') { const sha = 'c' + (++n); store.commits[sha] = body; return res({ sha, html_url: 'https://github.com/o/r/commit/' + sha }); }
    if (method === 'PATCH' && path === '/git/refs/heads/main') { store.ref = body.sha; return res({}); }
    return { ok: false, status: 404, statusText: 'nope', json: async () => ({}) };
  };
  const bytes = new Uint8Array(200000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 255;
  const r = await new GitHub({ owner: 'o', repo: 'r', branch: 'main', token: 't' }).commitFiles([{ path: 'openstrike.wasm', bytes }, { path: 'data/mods.json', text: '{"v":1}' }], 'msg');
  const c = store.commits[store.ref], t = store.trees[c.tree];
  ok(r.commitUrl.endsWith(store.ref) && c.parents[0] === 'base' && c.message === 'msg', 'commitFiles makes one commit on top of the branch');
  ok(t.base_tree === 't0' && t.tree.map(e => e.path).join() === 'openstrike.wasm,data/mods.json', 'the commit contains both files');
  const wb = store.blobs[t.tree[0].sha]; ok(wb.encoding === 'base64' && Buffer.from(wb.content, 'base64').equals(Buffer.from(bytes)), 'binary game file uploaded byte-for-byte');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
