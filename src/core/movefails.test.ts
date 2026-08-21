import {describe, expect, it} from 'vitest';
import {moveFailsOutright, targetsOpponent, type MoveFailInput} from './movefails.js';

const move = (overrides: Partial<MoveFailInput['move']> = {}): MoveFailInput['move'] => ({
  id: 'Thunder Wave',
  target: 'normal',
  isSound: false,
  type: 'Electric',
  ...overrides,
});

const defender = (overrides: Partial<MoveFailInput['defender']> = {}): MoveFailInput['defender'] => ({
  types: ['Water'],
  status: undefined,
  substitute: undefined,
  ...overrides,
});

const base = (overrides: Partial<MoveFailInput> = {}): MoveFailInput => ({
  move: move(),
  defender: defender(),
  attackerAbility: undefined,
  moveTypeEffectiveness: 1,
  ...overrides,
});

describe('targetsOpponent', () => {
  it('accepts the opponent-directed targets', () => {
    for (const t of ['normal', 'any', 'randomNormal', 'adjacentFoe', 'allAdjacentFoes']) {
      expect(targetsOpponent(t), t).toBe(true);
    }
  });

  it('rejects self and field/side targets', () => {
    for (const t of ['self', 'allySide', 'foeSide', 'all', 'adjacentAlly', 'adjacentAllyOrSelf', 'allies', 'allyTeam']) {
      expect(targetsOpponent(t), t).toBe(false);
    }
  });
});

describe('moveFailsOutright — never fires off-target', () => {
  it('says nothing for a self-targeting move, even with a Substitute up', () => {
    const input = base({
      move: move({id: 'Swords Dance', target: 'self', type: 'Normal'}),
      defender: defender({substitute: {dented: false}}),
    });
    expect(moveFailsOutright(input)).toBeNull();
  });

  it('says nothing for a field move', () => {
    const input = base({move: move({id: 'Stealth Rock', target: 'foeSide', type: 'Rock'})});
    expect(moveFailsOutright(input)).toBeNull();
  });
});

describe('moveFailsOutright — substitute', () => {
  it('blocks a status move behind a standing Substitute', () => {
    const input = base({defender: defender({substitute: {dented: false}})});
    expect(moveFailsOutright(input)).toEqual({kind: 'substitute'});
  });

  it('lets a sound move through the Substitute', () => {
    const input = base({
      move: move({id: 'Perish Song', isSound: true, type: 'Normal'}),
      defender: defender({substitute: {dented: false}}),
    });
    expect(moveFailsOutright(input)).toBeNull();
  });

  it('lets Infiltrator through the Substitute', () => {
    const input = base({
      defender: defender({substitute: {dented: false}}),
      attackerAbility: 'Infiltrator',
    });
    expect(moveFailsOutright(input)).toBeNull();
  });

  it('is checked before type immunity, so both being true still reports substitute', () => {
    const input = base({
      defender: defender({types: ['Ground'], substitute: {dented: false}}),
      moveTypeEffectiveness: 0,
    });
    expect(moveFailsOutright(input)).toEqual({kind: 'substitute'});
  });
});

describe('moveFailsOutright — type immunity', () => {
  it('reports the ordinary type-chart immunity, naming the move\'s own type', () => {
    const input = base({defender: defender({types: ['Ground']}), moveTypeEffectiveness: 0});
    expect(moveFailsOutright(input)).toEqual({kind: 'type-immune', immuneType: 'Electric'});
  });

  it('reports a status-type immunity even when the move\'s own type is neutral', () => {
    const input = base({defender: defender({types: ['Electric']})});
    expect(moveFailsOutright(input)).toEqual({kind: 'type-immune', immuneType: 'Electric'});
  });

  it('covers both types poison is immune against', () => {
    const toxic = move({id: 'Toxic', type: 'Poison'});
    expect(moveFailsOutright(base({move: toxic, defender: defender({types: ['Poison']})})))
      .toEqual({kind: 'type-immune', immuneType: 'Poison'});
    expect(moveFailsOutright(base({move: toxic, defender: defender({types: ['Normal', 'Steel']})})))
      .toEqual({kind: 'type-immune', immuneType: 'Steel'});
  });

  it('blocks a powder move on a Grass-type target', () => {
    const input = base({
      move: move({id: 'Sleep Powder', type: 'Grass'}),
      defender: defender({types: ['Grass']}),
    });
    expect(moveFailsOutright(input)).toEqual({kind: 'type-immune', immuneType: 'Grass'});
  });

  it('blocks Spore on a Grass-type target too — it carries the powder flag despite the common belief otherwise', () => {
    const input = base({move: move({id: 'Spore', type: 'Grass'}), defender: defender({types: ['Grass']})});
    expect(moveFailsOutright(input)).toEqual({kind: 'type-immune', immuneType: 'Grass'});
  });

  it('blocks Leech Seed on a Grass-type target by its own named immunity', () => {
    const input = base({
      move: move({id: 'Leech Seed', type: 'Grass'}),
      defender: defender({types: ['Grass']}),
    });
    expect(moveFailsOutright(input)).toEqual({kind: 'type-immune', immuneType: 'Grass'});
  });
});

describe('moveFailsOutright — already statused', () => {
  it('fails a status move against a target already carrying a status', () => {
    const input = base({defender: defender({status: 'brn'})});
    expect(moveFailsOutright(input)).toEqual({kind: 'already-statused', existing: 'brn'});
  });

  it('does not apply to a move with no catalogued status effect', () => {
    const input = base({move: move({id: 'Growl', type: 'Normal'}), defender: defender({status: 'brn'})});
    expect(moveFailsOutright(input)).toBeNull();
  });
});

describe('moveFailsOutright — an uncatalogued move says nothing', () => {
  it('never guesses for a status move this table has no data on', () => {
    const input = base({move: move({id: 'Some New Move', type: 'Normal'})});
    expect(moveFailsOutright(input)).toBeNull();
  });
});
