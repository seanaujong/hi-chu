import {describe, it, expect} from 'vitest';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {localImports} from './importgraph.js';
import {
  HATCH,
  clientFieldsRead,
  docCoverageGaps,
  testCoverageGaps,
  unexplainedHatchLines,
  unprobedClientFields,
} from './rules.js';

/**
 * Rules this project states in prose and, until now, stated ONLY in prose. Its two sibling
 * fitness tests own the other halves: `dependency-boundaries.test.ts` owns facts about the
 * import graph, `invariant-index.test.ts` owns whether the invariant table's pointers still
 * resolve. This file owns conventions about how the source itself is written — each one a
 * sentence that was true when someone wrote it down, with nothing keeping it true after.
 */

/**
 * The files the extension actually SHIPS: everything reachable from a build entry point
 * (`build.mjs` bundles `content.ts`; the Safari build adds `background.ts`).
 *
 * Derived rather than listed, because the interesting rules below are about code that runs
 * on someone else's machine and the tree keeps growing test-support files beside it —
 * `scenario.ts` and `sets.testfixtures.ts`, the two that stay in `src/` beside the product
 * tests that drive them. Neither had to be named here or kept up to date: nothing the product
 * runs imports them, so nothing the product runs makes a claim on their behalf. (`previews.ts`
 * needs no mention at all now — it lives in `gallery/`, which the cruise forbids the product
 * from reaching.)
 *
 * Type-only edges count. They are erased before the bundle runs, but a file the product's own
 * types are built out of is part of the product's definition — the conservative reading, and
 * the one that needs no explaining at a call site.
 */
const ENTRY_POINTS = ['src/content.ts', 'src/background.ts'];

function shippedFiles(): string[] {
  const reached = new Set<string>();
  const visit = (file: string): void => {
    if (reached.has(file) || !existsSync(file)) return;
    reached.add(file);
    for (const dependency of localImports(file)) visit(dependency.path);
  };
  for (const entry of ENTRY_POINTS) visit(entry);
  return [...reached].sort();
}

/**
 * `HATCH` and the three-line rationale window live in `rules.ts`, with the reasoning for both:
 * why these five and not the plain `as X` or the non-null `!` (under
 * `noUncheckedIndexedAccess` those two ARE the ordinary way to read a checked index, and a
 * rationale on each would be noise a reader learns to skip), and why the window is three lines
 * rather than one. What stays here is the reading of the tree they judge.
 */
describe('an escape hatch that switches the typechecker off carries a written rationale', () => {
  it('every `as unknown as`, `as any` or suppression comment in shipped code is explained', () => {
    const unexplained = shippedFiles().flatMap((path) =>
      unexplainedHatchLines(readFileSync(path, 'utf8').split('\n')).map((line) => `${path}:${line}`),
    );
    expect(
      unexplained,
      'Each site above defeats the typechecker with nothing saying why. Write one sentence on the line ' +
        'or just above it — or, if the same assertion appears several times, give it a named function whose ' +
        'docblock explains it once (see `rawEntries` in src/data/lookup.ts)',
    ).toEqual([]);
  });

  it('reaches the whole product from its entry points, and finds hatches there', () => {
    const shipped = shippedFiles();
    expect(shipped).toContain('src/core/damage.ts'); // the deepest module, furthest from an entry point
    expect(shipped).not.toContain('src/scenario.ts'); // a fixture builder, exempt by construction
    expect(shipped.filter((path) => HATCH.test(readFileSync(path, 'utf8'))).length).toBeGreaterThan(0);
  });
});

/**
 * Every law in the pure core has a colocated test, or sits here with the reason it does not.
 *
 * CLAUDE.md already states this list in prose, which is exactly the problem: prose can stop
 * being true without anything happening. A new core module with no test should cost a
 * deliberate edit here and a sentence defending it. The reverse direction is checked too — a
 * module that GAINS a test has to leave the list, so an exemption cannot outlive its reason.
 */
const UNTESTED_BY_DESIGN: Readonly<Record<string, string>> = {
  'types.ts': 'shared vocabulary — types only, nothing to execute',
  'moves.ts': 'data tables — exercised end to end by damage.test.ts',
  'facts.ts': 'tiny shared readings of LiveFacts — covered by resolve.test.ts',
  'narrow.ts': 'the evidence law — covered by resolve.test.ts',
  'calcinternals.ts':
    'bindings only — the assertion IS the type annotation, so tsc is its test; what the ' +
    'bound functions DO is pinned by speed.test.ts and hazards.test.ts',
};

/** The pure core's own modules — not their tests, not the fixture builder beside them. */
const coreModules = readdirSync('src/core').filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('testfixtures'),
);

