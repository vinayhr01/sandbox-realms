import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/a11y/**/*.test.ts'],
    environment: 'node',
  },
});
