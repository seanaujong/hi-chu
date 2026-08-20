import {describe, it, expect} from 'vitest';
import {calcDamage} from './damage.js';
import {candidateDamageByMove, incomingDamageBuckets, moveDamageBuckets, type DamageContext} from './variantdamage.js';
import type {FieldFacts, ResolvedMon, SetVariant} from './types.js';

const noField: FieldFacts = {defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false}};
const ctx: DamageContext = {gen: 9, field: noField, doubles: false};

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

const volcarona = mon({speciesForme: 'Volcarona'});
const vest: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Assault Vest'}), role: 'Fast Support'};
const plain: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Leftovers'}), role: 'Fast Support'};

describe('moveDamageBuckets — the DEFENDER is the uncertain side', () => {
  it('splits into one bucket per distinct outcome, labelled by what differs', () => {
    // An Assault Vest halves a special hit, so the two sets cannot share a line.
    const buckets = moveDamageBuckets(volcarona, [vest, plain], 'Bug Buzz', ctx);
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.label).sort()).toEqual(['Assault Vest', 'Leftovers']);
  });

  it('merges sets that land on the SAME number into one unlabelled bucket', () => {
    // Neither item touches a physical hit, so there is nothing for a player to choose
    // between — two variants, one line.
    const buckets = moveDamageBuckets(volcarona, [vest, plain], 'U-turn', ctx);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.label).toBe('');
  });

  it('drops a status move entirely rather than showing a zero', () => {
    expect(moveDamageBuckets(volcarona, [vest, plain], 'Toxic', ctx)).toEqual([]);
  });

  it('splits Torkoal’s Fire damage into two while Cetitan could still be Thick Fat or Slush Rush', () => {
    // Thick Fat halves the incoming Fire hit; Slush Rush is a Speed ability that touches
    // nothing here — so the two candidate sets cannot share a line until the ability is
    // actually revealed. Same species and item on both variants, so ability is the only
    // axis left to label the buckets by.
    const torkoal = mon({speciesForme: 'Torkoal', ability: 'Drought'});
    const thickFat: SetVariant = {mon: mon({speciesForme: 'Cetitan', ability: 'Thick Fat'}), role: 'Special Wall'};
    const slushRush: SetVariant = {mon: mon({speciesForme: 'Cetitan', ability: 'Slush Rush'}), role: 'Special Wall'};
    const buckets = moveDamageBuckets(torkoal, [thickFat, slushRush], 'Fire Blast', ctx);
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.label).sort()).toEqual(['Slush Rush', 'Thick Fat']);
    const [withThickFat, withSlushRush] = buckets[0]!.label === 'Thick Fat' ? buckets : [buckets[1]!, buckets[0]!];
    expect(withThickFat!.report.percent.max).toBeLessThan(withSlushRush!.report.percent.max);
  });

  it('survives a variant the calc cannot model, keeping the ones it can', () => {
    // A species outside the calc's dex throws; that must cost its own line, not the section.
    const unknown: SetVariant = {mon: mon({speciesForme: 'Missingno-Mega'}), role: 'Fast Support'};
    const buckets = moveDamageBuckets(volcarona, [unknown, plain], 'Bug Buzz', ctx);
    expect(buckets).toHaveLength(1);
  });
});

describe('incomingDamageBuckets — the ATTACKER is the uncertain side', () => {
  it('varies the attacker instead, over the same law', () => {
    const specs: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Choice Specs'}), role: 'Fast Support'};
    const buckets = incomingDamageBuckets(volcarona, [specs, plain], 'Energy Ball', ctx);
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.label).sort()).toEqual(['Choice Specs', 'Leftovers']);
  });

  it('is the mirror of the outgoing direction, not a second implementation', () => {
    // The same pair calculated both ways round must agree about the number, which is what
    // makes one shared `scoreVariants` the right shape rather than two similar loops.
    const direct = calcDamage(plain.mon, volcarona, 'Energy Ball', ctx).percent;
    const [bucket] = incomingDamageBuckets(volcarona, [plain], 'Energy Ball', ctx);
    expect(bucket!.report.percent).toEqual(direct);
  });
});

describe('candidateDamageByMove', () => {
  it('keys each move by id, and omits the ones with nothing to show', () => {
    const byMove = candidateDamageByMove([vest, plain], volcarona, ['Power Whip', 'Toxic'], ctx);
    expect([...byMove.keys()]).toEqual(['powerwhip']);
  });

  it('asks for the nHKO ladder, which the compact callers do not', () => {
    // `render.koTier` reads the turn-2 figure to colour a move '2hko'; without the ladder
    // there is no such figure and the colour silently stops happening.
    const [bucket] = candidateDamageByMove([plain], volcarona, ['Power Whip'], ctx).get('powerwhip')!;
    expect(bucket!.report.nhko).toBeDefined();
    const compact = incomingDamageBuckets(volcarona, [plain], 'Power Whip', ctx);
    expect(compact[0]!.report.nhko).toBeUndefined();
  });
});
