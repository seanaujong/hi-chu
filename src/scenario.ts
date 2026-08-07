// Named, reproducible battle STATES, built by mutating a real captured one.
//
// Every scenario starts from `__fixtures__/replay-*.json` — a two-sided battle captured live
// from a Showdown replay — and changes only what it means to demonstrate. That direction is
// the whole point, not an implementation detail: the Showdown client ships no types, so a
// `ClientBattle` authored from scratch would be OUR idea of what the client produces rather
// than the client's. A test or a preview built on one can pass beautifully while the live
// hover is broken. Mutating a captured battle keeps every field nobody touched honest.
//
// Two consumers, which is why this is not a `*.test.ts` file: `section.test.ts` drives the
// exact code path a live hover runs, and `previews.ts` renders the same states to look at.
// A state worth previewing is usually one worth asserting on, so they share ONE builder
// rather than drifting into two ideas of what "a battle with a Substitute up" means.

import fixture from './__fixtures__/replay-gen9randombattle-2640322654-turn5.json';
import type {ClientBattle, ClientPokemon, ClientSide} from './battle/readState.js';
import type {RandbatsData} from './core/types.js';

/** The captured battle's own randbats feed, so every scenario resolves sets offline. */
export const scenarioData = fixture.randbats as unknown as RandbatsData;

/**
 * The same feed plus Ditto's real randbats set — one move, Transform, and a Choice Scarf.
 * The capture holds only the species that battle contained, so a scenario that swaps the foe
 * for a Ditto has to bring its entry along or the hover resolves nothing at all.
 */
export const scenarioDataWithDitto = {
  ...(scenarioData as object),
  Ditto: {
    level: 87,
    abilities: ['Imposter'],
    items: ['Choice Scarf'],
    roles: {'Fast Support': {abilities: ['Imposter'], items: ['Choice Scarf'], teraTypes: ['Ghost', 'Steel'], moves: ['Transform']}},
  },
} as unknown as RandbatsData;

/**
 * The same feed plus Emboar's real gen9 randbats entry, verbatim from the live feed.
 *
 * Brought along for one property its "Fast Attacker" role has and nothing in the captured
 * battle does: an item pool of exactly `["Choice Band", "Choice Scarf"]`. One ability and two
 * items make two variants of EQUAL weight, so the faster (Scarf, 235) leads and the slower
 * (Band, 157) trails — the shape that produces a speed aside pointing DOWNWARD, which is the
 * case `speedLine` drops. Head Smash is the move that gets there: it belongs to that role
 * alone, so revealing it narrows the other two away and leaves the split standing by itself.
 */
export const scenarioDataWithEmboar = {
  ...(scenarioData as object),
  Emboar: {
    level: 84,
    abilities: ['Reckless'],
    items: ['Assault Vest', 'Choice Band', 'Choice Scarf', 'Leftovers'],
    roles: {
      'Bulky Setup': {abilities: ['Reckless'], items: ['Leftovers'], teraTypes: ['Fighting', 'Grass'], moves: ['Bulk Up', 'Drain Punch', 'Flare Blitz', 'Trailblaze']},
      'AV Pivot': {abilities: ['Reckless'], items: ['Assault Vest'], teraTypes: ['Dark', 'Electric', 'Fire', 'Water'], moves: ['Close Combat', 'Flare Blitz', 'Knock Off', 'Scald', 'Sucker Punch', 'Wild Charge']},
      'Fast Attacker': {abilities: ['Reckless'], items: ['Choice Band', 'Choice Scarf'], teraTypes: ['Fire'], moves: ['Close Combat', 'Flare Blitz', 'Head Smash', 'Knock Off', 'Wild Charge']},
    },
  },
} as unknown as RandbatsData;

/**
 * The same feed plus Greninja's real gen9 randbats entry, verbatim from the live feed.
 *
 * Brought along for Protean, which nothing in the captured battle has and which is the one
 * ability that rewrites the Pokémon's own TYPES mid-battle. Greninja is Water/Dark, its
 * moves span four types, and gen 9 lets the ability fire once per switch-in — so the same
 * Pokémon reads completely differently before and after that one moment, in both
 * directions at once (what its moves get STAB on, and what the whole type chart does to
 * it). No other mechanic in the format moves that many numbers off one log line.
 */
