import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // Three homes, because they answer three different questions. `src/` tests the PRODUCT:
    // given this battle, is the damage right. `fitness/` tests the CODEBASE: does the import
    // graph match the layering we claim, does CLAUDE.md point at things that exist. Keeping
    // the second out of `src/` is what lets a reader open `src/` and find only Pokémon.
    // `scripts/` is plain JS and outside tsconfig, so its tests are `.mjs` and colocated;
    // the release tooling has pure, exported cores that deserve the same gate as src.
    include: ['src/**/*.test.ts', 'fitness/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node', // the pure core needs no DOM; render tests assert on strings
  },
});
