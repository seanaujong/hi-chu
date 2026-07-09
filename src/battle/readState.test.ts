import {describe, it, expect} from 'vitest';
import {
  toLiveFacts,
  readSpeciesData,
  hasLandedDamagingHit,
  tookEntryHazardDamage,
  switchedIntoStealthRockUnharmed,
  readOwnItem,
  readOwnMoves,
  readOwnTeraType,
  readTeraToggled,
  detectFormat,
  findOpposingActive,
  readFieldFacts,
  type ClientPokemon,
  type ClientBattle,
  type ClientSide,
  type ToggleDocument,
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

  it('carries the behaviour signals through, defaulting to false', () => {
    expect(toLiveFacts(clientMon({}), {landedDamagingHit: true}).landedDamagingHit).toBe(true);
    expect(toLiveFacts(clientMon({}), {tookEntryHazardDamage: true}).tookEntryHazardDamage).toBe(true);
    const f = toLiveFacts(clientMon({})); // no signals → safe defaults
    expect(f.landedDamagingHit).toBe(false);
    expect(f.tookEntryHazardDamage).toBe(false);
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

  it('builds the feed id for standard random battles, flagging doubles', () => {
    expect(detectFormat(battle('[Gen 9] Random Battle'))).toEqual({gen: 9, formatId: 'gen9randombattle', doubles: false});
    expect(detectFormat(battle('[Gen 8] Random Doubles Battle', 8))).toEqual({
      gen: 8,
      formatId: 'gen8randomdoublesbattle',
      doubles: true,
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
      doubles: false,
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

  it('finds Trick Room among the pseudo-weathers (alongside a terrain)', () => {
    const b = battle({pseudoWeather: [['Trick Room', 5, 0], ['Grassy Terrain', 5, 8]]});
    expect(readFieldFacts(b, undefined).trickRoom).toBe(true);
    expect(readFieldFacts(battle(), undefined).trickRoom).toBeUndefined();
  });

  it("reads each side's Tailwind — the defender's own, and the other side's as the attacker's", () => {
    const windy: ClientSide = {active: [], sideConditions: {tailwind: ['Tailwind', 1, 3, 5]}};
    const calm: ClientSide = {active: []};
    const b = battle({sides: [windy, calm]});
    expect(readFieldFacts(b, windy).defenderTailwind).toBe(true);
    expect(readFieldFacts(b, windy).attackerTailwind).toBeUndefined();
    expect(readFieldFacts(b, calm).attackerTailwind).toBe(true);
    expect(readFieldFacts(b, calm).defenderTailwind).toBeUndefined();
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

describe('tookEntryHazardDamage (rules out Heavy-Duty Boots)', () => {
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue} as unknown as ClientBattle);
  const haxorus = clientMon({ident: 'p2: Haxorus'});

  it('is true when the log shows the mon taking Stealth Rock / Spikes damage', () => {
    expect(tookEntryHazardDamage(withLog(['|-damage|p2a: Haxorus|214/244|[from] Stealth Rock']), haxorus)).toBe(true);
    expect(tookEntryHazardDamage(withLog(['|-damage|p2a: Haxorus|180/244|[from] Spikes']), haxorus)).toBe(true);
  });

  it('is false for damage that is not an entry hazard (a move, Life Orb, poison)', () => {
    expect(tookEntryHazardDamage(withLog(['|-damage|p2a: Haxorus|100/244']), haxorus)).toBe(false); // a move hit
    expect(tookEntryHazardDamage(withLog(['|-damage|p2a: Haxorus|100/244|[from] psn']), haxorus)).toBe(false);
  });

  it('does not attribute another Pokémon’s hazard damage to this one', () => {
    expect(tookEntryHazardDamage(withLog(['|-damage|p1a: Chansey|494/564|[from] Stealth Rock']), haxorus)).toBe(false);
  });
});

describe('switchedIntoStealthRockUnharmed (confirms Heavy-Duty Boots)', () => {
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue} as unknown as ClientBattle);
  const corv = clientMon({ident: 'p2: Corviknight'});
  const SR = '|-sidestart|p2: Player|move: Stealth Rock';

  it('is true when the mon switches into its side’s Stealth Rock and takes no damage', () => {
    expect(switchedIntoStealthRockUnharmed(withLog([SR, '|switch|p2a: Corviknight|Corviknight, M|100/100', '|turn|3']), corv)).toBe(true);
  });

  it('is false when it took Stealth Rock damage on the way in', () => {
    const log = [SR, '|switch|p2a: Corviknight|Corviknight, M|100/100', '|-damage|p2a: Corviknight|88/100|[from] Stealth Rock'];
    expect(switchedIntoStealthRockUnharmed(withLog(log), corv)).toBe(false);
  });

  it('is false when no Stealth Rock was set on its side', () => {
    expect(switchedIntoStealthRockUnharmed(withLog(['|switch|p2a: Corviknight|Corviknight, M|100/100', '|turn|3']), corv)).toBe(false);
  });

  it('does not count Stealth Rock on the OTHER side', () => {
    const log = ['|-sidestart|p1: Player|move: Stealth Rock', '|switch|p2a: Corviknight|Corviknight, M|100/100', '|turn|3'];
    expect(switchedIntoStealthRockUnharmed(withLog(log), corv)).toBe(false);
  });

  it('respects Stealth Rock being spun/Defogged away before the switch', () => {
    const log = [SR, '|-sideend|p2: Player|Stealth Rock|[from] move: Rapid Spin', '|switch|p2a: Corviknight|Corviknight, M|100/100', '|turn|3'];
    expect(switchedIntoStealthRockUnharmed(withLog(log), corv)).toBe(false);
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

describe('readOwnTeraType (your private Tera type, for the selected-Tera preview)', () => {
  const battle = (myPokemon?: unknown): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], myPokemon} as unknown as ClientBattle);
  const mon = clientMon({ident: 'p1: Iron Bundle'});

  it("reads the viewer's own Tera type by ident", () => {
    expect(readOwnTeraType(battle([{ident: 'p1: Iron Bundle', teraType: 'Ice'}]), mon)).toBe('Ice');
  });

  it('is undefined when spectating (no myPokemon) or when nothing matches the ident', () => {
    expect(readOwnTeraType(battle(undefined), mon)).toBeUndefined();
    expect(readOwnTeraType(battle([{ident: 'p1: Cetitan', teraType: 'Ice'}]), mon)).toBeUndefined();
  });

  it('treats an empty or missing teraType as none', () => {
    expect(readOwnTeraType(battle([{ident: 'p1: Iron Bundle', teraType: ''}]), mon)).toBeUndefined();
    expect(readOwnTeraType(battle([{ident: 'p1: Iron Bundle'}]), mon)).toBeUndefined();
  });
});

describe('readOwnMoves (your private moveset, for the own-hover matchup view)', () => {
  const battle = (myPokemon?: unknown): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], myPokemon} as unknown as ClientBattle);
  const mon = clientMon({ident: 'p1: Iron Bundle'});

  it("reads the viewer's own full moveset by ident (id form)", () => {
    const moves = ['freezedry', 'hydropump', 'icebeam', 'flipturn'];
    expect(readOwnMoves(battle([{ident: 'p1: Iron Bundle', moves}]), mon)).toEqual(moves);
  });

  it('is undefined when spectating (no myPokemon) or when nothing matches the ident', () => {
    expect(readOwnMoves(battle(undefined), mon)).toBeUndefined();
    expect(readOwnMoves(battle([{ident: 'p1: Cetitan', moves: ['iciclecrash']}]), mon)).toBeUndefined();
  });

  it('treats an empty or missing move list as none', () => {
    expect(readOwnMoves(battle([{ident: 'p1: Iron Bundle', moves: []}]), mon)).toBeUndefined();
    expect(readOwnMoves(battle([{ident: 'p1: Iron Bundle'}]), mon)).toBeUndefined();
  });
});

describe('readTeraToggled (the move panel’s Terastallize checkbox)', () => {
  const battle = (roomid?: string): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], roomid} as unknown as ClientBattle);
  /** A stub document: `rooms` maps element ids to that room's checkbox (if any);
   *  `global` is what a document-wide query would find. */
  const doc = (over: {rooms?: Record<string, {checked: boolean} | null>; global?: {checked: boolean} | null} = {}): ToggleDocument => ({
    getElementById: (id) => {
      const box = over.rooms?.[id];
      return over.rooms && id in over.rooms ? {querySelector: () => box ?? null} : null;
    },
    querySelector: () => over.global ?? null,
  });

  it('reads the checked box inside THIS battle’s room element', () => {
    const d = doc({rooms: {'room-battle-x': {checked: true}}});
    expect(readTeraToggled(battle('battle-x'), d)).toBe(true);
    expect(readTeraToggled(battle('battle-x'), doc({rooms: {'room-battle-x': {checked: false}}}))).toBe(false);
  });

  it("never leaks another room's checked box (a scoped miss is false, not a fallback)", () => {
    const d = doc({rooms: {'room-battle-x': null}, global: {checked: true}});
    expect(readTeraToggled(battle('battle-x'), d)).toBe(false);
  });

  it('falls back to a document-wide read when the room element is missing (preact client)', () => {
    expect(readTeraToggled(battle('battle-x'), doc({global: {checked: true}}))).toBe(true);
    expect(readTeraToggled(battle(undefined), doc({global: {checked: true}}))).toBe(true);
  });

  it('is false when no checkbox exists at all (already terastallized, can’t Tera, not choosing)', () => {
    expect(readTeraToggled(battle('battle-x'), doc())).toBe(false);
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

describe('readSpeciesData (the client dex as calc fallback for unknown formes)', () => {
  const fullRecord = {
    exists: true,
    baseStats: {hp: 60, atk: 75, def: 110, spa: 175, spd: 110, spe: 90},
    types: ['Ghost', 'Fire'],
    weightkg: 34.3,
  };
  const withDex = (record: unknown): ClientBattle => ({
    gen: 9,
    tier: '[Gen 9 Champions] Random Battle',
    sides: [],
    dex: {species: {get: () => record as never}},
  });

  it('reads a complete record into SpeciesData', () => {
    const sd = readSpeciesData(withDex(fullRecord), clientMon({speciesForme: 'Chandelure-Mega'}));
    expect(sd).toEqual({
      baseStats: {hp: 60, atk: 75, def: 110, spa: 175, spd: 110, spe: 90},
      types: ['Ghost', 'Fire'],
      weightkg: 34.3,
    });
  });

  it('folds into LiveFacts via the toLiveFacts third source', () => {
    const sd = readSpeciesData(withDex(fullRecord), clientMon());
    expect(toLiveFacts(clientMon(), {}, sd).speciesData).toEqual(sd);
    expect(toLiveFacts(clientMon()).speciesData).toBeUndefined();
  });

  it('returns undefined without a dex (fixtures, older clients) or for a non-existent species', () => {
    const noDex: ClientBattle = {gen: 9, tier: '[Gen 9] Random Battle', sides: []};
    expect(readSpeciesData(noDex, clientMon())).toBeUndefined();
    expect(readSpeciesData(withDex({...fullRecord, exists: false}), clientMon())).toBeUndefined();
    expect(readSpeciesData(withDex(undefined), clientMon())).toBeUndefined();
  });

  it('refuses a malformed record rather than half-answering (never lie)', () => {
    const {spe: _spe, ...missingStat} = fullRecord.baseStats;
    expect(readSpeciesData(withDex({...fullRecord, baseStats: missingStat}), clientMon())).toBeUndefined();
    expect(readSpeciesData(withDex({...fullRecord, baseStats: {...fullRecord.baseStats, hp: 0}}), clientMon())).toBeUndefined();
    expect(readSpeciesData(withDex({...fullRecord, types: []}), clientMon())).toBeUndefined();
    expect(readSpeciesData(withDex({...fullRecord, types: undefined}), clientMon())).toBeUndefined();
  });
});
