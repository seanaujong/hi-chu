import {describe, it, expect} from 'vitest';
import {
  toLiveFacts,
  readLiveForme,
  readLiveTypes,
  readRoosting,
  proteanAlreadyFired,
  readTransformTarget,
  readSpeciesData,
  readSubstitute,
  findByIdent,
  hasLandedDamagingHit,
  mostRecentCleanHit,
  timesAttacked,
  tookEntryHazardDamage,
  switchedIntoStealthRockUnharmed,
  usedDifferentMovesSinceSwitchIn,
  mostRecentCleanOrder,
  switchedInWithoutAnnouncingBalloon,
  endedTurnUnstatused,
  readOwnItem,
  readOwnAbility,
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
  readOwnHazards,
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

  it('survives a client Pokemon with NO boosts table at all', () => {
    // Seen in CI's player-check: a real battle produced a Pokemon with no `boosts`, and
    // `p.boosts['atk']` — the first read in BOOSTABLE order — threw straight into
    // content.ts's catch-all, silently costing that hover its whole hi-chu section. The
    // hover looked merely unhelpful, not broken, which is why it went unnoticed.
    const {boosts: _none, ...noBoosts} = clientMon();
    const f = toLiveFacts(noBoosts as ClientPokemon);
    expect(f.boosts).toEqual({});
    expect(f.accuracyBoost).toBeUndefined();
    expect(f.evasionBoost).toBeUndefined();
    // ...and a present table is still read, so the guard didn't just swallow everything.
    const boosted = toLiveFacts(clientMon({boosts: {atk: 2, accuracy: -1}}));
    expect(boosted.boosts.atk).toBe(2);
    expect(boosted.accuracyBoost).toBe(-1);
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

  it('reads a live retype from the typechange volatile, not from speciesForme', () => {
    // The client flattens every retype trigger into this one volatile, joined on "/".
    const greninja = clientMon({speciesForme: 'Greninja', volatiles: {typechange: ['typechange', 'Ice']}});
    expect(readLiveTypes(greninja)).toEqual(['Ice']);
    const f = toLiveFacts(greninja);
    expect(f.liveTypes).toEqual(['Ice']); // what the calc must see
    expect(f.speciesForme).toBe('Greninja'); // what the set is still published under
    const dual = clientMon({volatiles: {typechange: ['typechange', 'Fire/Flying']}});
    expect(readLiveTypes(dual)).toEqual(['Fire', 'Flying']);
  });

  it('has no live types when nothing retyped the Pokémon', () => {
    expect(readLiveTypes(clientMon())).toBeUndefined();
    expect(readLiveTypes(clientMon({volatiles: {}}))).toBeUndefined();
    expect(toLiveFacts(clientMon()).liveTypes).toBeUndefined();
  });

  it('lets a TERA override the retype, exactly as the client’s own getTypes does', () => {
    // The client refuses to record a typechange on a terastallized Pokémon at all, and
    // returns the Tera type outright. `teraType` already carries that to the calc, so a
    // stale pre-Tera retype here would be two mechanisms arguing over one Pokémon.
    const tera = clientMon({terastallized: 'Water', volatiles: {typechange: ['typechange', 'Ice']}});
    expect(readLiveTypes(tera)).toBeUndefined();
  });

  it('takes `typeadd` only alongside a typechange — alone it is an ADDITION we cannot read', () => {
    // Forest's Curse adds Ghost to whatever the species already is, so reading the volatile
    // as a replacement would make a Corviknight pure Ghost. This reader has no species
    // record to add to, so it declines rather than guess.
    expect(readLiveTypes(clientMon({volatiles: {typeadd: ['typeadd', 'Ghost']}}))).toBeUndefined();
    const both = clientMon({volatiles: {typechange: ['typechange', 'Water'], typeadd: ['typeadd', 'Ghost']}});
    expect(readLiveTypes(both)).toEqual(['Water', 'Ghost']);
  });

  it('reads Roost from turnstatuses, which the client wipes at end of turn', () => {
    // A TURNSTATUS rather than a volatile, and that is the mechanic rather than a detail:
    // the grounding expires with the turn and leaves no `-end` line to read.
    expect(readRoosting(clientMon({turnstatuses: {roost: ['roost']}}))).toBe(true);
    expect(readRoosting(clientMon())).toBe(false);
    expect(readRoosting(clientMon({turnstatuses: {}}))).toBe(false);
    // A different single-turn effect is not Roost.
    expect(readRoosting(clientMon({turnstatuses: {protect: ['protect']}}))).toBe(false);
    expect(toLiveFacts(clientMon({turnstatuses: {roost: ['roost']}})).roosting).toBe(true);
    expect(toLiveFacts(clientMon()).roosting).toBeUndefined();
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

  it('reads accuracy/evasion boosts separately from the six calc-relevant stats', () => {
    const f = toLiveFacts(clientMon({boosts: {atk: 2, accuracy: 1, evasion: 0}}));
    expect(f.accuracyBoost).toBe(1);
    expect(f.evasionBoost).toBeUndefined(); // 0 means unboosted, same as an absent stat
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

describe('readOwnHazards', () => {
  it('defaults to no hazards when the side has none', () => {
    expect(readOwnHazards({active: []})).toEqual({stealthRock: false, spikesLayers: 0});
    expect(readOwnHazards(undefined)).toEqual({stealthRock: false, spikesLayers: 0});
  });

  it('reads Stealth Rock as present/absent', () => {
    const side: ClientSide = {active: [], sideConditions: {stealthrock: ['Stealth Rock', 1]}};
    expect(readOwnHazards(side).stealthRock).toBe(true);
  });

  it("reads Spikes' layer count from the side condition's level", () => {
    for (const layers of [1, 2, 3]) {
      const side: ClientSide = {active: [], sideConditions: {spikes: ['Spikes', layers, 0]}};
      expect(readOwnHazards(side).spikesLayers).toBe(layers);
    }
  });

  it('never trusts malformed Spikes data into a false layer count', () => {
    const bogus: ClientSide = {active: [], sideConditions: {spikes: ['Spikes', 'not-a-number']}};
    expect(readOwnHazards(bogus).spikesLayers).toBe(0);
    const notArray: ClientSide = {active: [], sideConditions: {spikes: 2}};
    expect(readOwnHazards(notArray).spikesLayers).toBe(0);
  });

  it('clamps an out-of-range layer count to 0-3', () => {
    const side: ClientSide = {active: [], sideConditions: {spikes: ['Spikes', 7]}};
    expect(readOwnHazards(side).spikesLayers).toBe(3);
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

describe('mostRecentCleanHit (an observed hit’s MAGNITUDE reveals an item)', () => {
  const withLog = (stepQueue: string[]): ClientBattle => ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue});
  const attacker = {ident: 'p2: Weavile'};
  const defender = {ident: 'p1: Skarmory'};

  it('reads the move and the fraction of max HP actually lost', () => {
    const log = [
      '|switch|p1a: Skarmory|Skarmory, L78|100/100',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|60/100',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({move: 'Icicle Crash', damageFraction: 0.4, attackerBoosts: {}, defenderBoosts: {}, attackerHpPercent: 1, defenderHpPercent: 1});
  });

  it('defaults "before" to full HP when the defender was never seen switching in', () => {
    const log = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|75/100'];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({move: 'Icicle Crash', damageFraction: 0.25, attackerBoosts: {}, defenderBoosts: {}, attackerHpPercent: 1, defenderHpPercent: 1});
  });

  it('excludes a multi-hit move — the shown number is a SUM, not one roll', () => {
    const log = ['|move|p2a: Weavile|Icicle Spear|p1a: Skarmory', '|-damage|p1a: Skarmory|70/100'];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toBeUndefined();
  });

  it('excludes a critical hit — a flat ×1.5 unrelated to the item', () => {
    const log = [
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-crit|p1a: Skarmory',
      '|-damage|p1a: Skarmory|30/100',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toBeUndefined();
  });

  it('excludes a hit that KOed the target — the display clips at 0, only a lower bound', () => {
    const log = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|0 fnt'];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toBeUndefined();
  });

  it('excludes indirect damage ([from] hazard/status/recoil, not the move itself)', () => {
    const log = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|94/100|[from] Stealth Rock'];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toBeUndefined();
  });

  it('follows a boost that happens afterward rather than giving the hit up', () => {
    // The boost is real, but it is not retroactive: the number was produced before it, so
    // the reading keeps the table as it stood and the later stage never enters the calc.
    const log = [
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|60/100',
      '|-boost|p2a: Weavile|atk|1',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({
      move: 'Icicle Crash',
      damageFraction: 0.4,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerHpPercent: 1,
      defenderHpPercent: 1,
    });
  });

  it('goes stale once weather/status/item changes afterward, on EITHER side', () => {
    const hit = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|60/100'];
    expect(mostRecentCleanHit(withLog([...hit, '|-weather|Sandstorm']), attacker, defender)).toBeUndefined();
    expect(mostRecentCleanHit(withLog([...hit, '|-status|p1a: Skarmory|brn']), attacker, defender)).toBeUndefined();
    expect(mostRecentCleanHit(withLog([...hit, '|-enditem|p2a: Weavile|Life Orb']), attacker, defender)).toBeUndefined();
  });

  it('survives the standing weather\u2019s end-of-turn tick, which moves nothing', () => {
    // The residual re-announcement, tagged `[upkeep]`. It fires every turn the weather is
    // up, so counting it as a change made one Snow Warning lead cost the reading for the
    // whole game \u2014 see `changesState`.
    const log = [
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|60/100',
      '|-weather|Snowscape|[upkeep]',
      '|upkeep',
      '|turn|4',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({move: 'Icicle Crash', damageFraction: 0.4, attackerBoosts: {}, defenderBoosts: {}, attackerHpPercent: 1, defenderHpPercent: 1});
  });

  it('still goes stale when the weather actually STARTS or ENDS', () => {
    // The two lines that carry no `[upkeep]`, and both really do move the state.
    const hit = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|60/100'];
    const started = '|-weather|Snowscape|[from] ability: Snow Warning|[of] p2a: Abomasnow';
    expect(mostRecentCleanHit(withLog([...hit, started]), attacker, defender)).toBeUndefined();
    expect(mostRecentCleanHit(withLog([...hit, '|-weather|none']), attacker, defender)).toBeUndefined();
  });

  it('survives the hit\u2019s OWN secondary stat drop, reporting the boosts it landed under', () => {
    // Moonblast's SpA drop is emitted as part of the same move's resolution. Treating it as
    // "something happened since" made the move stale the very hit it had just produced.
    const log = [
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|60/100',
      '|-unboost|p1a: Skarmory|spa|1',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({
      move: 'Icicle Crash',
      damageFraction: 0.4,
      attackerBoosts: {},
      defenderBoosts: {}, // the drop landed AFTER the number, so it was not in effect for it
      attackerHpPercent: 1,
      defenderHpPercent: 1,
    });
  });

  it('reports a boost that WAS in effect, replayed from the log', () => {
    const log = [
      '|-boost|p2a: Weavile|atk|2',
      '|-unboost|p1a: Skarmory|def|1',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|40/100',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({
      move: 'Icicle Crash',
      damageFraction: 0.6,
      attackerBoosts: {atk: 2},
      defenderBoosts: {def: -1},
      attackerHpPercent: 1,
      defenderHpPercent: 1,
    });
  });

  it('replays the boost-table verbs, and forgets a table when its Pok\u00e9mon leaves', () => {
    const hitLines = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|60/100'];
    const at = (lines: string[]) => mostRecentCleanHit(withLog(lines), attacker, defender)?.attackerBoosts;

    expect(at(['|-boost|p2a: Weavile|atk|2', '|-setboost|p2a: Weavile|atk|6', ...hitLines])).toEqual({atk: 6});
    expect(at(['|-boost|p2a: Weavile|atk|2', '|-invertboost|p2a: Weavile', ...hitLines])).toEqual({atk: -2});
    expect(at(['|-boost|p2a: Weavile|atk|2', '|-clearboost|p2a: Weavile', ...hitLines])).toEqual({});
    expect(at(['|-unboost|p2a: Weavile|atk|2', '|-clearnegativeboost|p2a: Weavile', ...hitLines])).toEqual({});
    expect(at(['|-boost|p2a: Weavile|atk|2', '|-clearallboost', ...hitLines])).toEqual({});
    // Capped at +6 the way the client caps it, rather than accumulating past the stage limit.
    expect(at(['|-boost|p2a: Weavile|atk|4', '|-boost|p2a: Weavile|atk|4', ...hitLines])).toEqual({atk: 6});
    // A Pokémon arriving has no boosts, whatever the mon of that name had before it left.
    expect(at([
      '|-boost|p2a: Weavile|atk|2',
      '|switch|p2a: Weavile|Weavile, L78|100/100',
      ...hitLines,
    ])).toEqual({});
  });

  it('reports the HP each side stood at, not the HP left behind', () => {
    // The attacker has been chipped; the defender is read at the health this hit was
    // resolved AGAINST, not the health it left. Both arm thresholds in the calc — the four
    // pinch abilities on one side, Multiscale on the other.
    const log = [
      '|switch|p2a: Weavile|Weavile, L78|100/100',
      '|switch|p1a: Skarmory|Skarmory, L78|100/100',
      '|move|p1a: Skarmory|Brave Bird|p2a: Weavile',
      '|-damage|p2a: Weavile|20/100',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|60/100',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toMatchObject({
      damageFraction: 0.4,
      attackerHpPercent: 0.2, // Weavile swung from 20%, where Swarm-style abilities are live
      defenderHpPercent: 1, // Skarmory was whole when the hit resolved, not at the 60% left
    });
  });

  it('carries the HP a Pokémon RETURNS at, not the HP it left on', () => {
    // Boosts reset on a switch and HP does not, so the two snapshots part company here.
    const log = [
      '|switch|p2a: Weavile|Weavile, L78|100/100',
      '|-damage|p2a: Weavile|30/100',
      '|switch|p2a: Gengar|Gengar, L80|100/100',
      '|switch|p2a: Weavile|Weavile, L78|30/100',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|60/100',
    ];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toMatchObject({attackerHpPercent: 0.3});
  });

  it('still abstains on a boost line whose DIRECTION it cannot replay', () => {
    // `-swapboost` and `-copyboost` each name two Pokémon; reading the direction backwards
    // would put a boost on the wrong side, so a hit followed by one is given up on.
    const hit = ['|move|p2a: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|60/100'];
    expect(mostRecentCleanHit(withLog([...hit, '|-swapboost|p2a: Weavile|p1a: Skarmory|atk']), attacker, defender)).toBeUndefined();
    expect(mostRecentCleanHit(withLog([...hit, '|-copyboost|p2a: Weavile|p1a: Skarmory']), attacker, defender)).toBeUndefined();
  });

  it('picks the MOST RECENT clean hit, not the first', () => {
    const log = [
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|80/100',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|50/100',
    ];
    const result = mostRecentCleanHit(withLog(log), attacker, defender);
    expect(result?.move).toBe('Icicle Crash');
    expect(result?.damageFraction).toBeCloseTo(0.3, 10);
  });

  it('does not attribute a foe’s damage to us (mover resets on the next move)', () => {
    const log = ['|move|p1a: Skarmory|Brave Bird|p2a: Weavile', '|-damage|p2a: Weavile|40/100'];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toBeUndefined();
  });

  it('matches by side+name across a switch, not by slot letter', () => {
    const log = ['|move|p2b: Weavile|Icicle Crash|p1a: Skarmory', '|-damage|p1a: Skarmory|60/100'];
    expect(mostRecentCleanHit(withLog(log), attacker, defender)).toEqual({move: 'Icicle Crash', damageFraction: 0.4, attackerBoosts: {}, defenderBoosts: {}, attackerHpPercent: 1, defenderHpPercent: 1});
  });

  it('is undefined with no log or no ident (conservative — never a false reading)', () => {
    expect(mostRecentCleanHit(withLog([]), attacker, defender)).toBeUndefined();
    expect(mostRecentCleanHit(withLog(['|move|p2a: Weavile|X|p1a: Skarmory', '|-damage|p1a: Skarmory|1/2']), {}, defender)).toBeUndefined();
  });
});

describe('timesAttacked (RAGE FIST’s power scales with this)', () => {
  const withLog = (stepQueue: string[]): ClientBattle => ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue});
  const noivern = clientMon({ident: 'p1: Noivern'});

  it('counts a direct move hit landing on the mon', () => {
    const log = ['|move|p2a: Corviknight|Brave Bird|p1a: Noivern', '|-damage|p1a: Noivern|140/298'];
    expect(timesAttacked(withLog(log), noivern)).toBe(1);
  });

  it('sums every hit of a multi-hit move — one -damage line per hit', () => {
    const log = [
      '|move|p2a: Cloyster|Icicle Spear|p1a: Noivern',
      '|-damage|p1a: Noivern|220/298',
      '|-damage|p1a: Noivern|140/298',
      '|-damage|p1a: Noivern|60/298',
      '|-hitcount|p1a: Noivern|3',
    ];
    expect(timesAttacked(withLog(log), noivern)).toBe(3);
  });

  it('ignores indirect damage — hazards, status and recoil carry [from]', () => {
    const log = [
      '|move|p2a: Corviknight|Body Press|p1a: Noivern',
      '|-damage|p1a: Noivern|200/298|[from] Stealth Rock', // not this move's hit
    ];
    expect(timesAttacked(withLog(log), noivern)).toBe(0);
  });

  it('does not count a self-inflicted hit (confusion) — the sim tags it [from] confusion, no [move] of its own', () => {
    // Real shape (sim/battle.ts spreadDamage): confusion damages via `this.damage()` directly,
    // with no `|move|` line at all — just the activate, then a tagged -damage.
    const log = ['|-activate|p1a: Noivern|confusion', '|-damage|p1a: Noivern|250/298|[from] confusion'];
    expect(timesAttacked(withLog(log), noivern)).toBe(0);
  });

  it('does not count a hit a Substitute blocked — the sub absorbs it, no -damage on the real mon', () => {
    const log = ['|move|p2a: Corviknight|Brave Bird|p1a: Noivern', '|-activate|p1a: Noivern|move: Substitute|[damage]'];
    expect(timesAttacked(withLog(log), noivern)).toBe(0);
  });

  it('accumulates across separate hits over the course of the battle', () => {
    const log = [
      '|move|p2a: Corviknight|Brave Bird|p1a: Noivern',
      '|-damage|p1a: Noivern|200/298',
      '|turn|3',
      '|move|p2a: Skarmory|Body Press|p1a: Noivern',
      '|-damage|p1a: Noivern|140/298',
    ];
    expect(timesAttacked(withLog(log), noivern)).toBe(2);
  });

  it('matches by side+name across a switch, not by slot letter', () => {
    const log = ['|switch|p1b: Noivern|Noivern, L82|298/298', '|move|p2a: Corviknight|Brave Bird|p1b: Noivern', '|-damage|p1b: Noivern|200/298'];
    expect(timesAttacked(withLog(log), noivern)).toBe(1);
  });

  it('is 0 with no log or no ident (conservative — never a false count)', () => {
    expect(timesAttacked(withLog([]), noivern)).toBe(0);
    expect(timesAttacked(withLog(['|move|p2a: X|Tackle|p1a: Noivern', '|-damage|p1a: Noivern|1/2']), clientMon({}))).toBe(0);
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

describe('mostRecentCleanOrder (who moved first, when that is safe to read)', () => {
  // The client dex is the priority source — @smogon/calc's move data zeroes every negative
  // bracket, so reading it there would put Dragon Tail in the 0 bracket with Tackle.
  const DEX: Record<string, {priority: number; category: string; type: string; flags?: Record<string, number>}> = {
    Tackle: {priority: 0, category: 'Physical', type: 'Normal'},
    'Shadow Ball': {priority: 0, category: 'Special', type: 'Ghost'},
    'Aqua Jet': {priority: 1, category: 'Physical', type: 'Water'},
    'Dragon Tail': {priority: -6, category: 'Physical', type: 'Dragon'},
    'Drain Punch': {priority: 0, category: 'Physical', type: 'Fighting', flags: {heal: 1}},
  };
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({
      gen: 9,
      tier: '[Gen 9] Random Battle',
      sides: [],
      stepQueue,
      dex: {species: {get: () => undefined}, moves: {get: (n: string) => DEX[n]}},
    } as unknown as ClientBattle);
  const us = clientMon({ident: 'p1: Noivern'});
  const them = clientMon({ident: 'p2: Gholdengo'});
  const OURS = '|move|p1a: Noivern|Tackle|p2a: Gholdengo';
  const THEIRS = '|move|p2a: Gholdengo|Shadow Ball|p1a: Noivern';

  it('reads a healing move from `flags.heal`, the only source the client exposes', () => {
    // The client's `Move` class publishes `flags` and deliberately not `drain`, however much
    // its raw data carries both — so reading `drain` came back undefined for every move and
    // Triage's +3 could never fire. `flags.heal` is also the condition the sim's own Triage
    // actually tests, so the reachable field and the correct one turn out to be the same.
    const log = ['|turn|1', '|move|p2a: Gholdengo|Drain Punch|p1a: Noivern', OURS, '|turn|2'];
    expect(mostRecentCleanOrder(withLog(log), us, them)?.theirs.healing).toBe(true);
    expect(mostRecentCleanOrder(withLog(['|turn|1', THEIRS, OURS, '|turn|2']), us, them)?.theirs.healing).toBe(false);
  });

  it('reads the order, with each move’s bracket attached', () => {
    const got = mostRecentCleanOrder(withLog(['|turn|1', THEIRS, OURS, '|turn|2']), us, them);
    expect(got?.theyMovedFirst).toBe(true);
    expect(got?.theirs).toEqual({name: 'Shadow Ball', priority: 0, category: 'Special', type: 'Ghost', healing: false});
    expect(got?.ours.name).toBe('Tackle');
  });

  it('reads the other order too', () => {
    expect(mostRecentCleanOrder(withLog(['|turn|1', OURS, THEIRS, '|turn|2']), us, them)?.theyMovedFirst).toBe(false);
  });

  it('takes the MOST RECENT readable turn', () => {
    const log = ['|turn|1', THEIRS, OURS, '|turn|2', OURS, THEIRS, '|turn|3'];
    expect(mostRecentCleanOrder(withLog(log), us, them)?.theyMovedFirst).toBe(false);
  });

  it('declines a turn where only one of them moved', () => {
    expect(mostRecentCleanOrder(withLog(['|turn|1', OURS, '|turn|2']), us, them)).toBeUndefined();
  });

  it('declines a turn where one of them could not move at all', () => {
    const log = ['|turn|1', THEIRS, '|cant|p1a: Noivern|par', '|turn|2'];
    expect(mostRecentCleanOrder(withLog(log), us, them)).toBeUndefined();
  });

  it('declines a CALLED move — it is not the mon’s own ordered action', () => {
    const called = '|move|p2a: Gholdengo|Shadow Ball|p1a: Noivern|[from]Copycat';
    expect(mostRecentCleanOrder(withLog(['|turn|1', called, OURS, '|turn|2']), us, them)).toBeUndefined();
  });

  it('declines a turn where anything ACTIVATED — Quick Claw and friends always announce', () => {
    const log = ['|turn|1', '|-activate|p2a: Gholdengo|item: Quick Claw', THEIRS, OURS, '|turn|2'];
    expect(mostRecentCleanOrder(withLog(log), us, them)).toBeUndefined();
  });

  it('declines a turn that contains After You', () => {
    const log = ['|turn|1', '|move|p2a: Gholdengo|After You|p1a: Noivern', THEIRS, OURS, '|turn|2'];
    expect(mostRecentCleanOrder(withLog(log), us, them)).toBeUndefined();
  });

  it('declines when a SPEED boost lands after the reading — the comparison has moved', () => {
    const log = ['|turn|1', THEIRS, OURS, '|turn|2', '|-boost|p2a: Gholdengo|spe|1'];
    expect(mostRecentCleanOrder(withLog(log), us, them)).toBeUndefined();
  });

  it('survives a boost to something OTHER than Speed, and a hazard going up', () => {
    // The precision that makes this readable at all: taking every -boost and -sidestart
    // wholesale would throw away most real turns, since an Attack drop and a Stealth Rock
    // are both common and neither moves anybody's Speed.
    const log = ['|turn|1', THEIRS, OURS, '|turn|2', '|-unboost|p1a: Noivern|atk|1', '|-sidestart|p1: Sean|move: Stealth Rock'];
    expect(mostRecentCleanOrder(withLog(log), us, them)?.theyMovedFirst).toBe(true);
  });

  it('declines when Tailwind goes up after the reading', () => {
    const log = ['|turn|1', THEIRS, OURS, '|turn|2', '|-sidestart|p2: Foe|move: Tailwind'];
    expect(mostRecentCleanOrder(withLog(log), us, them)).toBeUndefined();
  });

  it('declines once either of them has LEFT the field', () => {
    const log = ['|turn|1', THEIRS, OURS, '|turn|2', '|switch|p2a: Corviknight|Corviknight, M|100/100'];
    expect(mostRecentCleanOrder(withLog(log), us, them)).toBeUndefined();
  });

  it('declines a move the dex cannot describe — an unknown bracket is not the 0 bracket', () => {
    const unknown = '|move|p2a: Gholdengo|Mystery Move|p1a: Noivern';
    expect(mostRecentCleanOrder(withLog(['|turn|1', unknown, OURS, '|turn|2']), us, them)).toBeUndefined();
  });
});

describe('proteanAlreadyFired (gen 9 fires Protean/Libero once per switch-in)', () => {
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue} as unknown as ClientBattle);
  const greninja = clientMon({ident: 'p2: Greninja'});
  const IN = '|switch|p2a: Greninja|Greninja, M|100/100';
  const CONVERT = '|-start|p2a: Greninja|typechange|Ice|[from] ability: Protean';

  it('is true once the log shows the ability converting this Pokémon', () => {
    expect(proteanAlreadyFired(withLog([IN, '|move|p2a: Greninja|Ice Beam|p1a: Chansey', CONVERT]), greninja)).toBe(true);
  });

  it('is false before it has fired — the next move still converts and still gets STAB', () => {
    expect(proteanAlreadyFired(withLog([IN, '|turn|2']), greninja)).toBe(false);
  });

  it('reads the ATTRIBUTION, so a retype from somewhere else does not spend the ability', () => {
    // Soak on an unspent Protean holder. Reading `typechange`'s mere presence would call the
    // ability spent and quietly drop a STAB the next move genuinely gets.
    const soaked = '|-start|p2a: Greninja|typechange|Water|[from] move: Soak';
    expect(proteanAlreadyFired(withLog([IN, soaked]), greninja)).toBe(false);
  });

  it('resets when the Pokémon leaves — and leaving has no line of its own', () => {
    // The log never says a Pokémon switched OUT, only that somebody else arrived in its
    // slot. Miss that and the flag outlives the stint it belongs to.
    const replaced = [IN, CONVERT, '|switch|p2a: Corviknight|Corviknight, M|100/100'];
    expect(proteanAlreadyFired(withLog(replaced), greninja)).toBe(false);
    // …and coming back in starts a fresh, unspent stint.
    expect(proteanAlreadyFired(withLog([...replaced, IN]), greninja)).toBe(false);
    expect(proteanAlreadyFired(withLog([...replaced, IN, CONVERT]), greninja)).toBe(true);
  });

  it('ignores another Pokémon’s conversion', () => {
    const theirs = '|-start|p1a: Cinderace|typechange|Fire|[from] ability: Libero';
    expect(proteanAlreadyFired(withLog([IN, theirs]), greninja)).toBe(false);
  });
});

describe('usedDifferentMovesSinceSwitchIn (rules out a Choice item)', () => {
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue} as unknown as ClientBattle);
  const gholdengo = clientMon({ident: 'p2: Gholdengo'});
  const IN = '|switch|p2a: Gholdengo|Gholdengo|100/100';

  it('is true once two different moves are freely selected in one stint', () => {
    const log = [IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey', '|turn|2', '|move|p2a: Gholdengo|Shadow Ball|p1a: Chansey'];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(true);
  });

  it('is false for the same move repeated — the locked mon’s normal behaviour', () => {
    const log = [IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey', '|turn|2', '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey'];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(false);
  });

  it('is false across a switch — the lock dies on the way out, so this proves nothing', () => {
    // The exact case `revealedMoves.length >= 2` would get wrong: two moves, never unlocked.
    const log = [
      IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey',
      '|switch|p2a: Corviknight|Corviknight, M|100/100',
      IN, '|move|p2a: Gholdengo|Shadow Ball|p1a: Chansey',
    ];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(false);
  });

  it('ignores a CALLED move — the player chose the caller, not the callee', () => {
    const log = [IN, '|move|p2a: Gholdengo|Sleep Talk|p2a: Gholdengo', '|move|p2a: Gholdengo|Shadow Ball|p1a: Chansey|[from]Sleep Talk'];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(false);
  });

  it('ignores a `[still]` line — that IS the choice lock rejecting a different click', () => {
    // `choicelock.onBeforeMove` emits the move line, tags it [still] and fails it. Reading
    // that as a free selection would turn the lock's own signature into proof of its absence.
    const log = [IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey', '|turn|2', '|move|p2a: Gholdengo|Shadow Ball||[still]', '|-fail|p2a: Gholdengo'];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(false);
  });

  it('ignores Struggle — the sim exempts it from the lock by name', () => {
    const log = [IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey', '|turn|2', '|move|p2a: Gholdengo|Struggle|p1a: Chansey'];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(false);
  });

  it('ignores moves picked while Magic Room or Embargo suspends the item', () => {
    const magicRoom = [
      IN, '|-fieldstart|move: Magic Room|[of] p1a: Chansey',
      '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey', '|turn|2', '|move|p2a: Gholdengo|Shadow Ball|p1a: Chansey',
    ];
    expect(usedDifferentMovesSinceSwitchIn(withLog(magicRoom), gholdengo)).toBe(false);
    const embargo = [
      IN, '|-start|p2a: Gholdengo|Embargo',
      '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey', '|turn|2', '|move|p2a: Gholdengo|Shadow Ball|p1a: Chansey',
    ];
    expect(usedDifferentMovesSinceSwitchIn(withLog(embargo), gholdengo)).toBe(false);
  });

  it('resumes reading once Magic Room ends — the lock applies again', () => {
    const log = [
      IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey',
      '|-fieldstart|move: Magic Room|[of] p1a: Chansey', '|move|p2a: Gholdengo|Recover|p2a: Gholdengo',
      '|-fieldend|move: Magic Room|[of] p1a: Chansey', '|move|p2a: Gholdengo|Shadow Ball|p1a: Chansey',
    ];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(true);
  });

  it('does not attribute another Pokémon’s moves to this one', () => {
    const log = [IN, '|move|p1a: Chansey|Seismic Toss|p2a: Gholdengo', '|turn|2', '|move|p1a: Chansey|Soft-Boiled|p1a: Chansey'];
    expect(usedDifferentMovesSinceSwitchIn(withLog(log), gholdengo)).toBe(false);
  });

  it('is false on an empty log, or for a mon with no ident', () => {
    expect(usedDifferentMovesSinceSwitchIn(withLog([]), gholdengo)).toBe(false);
    expect(usedDifferentMovesSinceSwitchIn(withLog([IN, '|move|p2a: Gholdengo|Make It Rain|p1a: Chansey']), clientMon({}))).toBe(false);
  });
});

describe('switchedInWithoutAnnouncingBalloon (rules out Air Balloon)', () => {
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue} as unknown as ClientBattle);
  const heatran = clientMon({ident: 'p1: Heatran'});
  const IN = '|switch|p1a: Heatran|Heatran, M|344/344';
  const SAYS_BALLOON = '|-item|p1a: Heatran|Air Balloon';

  // The opening of a real battle, line for line out of the sim: BOTH sides switch in, and
  // only then do the switch-in effects fire. This is why the scan may not stop at a switch.
  const lead = (announces: boolean): string[] => [
    '|start',
    IN,
    '|switch|p2a: Landorus|Landorus-Therian, M|340/340',
    '|-ability|p2a: Landorus|Intimidate|boost',
    '|-unboost|p1a: Heatran|atk|1',
    ...(announces ? [SAYS_BALLOON] : []),
    '|turn|1',
  ];

  it('is true when a lead comes in silently — the announcement would have preceded |turn|', () => {
    expect(switchedInWithoutAnnouncingBalloon(withLog(lead(false)), heatran)).toBe(true);
  });

  it('is false when the lead announces one, though the OPPONENT’s switch line sits between', () => {
    // The regression that matters: a scan stopping at the next |switch| would never reach
    // the announcement, and would rule out a balloon the battle just showed us.
    expect(switchedInWithoutAnnouncingBalloon(withLog(lead(true)), heatran)).toBe(false);
  });

  it('reads a mid-battle switch-in, where the announcement precedes the turn’s first move', () => {
    const quiet = ['|turn|1', IN, '|move|p2a: Landorus|Earthquake|p1a: Heatran'];
    expect(switchedInWithoutAnnouncingBalloon(withLog(quiet), heatran)).toBe(true);
    const loud = ['|turn|1', IN, SAYS_BALLOON, '|move|p2a: Landorus|Earthquake|p1a: Heatran'];
    expect(switchedInWithoutAnnouncingBalloon(withLog(loud), heatran)).toBe(false);
  });

  it('ignores a switch-in under Gravity or Magic Room, which silence the balloon', () => {
    for (const suppressor of ['|-fieldstart|move: Gravity', '|-fieldstart|move: Magic Room|[of] p2a: Landorus']) {
      expect(switchedInWithoutAnnouncingBalloon(withLog([suppressor, IN, '|turn|2']), heatran)).toBe(false);
    }
  });

  it('resumes reading once the suppressor ends', () => {
    const log = [
      '|-fieldstart|move: Gravity', IN, '|turn|2',
      '|-fieldend|move: Gravity', '|switch|p1a: Skarmory|Skarmory, F|292/292', IN, '|turn|4',
    ];
    expect(switchedInWithoutAnnouncingBalloon(withLog(log), heatran)).toBe(true);
  });

  it('counts a drag the same as a switch — Whirlwind still brings the item in', () => {
    const log = ['|move|p2a: Landorus|Whirlwind|p1a: Skarmory', '|drag|p1a: Heatran|Heatran, M|344/344', '|turn|2'];
    expect(switchedInWithoutAnnouncingBalloon(withLog(log), heatran)).toBe(true);
  });

  it('does not read another Pokémon’s announcement as this one’s', () => {
    const log = [IN, '|-item|p2a: Landorus|Air Balloon', '|turn|1'];
    expect(switchedInWithoutAnnouncingBalloon(withLog(log), heatran)).toBe(true);
  });

  it('does not read some OTHER revealed item as the balloon', () => {
    const log = [IN, '|-item|p1a: Heatran|Leftovers|[from] move: Trick', '|turn|1'];
    expect(switchedInWithoutAnnouncingBalloon(withLog(log), heatran)).toBe(true);
  });

  it('says nothing while the switch-in resolution is still unfinished', () => {
    // A log that stops right after the switch has not yet reported the announcement, so
    // reading it as silence would invent a rule-out. Missing one beats making a false one.
    expect(switchedInWithoutAnnouncingBalloon(withLog(['|start', IN]), heatran)).toBe(false);
  });

  it('is false on an empty log, or for a mon with no ident', () => {
    expect(switchedInWithoutAnnouncingBalloon(withLog([]), heatran)).toBe(false);
    expect(switchedInWithoutAnnouncingBalloon(withLog(lead(false)), clientMon({}))).toBe(false);
  });
});

describe('endedTurnUnstatused (rules out Flame Orb / Toxic Orb)', () => {
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue} as unknown as ClientBattle);
  const ursaluna = clientMon({ident: 'p1: Ursaluna'});
  const IN = '|switch|p1a: Ursaluna|Ursaluna, L79, F|335/335';
  const FOE_IN = '|switch|p2a: Blissey|Blissey, L80, F|539/539';
  // The residual phase, line for line out of the sim: a blank separator, then the residuals,
  // then |upkeep| once they have all run.
  const RESIDUALS = ['|', '|-heal|p2a: Blissey|149/539|[from] item: Leftovers'];
  const PROCS = '|-status|p1a: Ursaluna|brn|[from] item: Flame Orb';

  it('is true once a turn ends with the holder still on the field and clean', () => {
    const log = ['|start', IN, FOE_IN, '|turn|1', '|move|p1a: Ursaluna|Facade|p2a: Blissey',
      ...RESIDUALS, '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(true);
  });

  it('is false when the orb actually fires — the status lands before |upkeep|', () => {
    const log = ['|start', IN, FOE_IN, '|turn|1', '|move|p1a: Ursaluna|Facade|p2a: Blissey',
      ...RESIDUALS, PROCS, '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(false);
  });

  it('does not count the opening switch-ins, which reach |turn|1 with no residual between', () => {
    // The reason the marker is |upkeep| and not |turn|: nothing has ended yet at turn 1.
    expect(endedTurnUnstatused(withLog(['|start', IN, FOE_IN, '|turn|1']), ursaluna)).toBe(false);
  });

  it('does not credit a faint replacement, which the sim brings in AFTER |upkeep|', () => {
    const log = ['|start', '|switch|p1a: Magikarp|Magikarp, L5, M|19/19', FOE_IN, '|turn|1',
      '|move|p2a: Blissey|Seismic Toss|p1a: Magikarp', '|-damage|p1a: Magikarp|0 fnt',
      '|faint|p1a: Magikarp', '|', '|upkeep', '|', IN, '|turn|2'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(false);
  });

  it('proves nothing about a turn the holder ended already statused', () => {
    const log = ['|start', IN, FOE_IN, '|turn|1', '|move|p2a: Blissey|Thunder Wave|p1a: Ursaluna',
      '|-status|p1a: Ursaluna|par', ...RESIDUALS, '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(false);
  });

  it('tracks the status along the LOG, so a later cure does not backdate a clean turn', () => {
    // The snapshot ends clean either way; only the log says whether the orb ever had its
    // chance. A turn that ended paralysed stays worthless after the paralysis is cured.
    const statused = ['|start', IN, FOE_IN, '|turn|1', '|-status|p1a: Ursaluna|par',
      '|upkeep', '|turn|2', '|-curestatus|p1a: Ursaluna|par|[from] move: Heal Bell'];
    expect(endedTurnUnstatused(withLog(statused), ursaluna)).toBe(false);
    expect(endedTurnUnstatused(withLog([...statused, '|upkeep', '|turn|3']), ursaluna)).toBe(true);
  });

  it('reads the status a returning Pokémon carries in on its switch line', () => {
    const log = ['|start', IN, FOE_IN, '|turn|1', '|switch|p1a: Skarmory|Skarmory, F|292/292',
      '|upkeep', '|turn|2', '|switch|p1a: Ursaluna|Ursaluna, L79, F|335/335 tox', '|upkeep', '|turn|3'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(false);
  });

  it('ignores a turn under Misty Terrain, Magic Room or Embargo — each silences the orb', () => {
    // Misty Terrain is the trap: the sim refuses the status without emitting anything at all
    // (only a |debug| line the client never carries), so silence there is not evidence.
    const suppressors = [
      '|-fieldstart|move: Misty Terrain',
      '|-fieldstart|move: Magic Room|[of] p2a: Blissey',
      '|-start|p1a: Ursaluna|move: Embargo',
    ];
    for (const suppressor of suppressors) {
      const log = ['|start', IN, FOE_IN, suppressor, '|turn|1', ...RESIDUALS, '|upkeep', '|turn|2'];
      expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(false);
    }
  });

  it('resumes reading once the suppressor ends', () => {
    const log = ['|start', IN, FOE_IN, '|-fieldstart|move: Misty Terrain', '|turn|1', '|upkeep',
      '|turn|2', '|-fieldend|move: Misty Terrain', '|upkeep', '|turn|3'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(true);
  });

  it('stops reading at a Tera, which changes what the holder can even catch', () => {
    const tera = '|-terastallize|p1a: Ursaluna|Fire';
    const after = ['|start', IN, FOE_IN, '|turn|1', tera, ...RESIDUALS, '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(after), ursaluna)).toBe(false);
    // A quiet turn BEFORE the Tera is still evidence, so the scan keeps what it already had.
    const before = ['|start', IN, FOE_IN, '|turn|1', '|upkeep', '|turn|2', tera, '|upkeep', '|turn|3'];
    expect(endedTurnUnstatused(withLog(before), ursaluna)).toBe(true);
    // …and someone ELSE terastallizing is none of our business.
    const foeTera = ['|start', IN, FOE_IN, '|turn|1', '|-terastallize|p2a: Blissey|Fairy',
      '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(foeTera), ursaluna)).toBe(true);
  });

  it('tracks the field per SLOT, so a doubles partner switching does not evict the holder', () => {
    const log = ['|start', IN, '|switch|p1b: Skarmory|Skarmory, F|292/292', FOE_IN, '|turn|1',
      '|switch|p1b: Chansey|Chansey, F|100/100', '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(log), ursaluna)).toBe(true);
  });

  it('is false while the holder is off the field, on an empty log, or with no ident', () => {
    const benched = ['|start', '|switch|p1a: Skarmory|Skarmory, F|292/292', FOE_IN, '|turn|1',
      '|upkeep', '|turn|2'];
    expect(endedTurnUnstatused(withLog(benched), ursaluna)).toBe(false);
    expect(endedTurnUnstatused(withLog([]), ursaluna)).toBe(false);
    expect(endedTurnUnstatused(withLog(['|start', IN, '|upkeep']), clientMon({}))).toBe(false);
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

describe('readOwnAbility (your private CURRENT ability, for your own move damage only)', () => {
  // The public battle-view Pokémon only learns an ability once something reveals it in
  // the log, even for our own active — so a silent ability (Huge Power here) would
  // otherwise be invisible to our own damage calc until something else reveals it.
  const battle = (myPokemon?: unknown): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], myPokemon} as unknown as ClientBattle);
  const mon = clientMon({ident: 'p1: Azumarill'});

  it("reads the viewer's own CURRENT ability by ident (id form)", () => {
    expect(readOwnAbility(battle([{ident: 'p1: Azumarill', ability: 'hugepower', baseAbility: 'hugepower'}]), mon)).toBe(
      'hugepower',
    );
  });

  it('reads the infected ability once something (e.g. Mummy) has changed it mid-battle', () => {
    // baseAbility stays the innate one; ability is what the request reports as CURRENT —
    // readOwnAbility deliberately reads the current one, matching the public field's role.
    expect(readOwnAbility(battle([{ident: 'p1: Azumarill', ability: 'mummy', baseAbility: 'hugepower'}]), mon)).toBe('mummy');
  });

  it('is undefined when spectating (no myPokemon), when nothing matches the ident, or in gen ≤6 (no live field)', () => {
    expect(readOwnAbility(battle(undefined), mon)).toBeUndefined();
    expect(readOwnAbility(battle([{ident: 'p1: Cetitan', ability: 'slushrush'}]), mon)).toBeUndefined();
    expect(readOwnAbility(battle([{ident: 'p1: Azumarill'}]), mon)).toBeUndefined();
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

describe('readSubstitute', () => {
  const subbed = (over: Partial<ClientPokemon> = {}) =>
    clientMon({ident: 'p2a: Keldeo', volatiles: {substitute: ['substitute']}, ...over});
  const withLog = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [], stepQueue}) as unknown as ClientBattle;

  it('reports nothing for a Pokémon with no sub, whatever the log once said', () => {
    const log = ['|-start|p2a: Keldeo|Substitute', '|-end|p2a: Keldeo|Substitute'];
    expect(readSubstitute(withLog(log), clientMon({ident: 'p2a: Keldeo', volatiles: {}}))).toBeUndefined();
  });

  it('reports a fresh sub as undented', () => {
    const log = ['|move|p2a: Keldeo|Substitute|p2a: Keldeo', '|-start|p2a: Keldeo|Substitute'];
    expect(readSubstitute(withLog(log), subbed())).toEqual({dented: false});
  });

  it('marks it dented once a hit has been absorbed', () => {
    const log = [
      '|-start|p2a: Keldeo|Substitute',
      '|move|p1a: Noivern|Flamethrower|p2a: Keldeo',
      '|-activate|p2a: Keldeo|move: Substitute|[damage]',
    ];
    expect(readSubstitute(withLog(log), subbed())).toEqual({dented: true});
  });

  it('does NOT count a status move the sub merely blocked — no damage, no dent', () => {
    const log = ['|-start|p2a: Keldeo|Substitute', '|-activate|p2a: Keldeo|move: Substitute'];
    expect(readSubstitute(withLog(log), subbed())).toEqual({dented: false});
  });

  it('forgets a PREVIOUS sub’s damage when a new one goes up', () => {
    // The doll standing now was made this turn; carrying the last one's chip onto it would
    // understate how many hits it can take.
    const log = [
      '|-start|p2a: Keldeo|Substitute',
      '|-activate|p2a: Keldeo|move: Substitute|[damage]',
      '|-end|p2a: Keldeo|Substitute',
      '|-start|p2a: Keldeo|Substitute',
    ];
    expect(readSubstitute(withLog(log), subbed())).toEqual({dented: false});
  });

  it('keeps one Pokémon’s sub separate from another’s', () => {
    const log = [
      '|-start|p2a: Keldeo|Substitute',
      '|-start|p1a: Noivern|Substitute',
      '|-activate|p1a: Noivern|move: Substitute|[damage]',
    ];
    expect(readSubstitute(withLog(log), subbed())).toEqual({dented: false});
  });

  it('names the MAKER of a Shed Tail sub — the doll was cut from its HP, not the wearer’s', () => {
    // Captured verbatim from the simulator: the `-start` lands on the user, and the sub
    // travels on the incoming mon's own switch line.
    const log = [
      '|move|p1a: Cyclizar|Shed Tail|p1a: Cyclizar',
      '|-start|p1a: Cyclizar|Substitute|[from] move: Shed Tail',
      '|-damage|p1a: Cyclizar|127/255',
      '|switch|p1a: Gliscor|Gliscor, L84, M|263/263|[from] Shed Tail',
    ];
    const gliscor = clientMon({ident: 'p1a: Gliscor', volatiles: {substitute: ['substitute']}});
    expect(readSubstitute(withLog(log), gliscor)).toEqual({dented: false, shedTailMaker: 'p1a: Cyclizar'});
  });

  it('claims no maker for an ordinary switch, which never carries a sub in', () => {
    const log = ['|-start|p1a: Cyclizar|Substitute', '|switch|p1a: Gliscor|Gliscor, L84, M|263/263'];
    const gliscor = clientMon({ident: 'p1a: Gliscor', volatiles: {substitute: ['substitute']}});
    expect(readSubstitute(withLog(log), gliscor)).toEqual({dented: false});
  });

  it('still reports the sub the volatile proves, even with no log to explain it', () => {
    expect(readSubstitute(withLog([]), subbed())).toEqual({dented: false});
  });
});

describe('findByIdent', () => {
  const cyclizar = clientMon({ident: 'p1: Cyclizar', speciesForme: 'Cyclizar'});
  const gliscor = clientMon({ident: 'p1: Gliscor', speciesForme: 'Gliscor'});
  const battle = {
    gen: 9,
    tier: '[Gen 9] Random Battle',
    sides: [{active: [gliscor], pokemon: [gliscor, cyclizar]}, {active: []}],
  } as unknown as ClientBattle;

  it('finds a Pokémon that has switched OUT — the roster outlives the field', () => {
    // A Shed Tail user is off the field by definition, so `active` alone would never find it.
    expect(findByIdent(battle, 'p1a: Cyclizar')?.speciesForme).toBe('Cyclizar');
  });

  it('matches slot-independently, so a log ident finds a roster one', () => {
    expect(findByIdent(battle, 'p1a: Gliscor')?.speciesForme).toBe('Gliscor');
  });

  it('answers undefined for a name nobody has', () => {
    expect(findByIdent(battle, 'p2a: Keldeo')).toBeUndefined();
    expect(findByIdent(battle, '')).toBeUndefined();
  });
});
