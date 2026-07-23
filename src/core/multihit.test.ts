import {describe, it, expect} from 'vitest';
import {
  type Pmf,
  pmfFromSamples,
  hitCountPmf,
  perHitChance,
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
  const none = {
    skillLink: false,
    loadedDice: false,
    wideLens: false,
    compoundEyes: false,
    hustle: false,
    noGuard: false,
    accuracyStage: 0,
    evasionStage: 0,
  };

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
    const pmf = hitCountPmf({kind: 'fixed', hits: 10, accuracyPerHit: 90}, {...none, loadedDice: true});
    expectPmf(pmf, {4: 1 / 7, 5: 1 / 7, 6: 1 / 7, 7: 1 / 7, 8: 1 / 7, 9: 1 / 7, 10: 1 / 7});
  });
});

describe('per-hit accuracy (multiaccuracy): the stop-at-miss law', () => {
  const none = {
    skillLink: false,
    loadedDice: false,
    wideLens: false,
    compoundEyes: false,
    hustle: false,
    noGuard: false,
    accuracyStage: 0,
    evasionStage: 0,
  };
  const tripleAxel = {kind: 'fixed', hits: 3, accuracyPerHit: 90} as const;
  const populationBomb = {kind: 'fixed', hits: 10, accuracyPerHit: 90} as const;

  it('a 3-hit 90% move: P(k) = 0.9^(k-1)·0.1, capped mass at 3', () => {
    // Hit 1 is conditioned on (damage calcs always assume the shown move connects);
    // hits 2 and 3 each land at 90% or the move ends.
    expectPmf(hitCountPmf(tripleAxel, none), {1: 0.1, 2: 0.09, 3: 0.81});
  });

  it('expected hits are Σ p^k — Triple Axel ≈2.71, Population Bomb ≈6.51', () => {
    expect(expectedValue(hitCountPmf(tripleAxel, none))).toBeCloseTo(2.71, 10);
    expect(expectedValue(hitCountPmf(populationBomb, none))).toBeCloseTo((1 - 0.9 ** 10) / 0.1, 10);
  });

  it('Population Bomb reaches all 10 hits with probability 0.9^9', () => {
    const pmf = hitCountPmf(populationBomb, none);
    expect(mass(pmf)).toBeCloseTo(1, 10);
    expect(pmf.get(10)).toBeCloseTo(0.9 ** 9, 10);
    expect(pmf.get(1)).toBeCloseTo(0.1, 10);
  });

  it('Loaded Dice DELETES the per-hit checks — a 3-hit move always gets all 3', () => {
    // PS data/items.ts: `if (move.multiaccuracy) delete move.multiaccuracy`.
    expectPmf(hitCountPmf(tripleAxel, {...none, loadedDice: true}), {3: 1});
  });

  it('Wide Lens raises each check with PS rounding: 90 → 99', () => {
    expect(perHitChance(90, {...none, wideLens: true})).toBeCloseTo(0.99, 10);
    expect(perHitChance(90, none)).toBeCloseTo(0.9, 10);
    // A boosted check can exceed 100 on paper; the chance caps at certainty.
    expect(perHitChance(100, {...none, wideLens: true})).toBe(1);
    const wide = hitCountPmf(populationBomb, {...none, wideLens: true});
    expect(expectedValue(wide)).toBeCloseTo((1 - 0.99 ** 10) / 0.01, 10); // ≈9.56 hits
  });
});

