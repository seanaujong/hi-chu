import {describe, it, expect} from 'vitest';
import {
  docCoverageGaps,
  importersOf,
  testCoverageGaps,
  unexplainedHatchLines,
  unreadableModuleNames,
} from './rules.js';

// Every case here is a violation the corresponding check is supposed to catch, fed straight
// to the judgement as a value. This is the plant-and-watch-it-fail step made permanent: it
// runs on every commit instead of once, in the session that wrote the rule, by hand.
//
// Each `describe` therefore asserts BOTH directions — the violation is caught, and the clean
// case is not. A rule that flags everything protects nothing either.

describe('a name outside the readable shape is caught', () => {
  it('flags a hyphen, a digit and a capital — the three ways an edge goes invisible', () => {
    expect(unreadableModuleNames(['item-loss.ts', 'item2.ts', 'ItemLoss.ts'])).toEqual([
      'item-loss.ts',
      'item2.ts',
      'ItemLoss.ts',
    ]);
  });

  it('passes the shapes the tree really uses', () => {
    expect(unreadableModuleNames(['damage.ts', 'damage.test.ts', 'sets.testfixtures.ts'])).toEqual([]);
  });
});

describe('reaching past a layer is caught', () => {
  it('names every importer, so the failure says who broke the rule', () => {
    const imports = {narrow: ['deductions'], knowledge: ['deductions', 'facts'], resolve: ['facts']};
    expect(importersOf('deductions', imports)).toEqual(['knowledge', 'narrow']);
  });

  it('names only the sanctioned importer when the layering holds', () => {
    expect(importersOf('deductions', {narrow: ['deductions'], knowledge: ['narrow']})).toEqual(['narrow']);
  });
});

describe('a test gap is caught in both directions', () => {
  const hasTest = (m: string): boolean => m === 'tested.ts';

  it('flags a module that is neither tested nor excused', () => {
    expect(testCoverageGaps(['untested.ts', 'tested.ts'], hasTest, []).untested).toEqual(['untested.ts']);
  });

  it('accepts an excused module, so the exemption list actually excuses', () => {
    expect(testCoverageGaps(['untested.ts'], hasTest, ['untested.ts']).untested).toEqual([]);
  });

  it('flags an exemption the module has outgrown — the reason expired', () => {
    expect(testCoverageGaps(['tested.ts'], hasTest, ['tested.ts']).stale).toEqual(['tested.ts']);
  });
});

describe('a module missing from the map is caught', () => {
  it('flags a real module the doc never mentions — the itemreveal.ts case', () => {
    const gaps = docCoverageGaps(['damage.ts', 'itemreveal.ts'], ['damage.ts']);
    expect(gaps.undocumented).toEqual(['itemreveal.ts']);
    expect(gaps.phantom).toEqual([]);
  });

  it('flags a doc entry for a module that is gone — the map outliving the road', () => {
    expect(docCoverageGaps(['damage.ts'], ['damage.ts', 'deleted.ts']).phantom).toEqual(['deleted.ts']);
  });

  it('is silent when the two agree', () => {
    const gaps = docCoverageGaps(['a.ts', 'b.ts'], ['b.ts', 'a.ts']);
    expect([gaps.undocumented, gaps.phantom]).toEqual([[], []]);
  });
});

describe('an unexplained escape hatch is caught', () => {
  it('flags a bare double assertion', () => {
    expect(unexplainedHatchLines(['const a = 1;', 'const b = a as unknown as string;'])).toEqual([2]);
  });

  it('accepts a rationale on the same line', () => {
    expect(unexplainedHatchLines(['const b = a as unknown as string; // the feed is looser than its type'])).toEqual([]);
  });

  it('accepts a docblock above the signature — two lines up, which one lookback misses', () => {
    const lines = ['/** The feed under the loose type it really has. */', 'function raw(d: Feed) {', '  return d as unknown as Raw;', '}'];
    expect(unexplainedHatchLines(lines)).toEqual([]);
  });

  it('ignores a hatch inside a comment — describing one is not doing one', () => {
    expect(unexplainedHatchLines(['// never write `as unknown as` without saying why'])).toEqual([]);
  });
});
