import {describe, it, expect} from 'vitest';
import {
  entryOrMinimal,
  foeVariants,
  illusionVariants,
  incomingMovesFor,
  suspectsFor,
  variantsFor,
  type SetSource,
} from './possibilities.js';
import {liveFacts} from './sets.testfixtures.js';
import type {RandbatsEntry} from './types.js';

// No feed, no `RandbatsData`, no `pickEntry` — the whole point of the port. A literal roster
// stands in for one, which is a thing a test could not do while these laws reached for the
// data layer themselves.
const WEAVILE: RandbatsEntry = {
  level: 78,
  abilities: ['Pressure'],
  items: ['Choice Band', 'Heavy-Duty Boots'],
  roles: {'Fast Attacker': {abilities: ['Pressure'], items: ['Choice Band', 'Heavy-Duty Boots'], teraTypes: ['Ice'], moves: ['Icicle Crash', 'Knock Off']}},
};
const ZOROARK: RandbatsEntry = {
  level: 84,
  abilities: ['Illusion'],
  items: ['Choice Specs'],
  roles: {'Fast Attacker': {abilities: ['Illusion'], items: ['Choice Specs'], teraTypes: ['Dark'], moves: ['Dark Pulse', 'Sludge Bomb']}},
};

const roster = [
  {species: 'Weavile', entry: WEAVILE},
  {species: 'Zoroark', entry: ZOROARK},
];

function sourceOf(entries = roster): SetSource {
  const byName = new Map(entries.map((e) => [e.species, e.entry]));
  return {
    entryFor: (facts) => byName.get(facts.speciesForme),
    allEntries: () => entries,
  };
}

const weavile = (over = {}) => liveFacts({speciesForme: 'Weavile', level: 78, ...over});

describe('entryOrMinimal', () => {
  it('falls back to the LIVE level, so an uncovered species is still calculable', () => {
    expect(entryOrMinimal(undefined, liveFacts({speciesForme: 'Notamon', level: 61})))
      .toEqual({level: 61, abilities: [], items: []});
  });

  it('leaves a real entry alone', () => {
    expect(entryOrMinimal(WEAVILE, weavile())).toBe(WEAVILE);
  });
});

describe('foeVariants / variantsFor', () => {
  it('fans a hidden item out into one variant per possibility', () => {
    expect(foeVariants(sourceOf(), weavile()).map((v) => v.mon.item).sort())
      .toEqual(['Choice Band', 'Heavy-Duty Boots']);
  });

  it('collapses to the revealed item once it is known', () => {
    expect(foeVariants(sourceOf(), weavile({item: 'Choice Band'})).map((v) => v.mon.item))
      .toEqual(['Choice Band']);
  });

  it('hands back the same pool whatever move is asked about', () => {
    // What separates the feed-backed adapter from the open-format one, whose variants depend
    // on the move's category: a feed knows the sets outright, so the move is irrelevant.
    const forFacts = variantsFor(sourceOf())(weavile());
    expect(forFacts('Icicle Crash')).toBe(forFacts('Knock Off'));
  });

  it('still resolves a species the source does not cover', () => {
    const variants = foeVariants(sourceOf(), liveFacts({speciesForme: 'Notamon', level: 61}));
    expect(variants).toHaveLength(1);
    expect(variants[0]!.mon.level).toBe(61);
  });
});

describe('the Illusion pool is filtered HERE, not by the source', () => {
  it('suspects a Zoroark from a move only its sets carry', () => {
    const facts = weavile({revealedMoves: ['Sludge Bomb']});
    expect(suspectsFor(facts, WEAVILE, sourceOf()).map((s) => s.species)).toEqual(['Zoroark']);
  });

  it('suspects nothing when the moves fit the species on screen', () => {
    expect(suspectsFor(weavile({revealedMoves: ['Icicle Crash']}), WEAVILE, sourceOf())).toEqual([]);
  });

  it('reads the ability off each entry, so a roster with no Illusion holder suspects nobody', () => {
    // The rule the port deliberately does NOT pre-apply: the source hands over its whole
    // roster and this module decides which entries could have been built with Illusion.
    const noIllusion = sourceOf([{species: 'Weavile', entry: WEAVILE}]);
    expect(suspectsFor(weavile({revealedMoves: ['Sludge Bomb']}), WEAVILE, noIllusion)).toEqual([]);
  });

  it('resolves a suspect as ITSELF — its own species and its own level', () => {
    const facts = weavile({revealedMoves: ['Sludge Bomb']});
    expect(illusionVariants(facts, WEAVILE, sourceOf()).map((v) => [v.role, v.mon.speciesForme, v.mon.level]))
      .toEqual([['Zoroark', 'Zoroark', 84]]);
  });
});

describe('incomingMovesFor', () => {
  const isStatusMove = (name: string) => name === 'Nasty Plot';

  it('pairs each still-possible move with the variants that could carry it', () => {
    const incoming = incomingMovesFor(sourceOf(), isStatusMove)(weavile());
    expect(incoming.map((i) => i.move).sort()).toEqual(['Icicle Crash', 'Knock Off']);
    // Both items are still live, so every move carries the full fan-out rather than a
    // first-guessed representative.
    expect(incoming.every((i) => i.variants.length === 2)).toBe(true);
  });

  it('marks a move actually used as known', () => {
    const incoming = incomingMovesFor(sourceOf(), isStatusMove)(weavile({revealedMoves: ['Knock Off']}));
    expect(incoming.find((i) => i.move === 'Knock Off')?.known).toBe(true);
    expect(incoming.find((i) => i.move === 'Icicle Crash')?.known).toBe(false);
  });

  it('supplies nothing for a species the source does not cover', () => {
    expect(incomingMovesFor(sourceOf(), isStatusMove)(liveFacts({speciesForme: 'Notamon'}))).toEqual([]);
  });
});
