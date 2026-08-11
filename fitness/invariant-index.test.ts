import {describe, it, expect} from 'vitest';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

/**
 * `CLAUDE.md`'s invariant table is an INDEX: every row promises that a rule's reasoning
 * lives in a named file and that named tests fail the build when it's broken. A promise
 * like that rots the moment a function is renamed — and it rots silently, because prose
 * doesn't compile. This test is the predicate that makes the index a checked claim rather
 * than a wish.
 *
 * It earned its place immediately: the prose version of that section named
 * `unknownSpeciesOverrides` twice, and no such function has ever existed (it's
 * `speciesOverrides`). Nothing could have caught that before this file.
 *
 * Deliberately NOT checked: whether a named test actually exercises the rule, or whether
 * the named file's docblocks really carry the argument. Both are judgement, and a test
 * that pretended to check them would just be a worse review. This checks the mechanical
 * half — that every pointer lands somewhere real — which is exactly the half that rots.
 */

const CLAUDE_MD = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');
const TAGS = ['✅', '◐', '👁'];

interface Row {
  readonly invariant: string;
  readonly tag: string;
  readonly ownedBy: string;
  readonly checkedBy: string;
}

/** The rows of the one table under `## Conventions & invariants`, header and rule line dropped. */
function invariantRows(): Row[] {
  const start = CLAUDE_MD.indexOf('| Invariant |');
  const rest = CLAUDE_MD.slice(start);
  const end = rest.indexOf('\n#'); // the next heading of any level closes the table
  return rest
    .slice(0, end === -1 ? undefined : end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2) // header row + the |---|---| rule
    .map((line) => line.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length === 4)
    .map(([invariant, tag, ownedBy, checkedBy]) => ({
      invariant: invariant!,
      tag: tag!,
      ownedBy: ownedBy!,
      checkedBy: checkedBy!,
    }));
}

/** Every `path.ts` / `path.json` mentioned in a cell. */
function filesIn(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+\.(?:ts|json))`/g)].map((m) => m[1]!);
}

/**
 * `file.ts` (`symbolA`, `symbolB`) → [[file, [symbolA, symbolB]]]. Symbols are only ever
 * claimed in the parenthesised group directly after the file they belong to, which is what
 * lets this assert them against that file specifically rather than the whole tree.
 */
function fileSymbolPairs(cell: string): [string, string[]][] {
  return [...cell.matchAll(/`([^`]+\.ts)`\s*\(([^)]*)\)/g)].map((m) => [
    m[1]!,
    [...m[2]!.matchAll(/`([^`]+)`/g)].map((s) => s[1]!),
  ]);
}

/** Source paths are written relative to `src/`; root config files stand alone. */
function resolveFile(ref: string): string | undefined {
  return [join('src', ref), join('fitness', ref), ref].find((p) => existsSync(p));
}

/**
 * Whether `source` DECLARES `symbol`, as opposed to merely mentioning it. A substring match
 * cannot tell the two apart, and the difference is the whole point of attributing a symbol
 * to a file: an import, a call or a comment all satisfy "the name appears here", so a symbol
 * that MOVES leaves every row that named its old home still passing.
 *
 * Measured when this replaced the substring test: of 91 rows, exactly one named a symbol it
 * did not declare — `conventions.test.ts` was credited with `HATCH`, which lives in
 * `rules.ts`, as that file's own docblock already said.
 */
function declares(source: string, symbol: string): boolean {
  const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^\\s*(export\\s+)?(async\\s+)?(function|const|let|class|interface|type|enum)\\s+${name}\\b` +
      `|^\\s*(readonly\\s+)?${name}\\s*[:(]` +
      `|^\\s*${name}\\s*=`,
    'm',
  ).test(source);
}

function findByBasename(dir: string, basename: string): boolean {
  return readdirSync(dir, {withFileTypes: true}).some((e) =>
    e.isDirectory() ? findByBasename(join(dir, e.name), basename) : e.name === basename,
  );
}

describe("CLAUDE.md's invariant index points at things that exist", () => {
  const rows = invariantRows();

  it('parses a plausible number of rows — a silent parse failure must not pass vacuously', () => {
    expect(rows.length).toBeGreaterThan(30);
  });

  it('tags every row with an enforcement level', () => {
    const untagged = rows.filter((r) => !TAGS.includes(r.tag)).map((r) => r.invariant);
    expect(untagged).toEqual([]);
  });

  it('names a real file for every "Reasoning owned by" entry', () => {
    const missing = rows.flatMap((r) =>
      filesIn(r.ownedBy)
        .filter((f) => !resolveFile(f))
        .map((f) => `${r.invariant} → ${f}`),
    );
    expect(missing).toEqual([]);
  });

  it('names a real test file for every "Checked by" entry', () => {
    const missing = rows.flatMap((r) =>
      filesIn(r.checkedBy)
        .filter((f) => !resolveFile(f) && !findByBasename('src', f) && !findByBasename('fitness', f))
        .map((f) => `${r.invariant} → ${f}`),
    );
    expect(missing).toEqual([]);
  });

  it('finds every named symbol DECLARED in the file the row attributes it to', () => {
    // Declared, not merely present: a row survives its symbol moving to another module if
    // the old home still imports or calls it, which is exactly the rot this index exists to
    // catch. Lifting `candidateDamageByMove` out of `section.ts` was the case that showed it.
    const missing = rows.flatMap((r) =>
      [...fileSymbolPairs(r.ownedBy), ...fileSymbolPairs(r.checkedBy)].flatMap(([file, symbols]) => {
        const path = resolveFile(file);
        if (!path) return []; // already reported by the file checks above
        const source = readFileSync(path, 'utf8');
        return symbols
          .filter((s) => !declares(source, s))
          .map((s) => `${r.invariant} → ${file} does not declare "${s}"`);
      }),
    );
    expect(missing).toEqual([]);
  });
});
