// node tools/bake.mjs  - rebuild openstrike.wasm from data/openstrike.original.wasm + data/mods.json
// (the admin page does the same thing when it publishes; use this after editing mods.json by hand)
import { readFileSync, writeFileSync } from 'node:fs';
import { bake } from '../js/bake.js';
const root = new URL('../', import.meta.url);
const defs = JSON.parse(readFileSync(new URL('data/defaults.json', root)));
const mods = JSON.parse(readFileSync(new URL('data/mods.json', root)));
const orig = readFileSync(new URL('data/openstrike.original.wasm', root));
const out = bake(orig, mods, defs);
if (!WebAssembly.validate(out.wasm)) throw new Error('baked file is not valid WebAssembly');
writeFileSync(new URL('openstrike.wasm', root), out.wasm);
console.log(`openstrike.wasm: ${out.changed ? 'baked' : 'original (no edits)'} ${JSON.stringify(out.stats)}`);
