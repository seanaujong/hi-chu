import {describe, it, expect} from 'vitest';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {localImports} from './importgraph.js';

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
 * `scenario.ts`, `previews.ts`, `sets.testfixtures.ts`. None of them had to be named here or
 * kept up to date: nothing the product runs imports them, so nothing the product runs makes
 * a claim on their behalf.
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
 * The escape hatches that switch the typechecker OFF rather than merely leaning on it: the
 * double assertion (whose whole purpose is to defeat the overlap rule a single `as` must
 * still satisfy), `as any`, and the three suppression comments.
 *
 * Deliberately NOT the plain `as X` or the non-null `!`. Under `noUncheckedIndexedAccess`
 * those two ARE the ordinary way to read a checked index, they outnumber the hatches below by
 * more than an order of magnitude, and a rationale on each would be noise — a check that emits
 * noise gets ignored, which costs more than the check can save. A plain `as` also still has to
 * satisfy the overlap rule; the ones below are chosen precisely because they do not.
 */
const HATCH = /\bas\s+unknown\s+as\b|\bas\s+any\b|@ts-expect-error|@ts-ignore|eslint-disable/;

/**
 * A comment on the cast's own line, or within the three lines above it.
 *
 * Three, because the best form this rule can reward is a cast wrapped in a named function
 * whose docblock explains it — and that puts the nearest comment line, the one closing the
 * docblock, two lines up with the signature in between. A one-line lookback rejects exactly
 * the shape it should encourage; that is not hypothetical, it is how `lookup.ts`'s
 * `rawEntries` first failed this test.
 */
function hasRationale(lines: readonly string[], index: number): boolean {
  const isComment = (line: string | undefined): boolean => /^\s*(\/\/|\/\*|\*)/.test(line ?? '');
  return lines[index]!.includes('//') || lines.slice(Math.max(0, index - 3), index).some(isComment);
}

describe('an escape hatch that switches the typechecker off carries a written rationale', () => {
  it('every `as unknown as`, `as any` or suppression comment in shipped code is explained', () => {
    const unexplained = shippedFiles().flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n');
      return lines.flatMap((line, i) =>
        HATCH.test(line) && !/^\s*(\/\/|\*)/.test(line) && !hasRationale(lines, i) ? [`${path}:${i + 1}`] : [],
      );
    });
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
};

describe('every module in the pure core has a colocated test, or a listed reason it does not', () => {
  const modules = readdirSync('src/core').filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('testfixtures'),
  );
  const hasTest = (name: string): boolean => existsSync(join('src/core', name.replace(/\.ts$/, '.test.ts')));

  // Each direction is its own `it` with its own message, because the two failures call for
  // opposite actions and a single set-equality assertion reports both as one array diff —
  // which tells a reader that something moved, but not which way or what to do about it.
  it('leaves no core module both untested and unexplained', () => {
    const unexplained = modules.filter((name) => !hasTest(name) && !(name in UNTESTED_BY_DESIGN));
    expect(
      unexplained,
      `Untested core module(s): ${unexplained.join(', ')}. Either add src/core/${unexplained[0]?.replace(/\.ts$/, '.test.ts') ?? '<module>.test.ts'}, ` +
        'or add the module to UNTESTED_BY_DESIGN in this file with the reason it needs no test of its own',
    ).toEqual([]);
  });

  it('drops an exemption once the module it excuses has grown a test', () => {
    const stale = Object.keys(UNTESTED_BY_DESIGN).filter((name) => hasTest(name));
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
