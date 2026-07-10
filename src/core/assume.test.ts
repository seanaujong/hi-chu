import {describe, it, expect} from 'vitest';
import {assumedSpreads, assumeDefenderVariants} from './assume.js';
import type {LiveFacts} from './types.js';

/** A bare open-format foe: everything unrevealed unless a test says otherwise. */
function facts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {
    speciesForme: 'Dragonite',
    level: 100,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: [],
    landedDamagingHit: false,
    tookEntryHazardDamage: false,
    switchedIntoStealthRockUnharmed: false,
    ...over,
  };
}

describe('assumedSpreads — the two honest extremes', () => {
  it('a physical move brackets HP/Def: uninvested vs Bold 252/252', () => {
    const spreads = assumedSpreads('Physical');
    expect(spreads.map((s) => s.name)).toEqual(['uninvested', 'max HP/Def']);
    expect(spreads[0]!.role.nature).toBe('Serious');
    expect(spreads[0]!.role.evs).toEqual({hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0});
    expect(spreads[1]!.role.nature).toBe('Bold');
    expect(spreads[1]!.role.evs).toEqual({hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0});
  });

  it('a special move mirrors to HP/SpD: Calm 252/252', () => {
    const spreads = assumedSpreads('Special');
    expect(spreads.map((s) => s.name)).toEqual(['uninvested', 'max HP/SpD']);
    expect(spreads[1]!.role.nature).toBe('Calm');
    expect(spreads[1]!.role.evs).toEqual({hp: 252, atk: 0, def: 0, spa: 0, spd: 252, spe: 0});
  });
});

describe('assumeDefenderVariants — spreads × dex abilities, known facts winning', () => {
  it('crosses both spreads with every dex ability slot when nothing is revealed', () => {
    const dex = {baseStats: {hp: 91, atk: 134, def: 95, spa: 100, spd: 100, spe: 80}, types: ['Dragon', 'Flying'], abilities: ['Inner Focus', 'Multiscale']};
    const vs = assumeDefenderVariants(facts({speciesData: dex}), 'Physical');
    expect(vs).toHaveLength(4);
    expect(new Set(vs.map((v) => v.mon.ability))).toEqual(new Set(['Inner Focus', 'Multiscale']));
    expect(new Set(vs.map((v) => v.role))).toEqual(new Set(['uninvested', 'max HP/Def']));
  });

  it('a revealed ability pins the pool to one', () => {
    const dex = {baseStats: {hp: 91, atk: 134, def: 95, spa: 100, spd: 100, spe: 80}, types: ['Dragon', 'Flying'], abilities: ['Inner Focus', 'Multiscale']};
    const vs = assumeDefenderVariants(facts({speciesData: dex, ability: 'Multiscale'}), 'Physical');
    expect(vs).toHaveLength(2);
    expect(vs.every((v) => v.mon.ability === 'Multiscale')).toBe(true);
  });

  it('a revealed item rides on every variant; none is assumed otherwise', () => {
    expect(assumeDefenderVariants(facts({item: 'Assault Vest'}), 'Special').every((v) => v.mon.item === 'Assault Vest')).toBe(true);
    expect(assumeDefenderVariants(facts(), 'Special').every((v) => v.mon.item === undefined)).toBe(true);
  });

  it('carries the public live facts: level, and an ACTIVE Tera only', () => {
    const vs = assumeDefenderVariants(facts({level: 50, terastallized: true, teraType: 'Steel'}), 'Physical');
    expect(vs.every((v) => v.mon.level === 50)).toBe(true);
    expect(vs.every((v) => v.mon.teraType === 'Steel')).toBe(true);
    expect(assumeDefenderVariants(facts({teraType: 'Steel'}), 'Physical').every((v) => v.mon.teraType === undefined)).toBe(true);
  });

  it('a species without dex abilities still yields both spread variants (ability unset)', () => {
    const vs = assumeDefenderVariants(facts(), 'Physical');
    expect(vs).toHaveLength(2);
    expect(vs.every((v) => v.mon.ability === undefined)).toBe(true);
  });
});
