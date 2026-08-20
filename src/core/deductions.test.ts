import {describe, it, expect} from 'vitest';
import {survivingItems} from './deductions.js';
import {liveFacts} from './sets.testfixtures.js';

// survivingItems(abilities, items, facts) is the deduction layer's whole public surface:
// given a role's ability pool and item pool, which items survive the behavioural rule-outs
// (and the Boots rule-in). Tested directly here with minimal hand-built facts.

describe('Life Orb rule-out (no recoil after a landed hit ⇒ not holding it)', () => {
  const pool = ['Life Orb', 'Choice Band'];

  it('removes Life Orb after a landed hit with a non-suppressing known ability', () => {
    const facts = liveFacts({landedDamagingHit: true, baseAbility: 'Overgrow'});
    expect(survivingItems(['Overgrow'], pool, facts)).toEqual(['Choice Band']);
  });

  it('keeps Life Orb when the known ability suppresses the recoil (Sheer Force / Magic Guard)', () => {
    for (const a of ['Sheer Force', 'Magic Guard']) {
      const facts = liveFacts({landedDamagingHit: true, baseAbility: a});
      expect(survivingItems([a], pool, facts)).toEqual(pool);
    }
  });

  it('never lies: keeps Life Orb while the ability is hidden and the pool could be Sheer Force', () => {
    const facts = liveFacts({landedDamagingHit: true}); // ability unknown
    expect(survivingItems(['Overgrow', 'Sheer Force'], pool, facts)).toEqual(pool);
  });

  it('does nothing without a landed hit, or once an item is already revealed', () => {
    expect(survivingItems(['Overgrow'], pool, liveFacts({landedDamagingHit: false}))).toEqual(pool);
    expect(survivingItems(['Overgrow'], pool, liveFacts({landedDamagingHit: true, item: 'Choice Band'}))).toEqual(pool);
  });
});

describe('Heavy-Duty Boots rule-out (took hazard damage ⇒ not holding them)', () => {
  const pool = ['Heavy-Duty Boots', 'Leftovers'];

  it('removes Heavy-Duty Boots once the mon has taken entry-hazard damage', () => {
    expect(survivingItems(['Overgrow'], pool, liveFacts({tookEntryHazardDamage: true}))).toEqual(['Leftovers']);
  });

  it('needs no ability guard — taking the damage also excludes Magic Guard', () => {
    // Even a could-be-Magic-Guard pool: if it TOOK the damage, it has neither Boots nor MG.
    expect(survivingItems(['Magic Guard', 'Overgrow'], pool, liveFacts({tookEntryHazardDamage: true}))).toEqual(['Leftovers']);
  });
});

describe('Heavy-Duty Boots rule-in (dodged Stealth Rock ⇒ holding them)', () => {
  const pool = ['Heavy-Duty Boots', 'Leftovers'];

  it('pins the pool to Boots when the mon switched into Stealth Rock unharmed', () => {
    const facts = liveFacts({switchedIntoStealthRockUnharmed: true, baseAbility: 'Overgrow'});
    expect(survivingItems(['Overgrow'], pool, facts)).toEqual(['Heavy-Duty Boots']);
  });

  it('never lies: does not pin while the ability is hidden and could be Magic Guard', () => {
    const facts = liveFacts({switchedIntoStealthRockUnharmed: true}); // ability unknown
    expect(survivingItems(['Magic Guard', 'Overgrow'], pool, facts)).toEqual(pool);
  });

  it('does not pin once an item is already revealed', () => {
    const facts = liveFacts({switchedIntoStealthRockUnharmed: true, baseAbility: 'Overgrow', item: 'Leftovers'});
    expect(survivingItems(['Overgrow'], pool, facts)).toEqual(pool);
  });
});

