import {describe, it, expect} from 'vitest';
import {resolveByRole, resolveMon, resolveVariants} from './resolve.js';
import {inferSets} from './knowledge.js';
import type {LiveFacts, RandbatsEntry} from './types.js';

const DRAGONITE: RandbatsEntry = {
  level: 74,
  abilities: ['Multiscale'],
  items: ['Heavy-Duty Boots'],
  roles: {
    'Bulky Setup': {
      abilities: ['Multiscale'],
      items: ['Heavy-Duty Boots'],
      teraTypes: ['Ground', 'Steel'],
      moves: ['Dragon Dance', 'Earthquake', 'Outrage', 'Roost'],
    },
    'Setup Sweeper': {
      abilities: ['Multiscale'],
      items: ['Heavy-Duty Boots'],
      teraTypes: ['Steel'],
      moves: ['Dragon Dance', 'Earthquake', 'Iron Head', 'Outrage'],
    },
  },
};

function facts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {
    speciesForme: 'Dragonite',
    level: 74,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: [],
    landedDamagingHit: false, tookEntryHazardDamage: false,
    ...over,
  };
}

describe('resolveMon', () => {
  it('defaults to gen9 randbats spread: 85 EVs, 31 IVs, Serious nature', () => {
    const r = resolveMon(facts(), DRAGONITE);
    expect(r.nature).toBe('Serious');
    expect(r.evs).toEqual({hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85});
    expect(r.ivs).toEqual({hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31});
  });

  it('applies per-set EV overrides on top of the 85 baseline', () => {
    // A roleless entry (older-gen shape) with an EV override on the 85 baseline.
    const entry: RandbatsEntry = {
      level: 74,
      abilities: ['Multiscale'],
      items: ['Heavy-Duty Boots'],
      evs: {hp: 77},
    };
    const r = resolveMon(facts(), entry);
    expect(r.evs).toEqual({hp: 77, atk: 85, def: 85, spa: 85, spd: 85, spe: 85});
  });

  it('narrows to the role consistent with revealed moves', () => {
    // Iron Head appears only in "Setup Sweeper".
    const r = resolveMon(facts({revealedMoves: ['Iron Head']}), DRAGONITE);
    expect(r.possibleMoves).toContain('Iron Head');
    expect(r.possibleMoves).not.toContain('Roost');
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('unions all roles when no moves are revealed yet', () => {
    const r = resolveMon(facts(), DRAGONITE);
    expect(r.possibleMoves).toEqual(expect.arrayContaining(['Roost', 'Iron Head']));
  });

  it('flags uncertainty when a revealed move matches no role', () => {
    const r = resolveMon(facts({revealedMoves: ['Hydro Pump']}), DRAGONITE);
    expect(r.assumptionsUncertainReason).toBeDefined();
    expect(r.possibleMoves).toContain('Hydro Pump'); // revealed certainties are always kept
  });

  it('lets revealed ability/item win over the assumed set', () => {
    const r = resolveMon(facts({ability: 'Inner Focus', item: 'Choice Band'}), DRAGONITE);
    expect(r.ability).toBe('Inner Focus');
    expect(r.item).toBe('Choice Band');
  });

  it('only applies a Tera type when the Pokémon has actually terastallized', () => {
    expect(resolveMon(facts(), DRAGONITE).teraType).toBeUndefined();
    expect(resolveMon(facts({terastallized: true, teraType: 'Flying'}), DRAGONITE).teraType).toBe('Flying');
  });
});

// Roles that differ by item and ability, so non-move evidence can tell them apart
// (modelled on real feed shapes like Noivern's Choice Specs vs Heavy-Duty Boots).
const NOIVERN: RandbatsEntry = {
  level: 80,
  abilities: ['Frisk', 'Infiltrator'],
  items: [],
  roles: {
    'Fast Attacker': {
      abilities: ['Infiltrator'],
      items: ['Choice Specs'],
      teraTypes: ['Normal'],
      moves: ['Boomburst', 'Draco Meteor', 'Flamethrower', 'Hurricane', 'U-turn'],
    },
    'Fast Support': {
      abilities: ['Frisk', 'Infiltrator'],
      items: ['Heavy-Duty Boots'],
      teraTypes: ['Fire'],
      moves: ['Defog', 'Draco Meteor', 'Flamethrower', 'Hurricane', 'Roost'],
    },
  },
};

function noivernFacts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {
    speciesForme: 'Noivern',
    level: 80,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: [],
    landedDamagingHit: false, tookEntryHazardDamage: false,
    ...over,
  };
}

describe('evidence beyond moves narrows the role', () => {
  const names = (k: ReturnType<typeof inferSets>): string[] => k.candidates.map((c) => c.name);

  it('a revealed held item rules out roles that never run it', () => {
    const r = resolveMon(noivernFacts({item: 'Choice Specs'}), NOIVERN);
    expect(r.possibleMoves).toContain('Boomburst');
    expect(r.possibleMoves).not.toContain('Roost'); // Fast Support is ruled out
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('a consumed/knocked-off item (prevItem) narrows exactly like a held one', () => {
    expect(names(inferSets(noivernFacts({prevItem: 'Heavy-Duty Boots'}), NOIVERN))).toEqual(['Fast Support']);
  });

  it('a revealed ability rules out roles that cannot have it', () => {
    expect(names(inferSets(noivernFacts({ability: 'Frisk'}), NOIVERN))).toEqual(['Fast Support']);
  });

  it('an active Tera type rules out roles that never run it', () => {
    // Only Fast Support runs Tera Fire — terastallizing reveals the set.
    expect(names(inferSets(noivernFacts({terastallized: true, teraType: 'Fire'}), NOIVERN))).toEqual([
      'Fast Support',
    ]);
  });

  it('taking entry-hazard damage rules out the Heavy-Duty Boots set', () => {
    // Fast Support runs ONLY Heavy-Duty Boots; taking Stealth Rock proves it isn't holding
    // them, leaving the Choice Specs set. (Boots never reveals itself directly — deduced.)
    expect(names(inferSets(noivernFacts({tookEntryHazardDamage: true}), NOIVERN))).toEqual(['Fast Attacker']);
  });

  it('keeps the Boots set while no hazard damage has been taken', () => {
    expect(names(inferSets(noivernFacts(), NOIVERN))).toEqual(['Fast Attacker', 'Fast Support']);
  });
});

// A single-role set whose ability (Trace) copies the opponent's mid-battle. Its
// CURRENT ability then differs from what the set was built with.
const GARDEVOIR: RandbatsEntry = {
  level: 83,
  abilities: ['Trace'],
  items: [],
  roles: {
    'Fast Attacker': {
      abilities: ['Trace'],
      items: ['Choice Scarf', 'Choice Specs', 'Life Orb'],
      teraTypes: ['Fairy', 'Fighting', 'Fire'],
      moves: ['Calm Mind', 'Focus Blast', 'Moonblast', 'Psychic', 'Psyshock', 'Trick'],
    },
  },
};

function gardevoirFacts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {speciesForme: 'Gardevoir', level: 83, hpPercent: 1, boosts: {}, terastallized: false, revealedMoves: [], landedDamagingHit: false, tookEntryHazardDamage: false, ...over};
}

describe('set inference uses the INNATE ability, not the live one', () => {
  // Trace/Skill Swap/Worry Seed/Entrainment/Simple Beam/Gastro Acid/Mummy all leave
  // `ability` (current) different from `baseAbility` (innate). Matching the current
  // ability against the set used to panic ("matched no known set"); the innate ability
  // is what the set is keyed to.
  it('does not panic when Trace has copied the opponent’s ability', () => {
    // Gardevoir Traced Zekrom's Teravolt: current = Teravolt, innate = Trace.
    const k = inferSets(gardevoirFacts({ability: 'Teravolt', baseAbility: 'Trace', revealedMoves: ['Moonblast']}), GARDEVOIR);
    expect(k.uncertainReason).toBeUndefined();
    expect(k.candidates).toHaveLength(1);
    // The set's own ability (Trace) is shown as confirmed — never the traced Teravolt.
    expect(k.candidates[0]!.abilities).toEqual([{name: 'Trace', known: true}]);
    expect(JSON.stringify(k)).not.toContain('Teravolt');
  });

  it('resolves the role cleanly for the calc (no shaky-assumptions flag)', () => {
    const r = resolveMon(gardevoirFacts({ability: 'Teravolt', baseAbility: 'Trace'}), GARDEVOIR);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    // The calc still uses the LIVE ability (Teravolt is what's actually active).
    expect(r.ability).toBe('Teravolt');
  });

  it('handles a suppressed ability (Gastro Acid) the same way', () => {
    // Gastro Acid: current = "(suppressed)", innate = Trace. Inference uses the innate.
    const k = inferSets(gardevoirFacts({ability: '(suppressed)', baseAbility: 'Trace'}), GARDEVOIR);
    expect(k.uncertainReason).toBeUndefined();
    expect(k.candidates[0]!.abilities).toEqual([{name: 'Trace', known: true}]);
  });

  it('falls back to the current ability when nothing has changed', () => {
    // A normal mon: only `ability` known, `baseAbility` absent → still narrows on it.
    expect(inferSets(noivernFacts({ability: 'Frisk'}), NOIVERN).candidates.map((c) => c.name)).toEqual([
      'Fast Support',
    ]);
  });
});

describe('inferSets', () => {
  const names = (k: ReturnType<typeof inferSets>): string[] => k.candidates.map((c) => c.name);

  it('starts wide open: every set kept whole, every option speculative', () => {
    const k = inferSets(noivernFacts(), NOIVERN);
    expect(names(k)).toEqual(['Fast Attacker', 'Fast Support']);
    expect(k.totalRoles).toBe(2);
    expect(k.candidates[0]!.items).toEqual([{name: 'Choice Specs', known: false}]);
    expect(k.candidates[1]!.items).toEqual([{name: 'Heavy-Duty Boots', known: false}]);
    expect(k.candidates.every((c) => c.moves.every((m) => !m.known))).toBe(true);
  });

  it('marks revealed moves as known inside every surviving set', () => {
    const k = inferSets(noivernFacts({revealedMoves: ['Flamethrower']}), NOIVERN);
    expect(names(k)).toHaveLength(2); // Flamethrower is in both roles — no narrowing yet
    for (const c of k.candidates) {
      const byName = new Map(c.moves.map((m) => [m.name, m.known]));
      expect(byName.get('Flamethrower')).toBe(true);
      expect(byName.get('Hurricane')).toBe(false);
    }
  });

  it('collapses an exclusive dimension once its value is confirmed', () => {
    // Item revealed → only its set survives, and its item line is settled fact.
    const k = inferSets(noivernFacts({item: 'Choice Specs'}), NOIVERN);
    expect(names(k)).toEqual(['Fast Attacker']);
    expect(k.candidates[0]!.items).toEqual([{name: 'Choice Specs', known: true}]);
    expect(k.candidates[0]!.gimmicks).toEqual([{kind: 'tera', types: [{name: 'Normal', known: false}]}]);
  });

  it('narrowing one dimension narrows the others through the set', () => {
    // Defog only appears in Fast Support → item must be Heavy-Duty Boots.
    const k = inferSets(noivernFacts({revealedMoves: ['Defog']}), NOIVERN);
    expect(names(k)).toEqual(['Fast Support']);
    expect(k.candidates[0]!.items).toEqual([{name: 'Heavy-Duty Boots', known: false}]);
  });

  it('an active Tera narrows the sets AND settles the Tera line', () => {
    const k = inferSets(noivernFacts({terastallized: true, teraType: 'Fire'}), NOIVERN);
    expect(names(k)).toEqual(['Fast Support']);
    expect(k.candidates[0]!.gimmicks).toEqual([{kind: 'tera', types: [{name: 'Fire', known: true}]}]);
  });

  it('keeps every set and flags uncertainty when evidence matches nothing', () => {
    const k = inferSets(noivernFacts({revealedMoves: ['Hydro Pump']}), NOIVERN);
    expect(names(k)).toHaveLength(2);
    expect(k.uncertainReason).toBeDefined();
    // Reveals are always shown, even when they fit no known set.
    expect(k.candidates[0]!.moves.find((m) => m.name === 'Hydro Pump')?.known).toBe(true);
  });

  it('falls back to a single unnamed set for role-less (older-gen) entries', () => {
    const entry: RandbatsEntry = {
      level: 80,
      abilities: ['Levitate'],
      items: ['Life Orb'],
      moves: ['Sludge Bomb', 'Flamethrower'],
    };
    const k = inferSets(noivernFacts(), entry);
    expect(k.totalRoles).toBe(0);
    expect(names(k)).toEqual(['']);
    expect(k.candidates[0]!.moves.map((m) => m.name)).toEqual(['Sludge Bomb', 'Flamethrower']);
    expect(k.candidates[0]!.items).toEqual([{name: 'Life Orb', known: false}]);
  });
});

// Life Orb takes 1/10 recoil after a damaging move connects and reveals itself doing
// so. So a mon that has LANDED a damaging hit with none of its item revealed can't be
// holding it — UNLESS Sheer Force or Magic Guard would have suppressed the recoil. This
// fixture has one Life-Orb-only role (drops when ruled out), one that pairs it with a
// second item (survives, minus Life Orb), and one Sheer Force role (recoil suppressed).
const ORB_MON: RandbatsEntry = {
  level: 80,
  abilities: ['Overgrow', 'Sheer Force'],
  items: [],
  roles: {
    'Orb Sweeper': {abilities: ['Overgrow'], items: ['Life Orb'], teraTypes: ['Grass'], moves: ['Leaf Storm', 'Earthquake']},
    'Mixed Attacker': {abilities: ['Overgrow'], items: ['Life Orb', 'Choice Band'], teraTypes: ['Grass'], moves: ['Leaf Storm', 'Earthquake']},
    'Force Sweeper': {abilities: ['Sheer Force'], items: ['Life Orb'], teraTypes: ['Grass'], moves: ['Leaf Storm', 'Earthquake']},
  },
};

function orbFacts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {
    speciesForme: 'Orbmon',
    level: 80,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: ['Leaf Storm'], // in every role, so it narrows nothing by itself
    landedDamagingHit: true, tookEntryHazardDamage: false,
    ...over,
  };
}

// A single role that can run EITHER a recoil-suppressing ability or a plain one, with
// Life Orb plus an alternative. It isolates the ability guard: same behaviour, opposite
// outcomes depending only on which ability the battle has revealed.
const DUAL_ABILITY: RandbatsEntry = {
  level: 80,
  abilities: ['Overgrow', 'Sheer Force'],
  items: [],
  roles: {
    Attacker: {abilities: ['Overgrow', 'Sheer Force'], items: ['Life Orb', 'Choice Band'], teraTypes: ['Grass'], moves: ['Leaf Storm']},
  },
};

describe('a landed damaging hit with no item revealed rules Life Orb out', () => {
  const names = (k: ReturnType<typeof inferSets>): string[] => k.candidates.map((c) => c.name);
  const itemNames = (k: ReturnType<typeof inferSets>, i: number): string[] =>
    k.candidates[i]!.items.map((o) => o.name);

  it('drops a Life-Orb-only role and strips Life Orb from a role that has an alternative', () => {
    const k = inferSets(orbFacts(), ORB_MON);
    // 'Orb Sweeper' (Life Orb its only item) is gone; the Sheer Force role remains.
    expect(names(k)).toEqual(['Mixed Attacker', 'Force Sweeper']);
    expect(itemNames(k, 0)).toEqual(['Choice Band']); // Life Orb ruled out, Choice Band kept
  });

  it('keeps Life Orb on a Sheer Force set — the recoil it never took proves nothing', () => {
    const k = inferSets(orbFacts(), ORB_MON);
    expect(k.candidates[1]!.name).toBe('Force Sweeper');
    expect(itemNames(k, 1)).toEqual(['Life Orb']);
  });

  it('never lies while the ability is hidden and the set COULD be Sheer Force', () => {
    // Ability unrevealed, and this role can run Sheer Force → Life Orb stays possible.
    const k = inferSets(orbFacts(), DUAL_ABILITY);
    expect(itemNames(k, 0)).toEqual(['Life Orb', 'Choice Band']);
  });

  it('rules Life Orb out once a NON-suppressing innate ability is revealed', () => {
    const k = inferSets(orbFacts({baseAbility: 'Overgrow'}), DUAL_ABILITY);
    expect(itemNames(k, 0)).toEqual(['Choice Band']);
  });

  it('keeps Life Orb once the revealed innate ability IS a suppressor', () => {
    const k = inferSets(orbFacts({baseAbility: 'Sheer Force'}), DUAL_ABILITY);
    expect(itemNames(k, 0)).toEqual(['Life Orb', 'Choice Band']);
  });

  it('infers nothing until a damaging hit has actually landed', () => {
    // No landed hit yet (moves whiffed, or only status used) → Life Orb intact. This is
    // the honesty guard: a missed damaging move triggers no recoil and proves nothing.
    const k = inferSets(orbFacts({landedDamagingHit: false}), DUAL_ABILITY);
    expect(itemNames(k, 0)).toEqual(['Life Orb', 'Choice Band']);
  });

  it('stays inert once an item is revealed (the positive path already pins the set)', () => {
    const k = inferSets(orbFacts({item: 'Life Orb'}), DUAL_ABILITY);
    expect(itemNames(k, 0)).toEqual(['Life Orb']); // revealed as held — settled fact
  });

  it('keeps the calc off a ruled-out Life Orb when picking the assumed item', () => {
    // Mixed Attacker lists Life Orb FIRST; without the rule the calc would assume it.
    const r = resolveMon(orbFacts(), ORB_MON);
    expect(r.item).toBe('Choice Band');
  });
});

// A [Gen 9] Champions Mega set, verbatim from the feed's "Meganium-Mega" entry. The
// live client reports its ability as "Mega Sol" (a Champions custom name), while the feed
// lists "Leaf Guard" — so matching on the ability would reject the only role. The forme +
// stone must carry the match instead.
const MEGANIUM_MEGA: RandbatsEntry = {
  level: 50,
  abilities: ['Leaf Guard'],
  items: ['Meganiumite'],
  roles: {
    'Bulky Attacker': {
      abilities: ['Leaf Guard'],
      items: ['Meganiumite'],
      teraTypes: [],
      moves: ['Dazzling Gleam', 'Solar Beam', 'Synthesis', 'Weather Ball'],
    },
  },
};

// The facts a mega-evolved Meganium presents, captured live from replay 2646169772.
function megaMeganiumFacts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {
    speciesForme: 'Meganium-Mega',
    level: 50,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: ['Solar Beam', 'Synthesis'],
    landedDamagingHit: false, tookEntryHazardDamage: false,
    ability: 'Mega Sol',
    baseAbility: 'Mega Sol',
    item: 'Meganiumite',
    ...over,
  };
}

