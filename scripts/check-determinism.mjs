// Fails when a banned non-deterministic global appears in the simulation or shared code
// (17 section 17, test 9). The worker shell is the only allowlisted reader of the clock.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/sim', 'src/shared', 'src/content'];
const ALLOW = new Set(['src/sim/worker.ts']);
const BANNED = /Math\.random|Date\.now|new Date\(|performance\.now|crypto\.getRandomValues/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

let failures = 0;
for (const root of ROOTS) {
  for (const file of files(root)) {
    const rel = file.split('\\').join('/');
    if (ALLOW.has(rel)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, idx) => {
        const code = line.trim();
        if (BANNED.test(code) && !code.startsWith('//')) {
          console.error(`${rel}:${idx + 1}: non-deterministic call: ${code}`);
          failures++;
        }
      });
  }
}
if (failures > 0) {
  console.error(`${failures} determinism violation(s)`);
  process.exit(1);
}
console.log('determinism check passed');
