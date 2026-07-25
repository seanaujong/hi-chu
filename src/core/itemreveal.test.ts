import {describe, it, expect} from 'vitest';
import {calcDamage} from './damage.js';
import {variantsConsistentWithDamage} from './itemreveal.js';
import type {FieldFacts, ResolvedMon, SetVariant} from './types.js';

const noField: FieldFacts = {defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false}};

/** A fully-specified ResolvedMon with sensible defaults, so tests state only what matters. */
function mon(over: Partial<ResolvedMon> & {speciesForme: string}): ResolvedMon {
  return {
    level: 100,
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
    timesAttacked: 0,
    ...over,
  };
}

describe('variantsConsistentWithDamage', () => {
  const defender = mon({speciesForme: 'Skarmory'});
  const lifeOrb: SetVariant = {mon: mon({speciesForme: 'Weavile', item: 'Life Orb'}), role: 'Life Orb'};
  const leftovers: SetVariant = {mon: mon({speciesForme: 'Weavile', item: 'Leftovers'}), role: 'Leftovers'};
  const variants = [lifeOrb, leftovers];
  const options = {gen: 9, field: noField, doubles: false};

  const lifeOrbRange = calcDamage(lifeOrb.mon, defender, 'Icicle Crash', options).percent;
  const leftoversRange = calcDamage(leftovers.mon, defender, 'Icicle Crash', options).percent;

  it('keeps only the variant whose calculated range contains the observed damage (Life Orb)', () => {
    // Confirm the fixture actually separates the two ranges before trusting the assertion
    // below — Life Orb's +30% must be a REAL, non-overlapping swing, not just a different label.
    expect(lifeOrbRange.min).toBeGreaterThan(leftoversRange.max);

    const observed = (lifeOrbRange.min + lifeOrbRange.max) / 200; // midpoint, as a [0,1] fraction
    const result = variantsConsistentWithDamage(variants, defender, options, {move: 'Icicle Crash', damageFraction: observed});
    expect(result).toEqual([lifeOrb]);
  });

  it('keeps only the Leftovers variant when the observed damage matches ITS range instead', () => {
    const observed = (leftoversRange.min + leftoversRange.max) / 200;
    const result = variantsConsistentWithDamage(variants, defender, options, {move: 'Icicle Crash', damageFraction: observed});
    expect(result).toEqual([leftovers]);
  });

  it('widens each range by the tolerance, for HP-display rounding', () => {
    const justBelowMin = leftoversRange.min / 100 - 0.005; // inside the default ±0.006 tolerance
    const result = variantsConsistentWithDamage(variants, defender, options, {move: 'Icicle Crash', damageFraction: justBelowMin});
    expect(result).toContainEqual(leftovers);
  });

  it('never narrows to nothing — an observation outside EVERY range hands back the full pool unfiltered', () => {
    const impossible = 5; // 500%, past what either variant could ever roll
    const result = variantsConsistentWithDamage(variants, defender, options, {move: 'Icicle Crash', damageFraction: impossible});
    expect(result).toEqual(variants);
  });

  it('keeps every variant for a status move — there is no damage number to compare it against', () => {
    const result = variantsConsistentWithDamage(variants, defender, options, {move: 'Toxic', damageFraction: 0.9});
    expect(result).toEqual(variants);
  });

  it('keeps a variant the calc cannot score this move for at all, rather than judge it', () => {
    // A truly unknown species (no dex record, no client-dex fallback) makes calcDamage
    // throw — see damage.test.ts's own "without dex data a truly unknown species still
    // throws" case. That must cost this reading a verdict, never the variant itself.
    const unresolvable: SetVariant = {mon: mon({speciesForme: 'Missingno-Mega'}), role: ''};
    const result = variantsConsistentWithDamage([unresolvable], defender, options, {move: 'Icicle Crash', damageFraction: 0.5});
    expect(result).toEqual([unresolvable]);
  });
});
