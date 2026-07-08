import {describe, it, expect} from 'vitest';
import {pickEntry} from './randbats.js';
import {inferSets} from '../core/knowledge.js';
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
    // In Champions, a Mega is a SEPARATE forme entry (not a stone on the base), and it
    // carries its stone item — this is verbatim from the real feed. The client reports
    // this forme name once a Pokémon has Mega Evolved, so this is the real Mega consumer.
    'Charizard-Mega-Y': {
      level: 47,
      abilities: ['Blaze'],
      items: ['Charizardite Y'],
      roles: {
        'Fast Attacker': {abilities: ['Blaze'], items: ['Charizardite Y'], moves: ['Air Slash', 'Roost', 'Solar Beam']},
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
    landedDamagingHit: false, tookEntryHazardDamage: false,
    ...over,
  });

  it('fills the missing teraTypes array so the core reads total shapes', () => {
    const role = pickEntry(championsFeed, 'Dragonite')!.roles!['Setup Sweeper']!;
    expect(role.teraTypes).toEqual([]); // absent on every Champions role
    expect(role.items).toEqual(['Lum Berry']);
    expect(role.abilities).toEqual(['Multiscale']);
  });

  it('a normalized entry flows through inferSets without crashing', () => {
    // The regression: every Champions hover threw here before normalization.
    const dragonite = pickEntry(championsFeed, 'Dragonite')!;
    expect(() => inferSets(facts({speciesForme: 'Dragonite'}), dragonite)).not.toThrow();
    expect(inferSets(facts({speciesForme: 'Dragonite'}), dragonite).candidates[0]!.moves.map((m) => m.name))
      .toContain('Iron Head');
  });

  it('derives a Mega gimmick from the stone item, with no Tera invented', () => {
    // Champions has Mega but no Tera — the honest "one, not the other" case. The
    // forme is derived from the base species + the stone's Y suffix.
    const megaY = pickEntry(championsFeed, 'Charizard-Mega-Y')!;
    const k = inferSets(facts({speciesForme: 'Charizard-Mega-Y'}), megaY);
    expect(k.candidates[0]!.gimmicks).toEqual([
      {kind: 'mega', stone: {name: 'Charizardite Y', known: false}, forme: 'Charizard-Mega-Y'},
    ]);
    // Dragonite (Tera-less, stone-less) has no gimmick line at all — the "none" case.
    const dragonite = inferSets(facts({speciesForme: 'Dragonite'}), pickEntry(championsFeed, 'Dragonite')!);
    expect(dragonite.candidates[0]!.gimmicks).toEqual([]);
  });

  it('derives a Z-Move gimmick from a Z-crystal item (gen7)', () => {
    // gen7 carries both Mega and Z-move; a crystal item (ends in " Z") is the Z signal.
    const gen7Feed = {
      Aerodactyl: {
        level: 79,
        abilities: ['Unnerve'],
        items: ['Flyinium Z'],
        roles: {
          'Z-Move user': {abilities: ['Unnerve'], items: ['Flyinium Z'], moves: ['Sky Attack', 'Stone Edge']},
        },
      },
    } as unknown as RandbatsData;
    const k = inferSets(facts({speciesForme: 'Aerodactyl'}), pickEntry(gen7Feed, 'Aerodactyl')!);
    expect(k.candidates[0]!.gimmicks).toEqual([{kind: 'zmove', crystal: {name: 'Flyinium Z', known: false}}]);
  });
});
