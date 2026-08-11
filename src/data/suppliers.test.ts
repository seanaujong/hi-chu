import {describe, it, expect} from 'vitest';
import {feedSource, megaCandidatesFor} from './suppliers.js';
import {liveFacts} from '../core/sets.testfixtures.js';
import type {RandbatsData} from '../core/types.js';

// Real feed shapes, including the two irregularities this file exists to absorb: a Mega
// forme keyed IRREGULARLY (drops "Eternal"), and an entry reachable only by its stone.
const feed = {
  Weavile: {level: 78, abilities: ['Pressure'], items: ['Choice Band']},
  Zoroark: {level: 84, abilities: ['Illusion'], items: ['Choice Specs']},
  'Floette-Eternal': {level: 52, abilities: ['Flower Veil'], items: ['Choice Scarf']},
  'Floette-Mega': {level: 48, abilities: ['Flower Veil'], items: ['Floettite']},
} as unknown as RandbatsData;

describe('feedSource.entryFor', () => {
  it('resolves by species key', () => {
    expect(feedSource(feed).entryFor(liveFacts({speciesForme: 'Weavile'}))?.level).toBe(78);
  });

  it('follows a held Mega stone to the MEGA forme, whose key does not follow from the name', () => {
    // The Pokémon's real set is the Mega one; reading the base forme's would calculate the
    // wrong stats for something about to change shape. Core never learns this happened.
    const holding = liveFacts({speciesForme: 'Floette-Eternal', item: 'Floettite'});
    expect(feedSource(feed).entryFor(holding)?.level).toBe(48);
    const bare = liveFacts({speciesForme: 'Floette-Eternal'});
    expect(feedSource(feed).entryFor(bare)?.level).toBe(52);
  });

  it('has no entry for a species the feed does not cover', () => {
    expect(feedSource(feed).entryFor(liveFacts({speciesForme: 'Notamon'}))).toBeUndefined();
  });
});

describe('feedSource.allEntries', () => {
  it('hands over the whole roster, unfiltered — the filtering is core’s', () => {
    expect(feedSource(feed).allEntries().map((e) => e.species).sort())
      .toEqual(['Floette-Eternal', 'Floette-Mega', 'Weavile', 'Zoroark']);
  });

  it('enumerates once per source, not once per call', () => {
    // Core asks for this inside a per-hover filter; normalising the roster every time would
    // be a cost with nothing to show for it.
    const source = feedSource(feed);
    expect(source.allEntries()).toBe(source.allEntries());
  });
});

describe('megaCandidatesFor', () => {
  const base = liveFacts({speciesForme: 'Floette-Eternal', level: 52});

  it('offers the Mega forme while the item is still unknown', () => {
    // Stated first so the rule-outs below mean something: without it, an empty result could
    // just as well be a feed with no Mega in it.
    expect(megaCandidatesFor(feed, base).map((m) => m.forme)).toEqual(['Floette-Mega']);
  });

  it('rules the evolution out once the item is settled, either way', () => {
    // A revealed item that is not a stone, and an item already lost, both close the door.
    expect(megaCandidatesFor(feed, {...base, item: 'Leftovers'})).toEqual([]);
    expect(megaCandidatesFor(feed, {...base, prevItem: 'Leftovers'})).toEqual([]);
  });
});
