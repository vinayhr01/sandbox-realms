import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the project at /sandbox-realms/; local builds and e2e stay at /.
  base: process.env['PAGES_BASE'] ?? '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Each art chunk (src/art/<chunk>/, see src/art/load.ts) becomes art-<chunk>-<hash>.js. gaits.ts is not in
        // those folders, so it stays in the main chunk.
        manualChunks(id) {
          const m = /[\\/]src[\\/]art[\\/](folk|beast|bird|sea|insect|undead|monster|divine|buildings)[\\/]/.exec(id);
          return m?.[1] ? `art-${m[1]}` : undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
