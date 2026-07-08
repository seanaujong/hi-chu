import {describe, it, expect} from 'vitest';
import {calcDamage, painSplit} from './damage.js';
import type {FieldFacts, ResolvedMon} from './types.js';

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
    ...over,
  };
}

describe('single-hit move', () => {
  const r = calcDamage(mon({speciesForme: 'Garchomp', ability: 'Rough Skin'}), mon({speciesForme: 'Skarmory'}), 'Earthquake');

  it('is reported as a non-multi-hit, exact calc', () => {
    expect(r.multiHit).toBe(false);
    expect(r.approximate).toBe(false);
    expect(r.perHit).toBeUndefined();
    expect(r.hits).toBeUndefined();
  });

  it('reports a coherent total, percent, and HP', () => {
    expect(r.total.min).toBeLessThanOrEqual(r.total.mean);
    expect(r.total.mean).toBeLessThanOrEqual(r.total.max);
    expect(r.percent.max).toBeCloseTo(Math.round((r.total.max / r.defenderMaxHP) * 1000) / 10, 6);
    expect(r.defenderRemainingHP).toBe(r.defenderMaxHP); // full HP
    expect(r.koChance).toBeGreaterThanOrEqual(0);
    expect(r.koChance).toBeLessThanOrEqual(1);
  });
});

describe('uniform-power multi-hit (Bullet Seed, 2-5)', () => {
  const r = calcDamage(
    mon({speciesForme: 'Breloom', nature: 'Adamant'}),
    mon({speciesForme: 'Tyranitar'}),
    'Bullet Seed',
  );

  it('exposes per-hit range and the real 35/35/15/15 hit-count distribution', () => {
    expect(r.multiHit).toBe(true);
    expect(r.approximate).toBe(false);
    expect(r.perHit!.min).toBeLessThan(r.perHit!.max);
    expect(r.hits!.distribution).toEqual([
      [2, 0.35],
      [3, 0.35],
      [4, 0.15],
      [5, 0.15],
    ]);
    expect(r.hits!.expected).toBeCloseTo(3.1, 10);
  });

  it('total spans 2×min-hit to 5×max-hit', () => {
    expect(r.total.min).toBe(r.perHit!.min * 2);
    expect(r.total.max).toBe(r.perHit!.max * 5);
  });
});

describe('hit-count modifiers', () => {
  it('Skill Link forces five hits', () => {
    const r = calcDamage(
      mon({speciesForme: 'Cloyster', nature: 'Adamant', ability: 'Skill Link'}),
      mon({speciesForme: 'Tyranitar'}),
      'Icicle Spear',
    );
    expect(r.hits!.distribution).toEqual([[5, 1]]);
    expect(r.total.min).toBe(r.perHit!.min * 5);
  });

  it('Loaded Dice forces a 50/50 split of four or five hits', () => {
    const r = calcDamage(
      mon({speciesForme: 'Breloom', nature: 'Adamant', item: 'Loaded Dice'}),
      mon({speciesForme: 'Tyranitar'}),
      'Bullet Seed',
    );
    expect(r.hits!.distribution).toEqual([
      [4, 0.5],
      [5, 0.5],
    ]);
    expect(r.total.min).toBe(r.perHit!.min * 4);
    expect(r.total.max).toBe(r.perHit!.max * 5);
  });
});

describe('variable-power multi-hit falls back to the calc total', () => {
  const r = calcDamage(
    mon({speciesForme: 'Cinderace', nature: 'Jolly'}),
    mon({speciesForme: 'Tyranitar'}),
    'Triple Axel',
  );

  it('is marked approximate with no per-hit roll', () => {
    expect(r.multiHit).toBe(true);
    expect(r.approximate).toBe(true);
    expect(r.perHit).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/per-hit base power varies/);
  });
});

