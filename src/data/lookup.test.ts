import {describe, it, expect} from 'vitest';
import {Generations, Pokemon} from '@smogon/calc';
import {pickEntry, megaEntryForItem, megaEntriesFor, championsStatPointsToEvs} from './lookup.js';
import {inferSets} from '../core/knowledge.js';
import type {LiveFacts, RandbatsData, RandbatsEntry} from '../core/types.js';

describe('megaEntryForItem (a held Mega stone is running the Mega set)', () => {
  // Real Champions shape: the base forme "Floette-Eternal" and its Mega keyed IRREGULARLY
  // as "Floette-Mega" (drops "Eternal"), so the set must be found by the stone, not the name.
  const feed = {
    'Floette-Eternal': {level: 52, abilities: ['Flower Veil'], items: ['Choice Scarf'], roles: {'Fast Attacker': {items: ['Choice Scarf'], moves: ['Trick']}}},
    'Floette-Mega': {level: 48, abilities: ['Flower Veil'], items: ['Floettite'], roles: {'Setup Sweeper': {items: ['Floettite'], moves: ['Calm Mind']}}},
    Blissey: {level: 50, abilities: ['Natural Cure'], items: ['Leftovers']},
  } as unknown as RandbatsData;

  it('finds the Mega set by its stone, despite the irregular "-Mega" key', () => {
    expect(megaEntryForItem(feed, 'Floettite')?.level).toBe(48); // the Floette-Mega entry
    expect(megaEntryForItem(feed, 'Floettite')?.roles?.['Setup Sweeper']).toBeDefined();
  });

  it('returns undefined for a non-stone item or no item', () => {
    expect(megaEntryForItem(feed, 'Leftovers')).toBeUndefined(); // held, but no Mega set uses it
    expect(megaEntryForItem(feed, 'Choice Scarf')).toBeUndefined();
    expect(megaEntryForItem(feed, undefined)).toBeUndefined();
  });
});

describe('megaEntriesFor (every Mega set still possible while the item is unknown)', () => {
  // Real Champions shape: a base entry's OWN item pool never lists the stone (verbatim from
  // the live feed: Charizard's pool is ['Leftovers'], not ['Charizardite X', …]) — the Mega
  // set lives only under its own separate entry, keyed by species prefix.
  const feed = {
    Charizard: {level: 52, abilities: ['Blaze'], items: ['Leftovers']},
    'Charizard-Mega-X': {level: 47, abilities: ['Blaze'], items: ['Charizardite X']},
    'Charizard-Mega-Y': {level: 47, abilities: ['Blaze'], items: ['Charizardite Y']},
    'Floette-Eternal': {level: 52, abilities: ['Flower Veil'], items: ['Choice Scarf']},
    'Floette-Mega': {level: 48, abilities: ['Flower Veil'], items: ['Floettite']},
    Blissey: {level: 50, abilities: ['Natural Cure'], items: ['Leftovers']},
  } as unknown as RandbatsData;

  it('finds every still-possible Mega entry for a species with more than one stone', () => {
    const found = megaEntriesFor(feed, 'Charizard').map((m) => m.forme).sort();
    expect(found).toEqual(['Charizard-Mega-X', 'Charizard-Mega-Y']);
  });

  it('finds the irregularly-keyed Mega by species prefix, not by matching the base key', () => {
    // "Floette-Eternal" and "Floette-Mega" share no key relationship beyond the species
    // prefix — a naive "does <forme>-Mega exist" lookup finds nothing here.
    const found = megaEntriesFor(feed, 'Floette-Eternal');
    expect(found.map((m) => m.forme)).toEqual(['Floette-Mega']);
    expect(found[0]?.entry.items).toEqual(['Floettite']);
  });

  it('returns nothing for a species with no Mega entry', () => {
    expect(megaEntriesFor(feed, 'Blissey')).toEqual([]);
  });
});

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
    landedDamagingHit: false, tookEntryHazardDamage: false, switchedIntoStealthRockUnharmed: false,
    timesAttacked: 0,
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

  it('champions stat points convert to mainline EVs (EV = 8·points − 4)', () => {
    // The Champions feed's `evs` are STAT POINTS in Champions' own stat system, not
    // EVs: its formula puts max(2·points − 1, 0) where mainline puts IV + ⌊EV/4⌋
    // (IVs hardcoded 31). Fed literally to @smogon/calc, 11 points read as 2 formula
    // points instead of the real 21 — deflating every stat on BOTH mons. Verbatim
    // Arbok from the feed, pinned against replay gen9championsrandombattle-2646312545.
    const championsFeed = {
      Arbok: {
        level: 54,
        abilities: ['Intimidate'],
        items: ['Leftovers'],
        evs: {hp: 11, atk: 11, def: 11, spa: 11, spd: 11, spe: 11},
        roles: {
          'Bulky Attacker': {
            abilities: ['Intimidate'],
            items: ['Leftovers'],
            moves: ['Earthquake', 'Glare', 'Gunk Shot', 'Knock Off', 'Toxic Spikes'],
            evs: {hp: 11, atk: 11, def: 11, spa: 11, spd: 11, spe: 11},
          },
        },
      },
    } as unknown as RandbatsData;

    const arbok = pickEntry(championsStatPointsToEvs(championsFeed), 'Arbok')!;
    const mainline = {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84}; // ⌊84/4⌋ = 21 = 2·11 − 1
    expect(arbok.evs).toEqual(mainline); // entry-level table
    expect(arbok.roles!['Bulky Attacker']!.evs).toEqual(mainline); // role-level table

    // The falsifiable link to the replay: the real Arbok showed 156/156 HP at L54.
    // Converted EVs reproduce it through @smogon/calc; the raw points give 146,
    // which is exactly what inflated every shown damage percent (47% for a true 43%).
    // (non-null: the toEqual above just proved the table exists)
    expect(new Pokemon(Generations.get(9), 'Arbok', {level: 54, evs: arbok.evs!}).maxHP()).toBe(156);
  });

  it('zero stat points convert to zero EVs, and absent tables stay absent', () => {
    const feed = {
      Emolga: {level: 50, abilities: ['Static'], items: [], evs: {hp: 0, spe: 11}},
      Blissey: {level: 50, abilities: ['Natural Cure'], items: ['Leftovers']}, // no evs key
    } as unknown as RandbatsData;
    const converted = championsStatPointsToEvs(feed);
    expect(pickEntry(converted, 'Emolga')!.evs).toEqual({hp: 0, spe: 84});
    expect(pickEntry(converted, 'Blissey')!.evs).toBeUndefined(); // the 85-EV baseline still applies downstream
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
