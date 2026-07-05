import {describe, it, expect} from 'vitest';
import {inferSets, resolveMon} from './resolve.js';
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