describe('a Mega forme matches on forme + stone, not its forme-locked ability', () => {
  it('matches the -Mega set even when client and feed disagree on the ability name', () => {
    const k = inferSets(megaMeganiumFacts(), MEGANIUM_MEGA);
    expect(k.uncertainReason).toBeUndefined(); // was "matched no known set"
    expect(k.candidates.map((c) => c.name)).toEqual(['Bulky Attacker']);
    expect(k.candidates[0]!.items).toEqual([{name: 'Meganiumite', known: true}]);
  });

  it('resolves cleanly for the calc — no shaky-assumptions flag', () => {
    expect(resolveMon(megaMeganiumFacts(), MEGANIUM_MEGA).assumptionsUncertainReason).toBeUndefined();
  });

  it('still narrows a Mega set by its MOVES (a move from no role is rejected)', () => {
    // The ability is ignored, but real evidence must still bite: a foreign move fails.
    const k = inferSets(megaMeganiumFacts({revealedMoves: ['Hydro Pump']}), MEGANIUM_MEGA);
    expect(k.uncertainReason).toBeDefined();
  });
});

// One role whose hidden item could be Assault Vest OR Leftovers — the shape that makes
// a single move deal two different amounts (AV halves the special hit).
const TENTACRUEL: RandbatsEntry = {
  level: 82,
  abilities: ['Liquid Ooze'],
  items: [],
  roles: {
    'Bulky Support': {
      abilities: ['Liquid Ooze'],
      items: ['Assault Vest', 'Leftovers'],
      teraTypes: ['Flying', 'Grass'],
      moves: ['Surf', 'Haze', 'Rapid Spin', 'Toxic Spikes'],
    },
  },
};

