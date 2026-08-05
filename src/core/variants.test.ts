import {describe, it, expect} from 'vitest';
import {bucketByDamage, labelBuckets} from './variants.js';
import type {DamageReport} from './damage.js';
import type {ResolvedMon, SetVariant} from './types.js';

/** A minimal calc-ready mon; only species/item/ability/role matter for bucket labelling. */
function variant(over: {species?: string; item?: string; ability?: string; role?: string} = {}): SetVariant {
  const mon: ResolvedMon = {
    speciesForme: over.species ?? 'Tentacruel',
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
    timesAttacked: 0,
  };
  return {mon, role: over.role ?? ''};
}

/** A report shown as `percentMax`% and `koChance`. `desc` varies incidental fields that
 *  must NOT affect bucketing — two reads with the same numbers are one line, not two. */
function report(percentMax: number, koChance = 0, desc = ''): DamageReport {
  return {
    move: 'Surf',
    category: 'Special',
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

  it('labels by SPECIES first — a disguised Zoroark reads as its own Pokémon', () => {
    // The Illusion case: the shown species and the suspected Zoroark are different mons,
    // so the buckets name themselves by species, not by item.
    const labels = labelBuckets([
      [variant({species: 'Dudunsparce', item: 'Leftovers'})],
      [variant({species: 'Zoroark-Hisui', item: 'Life Orb'})],
    ]);
    expect(labels).toEqual(['Dudunsparce', 'Zoroark-Hisui']);
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

  it('labels an open-format spread split by its assumed-spread names', () => {
    // Two assumed spreads, each bucket holding both dex abilities (they didn't change
    // the number) — the role axis is the spread name and must separate them.
    const labels = labelBuckets([
      [variant({ability: 'Inner Focus', role: 'uninvested'}), variant({ability: 'Multiscale', role: 'uninvested'})],
      [variant({ability: 'Inner Focus', role: 'max HP/Def'}), variant({ability: 'Multiscale', role: 'max HP/Def'})],
    ]);
    expect(labels).toEqual(['uninvested', 'max HP/Def']);
  });

  it('gives a four-way spread × ability split four DISTINCT labels', () => {
    // A damage-relevant ability (Multiscale) crossed with two spreads: no single axis
    // separates all four buckets, so the compound role · ability axis must.
    const labels = labelBuckets([
      [variant({ability: 'Inner Focus', role: 'uninvested'})],
      [variant({ability: 'Multiscale', role: 'uninvested'})],
      [variant({ability: 'Inner Focus', role: 'max HP/Def'})],
      [variant({ability: 'Multiscale', role: 'max HP/Def'})],
    ]);
    expect(labels).toEqual([
      'uninvested · Inner Focus',
      'uninvested · Multiscale',
      'max HP/Def · Inner Focus',
      'max HP/Def · Multiscale',
    ]);
    expect(new Set(labels).size).toBe(4);
  });

  it('labels ONE role’s item × ability fan-out by the pair, when neither alone separates', () => {
    // Porygon-Z's Fast Attacker: three items × two abilities, where Choice Specs ×
    // Adaptability and Choice Scarf × Download multiply out to the SAME damage and share a
    // bucket. That puts Choice Scarf in two buckets and Adaptability in two others, so no
    // single axis has a value unique to any bucket — and the role, identical across every
    // variant in one candidate's fan-out, separates nothing at all. Only the pair does.
    const combo = (item: string, ability: string) => variant({item, ability, role: 'Fast Attacker'});
    const labels = labelBuckets([
      [combo('Choice Scarf', 'Adaptability')],
      [combo('Choice Scarf', 'Download'), combo('Choice Specs', 'Adaptability')],
      [combo('Choice Specs', 'Download')],
      [combo('Life Orb', 'Adaptability')],
    ]);
    expect(labels).toEqual([
      'Choice Scarf · Adaptability',
      'Choice Scarf · Download / Choice Specs · Adaptability',
      'Choice Specs · Download',
      'Life Orb · Adaptability',
    ]);
    expect(new Set(labels).size).toBe(4);
  });

  it('numbers the buckets when nothing separates them — never repeats one name', () => {
    // The fallback's whole job is that the labels come out DISTINCT. Naming a bucket after
    // its role instead reads fine across a mixed pool and fails silently on a single role's
    // fan-out, handing every bucket the identical name.
    const same = {item: 'Leftovers', ability: 'Levitate', role: 'Bulky Support'};
    const labels = labelBuckets([[variant(same)], [variant(same)], [variant(same)]]);
    expect(labels).toEqual(['set 1', 'set 2', 'set 3']);
    expect(new Set(labels).size).toBe(3);
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
