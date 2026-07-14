import {describe, it, expect} from 'vitest';
import {resolveByRole, resolveMon, resolveVariants} from './resolve.js';
import {inferSets} from './knowledge.js';
import type {RandbatsEntry} from './types.js';
import {
  liveFacts,
  DRAGONITE, dragoniteFacts,
  NOIVERN, noivernFacts,
  GARDEVOIR, gardevoirFacts,
  ORB_MON, orbFacts, DUAL_ABILITY,
  MEGANIUM_MEGA, megaMeganiumFacts,
  CALYREX_SHADOW, calyrexShadowFacts,
  TERAPAGOS, terapagosFacts,
  TENTACRUEL, tentacruelFacts,
} from './sets.testfixtures.js';

describe('resolveMon', () => {
  it('defaults to gen9 randbats spread: 85 EVs, 31 IVs, Serious nature', () => {
    const r = resolveMon(dragoniteFacts(), DRAGONITE);
    expect(r.nature).toBe('Serious');
    expect(r.evs).toEqual({hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85});
    expect(r.ivs).toEqual({hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31});
  });

  it('applies per-set EV overrides on top of the 85 baseline', () => {
    // A roleless entry (older-gen shape) with an EV override on the 85 baseline.
    const entry: RandbatsEntry = {level: 74, abilities: ['Multiscale'], items: ['Heavy-Duty Boots'], evs: {hp: 77}};
    const r = resolveMon(dragoniteFacts(), entry);
    expect(r.evs).toEqual({hp: 77, atk: 85, def: 85, spa: 85, spd: 85, spe: 85});
  });

  it('narrows to the role consistent with revealed moves', () => {
    // Iron Head appears only in "Setup Sweeper".
    const r = resolveMon(dragoniteFacts({revealedMoves: ['Iron Head']}), DRAGONITE);
    expect(r.possibleMoves).toContain('Iron Head');
    expect(r.possibleMoves).not.toContain('Roost');
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('carries client-dex speciesData through to the resolved mon (calc fallback for unknown formes)', () => {
    // Champions invents Megas the calc's dex lacks; the client dex reading must survive
    // resolution untouched so the damage layer can fall back to it.
    const speciesData = {baseStats: {hp: 60, atk: 75, def: 110, spa: 175, spd: 110, spe: 90}, types: ['Ghost', 'Fire'], weightkg: 34.3};
    expect(resolveMon(dragoniteFacts({speciesData}), DRAGONITE).speciesData).toEqual(speciesData);
    expect(resolveMon(dragoniteFacts(), DRAGONITE).speciesData).toBeUndefined();
  });

  it('unions all roles when no moves are revealed yet', () => {
    const r = resolveMon(dragoniteFacts(), DRAGONITE);
    expect(r.possibleMoves).toEqual(expect.arrayContaining(['Roost', 'Iron Head']));
  });

  it('flags uncertainty when a revealed move matches no role', () => {
    const r = resolveMon(dragoniteFacts({revealedMoves: ['Hydro Pump']}), DRAGONITE);
    expect(r.assumptionsUncertainReason).toBeDefined();
    expect(r.possibleMoves).toContain('Hydro Pump'); // revealed certainties are always kept
  });

  it('lets revealed ability/item win over the assumed set', () => {
    const r = resolveMon(dragoniteFacts({ability: 'Inner Focus', item: 'Choice Band'}), DRAGONITE);
    expect(r.ability).toBe('Inner Focus');
    expect(r.item).toBe('Choice Band');
  });

  it('only applies a Tera type when the Pokémon has actually terastallized', () => {
    expect(resolveMon(dragoniteFacts(), DRAGONITE).teraType).toBeUndefined();
    expect(resolveMon(dragoniteFacts({terastallized: true, teraType: 'Flying'}), DRAGONITE).teraType).toBe('Flying');
  });

  it('resolves to NO item once it has been knocked off / consumed (prevItem set)', () => {
    // Otherwise the calc keeps the gone item — Knock Off would stay ×1.5-boosted, etc.
    expect(resolveMon(dragoniteFacts({prevItem: 'Heavy-Duty Boots'}), DRAGONITE).item).toBeUndefined();
    expect(resolveMon(dragoniteFacts(), DRAGONITE).item).toBe('Heavy-Duty Boots'); // still assumed when nothing's revealed
  });

  it('takes the nature from a role that carries one; feed roles without one stay Serious', () => {
    // The randbats feed never sets nature — only assumption/usage pools do. The Serious
    // default for natureless roles is the randbats byte-identity guard.
    const natured: RandbatsEntry = {
      level: 100, abilities: [], items: [],
      roles: {Bulky: {abilities: [], items: [], teraTypes: [], moves: [], nature: 'Bold'}},
    };
    expect(resolveMon(dragoniteFacts(), natured).nature).toBe('Bold');
    expect(resolveMon(dragoniteFacts(), DRAGONITE).nature).toBe('Serious');
  });

  it('threads knownStats (our own server-reported finals) through to the resolved mon', () => {
    const knownStats = {hp: 341, atk: 403, def: 226, spa: 212, spd: 236, spe: 196};
    expect(resolveMon(dragoniteFacts({knownStats}), DRAGONITE).knownStats).toEqual(knownStats);
    expect(resolveMon(dragoniteFacts(), DRAGONITE).knownStats).toBeUndefined();
  });

  it('arms Unburden (abilityOn) once the item is confirmed GONE, not merely absent', () => {
    // Knocked off / consumed mid-battle (prevItem set, nothing held) — Unburden fires.
    const lost = resolveMon(dragoniteFacts({ability: 'Unburden', prevItem: 'Heavy-Duty Boots'}), DRAGONITE);
    expect(lost.abilityOn).toBe(true);
    // Never revealed to have HAD an item at all — Unburden must not fire on a mere guess.
    const unrevealed = resolveMon(dragoniteFacts({ability: 'Unburden'}), DRAGONITE);
    expect(unrevealed.abilityOn).toBeUndefined();
    // Item lost, but the ability isn't Unburden — no reason to arm it.
    const otherAbility = resolveMon(dragoniteFacts({ability: 'Multiscale', prevItem: 'Heavy-Duty Boots'}), DRAGONITE);
    expect(otherAbility.abilityOn).toBeUndefined();
  });
});

describe('resolveMon reflects the same narrowing/deductions the display does', () => {
  it('a revealed held item rules out roles that never run it', () => {
    const r = resolveMon(noivernFacts({item: 'Choice Specs'}), NOIVERN);
    expect(r.possibleMoves).toContain('Boomburst');
    expect(r.possibleMoves).not.toContain('Roost'); // Fast Support is ruled out
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('uses the LIVE ability but resolves a Traced set cleanly (no shaky flag)', () => {
    const r = resolveMon(gardevoirFacts({ability: 'Teravolt', baseAbility: 'Trace'}), GARDEVOIR);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.ability).toBe('Teravolt'); // the calc uses what's actually active
  });

  it('keeps the calc off a ruled-out Life Orb when picking the assumed item', () => {
    // Mixed Attacker lists Life Orb FIRST; without the recoil rule the calc would assume it.
    expect(resolveMon(orbFacts(), ORB_MON).item).toBe('Choice Band');
  });

  it('resolves a Mega forme cleanly despite the client/feed ability-name mismatch', () => {
    expect(resolveMon(megaMeganiumFacts(), MEGANIUM_MEGA).assumptionsUncertainReason).toBeUndefined();
  });

  it("an ability the species cannot have narrows nothing — the protocol's umbrella name", () => {
    // Calyrex-Shadow reaches us with baseAbility "As One" (see the fixture) while the feed
    // says "As One (Spectrier)". Keying on the name rejected the only role, so every hover
    // read "matched no known set" from the moment it switched in.
    const r = resolveMon(calyrexShadowFacts({revealedMoves: ['Astral Barrage']}), CALYREX_SHADOW);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.possibleMoves).toContain('Nasty Plot');
    expect(r.ability).toBe('Grim Neigh'); // the calc still uses the LIVE ability
  });

  it('a FORME-LOCKED ability narrows nothing — Terapagos after Tera Shift', () => {
    // Tera Shift fires on switch-in and makes it Terapagos-Terastal, whose own ability —
    // Tera Shell — the client stamps over the innate one. Tera Shell is a REAL ability of
    // the species it now is, so checking the dex can't catch this; what makes it useless as
    // evidence is that no SET could have been built with it. Keying on it rejected both
    // roles, so every Terapagos hover cried "matched no known set" from the turn it landed.
    const r = resolveMon(terapagosFacts({revealedMoves: ['Calm Mind']}), TERAPAGOS);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.possibleMoves).toContain('Tera Starstorm');
    expect(r.ability).toBe('Tera Shell'); // the calc still uses the ability that is really active
  });

  it('an ability the set pool CAN produce still narrows, as hard as ever', () => {
    // The positive control for the law above: it must ignore only names no set could have
    // been built with. ORB_MON's three roles split on ability — Sheer Force belongs to one
    // of them, so revealing it still cuts the other two.
    // (No landed hit: the Life Orb deduction would rule roles out by ITEM, and this case is
    // about the ability alone.)
    const seen = (ability: string) => orbFacts({ability, baseAbility: ability, landedDamagingHit: false});
    const narrowed = resolveByRole(seen('Sheer Force'), ORB_MON);
    expect(narrowed.map((v) => v.role)).toEqual(['Force Sweeper']);
    // …while a name the pool could never produce leaves every role standing.
    const unnarrowed = resolveByRole(seen('Mega Sol'), ORB_MON);
    expect(unnarrowed.map((v) => v.role)).toEqual(['Orb Sweeper', 'Mixed Attacker', 'Force Sweeper']);
  });

  it('an ability the species cannot have narrows nothing — a borrowed one', () => {
    // Skill Swap before the innate ability was ever revealed: the client leaves `baseAbility`
    // empty, so readState falls back to the live one. Noivern can't have Poison Heal, so the
    // name is not evidence about its set — it must not reject the roles the moves still allow.
    const dex = {baseStats: {hp: 85, atk: 70, def: 80, spa: 97, spd: 80, spe: 123},
      types: ['Flying', 'Dragon'], abilities: ['Frisk', 'Infiltrator']};
    const facts = noivernFacts({speciesData: dex, ability: 'Poison Heal', baseAbility: 'Poison Heal'});
    expect(resolveMon(facts, NOIVERN).assumptionsUncertainReason).toBeUndefined();
    // A real Noivern ability still narrows: Infiltrator alone rules out neither role, but
    // Frisk is Fast Support's alone — so the pool loses Fast Attacker's moves.
    const frisk = resolveMon(noivernFacts({speciesData: dex, baseAbility: 'Frisk'}), NOIVERN);
    expect(frisk.possibleMoves).not.toContain('Boomburst');
  });
});

describe('resolveVariants — the still-possible sets to calc over', () => {
  const items = (vs: ReturnType<typeof resolveVariants>): string[] => [...new Set(vs.map((v) => v.mon.item ?? 'none'))];

  it('enumerates one variant per hidden item when the item is unknown', () => {
    expect(items(resolveVariants(tentacruelFacts(), TENTACRUEL)).sort()).toEqual(['Assault Vest', 'Leftovers']);
  });

  it('collapses to a single variant once the item is revealed', () => {
    const vs = resolveVariants(tentacruelFacts({item: 'Leftovers'}), TENTACRUEL);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.mon.item).toBe('Leftovers');
  });

  it('drops the Life Orb variant once a landed hit has ruled it out', () => {
    // The seam between the two features: a landed hit with no item revealed removes Life Orb
    // from the enumerated variants, so no phantom Life Orb damage bucket is produced.
    expect(items(resolveVariants(orbFacts(), DUAL_ABILITY))).toContain('Life Orb'); // hidden ability could be Sheer Force
    expect(items(resolveVariants(orbFacts({baseAbility: 'Overgrow'}), DUAL_ABILITY))).toEqual(['Choice Band']);
  });

  it('dedupes roles that resolve identically — no fan-out from redundant sets', () => {
    const twin: RandbatsEntry = {
      level: 80,
      abilities: ['Levitate'],
      items: [],
      roles: {
        'Role A': {abilities: ['Levitate'], items: ['Leftovers'], teraTypes: ['Fire'], moves: ['Flamethrower']},
        'Role B': {abilities: ['Levitate'], items: ['Leftovers'], teraTypes: ['Fire'], moves: ['Flamethrower']},
      },
    };
    expect(resolveVariants(noivernFacts({speciesForme: 'Rotom'}), twin)).toHaveLength(1);
  });
});

