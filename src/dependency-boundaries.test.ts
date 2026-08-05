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

/** The sibling core modules a file imports, by bare name: `['facts', 'narrow']`. Covers
 *  `import` and `import type` alike — a type-only edge is still an edge in the layering,
 *  and `render.ts`'s own rule below is the one place the distinction matters. */
function coreImportsOf(path: string): string[] {
  return importLines(readFileSync(path, 'utf8'))
    .map((line) => /from '\.\/([a-z]+)\.js'/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Every module under `src/core`, by bare name. */
function coreModules(): string[] {
  return allSourceFiles('src/core').map((p) => p.replace(/^src\/core\//, '').replace(/\.ts$/, ''));
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

/**
 * The set-inference layering, as edges rather than prose.
 *
 * `narrow.ts` says in its own header that resolution and display "both narrow through here,
 * so the rule lives in one place", and CLAUDE.md repeats it. That was true of the ROLE rule
 * and quietly false of the ITEM rule: `knowledge.ts` and `resolve.ts` each reached past
 * `narrow` for `deductions.survivingItems` and applied it with different fallbacks, so one
 * showed a candidate's items and the other calculated with a different pool. It rendered a
 * Thundurus block whose damage spanned two items above a heading that listed none.
 *
 * Prose could not fail; an edge can. These are the two invariants the Architecture section
 * already argues for, promoted to predicates — deliberately just those two, because the rest
 * of the graph is current shape and would only rot here.
 */
describe('the set-inference layering holds as an import graph, not just a description', () => {
  it('routes every deduction through narrow.ts — nothing else may import deductions.ts', () => {
    // The rule that would have caught the item-pool split the day it was written.
    const importers = coreModules().filter((m) => coreImportsOf(`src/core/${m}.ts`).includes('deductions'));
    expect(importers).toEqual(['narrow']);
  });

  it('keeps facts.ts a leaf, so the layers above need not depend on each other for it', () => {
    // `facts.ts` exists to be depended ON (7 modules do). The moment it depends back on one
    // of them, the shared-vocabulary module becomes a cycle waiting to happen. `types.ts` is
    // the one edge that stays legal: it is the vocabulary every layer is written in, and is
    // itself a true leaf (asserted below), so depending on it can close no loop.
    expect(coreImportsOf('src/core/facts.ts')).toEqual(['types']);
  });

  it('keeps types.ts a TRUE leaf — the vocabulary depends on nothing', () => {
    // What makes the exception above safe rather than a hole in it.
    expect(coreImportsOf('src/core/types.ts')).toEqual([]);
  });
});