// Every value below was pinned by driving the real `pokemon-showdown` simulator package
// directly (a Custom Game battle, `Battle#randomChance` monkey-patched to log its incoming
// accuracy argument) — not derived from reading the source alone. No randbats set pairs
// Compound Eyes, Hustle, No Guard, or a boosted accuracy/evasion stage with a multiaccuracy
// move, so these only ever fire in a Custom/Free-For-All battle.
describe('per-hit accuracy: Compound Eyes, Hustle, No Guard, accuracy/evasion boosts', () => {
  const none = {
    skillLink: false,
    loadedDice: false,
    wideLens: false,
    compoundEyes: false,
    hustle: false,
    noGuard: false,
    accuracyStage: 0,
    evasionStage: 0,
  };

  it('Compound Eyes alone pushes 90 past 100 — a guaranteed hit, not 130%', () => {
    // 90 × 5325/4096, PS-truncated, is 117 — over the accuracy cap.
    expect(perHitChance(90, {...none, compoundEyes: true})).toBe(1);
  });

  it('Hustle alone: 90 → 72% (×3277/4096, physical multiaccuracy moves only)', () => {
    expect(perHitChance(90, {...none, hustle: true})).toBeCloseTo(0.72, 10);
  });

  it('Hustle + Wide Lens combine via PS’s own fixed-point chain: 90 → 79%', () => {
    expect(perHitChance(90, {...none, hustle: true, wideLens: true})).toBeCloseTo(0.79, 10);
  });

  it('No Guard on either side always hits, overriding every other modifier', () => {
    expect(perHitChance(90, {...none, noGuard: true})).toBe(1);
    // Even a crushing accuracy stage can't undo it.
    expect(perHitChance(90, {...none, noGuard: true, accuracyStage: -6})).toBe(1);
  });

  it('a lone accuracy stage applies as an un-truncated float, not PS’s combined hit-1 stage', () => {
    expect(perHitChance(90, {...none, accuracyStage: -1})).toBeCloseTo(0.675, 10);
    expect(perHitChance(90, {...none, accuracyStage: -2})).toBeCloseTo(0.54, 10);
    expect(perHitChance(90, {...none, accuracyStage: -6})).toBeCloseTo(0.3, 10);
    expect(perHitChance(90, {...none, accuracyStage: 6})).toBe(1); // 270% → capped
  });

  it('the defender’s evasion stage applies as its own separate step, same table', () => {
    expect(perHitChance(90, {...none, evasionStage: 1})).toBeCloseTo(0.675, 10); // mirrors acc -1
    expect(perHitChance(90, {...none, evasionStage: -6})).toBe(1); // 270% → capped
  });

  it('accuracy and evasion stages combine sequentially (accuracy first, then evasion)', () => {
    expect(perHitChance(90, {...none, accuracyStage: -1, evasionStage: 1})).toBeCloseTo(0.50625, 10);
  });

  it('a fractional boost-adjusted accuracy silently drops the item/ability bonus — a real ' +
    'PS quirk (its event system only re-applies a chained modifier to a WHOLE number)', () => {
    // 90 / (4/3) = 67.5, not an integer — Compound Eyes' ×5325/4096 never gets re-applied.
    const boostedAlone = perHitChance(90, {...none, accuracyStage: -1});
    const boostedWithCompoundEyes = perHitChance(90, {...none, accuracyStage: -1, compoundEyes: true});
    expect(boostedWithCompoundEyes).toBe(boostedAlone);
    expect(boostedWithCompoundEyes).toBeCloseTo(0.675, 10);

    // Same drop for a WIDE LENS bonus, and for a different fractional stage (-4 → 38.57…%).
    expect(perHitChance(90, {...none, accuracyStage: -1, wideLens: true})).toBe(boostedAlone);
    const dashFour = perHitChance(90, {...none, accuracyStage: -4});
    expect(perHitChance(90, {...none, accuracyStage: -4, compoundEyes: true})).toBe(dashFour);
  });

  it('a WHOLE-number boost-adjusted accuracy lets the item/ability bonus through as normal', () => {
    // -2 accuracy stage: 90/(5/3) = 54, an integer — Compound Eyes DOES apply from there.
    // 54 × 5325/4096, PS-truncated, is 70.
    expect(perHitChance(90, {...none, accuracyStage: -2, compoundEyes: true})).toBeCloseTo(0.7, 10);
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
  const total = totalDamagePmf([perHit], oneOrTwo);

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

  it('a variable-power move draws each hit from ITS OWN distribution, in order', () => {
    // Deterministic per-hit damage 1 / 10 / 100 with the stop-at-miss counts of a
    // 3-hit 90% move: the totals separate cleanly by how many hits landed.
    const hit1: Pmf = new Map([[1, 1]]);
    const hit2: Pmf = new Map([[10, 1]]);
    const hit3: Pmf = new Map([[100, 1]]);
    const counts: Pmf = new Map([
      [1, 0.1],
      [2, 0.09],
      [3, 0.81],
    ]);
    expectPmf(totalDamagePmf([hit1, hit2, hit3], counts), {1: 0.1, 11: 0.09, 111: 0.81});
  });

  it('hits past the array’s end repeat its last entry (uniform = one element)', () => {
    const perHit: Pmf = new Map([[5, 1]]);
    expectPmf(totalDamagePmf([perHit], new Map([[4, 1]])), {20: 1});
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
    const independent = totalDamagePmf([perHit], new Map([[3, 1]]));
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
