import {describe, it, expect} from 'vitest';
import {
  type Pmf,
  pmfFromSamples,
  hitCountPmf,
  convolve,
  convolveN,
  totalDamagePmf,
  expectedValue,
  probabilityAtLeast,
  koLadder,
  summarize,
} from './multihit.js';

/** Total probability mass — every PMF this module produces must sum to 1. */
function mass(pmf: Pmf): number {
  let m = 0;
  for (const p of pmf.values()) m += p;
  return m;
}

/** Compare a PMF to an expected {value: prob} map, within float tolerance. */
function expectPmf(pmf: Pmf, expected: Record<number, number>) {
  expect(mass(pmf)).toBeCloseTo(1, 10);
  expect(pmf.size).toBe(Object.keys(expected).length);
  for (const [value, prob] of Object.entries(expected)) {
    expect(pmf.get(Number(value)) ?? 0).toBeCloseTo(prob, 10);
  }
}

describe('hitCountPmf', () => {
  const none = {skillLink: false, loadedDice: false};

  it('2-5 move with no mods is 35/35/15/15 (matches PS sample table)', () => {
    expectPmf(hitCountPmf({kind: 'range', min: 2, max: 5}, none), {
      2: 0.35,
      3: 0.35,
      4: 0.15,
      5: 0.15,
    });
  });

  it('Skill Link forces the maximum hit count', () => {
    expectPmf(hitCountPmf({kind: 'range', min: 2, max: 5}, {...none, skillLink: true}), {5: 1});
  });

  it('Loaded Dice nets to a clean 50/50 between 4 and 5', () => {
    // Derived from PS: the 70% of rolls <4 are reassigned uniformly to {4,5},
    // and the 30% already at 4/5 stay — so 0.35+0.15 each.
    expectPmf(hitCountPmf({kind: 'range', min: 2, max: 5}, {...none, loadedDice: true}), {
      4: 0.5,
      5: 0.5,
    });
  });

  it('a single-hit move is hit count 1 with certainty', () => {
    expectPmf(hitCountPmf({kind: 'single'}, none), {1: 1});
  });

  it('a fixed move (Double Kick) is its hit count with certainty', () => {
    expectPmf(hitCountPmf({kind: 'fixed', hits: 2}, none), {2: 1});
  });

  it('Population Bomb + Loaded Dice is uniform over 4..10', () => {
    const pmf = hitCountPmf({kind: 'fixed', hits: 10}, {...none, loadedDice: true});
    expectPmf(pmf, {4: 1 / 7, 5: 1 / 7, 6: 1 / 7, 7: 1 / 7, 8: 1 / 7, 9: 1 / 7, 10: 1 / 7});
  });
});

describe('pmfFromSamples', () => {
  it('assigns equal mass and merges duplicates', () => {
    // 16 equally-likely rolls with duplicates is exactly the @smogon/calc damage array shape.
    expectPmf(pmfFromSamples([84, 84, 102]), {84: 2 / 3, 102: 1 / 3});
  });
});

describe('convolution', () => {
  const coin: Pmf = new Map([
    [2, 0.5],
    [4, 0.5],
  ]);

  it('convolve gives the distribution of a sum of two independents', () => {
    expectPmf(convolve(coin, coin), {4: 0.25, 6: 0.5, 8: 0.25});
  });

  it('convolveN with n=0 is a point mass at 0', () => {
    expectPmf(convolveN(coin, 0), {0: 1});
  });

  it('convolveN with n=3 matches three hand-rolled coins', () => {
    expectPmf(convolveN(coin, 3), {6: 0.125, 8: 0.375, 10: 0.375, 12: 0.125});
  });
});

describe('totalDamagePmf', () => {
  const perHit: Pmf = new Map([
    [2, 0.5],
    [4, 0.5],
  ]);
  const oneOrTwo: Pmf = new Map([
    [1, 0.5],
    [2, 0.5],
  ]);
  const total = totalDamagePmf(perHit, oneOrTwo);

  it('mixes per-hit rolls over the hit-count distribution', () => {
    expectPmf(total, {2: 0.25, 4: 0.375, 6: 0.25, 8: 0.125});
  });

  it('expected total = E[hits] × E[per-hit]', () => {
    // E[hits]=1.5, E[per-hit]=3 → 4.5
    expect(expectedValue(total)).toBeCloseTo(4.5, 10);
  });

  it('KO chance is the upper tail at the remaining HP', () => {
    expect(probabilityAtLeast(total, 6)).toBeCloseTo(0.375, 10); // 6 and 8
    expect(probabilityAtLeast(total, 4)).toBeCloseTo(0.75, 10); // 4, 6, 8
    expect(probabilityAtLeast(total, 9)).toBeCloseTo(0, 10); // nothing reaches 9
  });
});

describe('independent rolls narrow the distribution vs @smogon/calc', () => {
  // This is the bug we fix: calc treats k hits as k × ONE shared roll, so the
  // chance of an all-max total is p_max. With independent rolls it is p_max^k.
  const perHit: Pmf = new Map([
    [2, 0.5],
    [4, 0.5],
  ]);

  it('mean is preserved but extreme-total probability shrinks', () => {
    const independent = totalDamagePmf(perHit, new Map([[3, 1]]));
    expect(expectedValue(independent)).toBeCloseTo(9, 10); // same mean as 3 × E=3

    const pAllMaxIndependent = independent.get(12) ?? 0; // 0.5^3
    const pAllMaxCorrelated = perHit.get(4) ?? 0; //        calc's model: 0.5
    expect(pAllMaxIndependent).toBeCloseTo(0.125, 10);
    expect(pAllMaxIndependent).toBeLessThan(pAllMaxCorrelated);
  });
});

describe('summarize', () => {
  it('reports min, max, and mean', () => {
    const s = summarize(new Map([
      [10, 0.25],
      [20, 0.5],
      [30, 0.25],
    ]));
    expect(s).toEqual({min: 10, max: 30, mean: 20});
  });
});

describe('koLadder (nHKO with between-turn recovery)', () => {
  it('is monotonic and matches single-use KO on turn 1', () => {
    // A move dealing 50 or 60 (50/50) into 100 HP: turn 1 never KOs (max 60 < 100).
    const perUse = pmfFromSamples([50, 60]);
    const ladder = koLadder(perUse, 100, 100, 0, 3);
    expect(ladder[0]).toBe(0); // 60 < 100 → no OHKO
    expect(ladder[0]).toBeLessThanOrEqual(ladder[1]!); // cumulative
    expect(ladder[1]).toBeLessThanOrEqual(ladder[2]!);
    expect(ladder[2]).toBe(1); // by turn 3, 3×50 = 150 ≥ 100 always
  });

  it('recovery makes a KO strictly harder (Leftovers heals between turns)', () => {
    const perUse = pmfFromSamples([55]); // deterministic 55 into 100 HP
    const noRecovery = koLadder(perUse, 100, 100, 0, 3); // 55,110 → 2HKO on turn 2
    const withLefties = koLadder(perUse, 100, 100, 12, 3); // heals 12/turn → survives longer
    expect(noRecovery[1]).toBe(1); // 55+55=110 ≥ 100 → guaranteed 2HKO
    expect(withLefties[1]).toBe(0); // after hit1: 45, heal → 57; hit2: 2 → still alive
    expect(withLefties[2]).toBe(1); // 57→2→14→ hit3 kills
  });
})
