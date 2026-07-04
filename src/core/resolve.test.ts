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
  it('a revealed held item rules out roles that never run it', () => {
    const r = resolveMon(noivernFacts({item: 'Choice Specs'}), NOIVERN);
    expect(r.possibleMoves).toContain('Boomburst');
    expect(r.possibleMoves).not.toContain('Roost'); // Fast Support is ruled out
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('a consumed/knocked-off item (prevItem) narrows exactly like a held one', () => {
    const k = inferSets(noivernFacts({prevItem: 'Heavy-Duty Boots'}), NOIVERN);
    expect(k.roles).toEqual(['Fast Support']);
  });

  it('a revealed ability rules out roles that cannot have it', () => {
    const k = inferSets(noivernFacts({ability: 'Frisk'}), NOIVERN);
    expect(k.roles).toEqual(['Fast Support']);
  });
});

describe('inferSets', () => {
  it('starts wide open: every role, every option speculative', () => {
    const k = inferSets(noivernFacts(), NOIVERN);
    expect(k.roles).toEqual(['Fast Attacker', 'Fast Support']);
    expect(k.totalRoles).toBe(2);
    expect(k.moves.every((m) => !m.known)).toBe(true);
    expect(k.items.map((i) => i.name).sort()).toEqual(['Choice Specs', 'Heavy-Duty Boots']);
  });

  it('marks revealed moves as known and keeps the rest speculative', () => {
    const k = inferSets(noivernFacts({revealedMoves: ['Flamethrower']}), NOIVERN);
    const byName = new Map(k.moves.map((m) => [m.name, m.known]));
    expect(byName.get('Flamethrower')).toBe(true);
    expect(byName.get('Hurricane')).toBe(false);
    expect(k.roles).toHaveLength(2); // Flamethrower is in both roles — no narrowing yet
  });

  it('collapses an exclusive dimension once its value is confirmed', () => {
    // Item revealed → the other role's item is no longer a possibility at all.
    const k = inferSets(noivernFacts({item: 'Choice Specs'}), NOIVERN);
    expect(k.items).toEqual([{name: 'Choice Specs', known: true}]);
    expect(k.roles).toEqual(['Fast Attacker']);
    expect(k.teraTypes).toEqual([{name: 'Normal', known: false}]);
  });

  it('narrowing one dimension narrows the others through the role', () => {
    // Defog only appears in Fast Support → item must be Heavy-Duty Boots.
    const k = inferSets(noivernFacts({revealedMoves: ['Defog']}), NOIVERN);
    expect(k.roles).toEqual(['Fast Support']);
    expect(k.items).toEqual([{name: 'Heavy-Duty Boots', known: false}]);
  });

  it('an active Tera collapses the Tera dimension to the known type', () => {
    const k = inferSets(noivernFacts({terastallized: true, teraType: 'Fire'}), NOIVERN);
    expect(k.teraTypes).toEqual([{name: 'Fire', known: true}]);
  });

  it('keeps every role and flags uncertainty when evidence matches nothing', () => {
    const k = inferSets(noivernFacts({revealedMoves: ['Hydro Pump']}), NOIVERN);
    expect(k.roles).toHaveLength(2);
    expect(k.uncertainReason).toBeDefined();
    expect(k.moves.find((m) => m.name === 'Hydro Pump')?.known).toBe(true); // reveals always shown
  });

  it('falls back to entry-level pools for role-less (older-gen) entries', () => {
    const entry: RandbatsEntry = {
      level: 80,
      abilities: ['Levitate'],
      items: ['Life Orb'],
      moves: ['Sludge Bomb', 'Flamethrower'],
    };
    const k = inferSets(noivernFacts(), entry);
    expect(k.totalRoles).toBe(0);
    expect(k.moves.map((m) => m.name)).toEqual(['Sludge Bomb', 'Flamethrower']);
    expect(k.items).toEqual([{name: 'Life Orb', known: false}]);
  });
});
