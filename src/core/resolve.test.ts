import {describe, it, expect} from 'vitest';
import {resolveByRole, resolveMon, resolveVariants} from './resolve.js';
import {inferSets} from './knowledge.js';
import type {RandbatsEntry} from './types.js';
import {
  DRAGONITE, dragoniteFacts,
  NOIVERN, noivernFacts,
  GARDEVOIR, gardevoirFacts,
  ORB_MON, orbFacts, DUAL_ABILITY,
  MEGANIUM_MEGA, megaMeganiumFacts,
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
