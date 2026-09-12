import {describe, it, expect} from 'vitest';
import {itemsUnderRevealedMoveRules, movesUnderSettledMoveRuleItem, itemsUnderGutsOrFacade} from './moveitems.js';
import {liveFacts} from './sets.testfixtures.js';

describe('itemsUnderRevealedMoveRules — the item pool narrowed by the move', () => {
  it('forces Heavy-Duty Boots once Court Change is revealed', () => {
    const facts = liveFacts({revealedMoves: ['Court Change']});
    expect(itemsUnderRevealedMoveRules(
      ['Choice Band', 'Heavy-Duty Boots'], ['Choice Band', 'Heavy-Duty Boots'], facts, [],
    )).toEqual(['Heavy-Duty Boots']);
  });

  it('forces Sitrus Berry on either Belly Drum or Fillet Away', () => {
    for (const move of ['Belly Drum', 'Fillet Away']) {
      const facts = liveFacts({revealedMoves: [move]});
      expect(itemsUnderRevealedMoveRules(
        ['Sitrus Berry', 'Choice Band'], ['Sitrus Berry', 'Choice Band'], facts, [],
      ), move).toEqual(['Sitrus Berry']);
    }
  });

  it('stays quiet for Belly Drum while the known ability is the measured Ice Face excuse', () => {
    const facts = liveFacts({revealedMoves: ['Belly Drum'], baseAbility: 'Ice Face'});
    const pool = ['Sitrus Berry', 'Salac Berry'];
    expect(itemsUnderRevealedMoveRules(pool, pool, facts, ['Ice Face'])).toEqual(pool);
  });

  it('never lies while the hidden ability could still be Ice Face', () => {
    const facts = liveFacts({revealedMoves: ['Belly Drum']});
    const pool = ['Sitrus Berry', 'Salac Berry'];
    expect(itemsUnderRevealedMoveRules(pool, pool, facts, ['Sturdy', 'Ice Face'])).toEqual(pool);
  });

  it('forces Power Herb on Meteor Beam', () => {
    const facts = liveFacts({revealedMoves: ['Meteor Beam']});
    expect(itemsUnderRevealedMoveRules(['Power Herb', 'Life Orb'], ['Power Herb', 'Life Orb'], facts, []))
      .toEqual(['Power Herb']);
  });

  it('forces White Herb on Shell Smash, excused by Weak Armor or Solid Rock', () => {
    const pool = ['White Herb', 'Life Orb'];
    for (const ability of ['Weak Armor', 'Solid Rock']) {
      const facts = liveFacts({revealedMoves: ['Shell Smash'], baseAbility: ability});
      expect(itemsUnderRevealedMoveRules(pool, pool, facts, [ability]), ability).toEqual(pool);
    }
    const shellSmash = liveFacts({revealedMoves: ['Shell Smash'], baseAbility: 'Sturdy'});
    expect(itemsUnderRevealedMoveRules(pool, pool, shellSmash, ['Sturdy'])).toEqual(['White Herb']);
  });

  it('keeps a Mega stone already in the pool alongside White Herb, unlike every other item', () => {
    // The generator's own `species.requiredItems` outranks the Shell Smash branch, so a
    // Mega-capable role sometimes keeps its stone instead — Barbaracle/Barbaracite,
    // measured in `scripts/move-item-exclusions.mjs`.
    const facts = liveFacts({revealedMoves: ['Shell Smash'], baseAbility: 'Tough Claws'});
    const pool = ['White Herb', 'Life Orb', 'Barbaracite'];
    expect(itemsUnderRevealedMoveRules(pool, pool, facts, ['Tough Claws'])).toEqual(['White Herb', 'Barbaracite']);
  });

  it('keeps a Mega stone already in the pool alongside Light Clay too', () => {
    const facts = liveFacts({revealedMoves: ['Aurora Veil'], baseAbility: 'Snow Warning'});
    const pool = ['Light Clay', 'Abomasite'];
    expect(itemsUnderRevealedMoveRules(pool, pool, facts, ['Snow Warning'])).toEqual(['Light Clay', 'Abomasite']);
  });

  it('never empties the pool — a role whose declared items never held the forced item stays as it was', () => {
    // The shape a species/evolution-stage carve-out takes for these laws too: the forcing
    // genuinely does not apply to a role that never had the item to force.
    const facts = liveFacts({revealedMoves: ['Court Change']});
    expect(itemsUnderRevealedMoveRules(['Leftovers'], ['Leftovers'], facts, [])).toEqual(['Leftovers']);
  });

  it('says nothing while none of these moves has been revealed', () => {
    const facts = liveFacts({revealedMoves: ['Psychic']});
    const pool = ['Choice Band', 'Heavy-Duty Boots'];
    expect(itemsUnderRevealedMoveRules(pool, pool, facts, [])).toEqual(pool);
  });
});

