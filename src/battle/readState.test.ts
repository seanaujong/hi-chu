import {describe, it, expect} from 'vitest';
import {
  toLiveFacts,
  readLiveForme,
  readTransformTarget,
  readSpeciesData,
  hasLandedDamagingHit,
  tookEntryHazardDamage,
  switchedIntoStealthRockUnharmed,
  readOwnItem,
  readOwnServerPokemon,
  readOwnMoves,
  readOwnStats,
  readOwnTeraType,
  serverPokemonFacts,
  serverStats,
  type ClientServerPokemon,
  readTeraToggled,
  readMegaToggled,
  readMegaForme,
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

  it('drops a "*" TRANSFORM move: it is the copied Pokémon\'s, not this one\'s', () => {
    // The client stars a move a Pokémon only has by Transform. Reading it as a revealed
    // move of THIS Pokémon narrows its set by the moveset it is imitating — a Ditto that
    // has copied a Dragonite is not thereby a Dragonite-shaped Ditto set.
    const f = toLiveFacts(clientMon({moveTrack: [['*Outrage', 5], ['Roost', 10]]}));
    expect(f.revealedMoves).toEqual(['Roost']);
  });

  it('reads the live forme from the formechange volatile, not speciesForme', () => {
    // A temporary forme change (Relic Song, Stance Change, Zen Mode, Transform) leaves
    // `speciesForme` alone and records the forme here — the client's own getSpeciesForme().
    const meloetta = clientMon({
      speciesForme: 'Meloetta',
      volatiles: {formechange: ['formechange', 'Meloetta-Pirouette']},
    });
    expect(readLiveForme(meloetta)).toBe('Meloetta-Pirouette');
    const f = toLiveFacts(meloetta);
    expect(f.liveForme).toBe('Meloetta-Pirouette'); // what the calc must see
    expect(f.speciesForme).toBe('Meloetta'); // what the set is published under
  });

  it('has no live forme when the Pokémon is simply itself', () => {
    expect(readLiveForme(clientMon({volatiles: {}}))).toBeUndefined();
    expect(readLiveForme(clientMon())).toBeUndefined();
    expect(toLiveFacts(clientMon()).liveForme).toBeUndefined();
    // A permanent change (|detailschange|) rewrites speciesForme itself; the client leaves
    // no volatile behind, and a stale one naming the same forme is not a change.
    const palafin = clientMon({
      speciesForme: 'Palafin-Hero',
      volatiles: {formechange: ['formechange', 'Palafin-Hero']},
    });
    expect(readLiveForme(palafin)).toBeUndefined();
  });

  it('reads the Transform target straight out of the volatile', () => {
    // The client stores the target's own Pokemon object there, so the copy can be resolved
    // with the same machinery as any other Pokémon on the field.
    const noivern = clientMon({speciesForme: 'Noivern', level: 82});
    const ditto = clientMon({
      speciesForme: 'Ditto',
      level: 87,
      volatiles: {transform: ['transform', noivern, false, 'M', 82], formechange: ['formechange', 'Noivern']},
    });
    expect(readTransformTarget(ditto)?.speciesForme).toBe('Noivern');
    // …and it is the live forme too: the client records a transform as a forme change.
    expect(readLiveForme(ditto)).toBe('Noivern');
  });

  it('has no Transform target for anyone else, and refuses a malformed one', () => {
    expect(readTransformTarget(clientMon())).toBeUndefined();
    expect(readTransformTarget(clientMon({volatiles: {}}))).toBeUndefined();
    // A shape we don't recognise costs us the copy, never the tooltip.
    expect(readTransformTarget(clientMon({volatiles: {transform: ['transform', 'Noivern']}}))).toBeUndefined();
    expect(readTransformTarget(clientMon({volatiles: {transform: ['transform', {speciesForme: 'Noivern'}]}}))).toBeUndefined();
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
    expect(detectFormat(battle('[Gen 9] Random Battle'))).toEqual({kind: 'randbats', gen: 9, formatId: 'gen9randombattle', doubles: false});
    expect(detectFormat(battle('[Gen 8] Random Doubles Battle', 8))).toEqual({
      kind: 'randbats',
      gen: 8,
      formatId: 'gen8randomdoublesbattle',
      doubles: true,
    });
  });

  it('strips qualifiers like "(Blitz)"', () => {
    expect(detectFormat(battle('[Gen 9] Random Battle (Blitz)'))).toEqual({kind: 'randbats', gen: 9, formatId: 'gen9randombattle', doubles: false});
  });

  it('keeps extra words inside the bracket tag ("[Gen 9 Champions] Random Battle")', () => {
    // The feed serves gen9championsrandombattle.json; a prefix-only strip used to
    // mangle this id and silently disable the extension in the format.
    expect(detectFormat(battle('[Gen 9 Champions] Random Battle'))).toEqual({
      kind: 'randbats',
      gen: 9,
      formatId: 'gen9championsrandombattle',
      doubles: false,
    });
  });

  it('prepends the gen when the title carries none', () => {
    expect(detectFormat(battle('Random Battle'))).toEqual({kind: 'randbats', gen: 9, formatId: 'gen9randombattle', doubles: false});
  });

  it('classifies every non-random format as open — no feed, damage surfaces only', () => {
    expect(detectFormat(battle('[Gen 9] OU'))).toEqual({kind: 'open', gen: 9, doubles: false});
    expect(detectFormat(battle('[Gen 9] Custom Game'))).toEqual({kind: 'open', gen: 9, doubles: false});
  });

  it('reads doubles from the client gameType in open formats (no format id to sniff)', () => {
    expect(detectFormat({...battle('[Gen 9] VGC 2025 Reg H'), gameType: 'doubles'})).toEqual({kind: 'open', gen: 9, doubles: true});
    expect(detectFormat({...battle('[Gen 9] OU'), gameType: 'singles'})).toEqual({kind: 'open', gen: 9, doubles: false});
  });

  it('returns null only when the battle carries no tier yet', () => {
    expect(detectFormat(battle(''))).toBeNull();
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

describe('readOwnServerPokemon (which private entry is this Pokémon?)', () => {
  // Illusion: the battle view shows a Noivern in our active slot, but the Pokémon really
  // standing there is the Zoroark-Hisui at myPokemon[0] — the slot the client itself
  // indexes. The Noivern whose face it wears is the bench entry with the matching ident.
  const zoroark = {ident: 'p1: Zoroark-Hisui', item: 'lifeorb'};
  const noivern = {ident: 'p1: Noivern', item: 'heavydutyboots'};
  const load = (): {battle: ClientBattle; disguised: ClientPokemon; foe: ClientPokemon} => {
    const near = {isFar: false, active: [] as (ClientPokemon | null)[]};
    const far = {isFar: true, active: [] as (ClientPokemon | null)[]};
    const disguised = clientMon({ident: 'p1: Noivern', speciesForme: 'Noivern', side: near as unknown as ClientSide});
    const foe = clientMon({ident: 'p2: Noivern', speciesForme: 'Noivern', side: far as unknown as ClientSide});
    near.active = [disguised];
    far.active = [foe];
    const battle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far], myPokemon: [zoroark, noivern]} as unknown as ClientBattle;
    return {battle, disguised, foe};
  };

  it('finds an ACTIVE Pokémon by its slot — its ident names only the disguise', () => {
    const {battle, disguised} = load();
    expect(readOwnServerPokemon(battle, disguised)).toBe(zoroark);
    expect(readOwnItem(battle, disguised)).toBe('lifeorb');
  });

  it('finds a benched Pokémon by ident — it holds no slot, and can wear no disguise', () => {
    const {battle} = load();
    const benched = clientMon({ident: 'p1: Noivern', speciesForme: 'Noivern'});
    expect(readOwnServerPokemon(battle, benched)).toBe(noivern);
  });

  it("never reads a foe's slot as ours", () => {
    const {battle, foe} = load();
    expect(readOwnServerPokemon(battle, foe)).toBeUndefined();
  });

  it('is undefined when spectating (no private team)', () => {
    const {disguised} = load();
    const spectating = {gen: 9, tier: '[Gen 9] Random Battle', sides: []} as unknown as ClientBattle;
    expect(readOwnServerPokemon(spectating, disguised)).toBeUndefined();
  });
});

describe('serverStats / readOwnStats (your exact finals, for open-format own damage)', () => {
  const battle = (myPokemon?: unknown): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] OU', sides: [], myPokemon} as unknown as ClientBattle);
  const mon = clientMon({ident: 'p1: Dragonite'});
  const fiveStats = {atk: 403, def: 226, spa: 212, spd: 236, spe: 197};

  it('assembles hp from maxhp plus the request’s five stats', () => {
    const own = {ident: 'p1: Dragonite', maxhp: 386, stats: fiveStats};
    expect(readOwnStats(battle([own]), mon)).toEqual({hp: 386, ...fiveStats});
  });

  it('is whole-or-nothing: a missing or malformed stat drops the whole reading', () => {
    expect(serverStats({ident: 'p1: Dragonite', maxhp: 386, stats: {...fiveStats, spe: undefined}} as unknown as ClientServerPokemon)).toBeUndefined();
    expect(serverStats({ident: 'p1: Dragonite', maxhp: 386} as ClientServerPokemon)).toBeUndefined();
    expect(serverStats({ident: 'p1: Dragonite', stats: fiveStats} as unknown as ClientServerPokemon)).toBeUndefined();
  });

  it('is undefined when spectating (no myPokemon)', () => {
    expect(readOwnStats(battle(undefined), mon)).toBeUndefined();
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

describe('serverPokemonFacts (a private ServerPokemon → LiveFacts, for the switch-menu hover)', () => {
  const server = (over: Record<string, unknown> = {}): ClientServerPokemon =>
    ({ident: 'p1: Honchkrow', details: 'Honchkrow, L86, F', condition: '312/312',
      item: 'heavydutyboots', baseAbility: 'moxie', teraType: 'Flying',
      moves: ['bravebird', 'heatwave', 'suckerpunch', 'uturn'], ...over} as ClientServerPokemon);

  it('prefers the client-parsed fields when present', () => {
    const facts = serverPokemonFacts(server({speciesForme: 'Honchkrow', level: 86, gender: 'F', hp: 156, maxhp: 312, status: 'par'}))!;
    expect(facts.speciesForme).toBe('Honchkrow');
    expect(facts.level).toBe(86);
    expect(facts.hpPercent).toBe(0.5);
    expect(facts.status).toBe('par');
    expect(facts.gender).toBe('F');
  });

  it('falls back to parsing the raw details/condition strings itself', () => {
    const facts = serverPokemonFacts(server({condition: '156/312 brn'}))!;
    expect(facts.speciesForme).toBe('Honchkrow');
    expect(facts.level).toBe(86);
    expect(facts.gender).toBe('F');
    expect(facts.hpPercent).toBe(0.5);
    expect(facts.status).toBe('brn');
    expect(facts.item).toBe('heavydutyboots');
    expect(facts.baseAbility).toBe('moxie');
    expect(facts.boosts).toEqual({});
    expect(facts.revealedMoves).toEqual([]);
  });

  it('reads a fainted condition as 0 HP', () => {
    expect(serverPokemonFacts(server({condition: '0 fnt'}))!.hpPercent).toBe(0);
  });

  it('carries an ACTIVE Tera only — teraType is never speculated from the pending type', () => {
    const pending = serverPokemonFacts(server())!;
    expect(pending.terastallized).toBe(false);
    expect(pending.teraType).toBeUndefined();
    const active = serverPokemonFacts(server({terastallized: 'Flying'}))!;
    expect(active.terastallized).toBe(true);
    expect(active.teraType).toBe('Flying');
  });

  it('is undefined when even the species cannot be read (never lie)', () => {
    expect(serverPokemonFacts(server({details: ''}))).toBeUndefined();
    expect(serverPokemonFacts({ident: 'p1: ?'} as ClientServerPokemon)).toBeUndefined();
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

describe('readMegaToggled (the move panel’s Mega Evolution checkbox)', () => {
  const battle = (roomid?: string): ClientBattle =>
    ({gen: 7, tier: '[Gen 7] Random Battle', sides: [], roomid} as unknown as ClientBattle);
  const doc = (over: {rooms?: Record<string, {checked: boolean} | null>; global?: {checked: boolean} | null} = {}): ToggleDocument => ({
    getElementById: (id) => (over.rooms && id in over.rooms ? {querySelector: () => over.rooms![id] ?? null} : null),
    querySelector: () => over.global ?? null,
  });

  it('reads the checked box scoped to THIS battle’s room, never another room’s', () => {
    expect(readMegaToggled(battle('battle-x'), doc({rooms: {'room-battle-x': {checked: true}}}))).toBe(true);
    expect(readMegaToggled(battle('battle-x'), doc({rooms: {'room-battle-x': {checked: false}}}))).toBe(false);
    // A scoped miss is false — a second battle's checked box must not leak in.
    expect(readMegaToggled(battle('battle-x'), doc({rooms: {'room-battle-x': null}, global: {checked: true}}))).toBe(false);
  });

  it('falls back to a document-wide read when the room element is missing (preact client)', () => {
    expect(readMegaToggled(battle('battle-x'), doc({global: {checked: true}}))).toBe(true);
  });

  it('is false when no checkbox exists (already Mega, can’t Mega, not choosing)', () => {
    expect(readMegaToggled(battle('battle-x'), doc())).toBe(false);
  });
});

describe('readMegaForme (a held Mega stone → the forme it unlocks, for the preview)', () => {
  // A Charizard holding Charizardite X: the private team names the stone; the client dex
  // maps it to the forme (`megaStone[species.name]`) and serves that forme's data.
  const megaXData = {exists: true, baseStats: {hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100}, types: ['Fire', 'Dragon'], abilities: {0: 'Tough Claws'}};
  const battle = (over: {item?: string; itemsGet?: (id: string) => unknown; speciesGet?: (name: string) => unknown} = {}): ClientBattle =>
    ({
      gen: 7,
      tier: '[Gen 7] Random Battle',
      sides: [],
      myPokemon: [{ident: 'p1: Charizard', item: over.item ?? 'charizarditex'}],
      dex: {
        items: {get: over.itemsGet ?? ((id: string) => (id === 'charizarditex' ? {megaStone: {Charizard: 'Charizard-Mega-X'}} : undefined))},
        species: {get: over.speciesGet ?? ((name: string) => (name === 'Charizard-Mega-X' ? megaXData : undefined))},
      },
    } as unknown as ClientBattle);
  const charizard = clientMon({ident: 'p1: Charizard', speciesForme: 'Charizard'});

  it('resolves the forme, its dex data, and its forme-locked ability', () => {
    expect(readMegaForme(battle(), charizard)).toEqual({
      speciesForme: 'Charizard-Mega-X',
      speciesData: {baseStats: megaXData.baseStats, types: ['Fire', 'Dragon'], abilities: ['Tough Claws']},
      ability: 'Tough Claws',
    });
  });

  it('is undefined once ALREADY Mega — there is nothing left to preview', () => {
    expect(readMegaForme(battle(), clientMon({ident: 'p1: Charizard', speciesForme: 'Charizard-Mega-X'}))).toBeUndefined();
  });

  it('is undefined when the mon holds no stone (or a non-stone item)', () => {
    expect(readMegaForme(battle({item: ''}), charizard)).toBeUndefined();
    expect(readMegaForme(battle({item: 'leftovers'}), charizard)).toBeUndefined();
  });

  it('falls back to the map’s sole value when the base name doesn’t key it (forme-specific stone)', () => {
    // A stone whose map keys the base under a name we don't literally hold still resolves,
    // because a Mega stone maps exactly one base → one forme.
    const b = battle({itemsGet: () => ({megaStone: {'Some-Other-Key': 'Charizard-Mega-X'}})});
    expect(readMegaForme(b, charizard)?.speciesForme).toBe('Charizard-Mega-X');
  });

  it('gives the forme without dex data/ability when the client dex can’t serve the species', () => {
    // The calc knows a mainline Mega even when this dex lacks it; clearing the ability lets
    // the calc default to the forme's own (readMegaForme returns just the name).
    expect(readMegaForme(battle({speciesGet: () => undefined}), charizard)).toEqual({speciesForme: 'Charizard-Mega-X'});
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

  it('captures the ability slots when present — tolerantly, never costing the record', () => {
    const slotted = {...fullRecord, abilities: {0: 'Flash Fire', 1: 'Flame Body', H: 'Infiltrator'}};
    expect(readSpeciesData(withDex(slotted), clientMon())?.abilities).toEqual(['Flash Fire', 'Flame Body', 'Infiltrator']);
    // Absent or empty slots leave the record intact — the calc fallback doesn't need them.
    expect(readSpeciesData(withDex(fullRecord), clientMon())?.abilities).toBeUndefined();
    expect(readSpeciesData(withDex({...fullRecord, abilities: {}}), clientMon())?.abilities).toBeUndefined();
    expect(readSpeciesData(withDex({...fullRecord, abilities: {0: ''}}), clientMon())?.abilities).toBeUndefined();
  });
});
