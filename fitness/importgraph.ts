// Reading this tree's own import graph, for the fitness tests that assert things about it
// (`dependency-boundaries.test.ts`, `conventions.test.ts`). Not part of the product: nothing
// reachable from a build entry point imports it, which `conventions.test.ts` relies on to
// tell shipped code from the fixture builders beside it.
//
// Lexical on purpose. The alternative is asking the TypeScript compiler for the real module
// graph, which is exact but pulls a program-construction step into a test that has to stay
// fast enough to run on every commit. Two things make the cheap read trustworthy here:
// `verbatimModuleSyntax` forces the type/value distinction into the SYNTAX (so `typeOnly`
// below is read, never inferred), and every consumer asserts it found a non-zero number of
// edges, so a parser that silently stopped working fails loudly instead of passing vacuously.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

export interface ImportStatement {
  /** The quoted module specifier, exactly as written — `./damage.js`, `@smogon/calc`. */
  readonly specifier: string;
  /** `import type {…}`, which `verbatimModuleSyntax` guarantees is erased before anything runs. */
  readonly typeOnly: boolean;
}

/** Matches through a wrapped import to the specifier that closes it. */
const IMPORT_SPECIFIER = /^import\s+(?:type\s+)?(?:[\s\S]*?\bfrom\s+)?['"]([^'"]+)['"]/;

/**
 * Every `import` in a file, each wrapped one folded back into a single statement.
 *
 * Reading imports LINE by line drops every import whose specifier sits on a later line than
 * its `import` keyword — `section.ts` wraps five today. That failure runs in the dangerous
 * direction: an edge nobody can see reads as a boundary held.
 */
export function importStatements(source: string): ImportStatement[] {
  const lines = source.split('\n');
  const statements: ImportStatement[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^import\b/.test(lines[i]!)) continue;
    let statement = lines[i]!;
    let match = IMPORT_SPECIFIER.exec(statement);
    while (!match && i + 1 < lines.length) {
      statement += ` ${lines[++i]!.trim()}`;
      match = IMPORT_SPECIFIER.exec(statement);
    }
    if (match) statements.push({specifier: match[1]!, typeOnly: /^import\s+type\b/.test(statement)});
  }
  return statements;
}

/** The relative imports of one file, as the paths they resolve to. */
export function localImports(file: string): (ImportStatement & {readonly path: string})[] {
  return importStatements(readFileSync(file, 'utf8'))
    .filter((s) => s.specifier.startsWith('.'))
    .map((s) => ({...s, path: join(dirname(file), s.specifier.replace(/\.js$/, '.ts'))}));
}
