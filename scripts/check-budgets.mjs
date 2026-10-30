// Build-size budgets (17 section 10, PERFORMANCE-PLAN section 2; map-graphics Global Constraints). Run after `npm run build`.
// Fails when the main JS chunk exceeds 350 KB gzip, the worker chunk exceeds 250 KB gzip, any art chunk exceeds
// its cap, or all art chunks together exceed 600 KB gzip. Art chunks are the art-*.js files (src/art/<chunk>/ and
// src/art/powers/<group>/, the latter as art-p<group>).
// Each art chunk gets 40 KB gzip unless ART_CHUNK_LIMITS overrides it (controller ruling R17: the buildings chunk
// gets 48 KB because its window glass is lit per building; creature chunks keep 40 KB).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ASSETS = join('dist', 'assets');
const LIMITS = { main: 350 * 1024, worker: 250 * 1024, render3d: 220 * 1024, artChunk: 40 * 1024, artTotal: 600 * 1024 };
// Per-chunk gzip caps that override LIMITS.artChunk (keys are art chunk names, e.g. art-buildings).
const ART_CHUNK_LIMITS = { 'art-buildings': 48 * 1024 };
const artChunkLimit = (chunk) => ART_CHUNK_LIMITS[chunk] ?? LIMITS.artChunk;

const files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
const gz = (f) => gzipSync(readFileSync(join(ASSETS, f))).length;
const sizes = (name) => {
  let total = 0;
  for (const f of files.filter((f) => f.startsWith(name))) {
    total += gz(f);
  }
  return total;
};

// The main chunk is the entry index-*.js; the worker chunk is worker-*.js (vite naming).
const main = files.filter((f) => f.startsWith('index-')).reduce((n, f) => n + gz(f), 0);
const worker = sizes('worker-');
// The lazy 3D chunk (vite.config.ts manualChunks: three.js and src/render3d/) is render3d-<hash>.js.
const render3d = sizes('render3d-');

// Art chunks are named art-<chunk>-<hash>.js (vite.config.ts manualChunks). Sum gzip per chunk name.
const artByChunk = new Map();
for (const f of files.filter((f) => f.startsWith('art-'))) {
  const chunk = /^(art-[a-z]+)-/.exec(f)?.[1] ?? f;
  artByChunk.set(chunk, (artByChunk.get(chunk) ?? 0) + gz(f));
}
const artTotal = [...artByChunk.values()].reduce((n, b) => n + b, 0);
const artWorst = [...artByChunk].reduce((w, [name, b]) => (b > w[1] ? [name, b] : w), ['', 0]);

let failed = false;
for (const [name, bytes, limit] of [['main', main, LIMITS.main], ['worker', worker, LIMITS.worker], ['render3d', render3d, LIMITS.render3d], ['art', artTotal, LIMITS.artTotal]]) {
  const kb = (bytes / 1024).toFixed(1);
  if (bytes > limit) {
    console.error(`budget exceeded: ${name} ${kb} KB gzip > ${limit / 1024} KB`);
    failed = true;
  } else {
    console.log(`ok: ${name} ${kb} KB gzip <= ${limit / 1024} KB`);
  }
}
for (const [name, bytes] of artByChunk) {
  const limit = artChunkLimit(name);
  if (bytes > limit) {
    console.error(`budget exceeded: ${name} ${(bytes / 1024).toFixed(1)} KB gzip > ${limit / 1024} KB`);
    failed = true;
  } else {
    console.log(`ok: ${name} ${(bytes / 1024).toFixed(1)} KB gzip <= ${limit / 1024} KB`);
  }
}
if (artByChunk.size > 0 && !failed) {
  console.log(`ok: art chunks ${artByChunk.size}, largest ${artWorst[0]} ${(artWorst[1] / 1024).toFixed(1)} KB gzip <= ${artChunkLimit(artWorst[0]) / 1024} KB`);
}
if (failed) process.exit(1);
