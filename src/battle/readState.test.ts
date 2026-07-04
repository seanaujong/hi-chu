import {describe, it, expect} from 'vitest';
import {
  toLiveFacts,
  detectFormat,
  findOpposingActive,
  readFieldFacts,
  type ClientPokemon,
  type ClientBattle,
  type ClientSide,
} from './readState.js';

function clientMon(over: Partial<ClientPokemon> = {}): ClientPokemon {
  return {
    speciesForme: 'Dragonite',
    level: 74,
    hp: 100,
    maxhp: 100,
    status: '',
    boosts: {},
    terastallized: '',
    ...over,
  };
}

describe('toLiveFacts', () => {
  it('computes HP as a fraction and reads simple fields', () => {
    const f = toLiveFacts(clientMon({hp: 73, maxhp: 100, level: 74}));
    expect(f.hpPercent).toBeCloseTo(0.73, 10);
    expect(f.level).toBe(74);
    expect(f.terastallized).toBe(false);
    expect(f.teraType).toBeUndefined();
  });

  it('treats a non-empty terastallized field as the active Tera type', () => {
    const f = toLiveFacts(clientMon({terastallized: 'Flying'}));
    expect(f.terastallized).toBe(true);
    expect(f.teraType).toBe('Flying');
  });

  it('keeps only real status conditions (ignores "" and "???")', () => {
    expect(toLiveFacts(clientMon({status: 'brn'})).status).toBe('brn');
    expect(toLiveFacts(clientMon({status: '???'})).status).toBeUndefined();
    expect(toLiveFacts(clientMon({status: ''})).status).toBeUndefined();
  });

  it('strips the "*" transform marker and drops empty move names', () => {
    const f = toLiveFacts(clientMon({moveTrack: [['*Outrage', 5], ['Roost', 10]]}));
    expect(f.revealedMoves).toEqual(['Outrage', 'Roost']);
  });

  it('keeps only non-zero stat boosts', () => {
    const f = toLiveFacts(clientMon({boosts: {atk: 2, spe: -1, accuracy: 1, evasion: 0}}));
    expect(f.boosts).toEqual({atk: 2, spe: -1});
  });

  it('carries a consumed/knocked-off item as prevItem', () => {
    const f = toLiveFacts(clientMon({item: '', prevItem: 'Sitrus Berry'}));
    expect(f.item).toBeUndefined();
    expect(f.prevItem).toBe('Sitrus Berry');
  });

  it('prefers the current ability, falling back to the base ability', () => {
    expect(toLiveFacts(clientMon({ability: 'Multiscale'})).ability).toBe('Multiscale');
    expect(toLiveFacts(clientMon({ability: '', baseAbility: 'Inner Focus'})).ability).toBe('Inner Focus');
    expect(toLiveFacts(clientMon({})).ability).toBeUndefined();
  });
});

describe('detectFormat', () => {
  const battle = (tier: string, gen = 9): ClientBattle => ({gen, tier, sides: []});

  it('builds the feed id for standard random battles', () => {
    expect(detectFormat(battle('[Gen 9] Random Battle'))).toEqual({gen: 9, formatId: 'gen9randombattle'});
    expect(detectFormat(battle('[Gen 8] Random Doubles Battle', 8))).toEqual({
      gen: 8,
      formatId: 'gen8randomdoublesbattle',
    });
  });

  it('strips qualifiers like "(Blitz)"', () => {
    expect(detectFormat(battle('[Gen 9] Random Battle (Blitz)'))?.formatId).toBe('gen9randombattle');
  });

  it('keeps extra words inside the bracket tag ("[Gen 9 Champions] Random Battle")', () => {
    // The feed serves gen9championsrandombattle.json; a prefix-only strip used to
    // mangle this id and silently disable the extension in the format.
    expect(detectFormat(battle('[Gen 9 Champions] Random Battle'))).toEqual({
      gen: 9,
      formatId: 'gen9championsrandombattle',
    });
  });

  it('prepends the gen when the title carries none', () => {
    expect(detectFormat(battle('Random Battle'))?.formatId).toBe('gen9randombattle');
  });

  it('returns null for non-random formats', () => {
    expect(detectFormat(battle('[Gen 9] OU'))).toBeNull();
  });
});

describe('readFieldFacts', () => {
  const battle = (over: Partial<ClientBattle> = {}): ClientBattle => ({
    gen: 9,
    tier: '[Gen 9] Random Battle',
    sides: [],
    ...over,
  });

  it('maps the weather id to the calc weather name', () => {
    expect(readFieldFacts(battle({weather: 'raindance'}), undefined).weather).toBe('Rain');
    expect(readFieldFacts(battle({weather: 'sunnyday'}), undefined).weather).toBe('Sun');
    expect(readFieldFacts(battle({weather: 'snow'}), undefined).weather).toBe('Snow');
  });

  it('has no weather when clear', () => {
    expect(readFieldFacts(battle({weather: ''}), undefined).weather).toBeUndefined();
    expect(readFieldFacts(battle({}), undefined).weather).toBeUndefined();
  });

  it('finds a terrain among the pseudo-weathers', () => {
    const b = battle({pseudoWeather: [['Trick Room', 5, 0], ['Grassy Terrain', 5, 8]]});
    expect(readFieldFacts(b, undefined).terrain).toBe('Grassy');
  });

  it("reads the defender's screens from its side conditions", () => {
    const side: ClientSide = {active: [], sideConditions: {reflect: ['Reflect', 1, 5, 8]}};
    const facts = readFieldFacts(battle(), side);
    expect(facts.defenderScreens).toEqual({reflect: true, lightScreen: false, auroraVeil: false});
  });

  it('defaults to no screens when the side has none', () => {
    expect(readFieldFacts(battle(), {active: []}).defenderScreens).toEqual({
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
    });
  });
});

describe('findOpposingActive', () => {
  it('returns the first active Pokémon on the other side', () => {
    const mine = clientMon({speciesForme: 'Mine'});
    const theirs = clientMon({speciesForme: 'Theirs'});
    const mySide = {active: [mine]};
    const foeSide = {active: [theirs]};
    const battle: ClientBattle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [mySide, foeSide]};
    const hovered = {...mine, side: mySide};
    expect(findOpposingActive(battle, hovered)?.speciesForme).toBe('Theirs');
  });
});
