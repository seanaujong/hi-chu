import {describe, it, expect} from 'vitest';
import {calcDamage} from './damage.js';
import {hasObservation, narrowByLog, type RevealFrame} from './reveals.js';
import type {FieldFacts, ObservedHit, ResolvedMon, SetVariant} from './types.js';

const bare: FieldFacts = {defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false}};
const screened: FieldFacts = {defenderScreens: {reflect: false, lightScreen: true, auroraVeil: false}};

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

function hit(move: string, damageFraction: number): ObservedHit {
  return {move, damageFraction, attackerBoosts: {}, defenderBoosts: {}, attackerHpPercent: 1, defenderHpPercent: 1};
}

const ours = mon({speciesForme: 'Volcarona'});
const vest: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Assault Vest'}), role: 'Fast Support'};
const plain: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Leftovers'}), role: 'Fast Support'};
const pool = [vest, plain];

/** The midpoint of a range, as the [0,1] fraction an observation carries. */
const midpoint = (r: {min: number; max: number}): number => (r.min + r.max) / 200;

describe('the field is read from the end that is DEFENDING', () => {
  // The trap this module exists to make checkable. A Light Screen belongs to ONE side, so a
  // hit we DEALT and a hit we TOOK need opposite readings of the same battle — and a swap
  // produces a number that looks perfectly ordinary.
  const throughTheirScreen = calcDamage(ours, plain.mon, 'Bug Buzz', {gen: 9, field: screened, doubles: false}).percent;
  const unscreened = calcDamage(ours, plain.mon, 'Bug Buzz', {gen: 9, field: bare, doubles: false}).percent;

  const frame: RevealFrame = {
    gen: 9,
    doubles: false,
    ourselvesThen: ours,
    ourAttacker: ours,
    fieldDefendingUs: bare, // no screen on our side
    fieldDefendingThem: screened, // theirs is up
  };

  it('separates the two orientations, so the fixture means something', () => {
    expect(unscreened.min).toBeGreaterThan(throughTheirScreen.max);
  });

  it('judges a hit WE dealt against THEIR screen', () => {
    const observed = hit('Bug Buzz', midpoint(throughTheirScreen));
    expect(narrowByLog(pool, {ourHit: observed}, frame)).toEqual([plain]);
  });

  it('loses the rule-out entirely when the two orientations are swapped', () => {
    // Read from the wrong end, the same observation fits nothing — a screen applied to a hit
    // that never went through one — so the pool comes back whole and the reading is silently
    // worth nothing. Nothing about the number looks off, which is why these are named fields
    // rather than two `FieldFacts` in a row.
    const observed = hit('Bug Buzz', midpoint(throughTheirScreen));
    const swapped: RevealFrame = {...frame, fieldDefendingUs: screened, fieldDefendingThem: bare};
    expect(narrowByLog(pool, {ourHit: observed}, swapped)).toEqual(pool);
  });
});

describe('a hit THEY dealt is read against OUR screen', () => {
  // The mirror, and it needs its own pool: on this side the variants are the ATTACKER, so
  // they have to differ in what they DEAL — an Assault Vest never would.
  const specs: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Choice Specs'}), role: 'Fast Support'};
  const lefto: SetVariant = {mon: mon({speciesForme: 'Tsareena', item: 'Leftovers'}), role: 'Fast Support'};
  const theirPool = [specs, lefto];

  const throughOurScreen = calcDamage(lefto.mon, ours, 'Energy Ball', {gen: 9, field: screened, doubles: false}).percent;
  const unscreened = calcDamage(lefto.mon, ours, 'Energy Ball', {gen: 9, field: bare, doubles: false}).percent;

  const frame: RevealFrame = {
    gen: 9,
    doubles: false,
    ourselvesThen: ours,
    ourAttacker: ours,
    fieldDefendingUs: screened, // our screen is the one this hit went through
    fieldDefendingThem: bare,
  };

  it('separates the two orientations, so the fixture means something', () => {
    expect(unscreened.min).toBeGreaterThan(throughOurScreen.max);
  });

  it('keeps the set whose damage matches once our screen is accounted for', () => {
    const observed = hit('Energy Ball', midpoint(throughOurScreen));
    expect(narrowByLog(theirPool, {theirHit: observed}, frame)).toEqual([lefto]);
  });

  it('loses the rule-out when the orientations are swapped', () => {
    // Measured, not assumed: the swap costs the verdict here rather than inverting it. A
    // screen halves and Choice Specs multiplies by 1.5, so with our screen dropped the
    // observation sits below BOTH predictions and nothing fits — the never-narrow-to-nothing
    // rule then hands the pool back whole. Silent either way, which is the point.
    const observed = hit('Energy Ball', midpoint(throughOurScreen));
    const swapped: RevealFrame = {...frame, fieldDefendingUs: bare, fieldDefendingThem: screened};
    expect(narrowByLog(theirPool, {theirHit: observed}, swapped)).toEqual(theirPool);
  });
});