describe('movesUnderSettledMoveRuleItem — the moves narrowed by the item', () => {
  it('drops Court Change once the item settles away from Heavy-Duty Boots', () => {
    const facts = liveFacts();
    const movePool = ['Court Change', 'Spikes', 'Stealth Rock'];
    expect(movesUnderSettledMoveRuleItem(movePool, ['Heavy-Duty Boots', 'Choice Band'], ['Choice Band'], facts, []))
      .toEqual(['Spikes', 'Stealth Rock']);
  });

  it('keeps Court Change while Heavy-Duty Boots is still a live possibility', () => {
    const facts = liveFacts();
    const movePool = ['Court Change', 'Spikes'];
    const items = ['Heavy-Duty Boots', 'Choice Band'];
    expect(movesUnderSettledMoveRuleItem(movePool, items, items, facts, [])).toEqual(movePool);
  });

  it('keeps Shell Smash when the item settles on a Mega stone, not just White Herb', () => {
    const facts = liveFacts({baseAbility: 'Tough Claws'});
    const movePool = ['Shell Smash', 'Rock Slide'];
    expect(movesUnderSettledMoveRuleItem(movePool, ['White Herb', 'Barbaracite'], ['Barbaracite'], facts, ['Tough Claws']))
      .toEqual(movePool);
  });

  it('keeps Belly Drum while the known ability excuses the forcing (Ice Face)', () => {
    const facts = liveFacts({baseAbility: 'Ice Face'});
    const movePool = ['Belly Drum', 'Icicle Crash'];
    expect(movesUnderSettledMoveRuleItem(movePool, ['Sitrus Berry', 'Salac Berry'], ['Salac Berry'], facts, ['Ice Face']))
      .toEqual(movePool);
  });

  it('keeps the move when the declared pool never held the forced item in the first place', () => {
    const facts = liveFacts();
    const movePool = ['Court Change', 'Spikes'];
    expect(movesUnderSettledMoveRuleItem(movePool, ['Leftovers'], ['Leftovers'], facts, [])).toEqual(movePool);
  });

  it('says nothing while the item pool is empty (nothing settled)', () => {
    const facts = liveFacts();
    const movePool = ['Court Change', 'Spikes'];
    expect(movesUnderSettledMoveRuleItem(movePool, ['Heavy-Duty Boots'], [], facts, [])).toEqual(movePool);
  });
});

describe('itemsUnderGutsOrFacade — the item pool narrowed by Guts or Facade', () => {
  const STATS = {hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80};
  const FLAME_TYPE = {baseStats: STATS, types: ['Fire']};
  const NORMAL_TYPE = {baseStats: STATS, types: ['Normal']};

  it('narrows to Toxic Orb for a Fire-type Facade user, type read off the species', () => {
    const facts = liveFacts({revealedMoves: ['Facade'], speciesData: FLAME_TYPE});
    const pool = ['Toxic Orb', 'Flame Orb', 'Life Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Facade'], facts, [])).toEqual(['Toxic Orb']);
  });

  it('narrows to Flame Orb for a non-Fire Facade user with a known non-Toxic-Boost ability', () => {
    const facts = liveFacts({revealedMoves: ['Facade'], speciesData: NORMAL_TYPE, baseAbility: 'Guts'});
    const pool = ['Toxic Orb', 'Flame Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Facade'], facts, ['Guts'])).toEqual(['Flame Orb']);
  });

  it('narrows to Toxic Orb when the known ability is Toxic Boost, regardless of type', () => {
    const facts = liveFacts({revealedMoves: ['Facade'], speciesData: NORMAL_TYPE, baseAbility: 'Toxic Boost'});
    const pool = ['Toxic Orb', 'Flame Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Facade'], facts, ['Toxic Boost'])).toEqual(['Toxic Orb']);
  });

  it('triggers on the ABILITY alone — Guts needs no move at all', () => {
    const facts = liveFacts({baseAbility: 'Guts', speciesData: NORMAL_TYPE});
    const pool = ['Flame Orb', 'Life Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, [], facts, ['Guts'])).toEqual(['Flame Orb']);
  });

  it('keeps both orbs live while type is unknown and the ability is hidden', () => {
    const facts = liveFacts({revealedMoves: ['Facade']});
    const pool = ['Toxic Orb', 'Flame Orb', 'Life Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Facade'], facts, [])).toEqual(['Toxic Orb', 'Flame Orb']);
  });

  it('keeps both orbs live while Toxic Boost is still a possible ability for this role', () => {
    const facts = liveFacts({revealedMoves: ['Facade'], speciesData: NORMAL_TYPE});
    const pool = ['Toxic Orb', 'Flame Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Facade'], facts, ['Toxic Boost', 'Guts'])).toEqual(pool);
  });

  it('stays quiet for Poison Heal/Quick Feet — they reach Toxic Orb a different way', () => {
    for (const ability of ['Poison Heal', 'Quick Feet']) {
      const facts = liveFacts({revealedMoves: ['Facade'], speciesData: NORMAL_TYPE, baseAbility: ability});
      const pool = ['Toxic Orb', 'Flame Orb'];
      expect(itemsUnderGutsOrFacade(pool, pool, ['Facade'], facts, [ability]), ability).toEqual(pool);
    }
  });

  it('stays quiet when the role could pair Facade with Sleep Talk instead', () => {
    const facts = liveFacts({revealedMoves: ['Facade'], speciesData: NORMAL_TYPE});
    const pool = ['Toxic Orb', 'Flame Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Facade', 'Sleep Talk'], facts, [])).toEqual(pool);
  });

  it('never empties the pool — a role whose declared items never held either orb stays as it was', () => {
    const facts = liveFacts({revealedMoves: ['Facade'], speciesData: NORMAL_TYPE, baseAbility: 'Guts'});
    expect(itemsUnderGutsOrFacade(['Eviolite'], ['Eviolite'], ['Facade'], facts, ['Guts'])).toEqual(['Eviolite']);
  });

  it('says nothing while neither Guts nor Facade is in evidence', () => {
    const facts = liveFacts({revealedMoves: ['Return'], speciesData: NORMAL_TYPE});
    const pool = ['Toxic Orb', 'Flame Orb'];
    expect(itemsUnderGutsOrFacade(pool, pool, ['Return'], facts, [])).toEqual(pool);
  });
});
