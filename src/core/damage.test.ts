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

  it('is reported as a non-multi-hit calc — no hit breakdown at all', () => {
    expect(r.multiHit).toBeUndefined();
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

describe('a species the calc dex does not know (a Champions-invented Mega)', () => {
  // Chandelure-Mega exists only in Champions — @smogon/calc has no record and throws
  // reading its base stats (replay gen9championsrandombattle-2646324776 broke every
  // hover). The client dex's data (verbatim from play.pokemonshowdown.com/data/pokedex.js)
  // rides in on speciesData, and the calc computes from it via `overrides`.
  const chandelureMegaDex = {
    baseStats: {hp: 60, atk: 75, def: 110, spa: 175, spd: 110, spe: 90},
    types: ['Ghost', 'Fire'],
    weightkg: 34.3,
  };
  const mega = mon({speciesForme: 'Chandelure-Mega', level: 48, speciesData: chandelureMegaDex});
  const arbok = mon({speciesForme: 'Arbok', level: 54});

  it('computes damage FROM the unknown species, STAB and stats included', () => {
    const r = calcDamage(mega, arbok, 'Shadow Ball', {gen: 9, field: noField});
    expect(r.total.min).toBeGreaterThan(0);
    expect(r.total.max).toBeGreaterThan(r.total.min);
  });

  it('computes damage INTO the unknown species with its type chart (Ghost is immune to Normal)', () => {
    const defended = calcDamage(arbok, mega, 'Body Slam', {gen: 9, field: noField});
    expect(defended.total.max).toBe(0); // the override's Ghost typing is really applied
    const hit = calcDamage(arbok, mega, 'Crunch', {gen: 9, field: noField});
    expect(hit.total.min).toBeGreaterThan(0); // super-effective Dark still lands
  });

  it('without dex data the unknown species still throws — we never guess its stats', () => {
    const noDex = mon({speciesForme: 'Chandelure-Mega', level: 48});
    expect(() => calcDamage(noDex, arbok, 'Shadow Ball', {gen: 9, field: noField})).toThrow();
  });

  it('an item the calc dex does not know resolves to NO item (an invented Mega stone)', () => {
    // Chandelurite is Champions-invented too: the calc's item dex lacks it, and gen-9
    // Knock Off mechanics crash reading `.megaEvolves` off the missing record — even
    // against a base-forme holder. A stone is damage-inert, so the itemless number is
    // the correct one.
    const holder = mon({speciesForme: 'Chandelure-Mega', level: 48, speciesData: chandelureMegaDex, item: 'Chandelurite'});
    const vsHolder = calcDamage(arbok, holder, 'Crunch', {gen: 9, field: noField});
    const vsItemless = calcDamage(arbok, mega, 'Crunch', {gen: 9, field: noField});
    expect(vsHolder.total).toEqual(vsItemless.total);
    // A KNOWN item still applies: Assault Vest visibly cuts the special hit.
    const vsVest = calcDamage(arbok, mon({...mega, item: 'Assault Vest'}), 'Dark Pulse', {gen: 9, field: noField});
    const vsPlain = calcDamage(arbok, mega, 'Dark Pulse', {gen: 9, field: noField});
    expect(vsVest.total.max).toBeLessThan(vsPlain.total.max);
  });

  it('a known item applies in id form too — normalized to the dex name for the calc', () => {
    // The calc's mechanics compare items by display name and silently IGNORE any other
    // form. battle.myPokemon carries "choicespecs" — without normalization the boost
    // would vanish and the number would silently read itemless.
    const specsId = calcDamage(mon({speciesForme: 'Noivern', item: 'choicespecs'}), arbok, 'Draco Meteor', {gen: 9, field: noField});
    const specsName = calcDamage(mon({speciesForme: 'Noivern', item: 'Choice Specs'}), arbok, 'Draco Meteor', {gen: 9, field: noField});
    const itemless = calcDamage(mon({speciesForme: 'Noivern'}), arbok, 'Draco Meteor', {gen: 9, field: noField});
    expect(specsId.total).toEqual(specsName.total);
    expect(specsId.total.max).toBeGreaterThan(itemless.total.max);
  });

  it('a species the calc DOES know keeps its canonical record — dex data changes nothing', () => {
    const bogus = {baseStats: {hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1}, types: ['Normal']};
    const withDex = calcDamage(mon({speciesForme: 'Arbok', level: 54, speciesData: bogus}), mega, 'Crunch', {gen: 9, field: noField});
    const without = calcDamage(arbok, mega, 'Crunch', {gen: 9, field: noField});
    expect(withDex.total).toEqual(without.total);
    expect(withDex.percent).toEqual(without.percent);
  });
});

describe('uniform-power multi-hit (Bullet Seed, 2-5)', () => {
  const r = calcDamage(
    mon({speciesForme: 'Breloom', nature: 'Adamant'}),
    mon({speciesForme: 'Tyranitar'}),
    'Bullet Seed',
  );

  it('exposes per-hit range and the real 35/35/15/15 hit-count distribution', () => {
    expect(r.multiHit!.perHit.min).toBeLessThan(r.multiHit!.perHit.max);
    expect(r.multiHit!.hits.distribution).toEqual([
      [2, 0.35],
      [3, 0.35],
      [4, 0.15],
      [5, 0.15],
    ]);
    expect(r.multiHit!.hits.expected).toBeCloseTo(3.1, 10);
  });

  it('total spans 2×min-hit to 5×max-hit', () => {
    expect(r.total.min).toBe(r.multiHit!.perHit.min * 2);
    expect(r.total.max).toBe(r.multiHit!.perHit.max * 5);
  });
});

describe('hit-count modifiers', () => {
  it('Skill Link forces five hits', () => {
    const r = calcDamage(
      mon({speciesForme: 'Cloyster', nature: 'Adamant', ability: 'Skill Link'}),
      mon({speciesForme: 'Tyranitar'}),
      'Icicle Spear',
    );
    expect(r.multiHit!.hits.distribution).toEqual([[5, 1]]);
    expect(r.total.min).toBe(r.multiHit!.perHit.min * 5);
  });

  it('Loaded Dice forces a 50/50 split of four or five hits', () => {
    const r = calcDamage(
      mon({speciesForme: 'Breloom', nature: 'Adamant', item: 'Loaded Dice'}),
      mon({speciesForme: 'Tyranitar'}),
      'Bullet Seed',
    );
    expect(r.multiHit!.hits.distribution).toEqual([
      [4, 0.5],
      [5, 0.5],
    ]);
    expect(r.total.min).toBe(r.multiHit!.perHit.min * 4);
    expect(r.total.max).toBe(r.multiHit!.perHit.max * 5);
  });
});

describe('variable-power multi-hit (Triple Axel 20/40/60) is computed per hit', () => {
  const weavile = mon({speciesForme: 'Weavile', nature: 'Jolly'});
  const tyranitar = mon({speciesForme: 'Tyranitar'});
  const r = calcDamage(weavile, tyranitar, 'Triple Axel');

  it('carries the stop-at-miss hit counts: 0.1 / 0.09 / 0.81, ≈2.71 expected', () => {
    const distribution = r.multiHit!.hits.distribution;
    expect(distribution.map(([k]) => k)).toEqual([1, 2, 3]);
    expect(distribution[0]![1]).toBeCloseTo(0.1, 10);
    expect(distribution[1]![1]).toBeCloseTo(0.09, 10);
    expect(distribution[2]![1]).toBeCloseTo(0.81, 10);
    expect(r.multiHit!.hits.expected).toBeCloseTo(2.71, 10);
  });

  it('total min is ONE min hit (the move can stop at hit 1); max is all three maxed', () => {
    // The 20 BP hit alone is the worst case, so the reported floor equals the
    // per-hit floor — the correlated-total model could never produce that.
    expect(r.total.min).toBe(r.multiHit!.perHit.min);
    expect(r.total.max).toBeGreaterThan(r.multiHit!.perHit.max * 2); // 20+40+60 ≫ 2×60-hit
  });

  it('each hit uses its own base power: the mean sits near the 90%-weighted hit sum', () => {
    // E[total] = E[hit1] + 0.9·E[hit2] + 0.81·E[hit3]; with BP 20/40/60 that is far
    // above 2.71 × E[hit1] — the check that hit 2 and 3 really got their higher BP.
    expect(r.total.mean).toBeGreaterThan(2.71 * r.multiHit!.perHit.min * 1.5);
  });

  it('Loaded Dice deletes the per-hit accuracy checks (Cinccino’s set): all 3 hits', () => {
    const dice = calcDamage(mon({...weavile, item: 'Loaded Dice'}), tyranitar, 'Triple Axel');
    expect(dice.multiHit!.hits.distribution).toEqual([[3, 1]]);
    expect(dice.total.min).toBeGreaterThan(r.total.min); // the 1-hit floor is gone
  });

  it('Technician boosts every hit — all three BPs are ≤60 (Ambipom’s set)', () => {
    // Pickup as the explicit no-op baseline: an unset ability would default to the
    // species' first slot, which for Ambipom is Technician itself.
    const plain = calcDamage(mon({speciesForme: 'Ambipom', nature: 'Jolly', ability: 'Pickup'}), tyranitar, 'Triple Axel');
    const tech = calcDamage(mon({speciesForme: 'Ambipom', nature: 'Jolly', ability: 'Technician'}), tyranitar, 'Triple Axel');
    expect(tech.total.mean / plain.total.mean).toBeCloseTo(1.5, 1);
  });

  it('Triple Kick shares the law at 10/20/30', () => {
    const tk = calcDamage(mon({speciesForme: 'Hitmontop', nature: 'Adamant'}), tyranitar, 'Triple Kick');
    expect(tk.multiHit!.hits.expected).toBeCloseTo(2.71, 10);
    expect(tk.total.min).toBe(tk.multiHit!.perHit.min);
  });
});

describe('Population Bomb checks 90% accuracy before every hit after the first', () => {
  const maushold = mon({speciesForme: 'Maushold', nature: 'Jolly', ability: 'Technician'});
  const tyranitar = mon({speciesForme: 'Tyranitar'});

  it('bare: ≈6.51 expected hits, all 10 only at 0.9⁹ — and no all-hits-land caveat', () => {
    const r = calcDamage(maushold, tyranitar, 'Population Bomb');
    expect(r.multiHit!.hits.expected).toBeCloseTo((1 - 0.9 ** 10) / 0.1, 10);
    expect(r.multiHit!.hits.distribution.find(([k]) => k === 10)![1]).toBeCloseTo(0.9 ** 9, 10);
    expect(r.notes).toEqual([]); // the old "assumes all 10 hits land" note is dead
  });

  it('Wide Lens (the real Maushold/Smeargle item) lifts each check to 99% — ≈9.56 hits', () => {
    const r = calcDamage(mon({...maushold, item: 'Wide Lens'}), tyranitar, 'Population Bomb');
    expect(r.multiHit!.hits.expected).toBeCloseTo((1 - 0.99 ** 10) / 0.01, 10);
  });

  it('Loaded Dice: uniform 4..10, no accuracy checks — 7 expected hits', () => {
    const r = calcDamage(mon({...maushold, item: 'Loaded Dice'}), tyranitar, 'Population Bomb');
    expect(r.multiHit!.hits.expected).toBeCloseTo(7, 10);
    expect(r.multiHit!.hits.distribution).toHaveLength(7);
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

describe('doubles game type (spread moves take their 0.75×)', () => {
  const atk = mon({speciesForme: 'Flutter Mane', nature: 'Timid'});
  const def = mon({speciesForme: 'Garchomp'});
  it('reduces a spread move in doubles but leaves a single-target move alone', () => {
    const spreadSingles = calcDamage(atk, def, 'Dazzling Gleam', {field: noField, doubles: false});
    const spreadDoubles = calcDamage(atk, def, 'Dazzling Gleam', {field: noField, doubles: true});
    expect(spreadDoubles.total.mean).toBeLessThan(spreadSingles.total.mean);
    expect(spreadDoubles.total.mean / spreadSingles.total.mean).toBeCloseTo(0.75, 1);

    const single = (doubles: boolean) => calcDamage(atk, def, 'Moonblast', {field: noField, doubles}).total.mean;
    expect(single(true)).toBe(single(false)); // single-target unaffected
  });
})