export const scenarioDataWithGreninja = {
  ...(scenarioData as object),
  Greninja: {
    level: 80,
    abilities: ['Protean'],
    items: ['Choice Specs', 'Life Orb'],
    roles: {
      Wallbreaker: {abilities: ['Protean'], items: ['Life Orb'], teraTypes: ['Poison'], moves: ['Grass Knot', 'Gunk Shot', 'Hydro Pump', 'Ice Beam', 'Spikes', 'U-turn']},
      'Fast Attacker': {abilities: ['Protean'], items: ['Choice Specs', 'Life Orb'], teraTypes: ['Dark', 'Poison', 'Water'], moves: ['Dark Pulse', 'Grass Knot', 'Gunk Shot', 'Hydro Pump', 'Ice Beam', 'Toxic Spikes', 'U-turn']},
    },
  },
} as unknown as RandbatsData;

/** The captured Tentacruel entry, as the shape this file has to reach into to grow a role. */
type FeedEntry = {roles: Record<string, {moves: readonly string[]}>};
const tentacruel = (scenarioData as unknown as Record<string, FeedEntry>)['Tentacruel'] as FeedEntry;

/**
 * The same feed with Tentacruel given a SECOND role that resolves to an identical Pokémon:
 * the first role's ability and items, a different move list.
 *
 * Real randbats entries do this constantly — a Sandaconda's "Bulky Attacker" and "Bulky
 * Setup" are both Shed Skin + Leftovers, differing only in what they carry. Two roles a
 * PLAYER tells apart at a glance (one sets up, one doesn't) and the CALC cannot tell apart
 * at all. That gap is easy to introduce and invisible without a picture, so the state is
 * worth both an assertion and a preview.
 */
export const scenarioDataTwinRoles = {
  ...(scenarioData as object),
  Tentacruel: {
    ...tentacruel,
    roles: {
      ...tentacruel.roles,
      'Bulky Attacker': {...tentacruel.roles['Bulky Support'], moves: ['Flip Turn', 'Knock Off', 'Sludge Bomb', 'Surf']},
    },
  },
} as unknown as RandbatsData;

/**
 * The same feed with ONE role that can hold three items and two abilities — the shape that
 * decides how much of the screen a hover costs.
 *
 * Six item × ability combinations multiply out to as many different numbers on every
 * damaging move in the role, and a real Porygon-Z is exactly this: three items, two
 * abilities, four attacks. Spelling each outcome out ran a single tooltip past the height
 * of the screen, so the sets view folds them into one span per move and spends a line only
 * on the outcome that decides a KO. The captured Tentacruel cannot show it — its two items
 * are both offensively inert, so its own moves never split at all — and meeting a Porygon-Z
 * takes playing until one appears. Hence a feed built to have the property, the same way
 * `scenarioDataTwinRoles` is. Every ability here is one the dex really gives Tentacruel, so
 * `narrow.buildableAbilities` still has something real to check.
 */
export const scenarioDataItemAbilitySplit = {
  ...(scenarioData as object),
  Tentacruel: {
    ...tentacruel,
    abilities: ['Liquid Ooze', 'Clear Body'],
    items: ['Choice Specs', 'Life Orb', 'Leftovers'],
    roles: {
      'Fast Attacker': {
        ...tentacruel.roles['Bulky Support'],
        abilities: ['Liquid Ooze', 'Clear Body'],
        items: ['Choice Specs', 'Life Orb', 'Leftovers'],
        moves: ['Sludge Bomb', 'Surf', 'Knock Off', 'Haze'],
      },
    },
  },
} as unknown as RandbatsData;

