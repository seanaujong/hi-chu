import {describe, it, expect} from 'vitest';
import {CHOICE_ITEMS, isChoiceItem, choiceRuledOutByStatusMoves, movesUnderChoiceItem} from './choiceitems.js';

// The shell reads a move's category off the client dex; here a small table stands in for
// it, so these tests state the law rather than Showdown's move data.
const STATUS = new Set([
  'Swords Dance', 'Calm Mind', 'Nasty Plot', 'Dragon Dance', 'Bulk Up', 'Agility',
  'Protect', 'Substitute', 'Roost', 'Toxic', 'Taunt', 'Stealth Rock',
  'Trick', 'Switcheroo', 'Healing Wish', 'Transform', 'Nature Power', 'Baton Pass', 'Parting Shot',
]);
const isStatusMove = (name: string) => STATUS.has(name);

describe('isChoiceItem', () => {
  it('names the three, by display name or id', () => {
    expect(['Choice Band', 'Choice Specs', 'Choice Scarf'].every(isChoiceItem)).toBe(true);
    expect(CHOICE_ITEMS.every(isChoiceItem)).toBe(true);
  });

  it('is not fooled by the other items a set might hold', () => {
    expect(['Life Orb', 'Leftovers', 'Assault Vest', 'Heavy-Duty Boots'].some(isChoiceItem)).toBe(false);
  });
});

describe('choiceRuledOutByStatusMoves — the item read off the moves', () => {
  it('rules the Choice items out on a single setup move', () => {
    // The replay this rule came from: Espathra clicks Calm Mind on turn one, and its
    // Choice Specs role cannot be what we are looking at.
    expect(choiceRuledOutByStatusMoves(['Calm Mind'])).toBe(true);
  });

  it('rules them out on any other status move too — setup is not the special case', () => {
    for (const move of ['Protect', 'Substitute', 'Roost', 'Toxic', 'Taunt', 'Stealth Rock']) {
      expect(choiceRuledOutByStatusMoves([move]), move).toBe(true);
    }
  });

  it('stays quiet for the seven the generator DOES pair with a Choice item', () => {
    for (const move of ['Trick', 'Switcheroo', 'Healing Wish', 'Transform', 'Nature Power', 'Baton Pass', 'Parting Shot']) {
      expect(choiceRuledOutByStatusMoves([move]), move).toBe(false);
    }
  });

  it('needs only ONE unexcused move — a Trick set that also Protects is still ruled out', () => {
    expect(choiceRuledOutByStatusMoves(['Trick', 'Protect'])).toBe(true);
  });

  it('says nothing when nothing status has been seen', () => {
    expect(choiceRuledOutByStatusMoves([])).toBe(false);
  });
});

describe('movesUnderChoiceItem — the moves read off the item', () => {
  const URSHIFU = ['Close Combat', 'Surging Strikes', 'U-turn', 'Aqua Jet', 'Ice Spinner', 'Swords Dance'];

  it('drops the setup move a revealed Choice Band forbids, keeping every attack', () => {
    // The other half of the same replay: Knock Off exposes Urshifu-Rapid-Strike's Choice
    // Band, so the Swords Dance still sitting in its role's pool is no longer possible.
    expect(movesUnderChoiceItem(URSHIFU, isStatusMove)).toEqual([
      'Close Combat', 'Surging Strikes', 'U-turn', 'Aqua Jet', 'Ice Spinner',
    ]);
  });

  it('keeps the seven, so a Choice Scarf Incineroar can still Parting Shot', () => {
    expect(movesUnderChoiceItem(['Flare Blitz', 'Parting Shot', 'Protect'], isStatusMove))
      .toEqual(['Flare Blitz', 'Parting Shot']);
  });

  it('leaves a pool of pure attacks untouched', () => {
    const attacks = ['Close Combat', 'Surging Strikes', 'U-turn', 'Aqua Jet'];
    expect(movesUnderChoiceItem(attacks, isStatusMove)).toEqual(attacks);
  });

  it('cannot classify what the dex does not know, and so narrows nothing', () => {
    // An unclassified move is not evidence that it is an attack — the same "never lie"
    // preference the deductions layer states, one direction over.
    expect(movesUnderChoiceItem(URSHIFU, () => false)).toEqual(URSHIFU);
  });
});
