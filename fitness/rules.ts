// The JUDGEMENTS the fitness checks make, separated from the reading of the tree they make
// them about.
//
// Every check in `fitness/` was watched failing once, by hand, in the session that wrote it —
// and then nothing ever re-ran that plant. A rule that quietly stops catching its own
// violation is indistinguishable from a rule that passes, which is the failure mode this
// whole directory exists to prevent everywhere except in itself. Two real instances already:
// a reader that dropped every wrapped import, and one that dropped every module whose name
// held a hyphen. Both read green.
//
// The fix is the one this codebase reaches for whenever something "can't be tested": find
// where the effect becomes a VALUE. A judgement over a list of filenames is a pure function,
// so `rules.test.ts` can feed it a violation directly and assert it is caught — no mutating
// the working tree, no subprocess, no plant anyone has to remember to re-run. What remains in
// the check files is only the reading, which is what their "not vacuously true" assertions
// already guard.

/** A module's base name as the layering rules can read it: lowercase letters only. */
export const CORE_MODULE = '[a-z]+';

/** Filenames under `src/core` that no layering rule can see. A name outside `CORE_MODULE`
 *  makes that module's edges invisible, so a violation involving it passes silently. */
export function unreadableModuleNames(names: readonly string[]): string[] {
  const shape = new RegExp(`^${CORE_MODULE}(\\.test|\\.testfixtures)?\\.ts$`);
  return names.filter((name) => !shape.test(name));
}

/** Which modules import `target`, given each module's own sibling imports. */
export function importersOf(target: string, siblingImports: Readonly<Record<string, readonly string[]>>): string[] {
  return Object.keys(siblingImports)
    .filter((name) => siblingImports[name]!.includes(target))
    .sort();
}

export interface TestCoverageGaps {
  /** Modules with no colocated test and no listed reason — write one or list it. */
  readonly untested: string[];
  /** Listed exemptions whose module has since grown a test — the reason has expired. */
  readonly stale: string[];
}

/** Both directions at once, because they are one rule read forwards and backwards: every
 *  module is tested or excused, and no excuse outlives the module gaining a test. */
export function testCoverageGaps(
  modules: readonly string[],
  hasTest: (module: string) => boolean,
  exempt: readonly string[],
): TestCoverageGaps {
  return {
    untested: modules.filter((m) => !hasTest(m) && !exempt.includes(m)).sort(),
    stale: exempt.filter((m) => hasTest(m)).sort(),
  };
}

export interface DocCoverageGaps {
  /** Real modules the doc never mentions — the map is missing part of the territory. */
  readonly undocumented: string[];
  /** Modules the doc describes that no longer exist — the map describes a deleted road. */
  readonly phantom: string[];
}

/**
 * A hand-written module list against the modules that actually exist.
 *
 * `invariant-index` already checks that every pointer in CLAUDE.md resolves; this is the
 * direction it deliberately left open, and the direction that actually rotted.
 * `itemreveal.ts` — half of the deduction story — existed for two releases without appearing
 * in the section titled "where to make a change", so anyone routed by that list could not
 * learn it was there. Adding a file is exactly when a hand-maintained list goes stale, and
 * nothing else notices.
 */
export function docCoverageGaps(inSource: readonly string[], inDoc: readonly string[]): DocCoverageGaps {
  return {
    undocumented: inSource.filter((m) => !inDoc.includes(m)).sort(),
    phantom: inDoc.filter((m) => !inSource.includes(m)).sort(),
  };
}

/**
 * The escape hatches that switch the typechecker OFF rather than leaning on it: the double
 * assertion (whose purpose is to defeat the overlap rule a single `as` must still satisfy),
 * `as any`, and the three suppression comments.
 */
export const HATCH = /\bas\s+unknown\s+as\b|\bas\s+any\b|@ts-expect-error|@ts-ignore|eslint-disable/;

/**
 * The 1-indexed lines carrying a hatch with nothing explaining it.
 *
 * A rationale counts if it is on the hatch's own line or within the three above. Three,
 * because the best form this rule can reward is a cast wrapped in a named function whose
 * docblock explains it — which puts the nearest comment line, the one closing the docblock,
 * two lines up with the signature between. A one-line lookback rejects exactly the shape it
 * should encourage, which is how `lookup.ts`'s `rawEntries` first failed this rule.
 */
export function unexplainedHatchLines(lines: readonly string[]): number[] {
  const isComment = (line: string | undefined): boolean => /^\s*(\/\/|\/\*|\*)/.test(line ?? '');
  return lines.flatMap((line, i) => {
    if (!HATCH.test(line) || isComment(line)) return [];
    const explained = line.includes('//') || lines.slice(Math.max(0, i - 3), i).some(isComment);
    return explained ? [] : [i + 1];
  });
}

/** Source with its comment lines removed, so a field a docblock merely MENTIONS is not
 *  mistaken for one the code reads — nor for one the drift probe actually checks. */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

/**
 * The client fields a file READS, in the form a drift probe has to name them: the keys hung
 * off the untyped client bags whose shape nothing in TypeScript can defend.
 *
 * Three families, because those are the three the client hands us untyped: `battle.dex.<api>`,
 * `pokemon.volatiles.<id>` and `pokemon.turnstatuses.<id>`. Both access forms count —
 * `volatiles?.substitute` and `volatiles?.['typechange']` are the same read.
 */
export function clientFieldsRead(source: string): string[] {
  const found = new Set<string>();
  for (const m of withoutComments(source).matchAll(
    /\b(dex|volatiles|turnstatuses)\??\.(?:\[['"]([A-Za-z]+)['"]\]|([A-Za-z]+))/g,
  )) {
    const key = m[2] ?? m[3];
    if (key && key !== 'get') found.add(`${m[1]}.${key}`);
  }
  return [...found].sort();
}

/**
 * Client fields one file reads that the other never names — the probe obligation, as a
 * predicate.
 *
 * CLAUDE.md states it in prose: reading a client field `readState.ts` doesn't already read
 * OBLIGES a probe in `scripts/drift-check.mjs`. Nothing enforced it, and the first change to
 * test that was the speed-order work — which added a `battle.dex.moves` read for a move's
 * priority bracket, wrote the field into CLAUDE.md's probe list, and never probed it.
 *
 * The failure is silent by construction: the reads needing a probe are exactly the ones the
 * typechecker cannot see, so a missing probe is indistinguishable from a covered one until a
 * client update quietly changes an answer. That is also why this rule earns its keep where a
 * hand-maintained list does not — the list in CLAUDE.md was updated and the probe still wasn't.
 *
 * A NAME, not a real assertion, is what this can check. drift-check's whole job is naming
 * fields, so a mention in its CODE is good evidence, and comments are stripped from both
 * sides so a note about a field cannot stand in for probing it. It catches the case that
 * actually happens — a field nobody thought about — not a deliberately hollow probe.
 */
export function unprobedClientFields(read: readonly string[], probed: readonly string[]): string[] {
  return read.filter((field) => !probed.includes(field)).sort();
}
