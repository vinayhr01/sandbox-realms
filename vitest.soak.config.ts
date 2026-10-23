import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/soak/**/*.soak.ts'],
    environment: 'node',
    testTimeout: 900_000,
  },
});