/**
 * Rebuild the client's object graph from the captured JSON, wiring the
 * `pokemon.side` back-references the live client maintains (and that
 * findOpposingActive / readFieldFacts depend on). Side 0 is the near side (ours),
 * side 1 the far side (theirs) — the client's seating for the recorded player.
 * The client's classes are untyped and cyclic, so the reconstruction casts through
 * `unknown` — the shapes match readState's structural interfaces.
 */
export function loadBattle(over: {noivernTerastallized?: string; tentacruelItem?: string; tentacruelPrevItem?: string; tentacruelBoosts?: Record<string, number>; tentacruelMoveTrack?: string[]; myNoivernItem?: string; myNoivernTera?: string; myNoivernMoves?: string[]; myPokemon?: readonly unknown[]; fullHp?: boolean; myNoivernHpPercent?: number; nearTailwind?: boolean; nearStealthRock?: boolean; nearSpikes?: number; farStealthRock?: boolean; farSpikes?: number; tentacruelHpPercent?: number; foeDitto?: 'transformed' | 'plain'; foeEmboar?: boolean; foeGreninja?: 'unspent' | 'converted'; noivernBoosts?: Record<string, number>; foeMovedFirst?: boolean; ourZoroark?: boolean; tentacruelSubstitute?: 'fresh' | 'dented'; noivernSubstitute?: 'fresh' | 'dented'} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
  const sides: ClientSide[] = fixture.battle.sides.map((s, i) => {
    // Tailwind blows on OUR side (index 0) only — the asymmetry is the point: it must
    // double our speed and leave the foe's alone, whichever side a caller orients on.
    const sideConditions = {
      ...s.sideConditions,
      ...(i === 0 && over.nearTailwind ? {tailwind: ['tailwind', 1]} : {}),
      ...(i === 0 && over.nearStealthRock ? {stealthrock: ['Stealth Rock', 1]} : {}),
      ...(i === 0 && over.nearSpikes !== undefined ? {spikes: ['Spikes', over.nearSpikes]} : {}),
      ...(i === 1 && over.farStealthRock ? {stealthrock: ['Stealth Rock', 1]} : {}),
      ...(i === 1 && over.farSpikes !== undefined ? {spikes: ['Spikes', over.farSpikes]} : {}),
    };
    const side = {isFar: i === 1, sideConditions, active: [] as (ClientPokemon | null)[]};
    side.active = s.active.map((p) => {
      const terastallized = p.speciesForme === 'Noivern' && over.noivernTerastallized !== undefined
        ? over.noivernTerastallized
        : p.terastallized;
      // Un-reveal Tentacruel's item to exercise the still-unknown-item split (its
      // Bulky Support set can run Assault Vest OR Leftovers).
      const item = p.speciesForme === 'Tentacruel' && over.tentacruelItem !== undefined ? over.tentacruelItem : p.item;
      // Side 0 is ours (p1), side 1 theirs (p2); the client tags actors this way.
      const ident = `p${i + 1}: ${p.speciesForme}`;
      return {
        ...p,
        terastallized,
        item,
        side,
        ident,
        // A knocked-off item: nothing held, prevItem names what was lost.
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelPrevItem !== undefined ? {prevItem: over.tentacruelPrevItem} : {}),
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelBoosts !== undefined ? {boosts: over.tentacruelBoosts} : {}),
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelMoveTrack !== undefined
          ? {moveTrack: over.tentacruelMoveTrack.map((m) => [m, 0])}
          : {}),
        ...(over.fullHp ? {hp: p.maxhp} : {}),
        ...(p.speciesForme === 'Noivern' && over.noivernBoosts !== undefined
          ? {boosts: over.noivernBoosts}
          : {}),
        ...(p.speciesForme === 'Noivern' && over.myNoivernHpPercent !== undefined
          ? {hp: Math.round(p.maxhp * over.myNoivernHpPercent)}
          : {}),
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelHpPercent !== undefined
          ? {hp: Math.round(p.maxhp * over.tentacruelHpPercent)}
          : {}),
        // A Substitute is a plain presence volatile; the log is what says how battered it is.
        // Stageable on EITHER side: a doll in front of the foe is what our move meets, and one
        // in front of us is what their threat lines meet — opposite directions, one mechanic.
        ...((p.speciesForme === 'Tentacruel' && over.tentacruelSubstitute) ||
        (p.speciesForme === 'Noivern' && over.noivernSubstitute)
          ? {volatiles: {substitute: ['substitute']}}
          : {}),
      } as unknown as ClientPokemon;
    });
    return side as unknown as ClientSide;
  });
  // Send out a different member of OUR OWN team. Noivern is the one this battle happened to
  // have on the field, and its only randbats ability is Infiltrator — so no move it throws
  // can ever meet a Substitute. Zoroark-Hisui was on the same team, has Illusion, and carries
  // a sound move alongside ordinary ones, which makes it the honest way to see a doll absorb
  // anything on a surface our active cannot demonstrate.
  if (over.ourZoroark) {
    const zoroark = {
      speciesForme: 'Zoroark-Hisui', level: 80, hp: 233, maxhp: 233, status: '', boosts: {},
      terastallized: '', ident: 'p1: Zoroark-Hisui', side: sides[0], moveTrack: [],
    };
    (sides[0]!.active as (ClientPokemon | null)[])[0] = zoroark as unknown as ClientPokemon;
  }
  // Swap the foe active for an Emboar that has shown Head Smash and no item yet. Its one
  // surviving role runs a Choice Band or a Choice Scarf, which is two speeds (157 and 235)
  // for one Pokémon — and our Noivern, at 249, moves first against both. The state exists to
  // be looked at: it is where the ⚡ line has something true to say about the foe's speed
  // that changes nothing about the answer.
  if (over.foeEmboar) {
    const emboar = {
      speciesForme: 'Emboar', level: 84, hp: 322, maxhp: 322, status: '', boosts: {},
      terastallized: '', ident: 'p2: Emboar', side: sides[1], item: '', moveTrack: [['Head Smash', 0]],
    };
    (sides[1]!.active as (ClientPokemon | null)[])[0] = emboar as unknown as ClientPokemon;
  }
  // Swap the foe active for a Greninja, either side of the one moment Protean fires. Both
  // states are the SAME Pokémon on the same turn count — the only difference is whether the
  // log carries the conversion, which is exactly the difference a player has to read off the
  // type bar and which every number on the tooltip depends on.
  if (over.foeGreninja) {
    const converted = over.foeGreninja === 'converted';
    const greninja = {
      speciesForme: 'Greninja', level: 80, hp: 238, maxhp: 238, status: '', boosts: {},
      terastallized: '', ident: 'p2: Greninja', side: sides[1], item: '',
      // Protean reveals itself by firing — the `[from]` on its own typechange line is what
      // the client remembers it from — so an unspent one is genuinely still unknown.
      ...(converted ? {baseAbility: 'Protean', ability: 'Protean'} : {}),
      moveTrack: converted ? [['Ice Beam', 0]] : [],
      ...(converted ? {volatiles: {typechange: ['typechange', 'Ice']}} : {}),
    };
    (sides[1]!.active as (ClientPokemon | null)[])[0] = greninja as unknown as ClientPokemon;
  }
  // Swap the foe active for a Ditto — plain, or Transformed into our Noivern. The client
  // records a transform as TWO volatiles: the target's own Pokemon object, and the same
  // `formechange` an ordinary forme change uses. It also copies the target's tracked moves
  // onto the Ditto, each STARRED: `*Flamethrower` is Noivern's move, not Ditto's.
  if (over.foeDitto) {
    const ourNoivern = sides[0]!.active[0];
    const ditto = {
      speciesForme: 'Ditto', level: 87, hp: 225, maxhp: 225, status: '', boosts: {},
      terastallized: '', ident: 'p2: Ditto', side: sides[1],
      ...(over.foeDitto === 'transformed'
        ? {
            moveTrack: [['*Flamethrower', 0]],
            volatiles: {
              transform: ['transform', ourNoivern, false, 'M', 82],
              formechange: ['formechange', 'Noivern'],
            },
          }
        : {}),
    };
    (sides[1]!.active as (ClientPokemon | null)[])[0] = ditto as unknown as ClientPokemon;
  }
  const battle = {
    gen: fixture.battle.gen,
    tier: fixture.battle.tier,
    weather: fixture.battle.weather,
    pseudoWeather: fixture.battle.pseudoWeather,
    sides,
    // The client's own move dex, which is where a PRIORITY bracket is read from — the calc's
    // move data carries no negative priority at all. Only the moves these scenarios use.
    ...(over.foeMovedFirst !== undefined
      ? {dex: {
          species: {get: () => undefined},
          moves: {get: (n: string) => ({
            'Head Smash': {priority: 0, category: 'Physical', type: 'Rock'},
            'Draco Meteor': {priority: 0, category: 'Special', type: 'Dragon'},
          }[n])},
        }}
      : {}),
    ...(over.tentacruelSubstitute || over.noivernSubstitute || over.foeMovedFirst !== undefined || over.foeGreninja
      ? {stepQueue: [
          ...(over.foeGreninja ? ['|switch|p2a: Greninja|Greninja, M|238/238'] : []),
          // The ATTRIBUTION is the fact, not the retype: `proteanAlreadyFired` reads this
          // `[from]` to tell a spent ability from a Soak that merely moved the types.
          ...(over.foeGreninja === 'converted'
            ? ['|move|p2a: Greninja|Ice Beam|p1a: Noivern', '|-start|p2a: Greninja|typechange|Ice|[from] ability: Protean']
            : []),
          // A Speed drop BEFORE the turn we read, so the two are consistent: the reader
          // refuses an observation with anything speed-relevant after it, and `finalSpeed`
          // reads the boosts standing now. -1 puts our Noivern at 166 — between Emboar's
          // Choice Band (157) and its Choice Scarf (235), which is the only arrangement in
          // which an observed order can tell the two apart at all.
          ...(over.foeMovedFirst !== undefined
            ? [
                '|-unboost|p1a: Noivern|spe|1',
                '|turn|1',
                ...(over.foeMovedFirst
                  ? ['|move|p2a: Emboar|Head Smash|p1a: Noivern', '|move|p1a: Noivern|Draco Meteor|p2a: Emboar']
                  : ['|move|p1a: Noivern|Draco Meteor|p2a: Emboar', '|move|p2a: Emboar|Head Smash|p1a: Noivern']),
                '|turn|2',
              ]
            : []),
          ...(over.tentacruelSubstitute ? ['|-start|p2a: Tentacruel|Substitute'] : []),
          ...(over.tentacruelSubstitute === 'dented' ? ['|-activate|p2a: Tentacruel|move: Substitute|[damage]'] : []),
          ...(over.noivernSubstitute ? ['|-start|p1a: Noivern|Substitute'] : []),
          ...(over.noivernSubstitute === 'dented' ? ['|-activate|p1a: Noivern|move: Substitute|[damage]'] : []),
        ]}
      : {}),
    // Our private team view — the item, Tera type, and moveset the opponent can't see. Only
    // Noivern, unless `myPokemon` supplies the whole array (the Illusion case, where the
    // Pokémon in our active slot is NOT the one the battle view shows).
    ...(over.myPokemon !== undefined ? {myPokemon: over.myPokemon} : {}),
    ...(over.myPokemon === undefined && (over.myNoivernItem !== undefined || over.myNoivernTera !== undefined || over.myNoivernMoves !== undefined)
      ? {myPokemon: [{
          ident: 'p1: Noivern',
          ...(over.myNoivernItem !== undefined ? {item: over.myNoivernItem} : {}),
          ...(over.myNoivernTera !== undefined ? {teraType: over.myNoivernTera} : {}),
          ...(over.myNoivernMoves !== undefined ? {moves: over.myNoivernMoves} : {}),
        }]}
      : {}),
  } as unknown as ClientBattle;
  const active = (name: string): ClientPokemon =>
    sides.flatMap((s) => s.active).find((p): p is ClientPokemon => p?.speciesForme === name)!;
  return {battle, active};
}
