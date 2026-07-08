import {describe, it, expect} from 'vitest';
import {inferSets} from './knowledge.js';
import type {RandbatsEntry} from './types.js';
import {
  NOIVERN, noivernFacts,
  GARDEVOIR, gardevoirFacts,
  GUARD_MON, guardFacts,
  ORB_MON, orbFacts, DUAL_ABILITY,
  MEGANIUM_MEGA, megaMeganiumFacts,
} from './sets.testfixtures.js';

const names = (k: ReturnType<typeof inferSets>): string[] => k.candidates.map((c) => c.name);
const itemNames = (k: ReturnType<typeof inferSets>, i = 0): string[] => k.candidates[i]!.items.map((o) => o.name);

describe('evidence beyond moves narrows the role', () => {
  it('a consumed/knocked-off item (prevItem) narrows exactly like a held one', () => {
    expect(names(inferSets(noivernFacts({prevItem: 'Heavy-Duty Boots'}), NOIVERN))).toEqual(['Fast Support']);
  });

  it('a revealed ability rules out roles that cannot have it', () => {
    expect(names(inferSets(noivernFacts({ability: 'Frisk'}), NOIVERN))).toEqual(['Fast Support']);
  });

  it('an active Tera type rules out roles that never run it', () => {
    // Only Fast Support runs Tera Fire — terastallizing reveals the set.
    expect(names(inferSets(noivernFacts({terastallized: true, teraType: 'Fire'}), NOIVERN))).toEqual(['Fast Support']);
  });

  it('taking entry-hazard damage rules out the Heavy-Duty Boots set', () => {
    // Fast Support runs ONLY Heavy-Duty Boots; taking Stealth Rock proves it isn't holding
    // them, leaving the Choice Specs set. (Boots never reveals itself directly — deduced.)
    expect(names(inferSets(noivernFacts({tookEntryHazardDamage: true}), NOIVERN))).toEqual(['Fast Attacker']);
  });

  it('keeps the Boots set while no hazard damage has been taken', () => {
    expect(names(inferSets(noivernFacts(), NOIVERN))).toEqual(['Fast Attacker', 'Fast Support']);
  });

  it('switching into Stealth Rock unharmed CONFIRMS Heavy-Duty Boots', () => {
    // Nothing but Boots (or Magic Guard) dodges Stealth Rock; Noivern can't run Magic Guard,
    // so this pins the Boots set and drops the Choice Specs one.
    expect(names(inferSets(noivernFacts({switchedIntoStealthRockUnharmed: true}), NOIVERN))).toEqual(['Fast Support']);
  });
});

describe('the Heavy-Duty Boots rule-in never lies about a possible Magic Guard set', () => {
  it('does NOT confirm Boots while the ability is hidden and could be Magic Guard', () => {
    // Magic Guard would dodge Stealth Rock too, so both items stay possible.
    expect(itemNames(inferSets(guardFacts(), GUARD_MON))).toEqual(['Heavy-Duty Boots', 'Leftovers']);
  });

  it('confirms Boots once the revealed innate ability rules Magic Guard out', () => {
    expect(itemNames(inferSets(guardFacts({baseAbility: 'Overgrow'}), GUARD_MON))).toEqual(['Heavy-Duty Boots']);
  });
});

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

  it('handles a suppressed ability (Gastro Acid) the same way', () => {
    // Gastro Acid: current = "(suppressed)", innate = Trace. Inference uses the innate.
    const k = inferSets(gardevoirFacts({ability: '(suppressed)', baseAbility: 'Trace'}), GARDEVOIR);
    expect(k.uncertainReason).toBeUndefined();
    expect(k.candidates[0]!.abilities).toEqual([{name: 'Trace', known: true}]);
  });

  it('falls back to the current ability when nothing has changed', () => {
    // A normal mon: only `ability` known, `baseAbility` absent → still narrows on it.
    expect(names(inferSets(noivernFacts({ability: 'Frisk'}), NOIVERN))).toEqual(['Fast Support']);
  });
});

describe('a Mega forme matches on forme + stone, not its forme-locked ability', () => {
  it('matches the -Mega set even when client and feed disagree on the ability name', () => {
    const k = inferSets(megaMeganiumFacts(), MEGANIUM_MEGA);
    expect(k.uncertainReason).toBeUndefined(); // was "matched no known set"
    expect(names(k)).toEqual(['Bulky Attacker']);
    expect(k.candidates[0]!.items).toEqual([{name: 'Meganiumite', known: true}]);
  });

  it('still narrows a Mega set by its MOVES (a move from no role is rejected)', () => {
    // The ability is ignored, but real evidence must still bite: a foreign move fails.
    expect(inferSets(megaMeganiumFacts({revealedMoves: ['Hydro Pump']}), MEGANIUM_MEGA).uncertainReason).toBeDefined();
  });
});

describe('a landed damaging hit with no item revealed rules Life Orb out (display)', () => {
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
    expect(itemNames(inferSets(orbFacts(), DUAL_ABILITY))).toEqual(['Life Orb', 'Choice Band']);
  });

  it('rules Life Orb out once a NON-suppressing innate ability is revealed', () => {
    expect(itemNames(inferSets(orbFacts({baseAbility: 'Overgrow'}), DUAL_ABILITY))).toEqual(['Choice Band']);
  });

  it('keeps Life Orb once the revealed innate ability IS a suppressor', () => {
    expect(itemNames(inferSets(orbFacts({baseAbility: 'Sheer Force'}), DUAL_ABILITY))).toEqual(['Life Orb', 'Choice Band']);
  });

  it('infers nothing until a damaging hit has actually landed', () => {
    // A missed damaging move triggers no recoil and proves nothing — the honesty guard.
    expect(itemNames(inferSets(orbFacts({landedDamagingHit: false}), DUAL_ABILITY))).toEqual(['Life Orb', 'Choice Band']);
  });

  it('stays inert once an item is revealed (the positive path already pins the set)', () => {
    expect(itemNames(inferSets(orbFacts({item: 'Life Orb'}), DUAL_ABILITY))).toEqual(['Life Orb']);
  });
});

describe('inferSets', () => {
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
    expect(k.candidates[0]!.moves.find((m) => m.name === 'Hydro Pump')?.known).toBe(true);
  });

  it('falls back to a single unnamed set for role-less (older-gen) entries', () => {
    const entry: RandbatsEntry = {level: 80, abilities: ['Levitate'], items: ['Life Orb'], moves: ['Sludge Bomb', 'Flamethrower']};
    const k = inferSets(noivernFacts(), entry);
    expect(k.totalRoles).toBe(0);
    expect(names(k)).toEqual(['']);
    expect(k.candidates[0]!.moves.map((m) => m.name)).toEqual(['Sludge Bomb', 'Flamethrower']);
    expect(k.candidates[0]!.items).toEqual([{name: 'Life Orb', known: false}]);
  });
});