function tentacruelFacts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {speciesForme: 'Tentacruel', level: 82, hpPercent: 1, boosts: {}, terastallized: false, revealedMoves: [], landedDamagingHit: false, tookEntryHazardDamage: false, ...over};
}

describe('resolveVariants — the still-possible sets to calc over', () => {
  const items = (vs: ReturnType<typeof resolveVariants>): string[] => [...new Set(vs.map((v) => v.mon.item ?? 'none'))];

  it('enumerates one variant per hidden item when the item is unknown', () => {
    const vs = resolveVariants(tentacruelFacts(), TENTACRUEL);
    expect(items(vs).sort()).toEqual(['Assault Vest', 'Leftovers']);
  });

  it('collapses to a single variant once the item is revealed', () => {
    const vs = resolveVariants(tentacruelFacts({item: 'Leftovers'}), TENTACRUEL);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.mon.item).toBe('Leftovers');
  });

  it('drops the Life Orb variant once a landed hit has ruled it out', () => {
    // The seam between the two features: a landed hit with no item revealed removes Life
    // Orb from the enumerated variants, so no phantom Life Orb damage bucket is produced.
    // Ability hidden but the set could be Sheer Force → Life Orb stays possible (never lie).
    expect(items(resolveVariants(orbFacts(), DUAL_ABILITY))).toContain('Life Orb');
    // Innate ability revealed as non-suppressing → the landed hit rules Life Orb out.
    expect(items(resolveVariants(orbFacts({baseAbility: 'Overgrow'}), DUAL_ABILITY))).toEqual(['Choice Band']);
  });

  it('dedupes roles that resolve identically — no fan-out from redundant sets', () => {
    // Two roles with the same spread, ability, and item are one calc, not two.
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
    const inferred = inferSets(noivernFacts(), NOIVERN);
    expect(byRole.map((v) => v.role)).toEqual(inferred.candidates.map((c) => c.name));
  });

  it("uses each set's own representative item, not one set's shared across all", () => {
    const byRole = resolveByRole(noivernFacts(), NOIVERN);
    const byName = new Map(byRole.map((v) => [v.role, v.mon.item]));
    expect(byName.get('Fast Attacker')).toBe('Choice Specs');
    expect(byName.get('Fast Support')).toBe('Heavy-Duty Boots');
  });
});
