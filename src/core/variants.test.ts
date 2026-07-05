import {describe, it, expect} from 'vitest';
import {bucketByDamage, labelBuckets} from './variants.js';
import type {DamageReport} from './damage.js';
import type {ResolvedMon, SetVariant} from './types.js';

/** A minimal calc-ready mon; only item/ability/role matter for bucket labelling. */
function variant(over: {item?: string; ability?: string; role?: string} = {}): SetVariant {
  const mon: ResolvedMon = {
    speciesForme: 'Tentacruel',
    level: 82,
    nature: 'Serious',
    evs: {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85},
    ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
    ability: over.ability,
    item: over.item,
    status: undefined,
    boosts: {},
    hpPercent: 1,
    teraType: undefined,
    terastallized: false,
    possibleMoves: [],
  };
  return {mon, role: over.role ?? ''};
}

/** A report shown as `percentMax`% and `koChance`. `desc` varies incidental fields that
 *  must NOT affect bucketing — two reads with the same numbers are one line, not two. */
function report(percentMax: number, koChance = 0, desc = ''): DamageReport {
  return {
    move: 'Surf',
    category: 'Special',
    multiHit: false,
    approximate: false,
    total: {min: 100, max: percentMax * 3, mean: 110},
    percent: {min: percentMax - 6, max: percentMax, mean: percentMax - 3},
    koChance,
    defenderMaxHP: 300,
    defenderRemainingHP: 300,
    calcDesc: desc,
    notes: [],
  };
}

describe('labelBuckets', () => {
  it('leaves a sole bucket unlabelled — nothing to distinguish', () => {
    expect(labelBuckets([[variant({item: 'Leftovers'})]])).toEqual(['']);
  });

  it('names two item buckets each by its own single item', () => {
    const labels = labelBuckets([[variant({item: 'Assault Vest'})], [variant({item: 'Leftovers'})]]);
    expect(labels).toEqual(['Assault Vest', 'Leftovers']);
  });

  it('names a big "everything-else" bucket by exclusion of the distinctive one', () => {
    // The Assault Vest set is the only one that changes the number; the rest (all
    // defensively inert) merge into one bucket named for what it is NOT.
    const inert = [variant({item: 'Leftovers'}), variant({item: 'Life Orb'}), variant({item: 'Heavy-Duty Boots'})];
    expect(labelBuckets([[variant({item: 'Assault Vest'})], inert])).toEqual(['Assault Vest', 'no Assault Vest']);
  });

  it('falls to the ability axis when the item is the same across buckets', () => {
    const labels = labelBuckets([
      [variant({item: 'Leftovers', ability: 'Thick Fat'})],
      [variant({item: 'Leftovers', ability: 'Levitate'})],
    ]);
    expect(labels).toEqual(['Thick Fat', 'Levitate']);
  });

  it('falls to the role name when neither item nor ability differs (a spread split)', () => {
    const labels = labelBuckets([
      [variant({item: 'Leftovers', ability: 'Liquid Ooze', role: 'Bulky Support'})],
      [variant({item: 'Leftovers', ability: 'Liquid Ooze', role: 'Fast Attacker'})],
    ]);
    expect(labels).toEqual(['Bulky Support', 'Fast Attacker']);
  });
});

describe('bucketByDamage', () => {
  it('collapses many sets with identical shown numbers into ONE bucket — no dupes', () => {
    // The dominant case the split must NOT blow up: three still-possible sets that all
    // deal the same damage (item irrelevant to this move). The reports are distinct
    // objects with different incidental fields (calcDesc names the item) — only the
    // SHOWN numbers must decide the merge, so they still collapse to one plain line.
    const buckets = bucketByDamage([
      {variant: variant({item: 'Leftovers'}), report: report(80, 0.3, 'via Leftovers')},
      {variant: variant({item: 'Life Orb'}), report: report(80, 0.3, 'via Life Orb')},
      {variant: variant({item: 'Choice Scarf'}), report: report(80, 0.3, 'via Choice Scarf')},
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.label).toBe('');
  });

  it('splits into distinct outcomes when the item changes the number', () => {
    const buckets = bucketByDamage([
      {variant: variant({item: 'Assault Vest'}), report: report(60, 0)},
      {variant: variant({item: 'Leftovers'}), report: report(92, 0.71)},
    ]);
    expect(buckets.map((b) => b.label)).toEqual(['Assault Vest', 'Leftovers']);
    expect(buckets.map((b) => b.report.percent.max)).toEqual([60, 92]);
  });
});
