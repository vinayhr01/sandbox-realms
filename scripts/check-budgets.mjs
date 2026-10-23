// Build-size budgets (17 section 10, PERFORMANCE-PLAN section 2). Run after `npm run build`.
// Fails when the main JS chunk exceeds 350 KB gzip or the worker chunk exceeds 250 KB gzip.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ASSETS = join('dist', 'assets');
const LIMITS = { main: 350 * 1024, worker: 250 * 1024 };

const files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
const sizes = (name) => {
  let total = 0;
  for (const f of files.filter((f) => f.startsWith(name))) {
    total += gzipSync(readFileSync(join(ASSETS, f))).length;
  }
  return total;
};

// The main chunk is the entry index-*.js; the worker chunk is worker-*.js (vite naming).
const main = files.filter((f) => f.startsWith('index-')).reduce((n, f) => n + gzipSync(readFileSync(join(ASSETS, f))).length, 0);
const worker = sizes('worker-');
let failed = false;
for (const [name, bytes, limit] of [['main', main, LIMITS.main], ['worker', worker, LIMITS.worker]]) {
  const kb = (bytes / 1024).toFixed(1);
  if (bytes > limit) {
    console.error(`budget exceeded: ${name} ${kb} KB gzip > ${limit / 1024} KB`);
    failed = true;
  } else {
    console.log(`ok: ${name} ${kb} KB gzip <= ${limit / 1024} KB`);
  }
}
if (failed) process.exit(1);