describe('Choice rule-out (two moves in one stint ⇒ not locked into one)', () => {
  const pool = ['Choice Band', 'Choice Specs', 'Choice Scarf', 'Life Orb'];
  const varied = (over = {}) => liveFacts({usedDifferentMovesSinceSwitchIn: true, ...over});

  it('removes all three Choice items at once — one lock, one deduction', () => {
    expect(survivingItems(['Good as Gold'], pool, varied({baseAbility: 'Good as Gold'}))).toEqual(['Life Orb']);
  });

  it('keeps them when the known ability is Klutz, which ignores the item entirely', () => {
    expect(survivingItems(['Klutz'], pool, varied({baseAbility: 'Klutz'}))).toEqual(pool);
  });

  it('never lies: keeps them while the ability is hidden and the pool could be Klutz', () => {
    expect(survivingItems(['Klutz', 'Limber'], pool, varied())).toEqual(pool);
  });

  it('does nothing without the signal, or once an item is revealed', () => {
    expect(survivingItems(['Good as Gold'], pool, liveFacts())).toEqual(pool);
    expect(survivingItems(['Good as Gold'], pool, varied({item: 'Choice Specs'}))).toEqual(pool);
    expect(survivingItems(['Good as Gold'], pool, varied({prevItem: 'Choice Specs'}))).toEqual(pool);
  });

  it('can empty a Choice-only pool, which is how `narrow` rules the ROLE out', () => {
    expect(survivingItems(['Good as Gold'], ['Choice Specs', 'Choice Scarf'], varied({baseAbility: 'Good as Gold'}))).toEqual([]);
  });
});

describe('Choice rule-out by set shape (a status move ⇒ never built with a Choice item)', () => {
  const pool = ['Choice Band', 'Choice Specs', 'Choice Scarf', 'Life Orb'];
  const used = (moves: string[], over = {}) => liveFacts({revealedStatusMoves: moves, ...over});

  it('removes all three on the FIRST status move, where the lock rule needs two', () => {
    expect(survivingItems(['Overgrow'], pool, used(['Calm Mind']))).toEqual(['Life Orb']);
  });

  it('needs no ability guard — Klutz excuses the lock, but not how the set was built', () => {
    expect(survivingItems(['Klutz'], pool, used(['Calm Mind'], {baseAbility: 'Klutz'}))).toEqual(['Life Orb']);
  });

  it('stays quiet for the status moves the generator DOES pair with a Choice item', () => {
    expect(survivingItems(['Overgrow'], pool, used(['Trick']))).toEqual(pool);
  });

  it('does nothing without the signal, or once an item is revealed', () => {
    expect(survivingItems(['Overgrow'], pool, liveFacts())).toEqual(pool);
    expect(survivingItems(['Overgrow'], pool, used(['Calm Mind'], {item: 'Choice Specs'}))).toEqual(pool);
    expect(survivingItems(['Overgrow'], pool, used(['Calm Mind'], {prevItem: 'Choice Specs'}))).toEqual(pool);
  });

  it('can empty a Choice-only pool, which is how `narrow` rules the ROLE out', () => {
    expect(survivingItems(['Overgrow'], ['Choice Specs', 'Choice Scarf'], used(['Calm Mind']))).toEqual([]);
  });
});

