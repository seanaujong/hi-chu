import {describe, it, expect} from 'vitest';
import {calcStat, Generations, type GenerationNum} from '@smogon/calc';
import {buildPokemon, calcDamage, moveCategory, painSplit, spreadForFinalStats} from './damage.js';
import type {FieldFacts, FullStats, ResolvedMon, StatID} from './types.js';

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
  // Chandelure-Mega was Champions-only when this guard was written — @smogon/calc had no
  // record and threw reading its base stats (replay gen9championsrandombattle-2646324776
  // broke every hover). @smogon/calc has since absorbed it into its own dex (0.11.0), so
  // it no longer exercises the "truly unknown" path below; it's kept here only for the
  // FROM/INTO tests, which don't care whether the numbers come from the calc's own record
  // or our override — they'd read the same either way. The client dex's data (verbatim
  // from play.pokemonshowdown.com/data/pokedex.js) rides in on speciesData, and the calc
  // computes from it via `overrides`.
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

  it('without dex data a truly unknown species still throws — we never guess its stats', () => {
    // "Missingno-Mega" is guaranteed fictional (unlike Chandelure-Mega above, a real
    // Champions forme the calc might one day absorb into its own dex too) — this pins
    // the fallback's behavior for whatever species the calc doesn't yet know, not for
    // this one species in particular.
    const noDex = mon({speciesForme: 'Missingno-Mega', level: 48});
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

  it('a known ability applies in id form too — normalized to the dex name for the calc', () => {
    // The calc's mechanics compare abilities by display name and silently IGNORE any
    // other form. battle.myPokemon carries "hugepower" — without normalization the
    // doubled Attack would vanish and the number would silently read ability-less.
    const powerId = calcDamage(mon({speciesForme: 'Azumarill', ability: 'hugepower'}), arbok, 'Play Rough', {gen: 9, field: noField});
    const powerName = calcDamage(mon({speciesForme: 'Azumarill', ability: 'Huge Power'}), arbok, 'Play Rough', {gen: 9, field: noField});
    const abilityless = calcDamage(mon({speciesForme: 'Azumarill'}), arbok, 'Play Rough', {gen: 9, field: noField});
    expect(powerId.total).toEqual(powerName.total);
    expect(powerId.total.max).toBeGreaterThan(abilityless.total.max);
  });

  it('a species the calc DOES know keeps its canonical record — dex data changes nothing', () => {
    const bogus = {baseStats: {hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1}, types: ['Normal']};
    const withDex = calcDamage(mon({speciesForme: 'Arbok', level: 54, speciesData: bogus}), mega, 'Crunch', {gen: 9, field: noField});
    const without = calcDamage(arbok, mega, 'Crunch', {gen: 9, field: noField});
    expect(withDex.total).toEqual(without.total);
    expect(withDex.percent).toEqual(without.percent);
  });
});

describe('knownStats — our own server-reported finals reach the calc exactly', () => {
  // The mechanism is a SOLVED equivalent spread, not a rawStats mutation: calculate()
  // clones both mons and the clone re-derives stats from nature/EVs/IVs, so only a
  // spread survives. These pins were probed against @smogon/calc directly.
  const gen9 = Generations.get(9 as GenerationNum);
  const STAT_IDS: readonly StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const dragoniteBase: FullStats = {hp: 91, atk: 134, def: 95, spa: 100, spd: 100, spe: 80};
  // Adamant, 252 HP / 252 Atk / 4 Spe, 31 IVs, L100 — as the server would report them.
  const adamantFinals: FullStats = {hp: 386, atk: 403, def: 226, spa: 212, spd: 236, spe: 197};

  const roundTrips = (base: FullStats, level: number, finals: FullStats) => {
    const spread = spreadForFinalStats(gen9, base, level, finals);
    expect(spread).toBeDefined();
    if (!spread) return;
    for (const stat of STAT_IDS) {
      expect(calcStat(gen9, stat, base[stat], spread.ivs[stat], spread.evs[stat], level, spread.nature)).toBe(finals[stat]);
    }
  };

  it('solves a spread the calc’s own formula maps back to the exact finals', () => {
    roundTrips(dragoniteBase, 100, adamantFinals);
  });

  it('solves a stat below the neutral floor (needs a minus nature)', () => {
    // Bold with 0 Atk IVs/EVs: Atk 245 < 273, the lowest any neutral nature can reach.
    roundTrips(dragoniteBase, 100, {hp: 386, atk: 245, def: 317, spa: 236, spd: 236, spe: 197});
  });

  it('solves at level 50 (VGC rounding)', () => {
    // Incineroar, Adamant 252 HP / 252 Atk / 4 SpD at L50.
    roundTrips({hp: 95, atk: 115, def: 90, spa: 80, spd: 90, spe: 60}, 50, {hp: 202, atk: 183, def: 110, spa: 90, spd: 111, spe: 80});
  });

  it('changes the damage to the real numbers (pinned) and the max HP to the real max', () => {
    const withKnown = calcDamage(mon({speciesForme: 'Dragonite', knownStats: adamantFinals}), mon({speciesForme: 'Tentacruel'}), 'Earthquake');
    const assumed = calcDamage(mon({speciesForme: 'Dragonite'}), mon({speciesForme: 'Tentacruel'}), 'Earthquake');
    expect({min: withKnown.total.min, max: withKnown.total.max}).toEqual({min: 310, max: 366});
    expect({min: assumed.total.min, max: assumed.total.max}).toEqual({min: 248, max: 294});
    expect(buildPokemon(gen9, mon({speciesForme: 'Dragonite', knownStats: adamantFinals})).maxHP()).toBe(386);
  });

  it('unsolvable finals fall back to the assumed spread without throwing (never crash a hover)', () => {
    const nonsense: FullStats = {hp: 1, atk: 9999, def: 1, spa: 1, spd: 1, spe: 1};
    const fallback = calcDamage(mon({speciesForme: 'Dragonite', knownStats: nonsense}), mon({speciesForme: 'Tentacruel'}), 'Earthquake');
    const assumed = calcDamage(mon({speciesForme: 'Dragonite'}), mon({speciesForme: 'Tentacruel'}), 'Earthquake');
    expect(fallback.total).toEqual(assumed.total);
  });
});

