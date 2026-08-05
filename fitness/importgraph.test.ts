import {describe, it, expect} from 'vitest';
import {importStatements} from './importgraph.js';

// Two fitness tests read the import graph through this parser, and both of them assert that
// something is ABSENT — no cycle, no unexplained cast in shipped code. An absence proved by a
// parser that quietly stopped seeing half the tree is the failure mode worth pinning, so the
// wrapped-import case gets its own case here rather than being trusted from the real files.

describe('reads an import however it is written', () => {
  it('folds a wrapped import back into one statement', () => {
    const source = ['import {', '  renderMoveSection,', '  type SetsRenderModel,', "} from './core/render.js';"].join('\n');
    expect(importStatements(source)).toEqual([{specifier: './core/render.js', typeOnly: false}]);
  });

  it('separates a type-only import from a value one', () => {
    const source = ["import type {LiveFacts} from './types.js';", "import {calcDamage} from './damage.js';"].join('\n');
    expect(importStatements(source)).toEqual([
      {specifier: './types.js', typeOnly: true},
      {specifier: './damage.js', typeOnly: false},
    ]);
  });

  it('reads a wrapped type-only import as type-only', () => {
    const source = ['import type {', '  CandidateSet,', "} from './core/types.js';"].join('\n');
    expect(importStatements(source)).toEqual([{specifier: './core/types.js', typeOnly: true}]);
  });

  it('reads a bare specifier, a default import and a namespace import', () => {
    const source = ["import './polyfill.js';", "import fixture from './replay.json';", "import * as fs from 'node:fs';"].join('\n');
    expect(importStatements(source).map((s) => s.specifier)).toEqual(['./polyfill.js', './replay.json', 'node:fs']);
  });

  it('ignores the word "import" anywhere but the start of a statement', () => {
    const source = ['// we import nothing here', 'const importantThing = 1;', "export {importantThing} from './x.js';"].join('\n');
    expect(importStatements(source)).toEqual([]);
  });
});
