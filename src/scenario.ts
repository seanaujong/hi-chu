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
 * Rebuild the client's object graph from the captured JSON, wiring the
 * `pokemon.side` back-references the live client maintains (and that
 * findOpposingActive / readFieldFacts depend on). Side 0 is the near side (ours),
 * side 1 the far side (theirs) — the client's seating for the recorded player.
 * The client's classes are untyped and cyclic, so the reconstruction casts through
 * `unknown` — the shapes match readState's structural interfaces.
 */
export function loadBattle(over: {noivernTerastallized?: string; tentacruelItem?: string; tentacruelPrevItem?: string; tentacruelBoosts?: Record<string, number>; tentacruelMoveTrack?: string[]; myNoivernItem?: string; myNoivernTera?: string; myNoivernMoves?: string[]; myPokemon?: readonly unknown[]; fullHp?: boolean; myNoivernHpPercent?: number; nearTailwind?: boolean; nearStealthRock?: boolean; nearSpikes?: number; farStealthRock?: boolean; farSpikes?: number; tentacruelHpPercent?: number; foeDitto?: 'transformed' | 'plain'; ourZoroark?: boolean; tentacruelSubstitute?: 'fresh' | 'dented'; noivernSubstitute?: 'fresh' | 'dented'} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
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
    ...(over.tentacruelSubstitute || over.noivernSubstitute
      ? {stepQueue: [
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