describe('every module in the pure core has a colocated test, or a listed reason it does not', () => {
  const modules = coreModules;
  const hasTest = (name: string): boolean => existsSync(join('src/core', name.replace(/\.ts$/, '.test.ts')));

  // Each direction is its own `it` with its own message, because the two failures call for
  // opposite actions and a single set-equality assertion reports both as one array diff —
  // which tells a reader that something moved, but not which way or what to do about it.
  const gaps = testCoverageGaps(modules, hasTest, Object.keys(UNTESTED_BY_DESIGN));

  it('leaves no core module both untested and unexplained', () => {
    const {untested} = gaps;
    expect(
      untested,
      `Untested core module(s): ${untested.join(', ')}. Either add src/core/${untested[0]?.replace(/\.ts$/, '.test.ts') ?? '<module>.test.ts'}, ` +
        'or add the module to UNTESTED_BY_DESIGN in this file with the reason it needs no test of its own',
    ).toEqual([]);
  });

  it('drops an exemption once the module it excuses has grown a test', () => {
    const {stale} = gaps;
    expect(
      stale,
      `Now tested, so the exemption is dead: ${stale.join(', ')}. Remove them from UNTESTED_BY_DESIGN — ` +
        'an exemption left behind reads as a standing decision that this module needs no test',
    ).toEqual([]);
  });

  it('keeps the exemption list to modules that really exist', () => {
    const ghosts = Object.keys(UNTESTED_BY_DESIGN).filter((name) => !modules.includes(name));
    expect(ghosts, `UNTESTED_BY_DESIGN names modules that are gone: ${ghosts.join(', ')}. Delete those entries`).toEqual([]);
  });
});

/**
 * The section titled "where to make a change" describes the modules that exist.
 *
 * `invariant-index.test.ts` checks that every pointer in CLAUDE.md resolves; this is the
 * direction it deliberately left open, and the direction that actually rotted. `itemreveal.ts`
 * — the damage-magnitude half of the deduction story — existed for two releases without
 * appearing in that section at all, so anyone routed by the map could not learn it was there.
 * A cold read of this repo found it by noticing the GENERATED graph listed a module the
 * hand-written list didn't.
 *
 * Adding a file is exactly when a hand-maintained list goes stale, and it is the one moment
 * nothing else notices — the module compiles, its test passes, the cruise is clean. So this is
 * the mechanical half of "a new file should trigger a second look": the half a predicate can
 * take, leaving only the judgement to a human.
 */
describe('every client field the reader reads has a drift probe', () => {
  // The one obligation CLAUDE.md states in prose and nothing enforced. It is the rule with
  // the least visible failure in the codebase: these fields are precisely the ones the
  // typechecker cannot defend, so an unprobed read looks exactly like a probed one right up
  // until a Showdown client update changes what it answers.
  it('names every dex API, volatile and turnstatus in scripts/drift-check.mjs', () => {
    const read = clientFieldsRead(readFileSync('src/battle/readState.ts', 'utf8'));
    const probed = clientFieldsRead(readFileSync('scripts/drift-check.mjs', 'utf8'));
    // The reader has to be reading SOMETHING, or the extraction has quietly stopped working
    // and this rule would pass by finding nothing — the failure mode `importgraph` has had
    // twice. Named fields, not a count, so the guard cannot rot into a tautology.
    expect(read).toContain('volatiles.formechange');
    expect(read).toContain('dex.species');
    expect(
      unprobedClientFields(read, probed),
      'Each client field above is read by readState.ts and named nowhere in drift-check.mjs. ' +
        'Add a probe there (or to player-check.mjs if it lives behind battle.myPokemon) and ' +
        'list it under CLAUDE.md → "What only a real browser can guard" — a field the ' +
        'typechecker cannot defend and no probe watches is one a client update breaks silently.',
    ).toEqual([]);
  });
});

describe('the Architecture section lists the modules that actually exist', () => {
  /** Each `- `name.ts` — …` bullet under `## Architecture`, at any nesting depth. */
  function modulesNamedInArchitecture(): string[] {
    const doc = readFileSync('CLAUDE.md', 'utf8');
    const start = doc.indexOf('## Architecture');
    const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
    return [...section.matchAll(/^\s*-\s+`([a-z]+\.ts)`/gm)].map((m) => m[1]!);
  }

  it('names every module under src/core, and no module that is gone', () => {
    const listed = modulesNamedInArchitecture();
    expect(listed.length, 'parsed no bullets — the section format changed').toBeGreaterThan(10);

    const {undocumented, phantom} = docCoverageGaps(coreModules, listed);
    expect(
      undocumented,
      `Missing from CLAUDE.md's Architecture section: ${undocumented.join(', ')}. Add a bullet saying what ` +
        'the module OWNS — the list is how someone decides where a change belongs, so a module absent from ' +
        'it is a module nobody will find',
    ).toEqual([]);
    expect(
      phantom,
      `CLAUDE.md's Architecture section describes modules that no longer exist: ${phantom.join(', ')}`,
    ).toEqual([]);
  });
});
