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
        // those folders, so it stays in the main chunk. Each power-art group (src/art/powers/<group>/) becomes art-p<group>.
        // reuse.ts sits beside the groups, not in one, so it stays in the main chunk too.
        manualChunks(id) {
          const m = /[\\/]src[\\/]art[\\/](?:(folk|beast|bird|sea|insect|undead|monster|divine|buildings)|powers[\\/](chips|land|nature|weather|disasters|blessings|peoples|inspect|world))[\\/]/.exec(id);
          if (!m) return undefined;
          return m[1] ? `art-${m[1]}` : `art-p${m[2]}`;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