describe('Air Balloon rule-out (came in silently ⇒ not holding one)', () => {
  // The mirror of the rules above: the balloon announces itself on every switch-in, so
  // silence is the evidence. Heatran's real randbats pool is exactly this two-item pair,
  // which is why the rule-out PINS the item rather than merely shortening a list.
  const pool = ['Air Balloon', 'Assault Vest'];
  const silent = (over = {}) => liveFacts({switchedInWithoutAnnouncingBalloon: true, ...over});

  it('removes Air Balloon after a switch-in that never announced one', () => {
    expect(survivingItems(['Flash Fire'], pool, silent({baseAbility: 'Flash Fire'}))).toEqual(['Assault Vest']);
  });

  it('keeps it when the known ability is Klutz, which silences the balloon and voids it', () => {
    expect(survivingItems(['Klutz'], pool, silent({baseAbility: 'Klutz'}))).toEqual(pool);
  });

  it('never lies: keeps it while the ability is hidden and the pool could be Klutz', () => {
    expect(survivingItems(['Klutz', 'Limber'], pool, silent())).toEqual(pool);
  });

  it('does nothing without the signal, or once an item is revealed', () => {
    expect(survivingItems(['Flash Fire'], pool, liveFacts())).toEqual(pool);
    expect(survivingItems(['Flash Fire'], pool, silent({item: 'Air Balloon'}))).toEqual(pool);
    expect(survivingItems(['Flash Fire'], pool, silent({prevItem: 'Air Balloon'}))).toEqual(pool);
  });

  it('is independent of the other rules — one silent switch-in touches only the balloon', () => {
    const facts = silent({baseAbility: 'Flash Fire'});
    expect(survivingItems(['Flash Fire'], ['Air Balloon', 'Life Orb', 'Choice Band'], facts))
      .toEqual(['Life Orb', 'Choice Band']);
  });
});

describe('Booster Energy rule-out (Paradox ability quiet at switch-in ⇒ not holding it)', () => {
  // Another self-announcing item, read through the ABILITY's own activation line rather than
  // one of its own: Quark Drive/Protosynthesis checks its field condition unconditionally on
  // every switch-in, so silence there already proves neither terrain/weather nor Booster
  // Energy armed it.
  const pool = ['Booster Energy', 'Life Orb'];
  const quiet = (over = {}) => liveFacts({switchedInWithoutBoosterActivation: true, ...over});

  it('removes Booster Energy after a switch-in whose Paradox ability stayed quiet', () => {
    expect(survivingItems(['Quark Drive'], pool, quiet({baseAbility: 'Quark Drive'}))).toEqual(['Life Orb']);
    expect(survivingItems(['Protosynthesis'], pool, quiet({baseAbility: 'Protosynthesis'}))).toEqual(['Life Orb']);
  });

  it('does nothing for a role that could not run either Paradox ability', () => {
    // No `noExcuse` guard here: unlike Life Orb's recoil, no OTHER ability could explain the
    // silence away — Quark Drive/Protosynthesis IS the ability being checked. The gate is
    // instead whether the role could run one of them at all.
    expect(survivingItems(['Levitate'], pool, quiet({baseAbility: 'Levitate'}))).toEqual(pool);
  });

  it('applies while the ability is unrevealed but the role has only one, fixed ability', () => {
    // Paradox species carry exactly one ability, so there is no hidden-ability escape the way
    // Sheer Force excuses Life Orb — an unrevealed ability the role could only be Quark Drive
    // still rules the item out.
    expect(survivingItems(['Quark Drive'], pool, quiet())).toEqual(['Life Orb']);
  });

  it('does nothing without the signal, or once an item is revealed', () => {
    expect(survivingItems(['Quark Drive'], pool, liveFacts({baseAbility: 'Quark Drive'}))).toEqual(pool);
    expect(survivingItems(['Quark Drive'], pool, quiet({item: 'Booster Energy'}))).toEqual(pool);
    expect(survivingItems(['Quark Drive'], pool, quiet({prevItem: 'Booster Energy'}))).toEqual(pool);
  });

  it('is independent of the other rules — one quiet switch-in touches only Booster Energy', () => {
    const facts = quiet({baseAbility: 'Quark Drive'});
    expect(survivingItems(['Quark Drive'], ['Booster Energy', 'Choice Scarf', 'Life Orb'], facts))
      .toEqual(['Choice Scarf', 'Life Orb']);
  });
});

