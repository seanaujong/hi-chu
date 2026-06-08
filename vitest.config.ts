import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node', // the pure core needs no DOM; render tests assert on strings
  },
});
