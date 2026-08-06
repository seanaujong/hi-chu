import {describe, it, expect} from 'vitest';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {importStatements, localImports} from './importgraph.js';

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

/**
 * The name shape the layering rules can SEE. Written once and used both to read sibling edges
 * and to constrain the filenames below, so the reader and the constraint cannot drift apart —
 * a disagreement between them is precisely the failure that made this necessary.
 */
const CORE_MODULE = '[a-z]+';

/** The sibling core modules a file imports, by bare name: `['facts', 'narrow']`. Covers
 *  `import` and `import type` alike — a type-only edge is still an edge in the layering,
 *  and `render.ts`'s own rule below is the one place the distinction matters. */
function coreImportsOf(path: string): string[] {
  const sibling = new RegExp(`^\\./(${CORE_MODULE})\\.js$`);
  return localImports(path)
    .map((statement) => sibling.exec(statement.specifier)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Every module under `src/core`, by bare name. */
function coreModules(): string[] {
  return allSourceFiles('src/core').map((p) => p.replace(/^src\/core\//, '').replace(/\.ts$/, ''));
}

describe('the @smogon/calc dependency stays confined to damage.ts and speed.ts', () => {
  it('is imported by exactly the allowed files, nowhere else', () => {
    const importers = allSourceFiles('src').filter((path) =>
      importStatements(readFileSync(path, 'utf8')).some((s) => s.specifier.startsWith('@smogon/calc')),
    );
    expect(importers.sort()).toEqual([...ALLOWED_IMPORTERS].sort());
  });
});

describe('the pure core never imports back into the shell (fetch/render.ts stays a leaf)', () => {
  it('no file under src/core imports from battle/, data/, content.ts, or section.ts', () => {
    const offenders = allSourceFiles('src/core').filter((path) =>
      localImports(path).some((s) => /^\.\.\/(battle|data|content|section)/.test(s.specifier)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('render.ts only knows the SHAPE reasoning produced, never calls into it', () => {
  it('every import from a sibling core module is type-only', () => {
    const siblings = localImports('src/core/render.ts').filter((s) => /^\.\/[a-z]/.test(s.specifier));
    expect(siblings.filter((s) => !s.typeOnly).map((s) => s.specifier)).toEqual([]);
    expect(siblings.length).toBeGreaterThan(0); // not vacuously true
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
/**
 * What makes every rule below able to see anything at all.
 *
 * The layering rules read a sibling edge lexically, matching `./<name>.js` against
 * `CORE_MODULE`. A filename outside that shape — a hyphen, a digit, a capital — produces an
 * edge the reader silently drops, and a dropped edge reads as a boundary held. Measured, not
 * theorised: `facts.ts` importing `./item-loss.js` violates the leaf rule directly and passes
 * the entire gate — fitness tests, a clean cruise, clean lint. Named `itemloss.ts`, the same
 * violation is caught at once.
 *
 * So the naming convention is not style here; it is the precondition for the checks working,
 * and it was written down nowhere until a cold read of this repo went looking for it. This is
 * the second time a lexical reader has failed by under-matching — the first read imports line
 * by line and lost every wrapped one — and both failed in the same direction: toward green.
 */
describe('a core module is named so the layering rules can see it', () => {
  it('names every file under src/core in lowercase letters only', () => {
    const shape = new RegExp(`^${CORE_MODULE}(\\.test|\\.testfixtures)?\\.ts$`);
    const unreadable = readdirSync('src/core').filter((name) => !shape.test(name));
    expect(
      unreadable,
      `Rename to lowercase letters only: ${unreadable.join(', ')}. The layering rules match sibling ` +
        `imports with /^\\.\\/(${CORE_MODULE})\\.js$/, so any other name makes this module's edges ` +
        'invisible to them, and a violation involving it passes silently',
    ).toEqual([]);
  });

  it('reads a real sibling edge — not vacuously true', () => {
    expect(coreImportsOf('src/core/narrow.ts')).toContain('deductions');
  });
});

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

/**
 * A barrel — an `index.ts` re-exporting its whole directory, or any `export * from` — makes
 * every module in that directory transitively import every other one, and it erases exactly
 * the distinction every rule above exists to draw: with one barrel in place, "does the core
 * import the shell?" and "who imports deductions.ts?" stop having per-module answers.
 *
 * The dependency cruise would catch it eventually, as the cycle it causes. This catches it at
 * the point the barrel is added, and names it as the cause rather than reporting the symptom
 * — the difference between "delete this file" and unpicking a directory's worth of edges.
 * There has never been one here, which is most of why the graph is clean.
 */
describe('no barrel file collapses a directory into a single import target', () => {
  it('has no index.ts anywhere under src', () => {
    expect(allSourceFiles('src').filter((path) => /(^|\/)index\.ts$/.test(path))).toEqual([]);
  });

  it('has no directory-wide re-export', () => {
    const offenders = allSourceFiles('src').filter((path) => /^export\s+\*/m.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
