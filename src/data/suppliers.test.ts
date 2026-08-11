import {describe, it, expect} from 'vitest';
import {
  entryFor,
  entryOrMinimal,
  illusionVariants,
  megaCandidatesFor,
  randbatsFoeVariants,
  randbatsIncomingMovesFor,
  randbatsVariantsFor,
} from './suppliers.js';
import {liveFacts} from '../core/sets.testfixtures.js';
import type {RandbatsData} from '../core/types.js';

const feed = {
  Weavile: {
    level: 78,
    abilities: ['Pressure'],
    items: ['Choice Band', 'Heavy-Duty Boots'],
    roles: {'Fast Attacker': {abilities: ['Pressure'], items: ['Choice Band', 'Heavy-Duty Boots'], moves: ['Icicle Crash', 'Knock Off']}},
  },
  Zoroark: {
    level: 84,
    abilities: ['Illusion'],
    items: ['Choice Specs'],
    roles: {'Fast Attacker': {abilities: ['Illusion'], items: ['Choice Specs'], moves: ['Dark Pulse', 'Sludge Bomb']}},
  },
  Blissey: {level: 50, abilities: ['Natural Cure'], items: ['Leftovers']},
  Gardevoir: {level: 84, abilities: ['Trace'], items: ['Gardevoirite']},
  'Gardevoir-Mega': {level: 80, abilities: ['Pixilate'], items: ['Gardevoirite']},
} as unknown as RandbatsData;

const isStatusMove = (name: string) => name === 'Nasty Plot';

describe('entryFor / entryOrMinimal', () => {
  it('finds a species entry, and falls back to a minimal one the calc can still use', () => {
    const known = liveFacts({speciesForme: 'Weavile', level: 78});
    expect(entryFor(feed, known)?.level).toBe(78);

    const stranger = liveFacts({speciesForme: 'Notamon', level: 61});
    expect(entryFor(feed, stranger)).toBeUndefined();
    // The fallback carries the LIVE level — a default spread, not a default Pokémon.
    expect(entryOrMinimal(undefined, stranger)).toEqual({level: 61, abilities: [], items: []});
  });
});

describe('randbatsVariantsFor — the feed-driven DefenderVariantsFor', () => {
  it('hands back the same pool whatever move is asked about', () => {
    // The property that separates it from the open-format adapter, whose variants depend on
    // the move's category: a feed knows the sets outright, so the move is irrelevant.
    const forFacts = randbatsVariantsFor(feed)(liveFacts({speciesForme: 'Weavile', level: 78}));
    expect(forFacts('Icicle Crash')).toBe(forFacts('Knock Off'));
  });

  it('fans a hidden item out into one variant per possibility', () => {
    const variants = randbatsFoeVariants(feed, liveFacts({speciesForme: 'Weavile', level: 78}));
    expect(variants.map((v) => v.mon.item).sort()).toEqual(['Choice Band', 'Heavy-Duty Boots']);
  });

  it('collapses to the revealed item once it is known', () => {
    const variants = randbatsFoeVariants(feed, liveFacts({speciesForme: 'Weavile', level: 78, item: 'Choice Band'}));
    expect(variants.map((v) => v.mon.item)).toEqual(['Choice Band']);
  });
});

describe('illusionVariants', () => {
  it('adds the suspected Zoroark as ITS OWN species, at ITS OWN level', () => {
    // A Weavile that has used a move only Zoroark's sets carry. The suspect must resolve as
    // Zoroark — not as a Weavile wearing Zoroark's moves.
    const facts = liveFacts({speciesForme: 'Weavile', level: 78, revealedMoves: ['Sludge Bomb']});
    const suspects = illusionVariants(facts, entryFor(feed, facts), feed);
    expect(suspects.map((v) => [v.role, v.mon.speciesForme, v.mon.level])).toEqual([['Zoroark', 'Zoroark', 84]]);
  });

  it('suspects nothing when the moves fit the species on screen', () => {
    const facts = liveFacts({speciesForme: 'Weavile', level: 78, revealedMoves: ['Icicle Crash']});
    expect(illusionVariants(facts, entryFor(feed, facts), feed)).toEqual([]);
  });
});

describe('megaCandidatesFor', () => {
  const base = liveFacts({speciesForme: 'Gardevoir', level: 84});

  it('offers the Mega forme while the item is still unknown', () => {
    // Stated first so the rule-outs below mean something: without this the empty results
    // could just as well be a feed with no Mega in it.
    expect(megaCandidatesFor(feed, base).map((m) => m.forme)).toEqual(['Gardevoir-Mega']);
  });

  it('rules the evolution out once the item is settled, either way', () => {
    // A revealed item that is not a stone, and an item already lost, both close the door.
    expect(megaCandidatesFor(feed, {...base, item: 'Leftovers'})).toEqual([]);
    expect(megaCandidatesFor(feed, {...base, prevItem: 'Leftovers'})).toEqual([]);
  });
});

describe('randbatsIncomingMovesFor — the feed-driven IncomingMovesFor', () => {
  it('pairs each still-possible move with the variants that could carry it', () => {
    const incoming = randbatsIncomingMovesFor(feed, isStatusMove)(liveFacts({speciesForme: 'Weavile', level: 78}));
    expect(incoming.map((i) => i.move).sort()).toEqual(['Icicle Crash', 'Knock Off']);
    // Both items are still live, so every move carries the full fan-out rather than a
    // first-guessed representative.
    expect(incoming.every((i) => i.variants.length === 2)).toBe(true);
  });

  it('marks a move the foe has actually used as known', () => {
    const facts = liveFacts({speciesForme: 'Weavile', level: 78, revealedMoves: ['Knock Off']});
    const incoming = randbatsIncomingMovesFor(feed, isStatusMove)(facts);
    expect(incoming.find((i) => i.move === 'Knock Off')?.known).toBe(true);
    expect(incoming.find((i) => i.move === 'Icicle Crash')?.known).toBe(false);
  });

  it('supplies nothing for a species the feed does not cover', () => {
    expect(randbatsIncomingMovesFor(feed, isStatusMove)(liveFacts({speciesForme: 'Notamon'}))).toEqual([]);
  });
});
