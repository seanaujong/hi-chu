import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // `scripts/` is plain JS and outside tsconfig, so its tests are `.mjs` and colocated.
    // The release tooling has pure, exported cores that deserve the same gate as src.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node', // the pure core needs no DOM; render tests assert on strings
  },
});
