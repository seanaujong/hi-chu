// Read the Pokémon Showdown client's live battle objects into our own typed
// LiveFacts. The `ClientPokemon`/`ClientBattle`/`ClientSide` interfaces are a
// minimal structural view of the client's classes (which ship no types we can
// import) — only the fields we actually read, named as the client names them.
//
// `toLiveFacts` is pure and unit-tested with a stub; the navigation helpers are
// thin and defensive (the client's shape can shift between releases).

import type {FieldFacts, LiveFacts, StatID, StatusName, TerrainName, WeatherName} from '../core/types.js';

export interface ClientPokemon {
  readonly speciesForme: string;
  readonly level: number;
  readonly hp: number;
  readonly maxhp: number;
  readonly status: string; // '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | '???'
  readonly boosts: Readonly<Record<string, number>>;
  readonly terastallized: string; // '' when not terastallized, else the Tera type
  readonly ability?: string;
  readonly baseAbility?: string;
  readonly item?: string;
  /** A revealed item the Pokémon no longer holds (consumed berry, knocked-off orb). */
  readonly prevItem?: string;
  readonly moveTrack?: ReadonlyArray<readonly [string, unknown]>;
  readonly gender?: string;
  readonly side?: ClientSide;
  /** Side+name identity, e.g. "p1: Noivern" — matches the protocol log's actor tags
   *  (slot-independent, so a mid-battle switch doesn't misattribute a slot). */
  readonly ident?: string;
}

export interface ClientSide {
  readonly active: ReadonlyArray<ClientPokemon | null>;
  /** True for the side rendered at the top of the screen — the opponent, from the viewer's seat. */
  readonly isFar?: boolean;
  /** Active side conditions keyed by id ("reflect", "lightscreen", "auroraveil", …). */
  readonly sideConditions?: Readonly<Record<string, unknown>>;
}

export interface ClientBattle {
  readonly gen: number;
  readonly tier: string;
  readonly sides: ReadonlyArray<ClientSide>;
  /** Weather id ("sunnyday", "raindance", …), or "" / undefined when clear. */
  readonly weather?: string;
  /** Field conditions including terrains; each entry is [displayName, …]. */
  readonly pseudoWeather?: ReadonlyArray<readonly [string, ...unknown[]]>;
  /** The raw `|`-delimited protocol log, one line per entry ("|move|…", "|-damage|…"). */
  readonly stepQueue?: ReadonlyArray<string>;
}

const BATTLE_STATUSES = new Set<StatusName>(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);
const BOOSTABLE: readonly StatID[] = ['atk', 'def', 'spa', 'spd', 'spe'];

function asStatus(raw: string): StatusName | undefined {
  return BATTLE_STATUSES.has(raw as StatusName) ? (raw as StatusName) : undefined;
}

function asGender(raw: string | undefined): 'M' | 'F' | 'N' | undefined {
  return raw === 'M' || raw === 'F' || raw === 'N' ? raw : undefined;
}

export function toLiveFacts(p: ClientPokemon, landedDamagingHit = false): LiveFacts {
  // moveTrack entries are [name, pp]; a leading "*" marks a transformed/mimicked move.
  const revealedMoves = (p.moveTrack ?? [])
    .map(([name]) => name.replace(/^\*/, ''))
    .filter((name) => name.length > 0);

  const boosts: Partial<Record<StatID, number>> = {};
  for (const stat of BOOSTABLE) {
    const v = p.boosts[stat];
    if (v) boosts[stat] = v;
  }

  // The client tracks two abilities: `ability` is the CURRENT effective one (what
  // Trace/Skill Swap/Mummy/suppression left active — this drives the live calc), and
  // `baseAbility` is the INNATE one the set was built with (`rememberAbility` stamps
  // it once and never overwrites it). Set inference must use the innate ability — a
  // Gardevoir that Traced Teravolt is still a Trace set — so we carry both.
  const ability = p.ability || p.baseAbility || undefined;
  const baseAbility = p.baseAbility || p.ability || undefined;
  const gender = asGender(p.gender);

  const facts: LiveFacts = {
    speciesForme: p.speciesForme,
    level: p.level,
    hpPercent: p.maxhp > 0 ? p.hp / p.maxhp : 1,
    boosts,
    terastallized: Boolean(p.terastallized),
    revealedMoves,
    landedDamagingHit,
    ...(asStatus(p.status) ? {status: asStatus(p.status)!} : {}),
    ...(p.terastallized ? {teraType: p.terastallized} : {}),
    ...(ability ? {ability} : {}),
    ...(baseAbility ? {baseAbility} : {}),
    ...(p.item ? {item: p.item} : {}),
    ...(p.prevItem ? {prevItem: p.prevItem} : {}),
    ...(gender ? {gender} : {}),
  };
  return facts;
}

/** A protocol/client ident ("p1a: Noivern", "p1: Noivern") reduced to a slot-independent
 *  "side|name" key, so a log line's actor matches a client Pokémon across switches. */
function identKey(ident: string | undefined): string | undefined {
  if (!ident) return undefined;
  const colon = ident.indexOf(':');
  if (colon < 0) return undefined;
  const side = ident.slice(0, colon).trim().slice(0, 2); // "p1a" | "p1" → "p1"
  const name = ident.slice(colon + 1).trim().toLowerCase();
  return side && name ? `${side}|${name}` : undefined;
}

