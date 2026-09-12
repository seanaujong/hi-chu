import {describe, it, expect} from 'vitest';
import {itemsUnderRevealedRest, movesUnderNonChestoItem} from './restitem.js';
import {liveFacts} from './sets.testfixtures.js';

// Carbink's real gen9randombattle role: Body Press, Iron Defense, Moonblast, Rest, Rock
// Polish, no Sleep Talk anywhere in the pool, items Chesto Berry or Leftovers, ability
// Clear Body or Sturdy — neither an excuse. The clean case this law was written for.
const CARBINK_MOVES = ['Body Press', 'Iron Defense', 'Moonblast', 'Rest', 'Rock Polish'];
const CARBINK_ITEMS = ['Chesto Berry', 'Leftovers'];
const CARBINK_ABILITIES = ['Clear Body', 'Sturdy'];

describe('itemsUnderRevealedRest — the item narrowed by Rest', () => {
  it('narrows to Chesto Berry once Rest is revealed', () => {
    const facts = liveFacts({revealedMoves: ['Rest']});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, CARBINK_ITEMS, CARBINK_MOVES, facts, CARBINK_ABILITIES))
      .toEqual(['Chesto Berry']);
  });

  it('says nothing while Rest has not been revealed', () => {
    const facts = liveFacts({revealedMoves: ['Moonblast']});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, CARBINK_ITEMS, CARBINK_MOVES, facts, CARBINK_ABILITIES))
      .toEqual(CARBINK_ITEMS);
  });

  it('stays quiet when the role could pair Rest with Sleep Talk instead', () => {
    const pool = [...CARBINK_MOVES, 'Sleep Talk'];
    const facts = liveFacts({revealedMoves: ['Rest']});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, CARBINK_ITEMS, pool, facts, CARBINK_ABILITIES))
      .toEqual(CARBINK_ITEMS);
  });

  it('stays quiet when Chesto Berry was never a live possibility for this role', () => {
    // Stands in for Giratina/an NFE species: the generator carves them out before it ever
    // reaches the Chesto-forcing branch, so their declared pool never contains it.
    const facts = liveFacts({revealedMoves: ['Rest']});
    expect(itemsUnderRevealedRest(['Leftovers'], ['Leftovers'], CARBINK_MOVES, facts, CARBINK_ABILITIES))
      .toEqual(['Leftovers']);
  });

  it('stays quiet while the known ability excuses the forcing', () => {
    const facts = liveFacts({revealedMoves: ['Rest'], baseAbility: 'Natural Cure'});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, CARBINK_ITEMS, CARBINK_MOVES, facts, ['Natural Cure']))
      .toEqual(CARBINK_ITEMS);
  });

  it('never lies while the hidden ability could still be an excuse', () => {
    const facts = liveFacts({revealedMoves: ['Rest']});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, CARBINK_ITEMS, CARBINK_MOVES, facts, ['Sturdy', 'Shed Skin']))
      .toEqual(CARBINK_ITEMS);
  });

  it('narrows once the known ability rules the excuse out', () => {
    const facts = liveFacts({revealedMoves: ['Rest'], baseAbility: 'Sturdy'});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, CARBINK_ITEMS, CARBINK_MOVES, facts, ['Sturdy', 'Shed Skin']))
      .toEqual(['Chesto Berry']);
  });

  it('never empties the pool even if Chesto Berry has already been filtered out upstream', () => {
    const facts = liveFacts({revealedMoves: ['Rest']});
    expect(itemsUnderRevealedRest(CARBINK_ITEMS, ['Leftovers'], CARBINK_MOVES, facts, CARBINK_ABILITIES))
      .toEqual(['Leftovers']);
  });
});

describe('movesUnderNonChestoItem — the moves narrowed by the item', () => {
  it('drops Rest once the surviving item pool has settled away from Chesto Berry', () => {
    const facts = liveFacts();
    expect(movesUnderNonChestoItem(CARBINK_MOVES, CARBINK_ITEMS, ['Leftovers'], facts, CARBINK_ABILITIES))
      .toEqual(['Body Press', 'Iron Defense', 'Moonblast', 'Rock Polish']);
  });

  it('keeps Rest while Chesto Berry is still a live possibility', () => {
    const facts = liveFacts();
    expect(movesUnderNonChestoItem(CARBINK_MOVES, CARBINK_ITEMS, CARBINK_ITEMS, facts, CARBINK_ABILITIES))
      .toEqual(CARBINK_MOVES);
  });

  it('keeps Rest when the role could pair it with Sleep Talk instead', () => {
    const pool = [...CARBINK_MOVES, 'Sleep Talk'];
    const facts = liveFacts();
    expect(movesUnderNonChestoItem(pool, CARBINK_ITEMS, ['Leftovers'], facts, CARBINK_ABILITIES))
      .toEqual(pool);
  });

  it('keeps Rest when Chesto Berry was never a live possibility for this role (Giratina/NFE shape)', () => {
    const facts = liveFacts();
    expect(movesUnderNonChestoItem(CARBINK_MOVES, ['Leftovers'], ['Leftovers'], facts, CARBINK_ABILITIES))
      .toEqual(CARBINK_MOVES);
  });

  it('keeps Rest while the known ability excuses the forcing', () => {
    const facts = liveFacts({baseAbility: 'Shed Skin'});
    expect(movesUnderNonChestoItem(CARBINK_MOVES, CARBINK_ITEMS, ['Leftovers'], facts, ['Shed Skin']))
      .toEqual(CARBINK_MOVES);
  });

  it('never lies while the hidden ability could still be an excuse', () => {
    const facts = liveFacts();
    expect(movesUnderNonChestoItem(CARBINK_MOVES, CARBINK_ITEMS, ['Leftovers'], facts, ['Sturdy', 'Natural Cure']))
      .toEqual(CARBINK_MOVES);
  });

  it('says nothing once the item pool is empty (nothing settled)', () => {
    const facts = liveFacts();
    expect(movesUnderNonChestoItem(CARBINK_MOVES, CARBINK_ITEMS, [], facts, CARBINK_ABILITIES)).toEqual(CARBINK_MOVES);
  });
});
