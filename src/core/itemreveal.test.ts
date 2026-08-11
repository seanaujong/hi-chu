import {describe, it, expect} from 'vitest';
import {calcDamage} from './damage.js';
import {variantsConsistentWithDamageDealt, variantsConsistentWithDamageTaken} from './itemreveal.js';
import type {FieldFacts, ObservedHit, ResolvedMon, SetVariant} from './types.js';

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

/** An observation with both sides unboosted — what every case below assumed implicitly. */
function hit(move: string, damageFraction: number, over: Partial<ObservedHit> = {}): ObservedHit {
  return {move, damageFraction, attackerBoosts: {}, defenderBoosts: {}, ...over};
}

describe('variantsConsistentWithDamageDealt', () => {
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
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Icicle Crash', observed));
    expect(result).toEqual([lifeOrb]);
  });

  it('keeps only the Leftovers variant when the observed damage matches ITS range instead', () => {
    const observed = (leftoversRange.min + leftoversRange.max) / 200;
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Icicle Crash', observed));
    expect(result).toEqual([leftovers]);
  });

  it('widens each range by the tolerance, for HP-display rounding', () => {
    const justBelowMin = leftoversRange.min / 100 - 0.005; // inside the default ±0.006 tolerance
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Icicle Crash', justBelowMin));
    expect(result).toContainEqual(leftovers);
  });

  it('never narrows to nothing — an observation outside EVERY range hands back the full pool unfiltered', () => {
    const impossible = 5; // 500%, past what either variant could ever roll
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Icicle Crash', impossible));
    expect(result).toEqual(variants);
  });

  it('keeps every variant for a status move — there is no damage number to compare it against', () => {
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Toxic', 0.9));
    expect(result).toEqual(variants);
  });

  it('keeps a variant the calc cannot score this move for at all, rather than judge it', () => {
    // A truly unknown species (no dex record, no client-dex fallback) makes calcDamage
    // throw — see damage.test.ts's own "without dex data a truly unknown species still
    // throws" case. That must cost this reading a verdict, never the variant itself.
    const unresolvable: SetVariant = {mon: mon({speciesForme: 'Missingno-Mega'}), role: ''};
    const result = variantsConsistentWithDamageDealt([unresolvable], defender, options, hit('Icicle Crash', 0.5));
    expect(result).toEqual([unresolvable]);
  });
});

describe('the boosts a reading is judged under are the OBSERVATION\u2019s, not the ones standing now', () => {
  // Bug Buzz lowers the defender's SpD as a secondary, so by the time anyone hovers, the
  // defender is at -1 and the same hit would compute BIGGER. Judging against that table is
  // how a set that was never impossible gets convicted.
  const attacker = mon({speciesForme: 'Volcarona'});
  const plain: SetVariant = {mon: mon({speciesForme: 'Tsareena'}), role: 'Fast Support'};
  const vest: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Assault Vest'}), role: 'Fast Support'};
  const options = {gen: 9, field: noField, doubles: false};

  it('reads an unboosted hit as unboosted even when the secondary has since landed', () => {
    const unboosted = calcDamage(attacker, plain.mon, 'Bug Buzz', options).percent;
    const dropped = calcDamage(attacker, {...plain.mon, boosts: {spd: -1}}, 'Bug Buzz', options).percent;
    // The fixture only means something if the drop really moves the number.
    expect(dropped.min).toBeGreaterThan(unboosted.max);

    const observed = hit('Bug Buzz', (unboosted.min + unboosted.max) / 200, {defenderBoosts: {}});
    expect(variantsConsistentWithDamageTaken([plain, vest], attacker, options, observed)).toEqual([plain]);
  });

  it('honours a boost the observation DOES carry', () => {
    const dropped = calcDamage(attacker, {...plain.mon, boosts: {spd: -1}}, 'Bug Buzz', options).percent;
    const observed = hit('Bug Buzz', (dropped.min + dropped.max) / 200, {defenderBoosts: {spd: -1}});
    expect(variantsConsistentWithDamageTaken([plain, vest], attacker, options, observed)).toEqual([plain]);
  });
});

describe('variantsConsistentWithDamageTaken (our hit bounds THEIR defensive item)', () => {
  // The direction nothing else can see: an Assault Vest changes no damage its holder deals,
  // fires no side effect and bends no move order, so only a hit INTO it ever shows.
  const attacker = mon({speciesForme: 'Volcarona'});
  const plain: SetVariant = {mon: mon({speciesForme: 'Tsareena'}), role: 'Fast Support'};
  const vest: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Assault Vest'}), role: 'Fast Support'};
  const variants = [plain, vest];
  const options = {gen: 9, field: noField, doubles: false};

  const plainRange = calcDamage(attacker, plain.mon, 'Bug Buzz', options).percent;
  const vestRange = calcDamage(attacker, vest.mon, 'Bug Buzz', options).percent;

  it('rules the vest out when our hit landed too hard for it', () => {
    // Confirm the vest really separates the ranges before trusting the assertion.
    expect(vestRange.max).toBeLessThan(plainRange.min);
    const observed = hit('Bug Buzz', (plainRange.min + plainRange.max) / 200);
    expect(variantsConsistentWithDamageTaken(variants, attacker, options, observed)).toEqual([plain]);
  });

  it('keeps only the vest when our hit landed as softly as one predicts', () => {
    const observed = hit('Bug Buzz', (vestRange.min + vestRange.max) / 200);
    expect(variantsConsistentWithDamageTaken(variants, attacker, options, observed)).toEqual([vest]);
  });

  it('never narrows to nothing in this direction either', () => {
    const observed = hit('Bug Buzz', 5);
    expect(variantsConsistentWithDamageTaken(variants, attacker, options, observed)).toEqual(variants);
  });
});