/**
 * Does this log line show the current mover dealing damage to someone OTHER than
 * itself — the event that reveals a held Life Orb via recoil? Three shapes count:
 *   - `-damage` on the target with no `[from]` tag (a bare `[from]` marks
 *     item/hazard/status/recoil damage, not the move's own — Life Orb's own recoil,
 *     `[from] item: Life Orb` on the user, is excluded on both the tag and the "not
 *     me" test, since it's handled by the positive item-reveal path instead);
 *   - a Substitute BREAKING (`-end … Substitute`); or
 *   - a Substitute ABSORBING the hit (`-activate … move: Substitute|[damage]`).
 * The Substitute cases matter because the sub takes the damage in the Pokémon's place,
 * so the foe's own HP bar never moves — yet the move still dealt damage. The `[damage]`
 * tag is what separates a dented sub from a status move the sub merely BLOCKED (no
 * damage, no tag). Sub hits count only in Gen 5+, as Gen 4 took no Life Orb recoil
 * against a substitute.
 */
function dealtDamageToFoe(line: string, me: string, subCountsAsHit: boolean): boolean {
  const parts = line.split('|'); // ['', TAG, 'p2a: Foo', …]
  const target = identKey(parts[2]);
  if (!target || target === me) return false;
  if (parts[1] === '-damage') return !parts.slice(4).some((p) => p.startsWith('[from]'));
  if (!subCountsAsHit) return false;
  const isSub = parts.some((p) => p === 'Substitute' || p === 'move: Substitute');
  if (parts[1] === '-end') return isSub; // a substitute only ends by being broken with damage
  if (parts[1] === '-activate') return isSub && parts.includes('[damage]');
  return false;
}

/**
 * Has `mon` landed a damaging hit — a move it used dealing damage to another Pokémon?
 * That hit is exactly the event that reveals a held Life Orb (1/10 recoil), so its
 * ABSENCE, with the item still unrevealed, is what rules Life Orb out. We can't see it
 * in a snapshot (`moveTrack` records that a move was USED, not that it landed — a miss
 * or an immunity leaves no trace there), so we read the protocol log, tracking the
 * current mover and asking `dealtDamageToFoe` of each following line. An unknown ident
 * or an empty log resolves to "no hit seen" — we would rather miss a rule-out than make
 * a false one.
 */
export function hasLandedDamagingHit(battle: ClientBattle, mon: ClientPokemon): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  const subCountsAsHit = (battle.gen || 9) >= 5;
  let moverIsMe = false;
  for (const line of battle.stepQueue ?? []) {
    if (line.startsWith('|move|')) {
      moverIsMe = identKey(line.split('|')[2]) === me;
    } else if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|turn|')) {
      moverIsMe = false; // a new actor context — don't let a later line borrow our move
    } else if (moverIsMe && dealtDamageToFoe(line, me, subCountsAsHit)) {
      return true;
    }
  }
  return false;
}

/** The first active Pokémon on a side other than the hovered Pokémon's own side. */
export function findOpposingActive(battle: ClientBattle, hovered: ClientPokemon): ClientPokemon | null {
  for (const side of battle.sides) {
    if (side === hovered.side) continue;
    for (const mon of side.active) if (mon) return mon;
  }
  return null;
}

/**
 * The randbats format id (e.g. "gen9randombattle") for this battle, or null if it
 * isn't a Random Battle format the feed covers.
 */
export function detectFormat(battle: ClientBattle): {gen: number; formatId: string} | null {
  const tier = battle.tier || '';
  if (!/random/i.test(tier)) return null;
  const gen = battle.gen || 9;
  // Derive the id the way PS itself does: toID over the whole title, digits kept.
  // Pattern-matching only a "[Gen 9]" prefix broke tags with extra words —
  // "[Gen 9 Champions] Random Battle" must become "gen9championsrandombattle".
  // Parenthesised qualifiers like "(Blitz)" share the base format's sets, so they
  // are dropped before the id is formed.
  const name = tier
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  if (!name) return null;
  return {gen, formatId: name.startsWith('gen') ? name : `gen${gen}${name}`};
}

function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Client weather/terrain ids → @smogon/calc names.
const WEATHER_BY_ID: Readonly<Record<string, WeatherName>> = {
  sunnyday: 'Sun',
  raindance: 'Rain',
  sandstorm: 'Sand',
  hail: 'Hail',
  snow: 'Snow',
  snowscape: 'Snow',
  desolateland: 'Harsh Sunshine',
  primordialsea: 'Heavy Rain',
  deltastream: 'Strong Winds',
};
const TERRAIN_BY_ID: Readonly<Record<string, TerrainName>> = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};

/**
 * Read the field conditions that change damage: weather, terrain, and the screens
 * on the DEFENDER's side. (Hazards are intentionally excluded — they affect
 * switch-in HP, not a move's damage, and we already read live HP.)
 */
export function readFieldFacts(battle: ClientBattle, defenderSide: ClientSide | undefined): FieldFacts {
  const weather = WEATHER_BY_ID[toId(battle.weather ?? '')];

  let terrain: TerrainName | undefined;
  for (const entry of battle.pseudoWeather ?? []) {
    const match = TERRAIN_BY_ID[toId(entry[0])];
    if (match) {
      terrain = match;
      break;
    }
  }

  const conditions = defenderSide?.sideConditions ?? {};
  const has = (id: string): boolean => Boolean(conditions[id]);

  return {
    ...(weather ? {weather} : {}),
    ...(terrain ? {terrain} : {}),
    defenderScreens: {
      reflect: has('reflect'),
      lightScreen: has('lightscreen'),
      auroraVeil: has('auroraveil'),
    },
  };
}
