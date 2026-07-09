// Pins for the speed-order law. The exact numbers double as the deep-import guard:
// getFinalSpeed comes from @smogon/calc's internals (dist/mechanics/util), so a calc
// upgrade that moves or changes it fails HERE, loudly, instead of silently breaking
// the hover. Expected values follow the mainline stat formula at the randbats spread
// (level 80, 85 EVs / 31 IVs / Serious): Dragapult (base 142 Spe) → 273 raw.

import {describe, it, expect} from 'vitest';
import {compareSpeed, finalSpeed, speedBuckets} from './speed.js';
import type {FieldFacts, ResolvedMon, SetVariant} from './types.js';

const mon = (over: Partial<ResolvedMon> = {}): ResolvedMon => ({
  speciesForme: 'Dragapult',
  level: 80,
  nature: 'Serious',
  evs: {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85},
  ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
  ability: undefined,
  item: undefined,
  status: undefined,
  boosts: {},
  hpPercent: 1,
  teraType: undefined,
  terastallized: false,
  possibleMoves: [],
  ...over,
});

const variant = (over: Partial<ResolvedMon>, role = 'Set'): SetVariant => ({mon: mon(over), role});

const field = (over: Partial<FieldFacts> = {}): FieldFacts => ({
  defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false},
  ...over,
});

describe('finalSpeed', () => {
  it('matches the mainline randbats spread exactly (no range)', () => {
    expect(finalSpeed(mon())).toBe(273);
  });

  it('applies Choice Scarf (×1.5)', () => {
    expect(finalSpeed(mon({item: 'Choice Scarf'}))).toBe(409);
  });

  it('halves under paralysis (gen 9)', () => {
    expect(finalSpeed(mon({status: 'par'}))).toBe(136);
  });

  it('doubles under Tailwind — the mon\'s OWN side\'s, passed by the caller', () => {
    expect(finalSpeed(mon(), {tailwind: true})).toBe(546);
  });

  it('applies stat stages', () => {
    expect(finalSpeed(mon({boosts: {spe: 1}}))).toBe(409);
  });

  it('composes: Scarf + Tailwind chain, then paralysis floors the result', () => {
    const m = mon({item: 'Choice Scarf', status: 'par'});
    expect(finalSpeed(m, {tailwind: true})).toBe(409);
  });

  it('arms Chlorophyll only when the sun is actually up', () => {
    const chloro = mon({speciesForme: 'Venusaur', ability: 'Chlorophyll'});
    const dry = finalSpeed(chloro);
    expect(finalSpeed(chloro, {field: field({weather: 'Sun'})})).toBe(dry * 2);
    expect(finalSpeed(chloro, {field: field({weather: 'Rain'})})).toBe(dry);
  });
});

describe('speedBuckets', () => {
  it('collapses variants with identical speed into ONE unlabelled bucket', () => {
    const buckets = speedBuckets([variant({item: 'Leftovers'}), variant({item: 'Heavy-Duty Boots'})]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({speed: 273, label: '', weight: 2});
  });

  it('splits a surviving Scarf set into its own labelled bucket, majority first', () => {
    const buckets = speedBuckets([
      variant({item: 'Leftovers'}),
      variant({item: 'Heavy-Duty Boots'}),
      variant({item: 'Choice Scarf'}),
    ]);
    expect(buckets).toHaveLength(2);
    // The bucket most surviving sets share leads; the Scarf outlier is the aside.
    expect(buckets[0]).toMatchObject({speed: 273, weight: 2});
    expect(buckets[1]).toMatchObject({speed: 409, weight: 1, label: 'Choice Scarf'});
  });

  it('labels a different-species outcome (a possible disguised Zoroark) by species', () => {
    const buckets = speedBuckets([
      variant({item: 'Leftovers'}),
      variant({speciesForme: 'Zoroark-Hisui'}, 'Zoroark-Hisui'),
    ]);
    expect(buckets.map((b) => b.label)).toContain('Zoroark-Hisui');
  });
});

describe('compareSpeed', () => {
  const bucket = (speed: number, label = '', weight = 1) => ({speed, label, weight});

  it('judges each outcome against our speed', () => {
    const order = compareSpeed(273, [bucket(213), bucket(319, 'Choice Scarf')]);
    expect(order.outcomes.map((o) => o.first)).toEqual(['ours', 'theirs']);
  });

  it('calls an exact speed tie a tie', () => {
    expect(compareSpeed(273, [bucket(273)]).outcomes[0]?.first).toBe('tie');
  });

  it('Trick Room flips the verdict, never the number — and a tie stays a tie', () => {
    const buckets = [bucket(213), bucket(319, 'Choice Scarf'), bucket(273)];
    const normal = compareSpeed(273, buckets, false);
    const room = compareSpeed(273, buckets, true);
    expect(normal.outcomes.map((o) => o.first)).toEqual(['ours', 'theirs', 'tie']);
    expect(room.outcomes.map((o) => o.first)).toEqual(['theirs', 'ours', 'tie']);
    expect(room.outcomes.map((o) => o.speed)).toEqual(normal.outcomes.map((o) => o.speed));
  });
});
