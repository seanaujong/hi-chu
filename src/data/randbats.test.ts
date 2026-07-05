import {describe, it, expect} from 'vitest';
import {pickEntry} from './randbats.js';
import {inferSets} from '../core/resolve.js';
import type {LiveFacts, RandbatsData, RandbatsEntry} from '../core/types.js';

const entry = (level: number): RandbatsEntry => ({level, abilities: [], items: []});

const data: RandbatsData = {
  Dragonite: entry(74),
  Greninja: entry(76),
  'Tauros-Paldea-Combat': entry(80),
};

describe('pickEntry', () => {
  it('matches an exact forme key', () => {
    expect(pickEntry(data, 'Tauros-Paldea-Combat')?.level).toBe(80);
  });

  it('falls back to a base species when the exact forme is absent', () => {
    expect(pickEntry(data, 'Greninja-Bond')?.level).toBe(76); // Greninja-Bond → Greninja
  });

  it('returns undefined when nothing matches', () => {
    expect(pickEntry(data, 'Missingno')).toBeUndefined();
  });
});

describe('normalizes the loose feed shape (gen9championsrandombattle)', () => {
  // Real gen9championsrandombattle entries, verbatim from the feed: the Champions
  // feed omits every empty array — NO `teraTypes` on any role, NO `items` on
  // item-less roles. A raw cast lies, so the core would crash ("pool is not
  // iterable") on the very first hover. pickEntry is the seam that totalizes.
  const championsFeed = {
    Dragonite: {
      level: 47,
      abilities: ['Multiscale'],
      items: ['Lum Berry'],
      roles: {
        // no teraTypes key
        'Setup Sweeper': {abilities: ['Multiscale'], items: ['Lum Berry'], moves: ['Dragon Dance', 'Iron Head']},
      },
    },
    Charizard: {
      level: 52,
      abilities: ['Blaze'],
      items: ['Leftovers'],
      roles: {
        // no items key AND no teraTypes key
        'Setup Sweeper': {abilities: ['Blaze'], moves: ['Acrobatics', 'Flare Blitz', 'Swords Dance']},
      },
    },
  } as unknown as RandbatsData;

  const facts = (over: Partial<LiveFacts> = {}): LiveFacts => ({
    speciesForme: 'x',
    level: 50,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: [],
    ...over,
  });

  it('fills missing role arrays so the core reads total shapes', () => {
    const role = pickEntry(championsFeed, 'Charizard')!.roles!['Setup Sweeper']!;
    expect(role.items).toEqual([]); // was absent in the feed
    expect(role.teraTypes).toEqual([]); // absent on every Champions role
    expect(role.abilities).toEqual(['Blaze']);
    expect(role.moves).toContain('Flare Blitz');
  });

  it('a normalized entry flows through inferSets without crashing', () => {
    // The regression: every Champions hover threw here before normalization.
    const charizard = pickEntry(championsFeed, 'Charizard')!;
    expect(() => inferSets(facts(), charizard)).not.toThrow();
    // And an active Tera (which reads role.teraTypes) must not throw either.
    expect(() => inferSets(facts({terastallized: true, teraType: 'Fire'}), charizard)).not.toThrow();
    const k = inferSets(facts(), charizard);
    expect(k.candidates[0]!.moves.map((m) => m.name)).toContain('Flare Blitz');
    expect(k.candidates[0]!.teraTypes).toEqual([]); // no Tera line invented
  });
});