describe('status-orb rule-out (a turn ended un-statused ⇒ holding neither orb)', () => {
  // The balloon's rule read silence at one moment; this reads it at one that comes round
  // every turn. Ursaring's real randbats pool is this pair, one role per item, so the
  // rule-out settles which of the two sets is on the field.
  const pool = ['Toxic Orb', 'Eviolite'];
  const quiet = (over = {}) => liveFacts({endedTurnUnstatused: true, ...over});

  it('removes both orbs at once — one clean turn is silence from either', () => {
    expect(survivingItems(['Guts'], ['Flame Orb', 'Toxic Orb', 'Leftovers'], quiet({baseAbility: 'Guts'})))
      .toEqual(['Leftovers']);
  });

  it('narrows a two-role species to the role that is not orb-fed', () => {
    expect(survivingItems(['Quick Feet'], pool, quiet({baseAbility: 'Quick Feet'}))).toEqual(['Eviolite']);
  });

  it('keeps them when the known ability would have swallowed the status', () => {
    // One per reason the sim refuses: the item ignored outright, every status refused,
    // burn refused, poison refused.
    for (const ability of ['Klutz', 'Purifying Salt', 'Water Veil', 'Pastel Veil']) {
      expect(survivingItems([ability], pool, quiet({baseAbility: ability}))).toEqual(pool);
    }
  });

  it('never lies: keeps them while the ability is hidden and the pool could excuse it', () => {
    expect(survivingItems(['Guts', 'Comatose'], pool, quiet())).toEqual(pool);
  });

  it('is not excused by an ability that refuses some OTHER status', () => {
    // Insomnia, Limber and Vital Spirit block sleep, paralysis and freeze — none of which
    // an orb inflicts, so they leave the deduction standing.
    for (const ability of ['Insomnia', 'Limber', 'Vital Spirit']) {
      expect(survivingItems([ability], pool, quiet({baseAbility: ability}))).toEqual(['Eviolite']);
    }
  });

  it('does nothing without the signal, or once an item is revealed', () => {
    expect(survivingItems(['Guts'], pool, liveFacts())).toEqual(pool);
    expect(survivingItems(['Guts'], pool, quiet({item: 'Toxic Orb'}))).toEqual(pool);
    expect(survivingItems(['Guts'], pool, quiet({prevItem: 'Toxic Orb'}))).toEqual(pool);
  });

  it('is independent of the other rules — a quiet turn touches only the orbs', () => {
    const facts = quiet({baseAbility: 'Guts'});
    expect(survivingItems(['Guts'], ['Flame Orb', 'Air Balloon', 'Life Orb'], facts))
      .toEqual(['Air Balloon', 'Life Orb']);
  });
});

describe('Leftovers rule-out (a damaged turn ended unhealed ⇒ not holding it)', () => {
  // Toedscruel's real gen9randombattle pool is this pair — the case that motivated the
  // rule: a special hit landed, the tooltip never collapsed the split, and the log already
  // showed the turn end with no Leftovers heal.
  const pool = ['Assault Vest', 'Leftovers'];
  const damaged = (over = {}) => liveFacts({endedTurnDamagedWithoutLeftoversHeal: true, ...over});

  it('drops Leftovers, narrowing a two-item pool to the other one', () => {
    expect(survivingItems([], pool, damaged())).toEqual(['Assault Vest']);
  });

  it('keeps it when the known ability would have swallowed the item outright', () => {
    expect(survivingItems(['Klutz'], pool, damaged({baseAbility: 'Klutz'}))).toEqual(pool);
  });

  it('never lies: keeps it while the ability is hidden and the pool could excuse it', () => {
    expect(survivingItems(['Guts', 'Klutz'], pool, damaged())).toEqual(pool);
  });

  it('does nothing without the signal, at full HP, or once an item is revealed', () => {
    expect(survivingItems([], pool, liveFacts())).toEqual(pool);
    expect(survivingItems([], pool, damaged({item: 'Leftovers'}))).toEqual(pool);
    expect(survivingItems([], pool, damaged({prevItem: 'Leftovers'}))).toEqual(pool);
  });

  it('is independent of the other rules — a damaged silent turn touches only Leftovers', () => {
    const facts = damaged();
    expect(survivingItems([], ['Air Balloon', 'Life Orb', 'Leftovers'], facts))
      .toEqual(['Air Balloon', 'Life Orb']);
  });
});