describe('active Tera is folded into the calc', () => {
  it('a Tera-Normal Extreme Speed hits harder than the same move untera’d', () => {
    const base = mon({speciesForme: 'Dragonite', nature: 'Adamant'});
    const tera = mon({speciesForme: 'Dragonite', nature: 'Adamant', terastallized: true, teraType: 'Normal'});
    const target = mon({speciesForme: 'Garchomp'});
    const plain = calcDamage(base, target, 'Extreme Speed');
    const teraed = calcDamage(tera, target, 'Extreme Speed');
    expect(teraed.total.mean).toBeGreaterThan(plain.total.mean);
  });
});

describe('field effects', () => {
  const greninja = mon({speciesForme: 'Greninja', nature: 'Timid'});
  const garchomp = mon({speciesForme: 'Garchomp'});
  const base = calcDamage(greninja, garchomp, 'Surf', {field: noField});

  it('weather scales same-type damage (Rain up, Sun down)', () => {
    const rain = calcDamage(greninja, garchomp, 'Surf', {field: {...noField, weather: 'Rain'}});
    const sun = calcDamage(greninja, garchomp, 'Surf', {field: {...noField, weather: 'Sun'}});
    expect(rain.total.mean).toBeGreaterThan(base.total.mean);
    expect(sun.total.mean).toBeLessThan(base.total.mean);
    expect(rain.total.mean / base.total.mean).toBeCloseTo(1.5, 1);
  });

  it('Light Screen halves special damage', () => {
    const screened = calcDamage(greninja, garchomp, 'Surf', {
      field: {defenderScreens: {reflect: false, lightScreen: true, auroraVeil: false}},
    });
    expect(screened.total.mean / base.total.mean).toBeCloseTo(0.5, 1);
  });

  it('Reflect halves physical damage', () => {
    const cinder = mon({speciesForme: 'Garchomp', nature: 'Jolly'});
    const tt = mon({speciesForme: 'Tyranitar'});
    const open = calcDamage(cinder, tt, 'Earthquake', {field: noField});
    const reflected = calcDamage(cinder, tt, 'Earthquake', {
      field: {defenderScreens: {reflect: true, lightScreen: false, auroraVeil: false}},
    });
    expect(reflected.total.mean / open.total.mean).toBeCloseTo(0.5, 1);
  });
});

describe('Guts negates burn (the bug the baseline gets wrong)', () => {
  it('a burned Guts attacker is not damage-halved', () => {
    const target = mon({speciesForme: 'Blissey'});
    const guts = calcDamage(
      mon({speciesForme: 'Conkeldurr', nature: 'Adamant', ability: 'Guts', status: 'brn'}),
      target,
      'Drain Punch',
    );
    const ironFist = calcDamage(
      mon({speciesForme: 'Conkeldurr', nature: 'Adamant', ability: 'Iron Fist', status: 'brn'}),
      target,
      'Drain Punch',
    );
    // Guts both ignores the burn Attack drop AND adds 1.5×, so it should be far higher,
    // not the ~half a naive "burn always halves" model would produce.
    expect(guts.total.mean).toBeGreaterThan(ironFist.total.mean * 2);
  });
});

describe('painSplit (HP redistribution the calc does not model)', () => {
  it('averages both mons’ HP — the low one gains, the high one loses, equalized', () => {
    const user = mon({speciesForme: 'Blissey', hpPercent: 0.1});
    const foe = mon({speciesForme: 'Blissey', hpPercent: 0.9});
    const r = painSplit(user, foe);
    expect(r.user.after).toBeGreaterThan(r.user.before); // gained
    expect(r.foe.after).toBeLessThan(r.foe.before); // lost
    expect(r.user.after).toBe(r.foe.after); // same species → equal % after
    expect(r.user.after).toBeCloseTo(50, 0);
  });

  it('never overheals past the user’s own max (caps the split)', () => {
    // A frail user at half HP vs a full huge-HP foe: the average exceeds the user's max.
    const r = painSplit(mon({speciesForme: 'Flutter Mane', hpPercent: 0.5}), mon({speciesForme: 'Blissey', hpPercent: 1}));
    expect(r.user.after).toBe(100);
  });
});
