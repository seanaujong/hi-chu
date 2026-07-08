import {describe, it, expect} from 'vitest';
import {
  toLiveFacts,
  hasLandedDamagingHit,
  readOwnItem,
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

  it('carries the landedDamagingHit flag through, defaulting to false', () => {
    expect(toLiveFacts(clientMon({}), true).landedDamagingHit).toBe(true);
    expect(toLiveFacts(clientMon({}), false).landedDamagingHit).toBe(false);
    expect(toLiveFacts(clientMon({})).landedDamagingHit).toBe(false); // safe default
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

  it('carries the current AND innate ability separately when Trace has changed it', () => {
    // Gardevoir Traced Teravolt: `ability` is the live one, `baseAbility` the innate set one.
    const f = toLiveFacts(clientMon({ability: 'Teravolt', baseAbility: 'Trace'}));
    expect(f.ability).toBe('Teravolt');
    expect(f.baseAbility).toBe('Trace');
  });

  it('mirrors a single known ability into baseAbility when nothing has changed', () => {
    expect(toLiveFacts(clientMon({ability: 'Multiscale'})).baseAbility).toBe('Multiscale');
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

describe('hasLandedDamagingHit', () => {
  // A minimal battle carrying only the protocol log the scan reads. Real log lines below
  // are taken verbatim from captured gen9randombattle replays.
  const withLog = (stepQueue: string[], gen = 9): ClientBattle => ({gen, tier: '[Gen 9] Random Battle', sides: [], stepQueue});
  const noivern = clientMon({ident: 'p1: Noivern'});

  it('is true when the log shows the mon dealing move damage to a foe', () => {
    const log = ['|move|p1a: Noivern|Flamethrower|p2a: Corviknight', '|-damage|p2a: Corviknight|180/298'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(true);
  });

  it('is false when the damaging move missed (no -damage line follows)', () => {
    const log = ['|move|p1a: Noivern|Hurricane|p2a: Corviknight', '|-miss|p1a: Noivern|p2a: Corviknight'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(false);
  });

  it('is false when the target was immune (attacked, but dealt no damage)', () => {
    const log = ['|move|p1a: Noivern|Earthquake|p2a: Corviknight', '|-immune|p2a: Corviknight'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(false);
  });

  it('ignores indirect damage — hazards, status, and Life Orb recoil carry [from]', () => {
    const log = [
      '|move|p1a: Noivern|Flamethrower|p2a: Corviknight',
      '|-damage|p1a: Noivern|90/100|[from] item: Life Orb', // recoil on SELF, not a hit
      '|-damage|p2a: Corviknight|270/298|[from] Stealth Rock', // switch-in chip, not our move
    ];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(false);
  });

  it('does not attribute a foe’s damage to us (mover resets on the next move)', () => {
    const log = ['|move|p2a: Corviknight|Brave Bird|p1a: Noivern', '|-damage|p1a: Noivern|140/298'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(false);
  });

  it('matches by side+name across a switch, not by slot letter', () => {
    // Noivern hits from a later turn after re-entering; slot tags differ, name matches.
    const log = ['|move|p1a: Noivern|Boomburst|p2a: Skarmory', '|-damage|p2a: Skarmory|10/271'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(true);
  });

  it('counts breaking a foe’s substitute — the sub took the damage, the HP bar did not', () => {
    const log = ['|move|p1a: Noivern|Boomburst|p2a: Keldeo', '|-end|p2a: Keldeo|Substitute'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(true);
  });

  it('counts denting a foe’s substitute (the [damage] tag marks a real hit)', () => {
    const log = ['|move|p1a: Noivern|Flamethrower|p2a: Keldeo', '|-activate|p2a: Keldeo|move: Substitute|[damage]'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(true);
  });

  it('does NOT count a status move a substitute merely blocked (no [damage] tag)', () => {
    const log = ['|move|p1a: Noivern|Thunder Wave|p2a: Keldeo', '|-activate|p2a: Keldeo|move: Substitute'];
    expect(hasLandedDamagingHit(withLog(log), noivern)).toBe(false);
  });

  it('does NOT count a substitute hit in Gen 4, which took no Life Orb recoil against one', () => {
    const log = ['|move|p1a: Noivern|Boomburst|p2a: Keldeo', '|-end|p2a: Keldeo|Substitute'];
    expect(hasLandedDamagingHit(withLog(log, 4), noivern)).toBe(false);
  });

  it('is false with no log or no ident (conservative — never a false rule-out)', () => {
    expect(hasLandedDamagingHit(withLog([]), noivern)).toBe(false);
    expect(hasLandedDamagingHit(withLog(['|move|p1a: Noivern|Flamethrower|p2a: X', '|-damage|p2a: X|1/2']), clientMon({}))).toBe(false);
  });
});

describe('readOwnItem (your private item, for your own move damage only)', () => {
  const battle = (myPokemon?: unknown): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], myPokemon} as unknown as ClientBattle);
  const mon = clientMon({ident: 'p1: Iron Bundle'});

  it("reads the viewer's own held item by ident (id form)", () => {
    expect(readOwnItem(battle([{ident: 'p1: Iron Bundle', item: 'heavydutyboots'}]), mon)).toBe('heavydutyboots');
  });

  it('is undefined when spectating (no myPokemon) or when nothing matches the ident', () => {
    expect(readOwnItem(battle(undefined), mon)).toBeUndefined();
    expect(readOwnItem(battle([{ident: 'p1: Cetitan', item: 'leftovers'}]), mon)).toBeUndefined();
  });

  it('treats an empty item string as no item', () => {
    expect(readOwnItem(battle([{ident: 'p1: Iron Bundle', item: ''}]), mon)).toBeUndefined();
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
