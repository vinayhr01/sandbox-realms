import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the project at /sandbox-realms/; local builds and e2e stay at /.
  base: process.env['PAGES_BASE'] ?? '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
