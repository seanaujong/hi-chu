import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * The only runtime dependency, `@smogon/calc`, is confined to the modules that
 * actually need its formulas — every other pure-core module says so in its own header
 * comment ("Pure: no DOM, no network, no @smogon/calc"), but that was only ever a
 * convention until this test. Widening this list is a deliberate, reviewed edit here,
 * not a silent import creeping in somewhere else. `hazards.ts` earned its place the same
 * way `speed.ts` did: a law that needs the calc's own type chart and grounding check
 * (`isGrounded`, deep-imported from calc internals exactly like `speed.ts`'s
 * `getFinalSpeed`), not something `damage.ts`'s existing exports cover.
 */
const ALLOWED_IMPORTERS = ['src/core/damage.ts', 'src/core/speed.ts', 'src/core/hazards.ts'];

function allSourceFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return allSourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function importLines(source: string): string[] {
  return source.split('\n').filter((line) => /^import\b/.test(line));
}

function importsCalc(source: string): boolean {
  return importLines(source).some((line) => line.includes('@smogon/calc'));
}

describe('the @smogon/calc dependency stays confined to damage.ts and speed.ts', () => {
  it('is imported by exactly the allowed files, nowhere else', () => {
    const importers = allSourceFiles('src').filter((path) => importsCalc(readFileSync(path, 'utf8')));
    expect(importers.sort()).toEqual([...ALLOWED_IMPORTERS].sort());
  });
});

describe('the pure core never imports back into the shell (fetch/render.ts stays a leaf)', () => {
  it('no file under src/core imports from battle/, data/, content.ts, or section.ts', () => {
    const offenders = allSourceFiles('src/core').filter((path) =>
      importLines(readFileSync(path, 'utf8')).some((line) => /from ['"]\.\.\/(battle|data|content|section)/.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('render.ts only knows the SHAPE reasoning produced, never calls into it', () => {
  it('every import from a sibling core module is type-only', () => {
    const siblingImports = importLines(readFileSync('src/core/render.ts', 'utf8')).filter((line) =>
      /from '\.\/[a-z]/.test(line),
    );
    const valueImports = siblingImports.filter((line) => !/^import type\b/.test(line));
    expect(valueImports).toEqual([]);
    expect(siblingImports.length).toBeGreaterThan(0); // not vacuously true
  });
});