describe('a reading whose preconditions are unmet is skipped, not approximated', () => {
  const observed = hit('Bug Buzz', 0.9);

  it('drops the outgoing reading entirely when our own attacker cannot be pinned', () => {
    // No `ourAttacker`, so there is nothing exact to divide the observed number through.
    const frame: RevealFrame = {
      gen: 9,
      doubles: false,
      ourselvesThen: ours,
      fieldDefendingUs: bare,
      fieldDefendingThem: bare,
    };
    expect(narrowByLog(pool, {ourHit: observed}, frame)).toEqual(pool);
  });

  it('runs it once an attacker is supplied', () => {
    const frame: RevealFrame = {
      gen: 9,
      doubles: false,
      ourselvesThen: ours,
      ourAttacker: ours,
      fieldDefendingUs: bare,
      fieldDefendingThem: bare,
    };
    const landed = calcDamage(ours, vest.mon, 'Bug Buzz', {gen: 9, field: bare, doubles: false}).percent;
    expect(narrowByLog(pool, {ourHit: hit('Bug Buzz', midpoint(landed))}, frame)).toEqual([vest]);
  });
});

describe('hasObservation', () => {
  it('is false only when the log turned up nothing at all', () => {
    expect(hasObservation({})).toBe(false);
    expect(hasObservation({theirHit: hit('Bug Buzz', 0.3)})).toBe(true);
    expect(hasObservation({ourHit: hit('Bug Buzz', 0.3)})).toBe(true);
    const move = (name: string, category: string, type: string) => ({name, priority: 0, category, type, healing: false});
    expect(hasObservation({
      order: {ours: move('Bug Buzz', 'Special', 'Bug'), theirs: move('Power Whip', 'Physical', 'Grass'), theyMovedFirst: true},
    })).toBe(true);
  });
});

describe('every reading narrows the SAME pool', () => {
  it('composes two readings into one surviving set', () => {
    // The property the whole module exists for: one narrowing, so no surface can show a set
    // another surface has already ruled out.
    const frame: RevealFrame = {
      gen: 9,
      doubles: false,
      ourselvesThen: ours,
      ourAttacker: ours,
      fieldDefendingUs: bare,
      fieldDefendingThem: bare,
    };
    const vestRange = calcDamage(ours, vest.mon, 'Bug Buzz', {gen: 9, field: bare, doubles: false}).percent;
    const theirs = calcDamage(plain.mon, ours, 'Power Whip', {gen: 9, field: bare, doubles: false}).percent;
    const kept = narrowByLog(
      pool,
      {ourHit: hit('Bug Buzz', midpoint(vestRange)), theirHit: hit('Power Whip', midpoint(theirs))},
      frame,
    );
    // The outgoing reading picks the vest; the incoming one cannot tell the two apart (an
    // item that changes no damage its holder deals), so it leaves that verdict standing.
    expect(kept).toEqual([vest]);
  });
});