describe('a live forme change', () => {
  // Relic Song turns Meloetta into Meloetta-Pirouette for as long as it stays in. The calc
  // has to see the forme standing there; the SET is still the one the feed publishes under
  // "Meloetta" — there is no Pirouette entry to look up, and the moves it revealed as a
  // Meloetta still narrow its role. So the two species part ways at exactly one seam.
  const MELOETTA: RandbatsEntry = {
    level: 82,
    abilities: ['Serene Grace'],
    items: ['Leftovers'],
    roles: {
      Wallbreaker: {
        abilities: ['Serene Grace'],
        items: ['Leftovers'],
        teraTypes: ['Fighting'],
        moves: ['Relic Song', 'Close Combat', 'Knock Off'],
      },
    },
  };
  const facts = liveFacts({
    speciesForme: 'Meloetta',
    liveForme: 'Meloetta-Pirouette',
    level: 82,
    revealedMoves: ['Relic Song'],
  });

  it('is what the calc resolves to, while the set stays the base species\'', () => {
    const r = resolveMon(facts, MELOETTA);
    expect(r.speciesForme).toBe('Meloetta-Pirouette');
    // …and the Meloetta role still matched: the revealed move narrowed it as normal.
    expect(r.possibleMoves).toContain('Close Combat');
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('reaches every variant, not just the single resolution', () => {
    for (const v of resolveVariants(facts, MELOETTA)) expect(v.mon.speciesForme).toBe('Meloetta-Pirouette');
    for (const v of resolveByRole(facts, MELOETTA)) expect(v.mon.speciesForme).toBe('Meloetta-Pirouette');
  });

  it('leaves a Pokémon that has not changed forme exactly as it was', () => {
    expect(resolveMon(dragoniteFacts(), DRAGONITE).speciesForme).toBe('Dragonite');
  });
});

describe('resolveByRole — one resolution per surviving set, aligned with inferSets', () => {
  it('yields a resolution per candidate, in the same order as inferSets', () => {
    const byRole = resolveByRole(noivernFacts(), NOIVERN);
    expect(byRole.map((v) => v.role)).toEqual(inferSets(noivernFacts(), NOIVERN).candidates.map((c) => c.name));
  });

  it("uses each set's own representative item, not one set's shared across all", () => {
    const byName = new Map(resolveByRole(noivernFacts(), NOIVERN).map((v) => [v.role, v.mon.item]));
    expect(byName.get('Fast Attacker')).toBe('Choice Specs');
    expect(byName.get('Fast Support')).toBe('Heavy-Duty Boots');
  });
});