describe('moveCategory', () => {
  it('reads the dex category', () => {
    expect(moveCategory(9, 'Earthquake')).toBe('Physical');
    expect(moveCategory(9, 'Shadow Ball')).toBe('Special');
    expect(moveCategory(9, 'Protect')).toBe('Status');
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

describe('Tera never raises a multi-hit move to 60 BP', () => {
  // Gen 9 floors a sub-60 BP move at 60 when it matches the attacker's active Tera type, and
  // Showdown exempts multi-hit moves outright (`!dexMove.multihit`). @smogon/calc reads that
  // exemption off `move.hits === 1`, so asking it for a single hit of a multi-hit move claims
  // the exemption is unavailable and prices a 25 BP hit at 60 — see TERA_FLOOR_SAFE_HITS.
  const teraBulletSeed = (teraType?: string) =>
    calcDamage(
      mon({speciesForme: 'Breloom', nature: 'Adamant', ...(teraType ? {teraType, terastallized: true} : {})}),
      mon({speciesForme: 'Tyranitar'}),
      'Bullet Seed',
    );

  it('a 2-5 hit move gains only the STAB step, not a base-power floor', () => {
    const plain = teraBulletSeed().multiHit!.perHit;
    const tera = teraBulletSeed('Grass').multiHit!.perHit;
    // Breloom is already Grass, so Tera can only take STAB 1.5 -> 2.0: a flat 4/3 per hit.
    // The floor would take 25 BP to 60 as well, tripling it instead.
    expect(tera.min).toBe(92);
    expect(tera.max).toBe(112);
    expect(tera.max).toBeLessThan(plain.max * 1.5);
  });

  it('Tera into some OTHER type changes nothing at all', () => {
    // Fire Tera on a Grass move: the floor needs move.type === the active Tera type, so it
    // cannot fire — and Tera keeps STAB on the ORIGINAL types, so Breloom's Grass STAB is
    // still 1.5. Per-hit damage is therefore identical to not having Terastallized, which
    // also pins that reading hit one of a two-hit ask is a no-op wherever no floor applies.
    expect(teraBulletSeed('Fire').multiHit!.perHit).toEqual(teraBulletSeed().multiHit!.perHit);
  });

  it('a variable-power ladder survives Tera — the stand-in is multi-hit too', () => {
    // Triple Axel is 20/40/60. Tera Ice scales all three alike; the floor would instead drag
    // the 20 and 40 BP hits up to 60 and collapse the ladder into a single value.
    const r = calcDamage(
      mon({speciesForme: 'Weavile', nature: 'Jolly', teraType: 'Ice', terastallized: true}),
      mon({speciesForme: 'Tyranitar'}),
      'Triple Axel',
    );
    expect(r.multiHit!.perHit.min).toBe(34);
    expect(r.multiHit!.perHit.max).toBe(112);
    expect(r.multiHit!.perHit.min * 2).toBeLessThan(r.multiHit!.perHit.max);
  });

  it('the stand-in keeps the real move CONTACT — Tough Claws still reaches it', () => {
    // Triple Axel is a contact move, so its stand-in must be one too: pick a non-contact
    // stand-in and Tough Claws (and Rocky Helmet, Rough Skin, Iron Barbs) silently stop
    // applying. Nothing about the Tera fix would fail — the damage would just quietly drop.
    const perHit = (ability?: string) =>
      calcDamage(
        mon({speciesForme: 'Weavile', nature: 'Jolly', ...(ability ? {ability} : {})}),
        mon({speciesForme: 'Tyranitar'}),
        'Triple Axel',
      ).multiHit!.perHit;
    expect(perHit()).toEqual({min: 25, max: 84});
    expect(perHit('Tough Claws')).toEqual({min: 31, max: 108}); // the ×1.3, on every hit
  });

  it('the stand-in carries the real move’s TYPE and CATEGORY, not its own', () => {
    // Double Hit is Normal and physical; Triple Kick is Fighting. Tyranitar is Rock/Dark, so
    // a leaked Normal type would read 1× where Fighting reads 4× — and a leaked physical
    // stat line would survive a special override. Both are pinned by the numbers below.
    const fighting = calcDamage(
      mon({speciesForme: 'Hitmontop', nature: 'Adamant'}),
      mon({speciesForme: 'Tyranitar'}),
      'Triple Kick',
    ).multiHit!.perHit;
    expect(fighting).toEqual({min: 48, max: 156}); // 4× effective, 10/20/30 BP ladder intact
  });

  it('a fixed-count multi-hit move is untouched as well', () => {
    const plain = calcDamage(
      mon({speciesForme: 'Hitmonlee', nature: 'Adamant'}),
      mon({speciesForme: 'Tyranitar'}),
      'Double Kick',
    ).multiHit!.perHit;
    const tera = calcDamage(
      mon({speciesForme: 'Hitmonlee', nature: 'Adamant', teraType: 'Fighting', terastallized: true}),
      mon({speciesForme: 'Tyranitar'}),
      'Double Kick',
    ).multiHit!.perHit;
    expect(tera.max).toBeLessThan(plain.max * 1.5);
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

  it('Skill Link/Loaded Dice still apply in id form — compared against the dex-resolved atk, not the raw field', () => {
    // An own-side read (readOwnAbility/readOwnItem) can hand these in id form
    // ("skilllink", "loadeddice"). A bare `attacker.ability === 'Skill Link'` on the
    // ResolvedMon would silently miss it; buildPokemon's `atk` is already resolved.
    const skillLinkId = calcDamage(
      mon({speciesForme: 'Cloyster', nature: 'Adamant', ability: 'skilllink'}),
      mon({speciesForme: 'Tyranitar'}),
      'Icicle Spear',
    );
    expect(skillLinkId.multiHit!.hits.distribution).toEqual([[5, 1]]);

    const loadedDiceId = calcDamage(
      mon({speciesForme: 'Breloom', nature: 'Adamant', item: 'loadeddice'}),
      mon({speciesForme: 'Tyranitar'}),
      'Bullet Seed',
    );
    expect(loadedDiceId.multiHit!.hits.distribution).toEqual([
      [4, 0.5],
      [5, 0.5],
    ]);
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

// No randbats set pairs any of these with a multiaccuracy move — they only ever fire in a
// Custom Game/Free-For-All battle. Each expected-hits figure is the geometric sum Σ p^k
// (k=0..n-1) at the per-hit chance `multihit.test.ts` pins directly.
describe('Compound Eyes / Hustle / No Guard / accuracy boosts reach the multiaccuracy trio', () => {
  const tyranitar = mon({speciesForme: 'Tyranitar'});

  it('Hustle: Triple Kick’s per-hit chance drops to 72% — ≈2.24 expected hits', () => {
    const r = calcDamage(mon({speciesForme: 'Hitmontop', nature: 'Adamant', ability: 'Hustle'}), tyranitar, 'Triple Kick');
    expect(r.multiHit!.hits.expected).toBeCloseTo(1 + 0.72 + 0.72 ** 2, 10);
  });

  it('No Guard on the ATTACKER guarantees all three Triple Axel hits', () => {
    const r = calcDamage(mon({speciesForme: 'Weavile', nature: 'Jolly', ability: 'No Guard'}), tyranitar, 'Triple Axel');
    expect(r.multiHit!.hits.distribution).toEqual([[3, 1]]);
  });

  it('No Guard on the DEFENDER also guarantees every Population Bomb hit', () => {
    const maushold = mon({speciesForme: 'Maushold', nature: 'Jolly', ability: 'Technician'});
    const r = calcDamage(maushold, mon({...tyranitar, ability: 'No Guard'}), 'Population Bomb');
    expect(r.multiHit!.hits.distribution).toEqual([[10, 1]]);
  });

  it('a -1 accuracy stage alone drops Triple Kick’s per-hit chance to 67.5%', () => {
    const r = calcDamage(mon({speciesForme: 'Hitmontop', nature: 'Adamant', accuracyBoost: -1}), tyranitar, 'Triple Kick');
    expect(r.multiHit!.hits.expected).toBeCloseTo(1 + 0.675 + 0.675 ** 2, 10);
  });

  it('that same -1 stage silently drops a Compound Eyes bonus — same hit count as boost alone', () => {
    const boostedAlone = calcDamage(
      mon({speciesForme: 'Hitmontop', nature: 'Adamant', accuracyBoost: -1}),
      tyranitar,
      'Triple Kick',
    );
    const withCompoundEyes = calcDamage(
      mon({speciesForme: 'Hitmontop', nature: 'Adamant', ability: 'Compound Eyes', accuracyBoost: -1}),
      tyranitar,
      'Triple Kick',
    );
    expect(withCompoundEyes.multiHit!.hits.expected).toBeCloseTo(boostedAlone.multiHit!.hits.expected, 10);
  });

  it('the DEFENDER’s evasion stage — not the attacker’s — feeds the per-hit check', () => {
    const r = calcDamage(
      mon({speciesForme: 'Weavile', nature: 'Jolly'}),
      mon({...tyranitar, evasionBoost: 1}),
      'Triple Axel',
    );
    expect(r.multiHit!.hits.expected).toBeCloseTo(1 + 0.675 + 0.675 ** 2, 10); // mirrors acc -1
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

describe('a live retype (Protean, Soak, Reflect Type) — the types on the field, not the record', () => {
  const blissey = mon({speciesForme: 'Blissey'});
  // Greninja is Water/Dark. Protean converts it to whatever it throws; after Ice Beam it is
  // pure Ice, and gen 9 does not let the ability fire again that stint.
  const unspent = mon({speciesForme: 'Greninja', ability: 'Protean'});
  const iced = mon({speciesForme: 'Greninja', ability: 'Protean', types: ['Ice'], proteanSpent: true});

  it('while UNSPENT, every move gets STAB — the one about to fire is what converts the user', () => {
    // The calc's own gen-6-8 model, which is also gen 9's correct answer for the first move
    // of a stint. Nothing here should change: the fix must not cost the case already right.
    expect(calcDamage(unspent, blissey, 'Surf').total.max).toBe(93);
    expect(calcDamage(unspent, blissey, 'Freeze-Dry').total.max).toBe(73); // off-type, still boosted
  });

  it('once SPENT, only a move matching the ACQUIRED type keeps STAB', () => {
    expect(calcDamage(iced, blissey, 'Freeze-Dry').total.max).toBe(73); // Ice matches — unchanged
    expect(calcDamage(iced, blissey, 'Surf').total.max).toBe(62); // Water is gone
    expect(calcDamage(iced, blissey, 'Dark Pulse').total.max).toBe(56); // so is Dark
  });

  it('replaces the type chart coming IN too, not only the STAB going out', () => {
    // Dark walls Psychic outright and pure Ice does not, so this one reads 0 vs a real number
    // rather than a ratio — the clearest possible statement that the defensive half applies.
    const alakazam = mon({speciesForme: 'Alakazam'});
    expect(calcDamage(alakazam, unspent, 'Psychic').total.max).toBe(0);
    expect(calcDamage(alakazam, iced, 'Psychic').total.max).toBe(189);
  });

  it('leaves exactly ONE type doing the work — `overrides` merges element-wise', () => {
    // The trap `NEUTRAL_TYPE` exists for: a bare ['Ice'] merged onto Greninja's own
    // ['Water', 'Dark'] is ['Ice', 'Dark'], which is not a Pokémon that has ever existed.
    // Close Combat separates them — 2x into pure Ice, 4x into Ice/Dark — so this fails
    // loudly if the padding is ever dropped, where a same-effectiveness pair would not.
    const machamp = mon({speciesForme: 'Machamp'});
    expect(calcDamage(machamp, iced, 'Close Combat').total.max).toBe(506);
    const bothTypes = mon({...iced, types: ['Ice', 'Dark']});
    expect(calcDamage(machamp, bothTypes, 'Close Combat').total.max).toBe(1012);
  });
});

describe('Roost suspends the user’s Flying type for the turn', () => {
  // The same law as a retype one block up, subtracting instead of replacing — and the case
  // where it matters most is an IMMUNITY, which is the difference between a move doing
  // nothing and a move doing half your health.
  const zam = mon({speciesForme: 'Alakazam'});
  const machamp = mon({speciesForme: 'Machamp'});
  const garchomp = mon({speciesForme: 'Garchomp'});
  const roosting = (speciesForme: string, on: boolean): ResolvedMon =>
    mon({speciesForme, ...(on ? {roosting: true} : {})});

  it('grounds a Ground/Flying Pokémon — Earthquake stops doing nothing at all', () => {
    expect(calcDamage(garchomp, roosting('Gliscor', false), 'Earthquake').total.max).toBe(0);
    expect(calcDamage(garchomp, roosting('Gliscor', true), 'Earthquake').total.max).toBe(132);
    // …and the Flying weakness goes with it: Ice Beam drops from 4x to 2x.
    expect(calcDamage(zam, roosting('Gliscor', false), 'Ice Beam').total.max).toBe(484);
    expect(calcDamage(zam, roosting('Gliscor', true), 'Ice Beam').total.max).toBe(242);
  });

  it('cuts both ways on a Flying/Steel Pokémon', () => {
    // Corviknight becomes pure Steel: it stops taking 2x from Electric, and starts taking
    // 2x from Fighting instead of the 1x its Flying half was cancelling out.
    expect(calcDamage(zam, roosting('Corviknight', false), 'Thunderbolt').total.max).toBe(220);
    expect(calcDamage(zam, roosting('Corviknight', true), 'Thunderbolt').total.max).toBe(110);
    expect(calcDamage(machamp, roosting('Corviknight', false), 'Close Combat').total.max).toBe(181);
    expect(calcDamage(machamp, roosting('Corviknight', true), 'Close Combat').total.max).toBe(362);
  });

  it('falls back to Normal for a PURE Flying Pokémon, as the sim does', () => {
    // Tornadus has nothing left once Flying goes, and a Pokémon with no type at all is not a
    // thing the type chart can answer for.
    expect(calcDamage(garchomp, roosting('Tornadus', false), 'Earthquake').total.max).toBe(0);
    expect(calcDamage(garchomp, roosting('Tornadus', true), 'Earthquake').total.max).toBe(205);
    expect(calcDamage(machamp, roosting('Tornadus', true), 'Close Combat').total.max).toBe(492);
  });

  it('leaves a Pokémon with no Flying to lose exactly alone', () => {
    expect(calcDamage(machamp, roosting('Blissey', true), 'Close Combat').total.max)
      .toBe(calcDamage(machamp, roosting('Blissey', false), 'Close Combat').total.max);
  });
});

describe('the pinch abilities read the ATTACKER’s own current HP', () => {
  // Overgrow/Blaze/Torrent/Swarm (×1.5 on their own type at ≤ 1/3 HP) and Defeatist
  // (×0.5 at ≤ 1/2) are the only abilities gated on the ATTACKER's remaining HP, and the
  // calc implements every one of them — but reads `attacker.curHP()`, which defaults to
  // full. So the failure they guard against is not an approximation: an unset curHP pins
  // the attacker at full health and none of the five can ever fire.
  const target = mon({speciesForme: 'Skarmory'});
  // Greninja's max HP on this spread is exactly 306, so the threshold falls on a whole
  // HP point (102) and the boundary can be asserted without rounding ambiguity.
  const ninja = (hpPercent: number) => mon({speciesForme: 'Greninja', ability: 'Torrent', hpPercent});

  it('is dormant above a third of max HP and armed at exactly a third', () => {
    expect(calcDamage(ninja(0.4), target, 'Surf').total.max).toBe(153);
    expect(calcDamage(ninja(1 / 3), target, 'Surf').total.max).toBe(229);
  });

  it('boosts only the ability’s own type — a Torrent Greninja’s Dark Pulse is untouched', () => {
    const pinched = calcDamage(ninja(0.3), target, 'Dark Pulse').total.max;
    expect(pinched).toBe(calcDamage(ninja(1), target, 'Dark Pulse').total.max);
  });

  it('cuts as well as boosts — Defeatist halves at half HP (Archeops’ max is 312)', () => {
    const archeops = (hpPercent: number) => mon({speciesForme: 'Archeops', ability: 'Defeatist', hpPercent});
    expect(calcDamage(archeops(0.6), target, 'Rock Slide').total.max).toBe(97);
    expect(calcDamage(archeops(0.5), target, 'Rock Slide').total.max).toBe(49);
  });
});

describe('Rage Fist scales its power with the ATTACKER’s own hits taken (a calc gap, like multi-hit)', () => {
  // @smogon/calc's own move data lists Rage Fist as a flat bp: 50 — it has no notion of
  // `timesAttacked` at all. Pinned against a direct @smogon/calc run with the same
  // spread and `overrides.basePower` set to the sim's own formula's output by hand, so
  // this also proves `overrides.basePower` reaches the calc for a move it never special-
  // cases by name (unlike Triple Axel/Kick, which the calc recomputes over regardless).
  const defender = mon({speciesForme: 'Skarmory'});
  const attacker = (n: number) => mon({speciesForme: 'Runerigus', timesAttacked: n});

  it('50 power when the user has never been hit', () => {
    const r = calcDamage(attacker(0), defender, 'Rage Fist');
    expect([r.total.min, r.total.max]).toEqual([40, 48]);
  });

  it('100 power after one hit — min(350, 50 + 50×1)', () => {
    const r = calcDamage(attacker(1), defender, 'Rage Fist');
    expect([r.total.min, r.total.max]).toEqual([79, 94]);
  });

  it('200 power after three hits', () => {
    const r = calcDamage(attacker(3), defender, 'Rage Fist');
    expect([r.total.min, r.total.max]).toEqual([159, 187]);
  });

  it('caps at 350 power from 6 hits on — a 7th+ hit no longer raises the damage', () => {
    const six = calcDamage(attacker(6), defender, 'Rage Fist');
    const ten = calcDamage(attacker(10), defender, 'Rage Fist');
    expect([six.total.min, six.total.max]).toEqual([276, 325]);
    expect([ten.total.min, ten.total.max]).toEqual([276, 325]);
  });

  it('is unaffected by the DEFENDER having been hit — only the attacker’s own count matters', () => {
    const untouchedDefender = calcDamage(attacker(0), defender, 'Rage Fist');
    const hitDefender = calcDamage(attacker(0), mon({speciesForme: 'Skarmory', timesAttacked: 5}), 'Rage Fist');
    expect(hitDefender.total).toEqual(untouchedDefender.total);
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

describe("the attacker's own HP swing (drain, recoil, Liquid Ooze)", () => {
  const swing = (
    attacker: Partial<ResolvedMon> & {speciesForme: string},
    defender: Partial<ResolvedMon> & {speciesForme: string},
    move: string,
  ) => calcDamage(mon(attacker), mon(defender), move, {selfHp: true}).selfHp ?? [];
  const find = (effects: ReturnType<typeof swing>, label: string) => effects.find((e) => e.label === label);

  it('is opt-in — a caller that does not ask gets nothing, so other surfaces bucket as before', () => {
    expect(calcDamage(mon({speciesForme: 'Dragonite'}), mon({speciesForme: 'Skarmory'}), 'Double-Edge').selfHp)
      .toBeUndefined();
  });

  it('reports a drain move as HP GAINED, as a percent of the attacker s own max HP', () => {
    const drain = find(swing({speciesForme: 'Rillaboom'}, {speciesForme: 'Skarmory'}, 'Drain Punch'), 'Drains');
    expect(drain?.direction).toBe('gain');
    expect(drain!.min).toBeGreaterThan(0);
    expect(drain!.min).toBeLessThanOrEqual(drain!.max);
  });

  it('reports a recoil move as HP LOST, and Rock Head cancels it (the calc s own guard)', () => {
    const plain = find(swing({speciesForme: 'Dragonite'}, {speciesForme: 'Skarmory'}, 'Double-Edge'), 'Recoil');
    expect(plain?.direction).toBe('loss');
    expect(plain!.max).toBeGreaterThan(0);
    const rockHead = swing({speciesForme: 'Dragonite', ability: 'Rock Head'}, {speciesForme: 'Skarmory'}, 'Double-Edge');
    expect(find(rockHead, 'Recoil')).toBeUndefined();
  });

  it('is a LIST because the causes stack — a Shell Bell recoil move both heals and hurts', () => {
    // The shape `SelfHpEffect` exists for: one move, two opposite swings, reported as two
    // facts rather than netted. Every other case here has a single cause, so nothing else
    // pins the list. ("Drains" is the calc's own bucket for any damage-proportional
    // recovery, Shell Bell's included — imprecise as a label, but the right figure.)
    const both = swing({speciesForme: 'Dragonite', item: 'Shell Bell'}, {speciesForme: 'Skarmory'}, 'Double-Edge');
    expect(both.map((e) => `${e.label}/${e.direction}`)).toEqual(['Drains/gain', 'Recoil/loss']);
  });

  // The two corrections below are ours: @smogon/calc models neither, verified by probing it
  // directly. Each would otherwise report a confidently wrong number.
  it('CORRECTION: Magic Guard cancels recoil, which the calc only ever checks Rock Head for', () => {
    const guarded = swing({speciesForme: 'Clefable', ability: 'Magic Guard'}, {speciesForme: 'Skarmory'}, 'Double-Edge');
    expect(find(guarded, 'Recoil')).toBeUndefined();
  });

  it("says nothing about a Life Orb — an invariant cost is noise, not a move's own price", () => {
    // The calc omits Life Orb's cut and we could supply it, but it is the same ~10% on every
    // damaging move for as long as the item is held, so it says nothing about the move being
    // hovered — and in the KO colour it read as a threat to the FOE. Deliberately absent.
    const orb = swing({speciesForme: 'Dragonite', item: 'Life Orb'}, {speciesForme: 'Skarmory'}, 'Outrage');
    expect(orb.find((e) => /life orb/i.test(e.label))).toBeUndefined();
    // A move whose OWN cost varies is still reported, Life Orb or not.
    const both = swing({speciesForme: 'Dragonite', item: 'Life Orb'}, {speciesForme: 'Skarmory'}, 'Double-Edge');
    expect(find(both, 'Recoil')?.direction).toBe('loss');
  });

  it('CORRECTION: Liquid Ooze inverts a drain into a LOSS — the calc reports the heal regardless', () => {
    const attacker = {speciesForme: 'Rillaboom'};
    const healed = find(swing(attacker, {speciesForme: 'Tentacruel', ability: 'Clear Body'}, 'Giga Drain'), 'Drains');
    const oozed = find(swing(attacker, {speciesForme: 'Tentacruel', ability: 'Liquid Ooze'}, 'Giga Drain'), 'Liquid Ooze');
    expect(healed?.direction).toBe('gain');
    expect(oozed?.direction).toBe('loss');
    // Same magnitude, opposite sign — Liquid Ooze redirects the siphon, it doesn't resize it.
    expect(oozed!.max).toBeCloseTo(healed!.max, 6);
    // ...and the heal must not ALSO be reported, or the tooltip would claim both.
    expect(find(swing(attacker, {speciesForme: 'Tentacruel', ability: 'Liquid Ooze'}, 'Giga Drain'), 'Drains'))
      .toBeUndefined();
  });

  it('says nothing for an ordinary move, and nothing for a multi-hit one (an explicit cut)', () => {
    expect(swing({speciesForme: 'Garchomp'}, {speciesForme: 'Skarmory'}, 'Earthquake')).toEqual([]);
    // Our convolved PMF replaces the calc's own damage array there, so recovery()/recoil()
    // would describe a single hit of a several-hit sequence. No gen-9 multi-hit move drains.
    expect(swing({speciesForme: 'Cloyster'}, {speciesForme: 'Skarmory'}, 'Icicle Spear')).toEqual([]);
  });
});

describe('a damage-callback move — no base power, so no damage formula (a calc gap)', () => {
  // Showdown gives these moves a `damageCallback(pokemon, target)` instead of a base power.
  // @smogon/calc implements some of the family (Seismic Toss, Night Shade — pinned at the
  // bottom of this block) and simply lacks these, running the ordinary formula over a zero
  // and returning nothing. The tooltip printed that as "0% - 0%": a move that takes half
  // your HP, reported as doing nothing at all. Values pinned against the sim's own formula
  // in `data/moves.ts`, whose `clampIntRange` floors before it clamps.
  const chansey = mon({speciesForme: 'Chansey'});

  it('Super Fang takes half the target’s current HP — 336 of a full 672', () => {
    const r = calcDamage(chansey, mon({speciesForme: 'Blissey'}), 'Super Fang');
    expect(r.defenderMaxHP).toBe(672);
    expect([r.total.min, r.total.max]).toEqual([336, 336]);
    expect(r.percent.min).toBe(50);
  });

  it('...half of CURRENT HP, not of max — and it floors', () => {
    // 40% of 672 is 269 remaining; half of that floors to 134, which is 19.9% of max —
    // not the 20% a reader assuming "half of max, scaled" would predict.
    const r = calcDamage(chansey, mon({speciesForme: 'Blissey', hpPercent: 0.4}), 'Super Fang');
    expect(r.defenderRemainingHP).toBe(269);
    expect([r.total.min, r.total.max]).toEqual([134, 134]);
    expect(r.percent.min).toBe(19.9);
  });

  it('...and never less than 1, so it KOes a target down to its last HP', () => {
    // Half of 1 floors to 0; the sim clamps that to 1, which is exactly lethal.
    const r = calcDamage(chansey, mon({speciesForme: 'Blissey', hpPercent: 0.001}), 'Super Fang');
    expect(r.defenderRemainingHP).toBe(1);
    expect([r.total.min, r.total.max]).toEqual([1, 1]);
    expect(r.koChance).toBe(1);
  });

  it('deals one exact amount, never a roll — nothing for a range to come from', () => {
    const r = calcDamage(chansey, mon({speciesForme: 'Blissey'}), 'Super Fang');
    expect(r.total.min).toBe(r.total.max);
    expect(r.total.mean).toBe(r.total.min);
    expect(r.multiHit).toBeUndefined();
  });

  it('ignores everything the damage formula reads — +6 Defense and Reflect change nothing', () => {
    const skarmory = (over: Partial<ResolvedMon> = {}) => mon({speciesForme: 'Skarmory', ...over});
    const plain = calcDamage(chansey, skarmory(), 'Super Fang');
    const boosted = calcDamage(chansey, skarmory({boosts: {def: 6}}), 'Super Fang');
    const screened = calcDamage(chansey, skarmory(), 'Super Fang', {
      field: {defenderScreens: {reflect: true, lightScreen: false, auroraVeil: false}},
    });
    expect([plain.total.min, plain.total.max]).toEqual([146, 146]);
    expect(boosted.total).toEqual(plain.total);
    expect(screened.total).toEqual(plain.total);
  });

  it('Ruination follows the same law from the special side', () => {
    const r = calcDamage(mon({speciesForme: 'Ting-Lu'}), mon({speciesForme: 'Corviknight'}), 'Ruination');
    expect(r.category).toBe('Special');
    expect([r.total.min, r.total.max]).toEqual([179, 179]);
    expect(r.percent.min).toBe(50);
  });

  it('a RESISTANCE does not scale it — Fairy resists Dark and still loses exactly half', () => {
    const r = calcDamage(mon({speciesForme: 'Ting-Lu'}), mon({speciesForme: 'Flutter Mane'}), 'Ruination');
    expect([r.total.min, r.total.max]).toEqual([136, 136]);
    expect(r.percent.min).toBe(50);
  });

  // ...but an IMMUNITY does stop it dead, which is the half of the mechanic that a table of
  // formulas alone would get wrong. `connects` puts that one question back to the calc.
  it('an IMMUNITY stops it dead — Super Fang is Normal, so a Ghost takes nothing', () => {
    const r = calcDamage(chansey, mon({speciesForme: 'Gengar'}), 'Super Fang');
    expect([r.total.min, r.total.max]).toEqual([0, 0]);
    expect(r.koChance).toBe(0);
  });

  it('...including an immunity the defender only just acquired by terastallizing', () => {
    // The type chart alone would say Blissey is Normal and takes half. The live Tera is what
    // makes it a Ghost, and asking the calc is what sees it.
    const teraGhost = mon({speciesForme: 'Blissey', teraType: 'Ghost', terastallized: true});
    expect(calcDamage(chansey, teraGhost, 'Super Fang').total.max).toBe(0);
    expect(calcDamage(chansey, mon({speciesForme: 'Blissey'}), 'Super Fang').total.max).toBe(336);
  });

  it('Endeavor drags the target down to the ATTACKER’s own HP', () => {
    // Luvdisc at 20% of its 248 max is on 50 HP; a full Blissey on 672 loses the 622 between.
    const r = calcDamage(mon({speciesForme: 'Luvdisc', hpPercent: 0.2}), mon({speciesForme: 'Blissey'}), 'Endeavor');
    expect([r.total.min, r.total.max]).toEqual([622, 622]);
    expect(r.percent.min).toBe(92.6);
  });

  it('...and fails outright when the attacker is not the lower of the two', () => {
    // Showdown guards it with `onTryImmunity: pokemon.hp < target.hp`; a non-positive
    // difference says the same thing without a second rule.
    const r = calcDamage(mon({speciesForme: 'Blissey'}), mon({speciesForme: 'Luvdisc'}), 'Endeavor');
    expect([r.total.min, r.total.max]).toEqual([0, 0]);
  });

  it('carries NO nHKO ladder, even when one is asked for', () => {
    // `koLadder` re-applies the same damage every turn, which is the one thing these moves
    // never do. Super Fang halves what is LEFT: from full HP a constant 50% would ladder to
    // "2HKO 100%", but it only ever approaches 1 HP. The single-use KO chance stays exact.
    const r = calcDamage(chansey, mon({speciesForme: 'Blissey'}), 'Super Fang', {nhkoTurns: 3});
    expect(r.nhko).toBeUndefined();
    expect(r.koChance).toBe(0);
    const endeavor = calcDamage(mon({speciesForme: 'Luvdisc', hpPercent: 0.2}), mon({speciesForme: 'Blissey'}), 'Endeavor', {nhkoTurns: 3});
    expect(endeavor.nhko).toBeUndefined();
  });

  it('leaves the family members the calc DOES model to the calc, ladder and all', () => {
    // Re-deriving a mechanic @smogon/calc already implements is how two answers drift, so
    // Seismic Toss and Night Shade are deliberately absent from our table. Both deal the
    // attacker's level, and both keep the ordinary nHKO ladder — their damage really is the
    // same every turn.
    for (const move of ['Seismic Toss', 'Night Shade']) {
      const r = calcDamage(chansey, mon({speciesForme: 'Corviknight'}), move, {nhkoTurns: 3});
      expect([r.total.min, r.total.max]).toEqual([100, 100]); // level 100
      expect(r.nhko).toBeDefined();
    }
  });
});

describe('a defender behind a Substitute', () => {
  const subbed = (over: Partial<ResolvedMon> = {}) =>
    mon({speciesForme: 'Keldeo', substitute: {dented: false}, ...over});
  const bare = mon({speciesForme: 'Keldeo'});

  it('says nothing at all when there is no sub — the overwhelming majority of hovers', () => {
    expect(calcDamage(mon({speciesForme: 'Barraskewda'}), bare, 'Waterfall').substitute).toBeUndefined();
  });

  it('reports how many hits break it, sized at a quarter of the defender’s max HP', () => {
    const attacker = mon({speciesForme: 'Barraskewda'});
    const r = calcDamage(attacker, subbed(), 'Waterfall');
    // Keldeo's max HP is 344 here, so the doll holds 86. Waterfall takes 15.7-18.9% of that
    // max per hit — under a quarter at either end — so it always takes two.
    expect(r.substitute).toEqual({kind: 'absorbs', hits: {min: 2, max: 2}, dented: false});
    // The damage figures themselves are untouched — the sub delays them, it doesn't change
    // them — so the numbers a caller renders are the same as with no sub in the way.
    expect(r.percent).toEqual(calcDamage(attacker, bare, 'Waterfall').percent);
  });

  it('needs several hits when one is worth less than the doll', () => {
    // Tachyon Cutter hits twice per use for ~10-12% of Keldeo's max HP each, against a sub
    // worth 25% — so a single use cannot break it, however the rolls fall.
    const r = calcDamage(mon({speciesForme: 'Iron Bundle', item: 'Choice Specs'}), subbed(), 'Tachyon Cutter');
    expect(r.substitute?.kind).toBe('absorbs');
    expect(r.substitute).toMatchObject({hits: {min: 3, max: 3}});
    expect(r.multiHit?.hits.expected).toBe(2); // two hits a use: three hits is two uses
  });

  it('lets a SOUND move straight through', () => {
    const r = calcDamage(mon({speciesForme: 'Noivern'}), subbed(), 'Boomburst');
    expect(r.substitute).toEqual({kind: 'bypassed'});
  });

  it('lets INFILTRATOR carry an ordinary move through', () => {
    const r = calcDamage(mon({speciesForme: 'Noivern', ability: 'Infiltrator'}), subbed(), 'Air Slash');
    expect(r.substitute).toEqual({kind: 'bypassed'});
    // …and the same attacker without it is stopped by the same doll.
    expect(calcDamage(mon({speciesForme: 'Noivern', ability: 'Frisk'}), subbed(), 'Air Slash').substitute?.kind).toBe('absorbs');
  });

  it('says nothing when the move cannot dent the sub at all', () => {
    // Nothing to report about a doll a move was never going to touch: the 0% damage line
    // already carries the whole story, and a hit count would be a fiction on top of it.
    const r = calcDamage(mon({speciesForme: 'Garchomp'}), mon({speciesForme: 'Corviknight', substitute: {dented: false}}), 'Earthquake');
    expect(r.total.max).toBe(0);
    expect(r.substitute).toBeUndefined();
  });

  it('carries the dent forward, since a chipped doll only ever breaks sooner', () => {
    const r = calcDamage(mon({speciesForme: 'Iron Bundle', item: 'Choice Specs'}), subbed({substitute: {dented: true}}), 'Tachyon Cutter');
    expect(r.substitute).toEqual({kind: 'absorbs', hits: {min: 3, max: 3}, dented: true});
  });

  it('sizes a SHED TAIL sub on the Pokémon that made it, not the one wearing it', () => {
    // Cyclizar's doll goes on ahead of it. Sized on a bulkier maker it takes more hits than
    // the same move would need against a sub the wearer had cut from its own HP.
    const attacker = mon({speciesForme: 'Iron Bundle', item: 'Choice Specs'});
    const own = calcDamage(attacker, subbed(), 'Tachyon Cutter').substitute;
    const inherited = calcDamage(attacker, subbed({substitute: {dented: false, sizedOnMaxHP: 600}}), 'Tachyon Cutter').substitute;
    // A doll cut from Keldeo's own 344 HP holds 86 and falls in three; one cut from a
    // 600 HP maker holds 150 and takes four or five of the very same hits.
    expect(own).toMatchObject({hits: {min: 3, max: 3}});
    expect(inherited).toMatchObject({hits: {min: 4, max: 5}});
  });

  it('applies to a damage-callback move, whose bite into a doll never shrinks', () => {
    // Super Fang halves the POKÉMON's HP, and a sub is what stops that HP moving — so each
    // hit into the doll is worth exactly what the first was.
    const r = calcDamage(mon({speciesForme: 'Chansey'}), subbed(), 'Super Fang');
    expect(r.substitute).toMatchObject({kind: 'absorbs', hits: {min: 1, max: 1}});
  });
});
