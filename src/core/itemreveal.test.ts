import {describe, it, expect} from 'vitest';
import {calcDamage} from './damage.js';
import {variantsConsistentWithDamageDealt, variantsConsistentWithDamageTaken} from './itemreveal.js';
import {resolveMon, resolveVariants} from './resolve.js';
import {NOIVERN, noivernFacts, TENTACRUEL, tentacruelFacts} from './sets.testfixtures.js';
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

/** An observation with both sides unboosted and at full health — what every case below
 *  assumed implicitly. */
function hit(move: string, damageFraction: number, over: Partial<ObservedHit> = {}): ObservedHit {
  return {
    move,
    damageFraction,
    attackerBoosts: {},
    defenderBoosts: {},
    attackerHpPercent: 1,
    defenderHpPercent: 1,
    ...over,
  };
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

describe('the HP a reading is judged under is the OBSERVATION\u2019s too', () => {
  // The four pinch abilities switch on at a THRESHOLD rather than scaling, so a hover taken
  // a few turns after the hit can sit on the wrong side of it. Blaze is the worked example:
  // the same Flamethrower is x1.5 below a third and plain above it.
  const defender = mon({speciesForme: 'Skarmory'});
  const healthy: SetVariant = {mon: mon({speciesForme: 'Charizard', ability: 'Blaze'}), role: 'Attacker'};
  const options = {gen: 9, field: noField, doubles: false};

  const full = calcDamage(healthy.mon, defender, 'Flamethrower', options).percent;
  const pinched = calcDamage({...healthy.mon, hpPercent: 0.2}, defender, 'Flamethrower', options).percent;

  it('separates the two, so the fixture means something', () => {
    expect(pinched.min).toBeGreaterThan(full.max);
  });

  it('judges a hit landed at FULL health as full health, however chipped the attacker is now', () => {
    const observed = hit('Flamethrower', (full.min + full.max) / 200, {attackerHpPercent: 1});
    expect(variantsConsistentWithDamageDealt([healthy], defender, options, observed)).toEqual([healthy]);
  });

  it('does not mistake a pinched Blaze for a Choice Specs at full health', () => {
    // The sharpest case there is, because the two multipliers are the SAME number: Blaze is
    // x1.5 below a third and Choice Specs is x1.5 always. So a Leftovers Charizard swinging
    // from 20% hits exactly as hard as a Choice Specs one that is whole — and judged at the
    // health it has NOW, the observation convicts the item it does not hold.
    const specs: SetVariant = {mon: mon({speciesForme: 'Charizard', ability: 'Blaze', item: 'Choice Specs'}), role: 'Attacker'};
    const leftovers: SetVariant = {mon: mon({speciesForme: 'Charizard', ability: 'Blaze', item: 'Leftovers'}), role: 'Attacker'};
    const pool = [specs, leftovers];

    const landed = calcDamage({...leftovers.mon, hpPercent: 0.2}, defender, 'Flamethrower', options).percent;
    const observed = hit('Flamethrower', (landed.min + landed.max) / 200, {attackerHpPercent: 0.2});
    expect(variantsConsistentWithDamageDealt(pool, defender, options, observed)).toEqual([leftovers]);

    // The same number read at full health picks the other one out — the false rule-out this
    // snapshot exists to prevent, and it eliminates the item actually held.
    const naive = {...observed, attackerHpPercent: 1};
    expect(variantsConsistentWithDamageDealt(pool, defender, options, naive)).toEqual([specs]);
  });

  it('a Multiscale defender is read at the health the hit resolved against', () => {
    // The other end of the same idea, and the one that always applies: Multiscale halves only
    // at FULL HP, and a defender is never at full HP afterwards — the hit itself is what took
    // it off. So every reading of a hit into a Multiscale holder is a reading across that
    // threshold. Both variants below stand where the hit left them, at half.
    const attacker = mon({speciesForme: 'Weavile'});
    const dragonite = mon({speciesForme: 'Dragonite', ability: 'Multiscale', hpPercent: 0.5});
    const vest: SetVariant = {mon: {...dragonite, item: 'Assault Vest'}, role: 'Bulky Setup'};
    const bare: SetVariant = {mon: {...dragonite, item: 'Leftovers'}, role: 'Bulky Setup'};
    const pool = [vest, bare];

    // What the Leftovers set really took, from full health, with Multiscale up.
    const landed = calcDamage(attacker, {...bare.mon, hpPercent: 1}, 'Ice Beam', options).percent;
    const observed = hit('Ice Beam', (landed.min + landed.max) / 200, {defenderHpPercent: 1});
    expect(variantsConsistentWithDamageTaken(pool, attacker, options, observed)).toEqual([bare]);

    // Read at the health it is on NOW, Multiscale is gone, every prediction doubles, and
    // nothing fits — so the pool comes back whole and the rule-out is quietly lost.
    const naive = {...observed, defenderHpPercent: 0.5};
    expect(variantsConsistentWithDamageTaken(pool, attacker, options, naive)).toEqual(pool);
  });
});

describe('Noivern: Choice Specs vs Heavy-Duty Boots from damage MAGNITUDE alone, no hazard evidence', () => {
  // Fast Attacker (Choice Specs) and Fast Support (Heavy-Duty Boots) share Flamethrower, so
  // unlike Boomburst (Fast Attacker-only) the MOVE itself narrows nothing — only the ×1.5
  // Specs boost on the number it deals can tell the two roles apart here. Neither item
  // touches hazards at all, so this is deliberately a different reading than the
  // Heavy-Duty-Boots-survives-Stealth-Rock rule-out in deductions.test.ts/section.test.ts.
  const options = {gen: 9, field: {defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false}}, doubles: false};
  const defender = resolveMon(tentacruelFacts(), TENTACRUEL);
  const variants = resolveVariants(noivernFacts(), NOIVERN);
  const specs = variants.find((v) => v.role === 'Fast Attacker')!;
  const boots = variants.find((v) => v.role === 'Fast Support')!;

  const specsRange = calcDamage(specs.mon, defender, 'Flamethrower', options).percent;
  const bootsRange = calcDamage(boots.mon, defender, 'Flamethrower', options).percent;

  it('fixture sanity: Choice Specs really does hit harder than Heavy-Duty Boots with the SAME shared move', () => {
    expect(specsRange.min).toBeGreaterThan(bootsRange.max);
  });

  it('a hit too hard for a bare set convicts Heavy-Duty Boots, keeping only Choice Specs', () => {
    const observed = (specsRange.min + specsRange.max) / 200;
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Flamethrower', observed));
    // Fast Attacker's innate ability is fully known (Infiltrator alone), so this side never
    // fans out — one surviving variant, and it's the Specs one.
    expect(result).toEqual([specs]);
  });

  it('a hit too soft for the ×1.5 boost convicts Choice Specs, keeping only Heavy-Duty Boots', () => {
    const observed = (bootsRange.min + bootsRange.max) / 200;
    const result = variantsConsistentWithDamageDealt(variants, defender, options, hit('Flamethrower', observed));
    // Fast Support's innate ability is still unknown (Frisk or Infiltrator), so this rule-out
    // is judged on the ITEM alone, exactly like the invariant it guards — every surviving
    // variant must still be the Boots role's item, whichever ability it fanned out under.
    expect(result.every((v) => v.role === 'Fast Support' && v.mon.item === 'Heavy-Duty Boots')).toBe(true);
    expect(result.some((v) => v.role === 'Fast Attacker')).toBe(false);
  });
});
