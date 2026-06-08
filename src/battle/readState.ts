// Read the Pokémon Showdown client's live battle objects into our own typed
// LiveFacts. The `ClientPokemon`/`ClientBattle`/`ClientSide` interfaces are a
// minimal structural view of the client's classes (which ship no types we can
// import) — only the fields we actually read, named as the client names them.
//
// `toLiveFacts` is pure and unit-tested with a stub; the navigation helpers are
// thin and defensive (the client's shape can shift between releases).

import type {LiveFacts, StatID, StatusName} from '../core/types.js';

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
  readonly moveTrack?: ReadonlyArray<readonly [string, unknown]>;
  readonly gender?: string;
  readonly side?: ClientSide;
}

export interface ClientSide {
  readonly active: ReadonlyArray<ClientPokemon | null>;
}

export interface ClientBattle {
  readonly gen: number;
  readonly tier: string;
  readonly sides: ReadonlyArray<ClientSide>;
}

const BATTLE_STATUSES = new Set<StatusName>(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);
const BOOSTABLE: readonly StatID[] = ['atk', 'def', 'spa', 'spd', 'spe'];

function asStatus(raw: string): StatusName | undefined {
  return BATTLE_STATUSES.has(raw as StatusName) ? (raw as StatusName) : undefined;
}

function asGender(raw: string | undefined): 'M' | 'F' | 'N' | undefined {
  return raw === 'M' || raw === 'F' || raw === 'N' ? raw : undefined;
}

export function toLiveFacts(p: ClientPokemon): LiveFacts {
  // moveTrack entries are [name, pp]; a leading "*" marks a transformed/mimicked move.
  const revealedMoves = (p.moveTrack ?? [])
    .map(([name]) => name.replace(/^\*/, ''))
    .filter((name) => name.length > 0);

  const boosts: Partial<Record<StatID, number>> = {};
  for (const stat of BOOSTABLE) {
    const v = p.boosts[stat];
    if (v) boosts[stat] = v;
  }

  const ability = p.ability || p.baseAbility || undefined;
  const gender = asGender(p.gender);

  const facts: LiveFacts = {
    speciesForme: p.speciesForme,
    level: p.level,
    hpPercent: p.maxhp > 0 ? p.hp / p.maxhp : 1,
    boosts,
    terastallized: Boolean(p.terastallized),
    revealedMoves,
    ...(asStatus(p.status) ? {status: asStatus(p.status)!} : {}),
    ...(p.terastallized ? {teraType: p.terastallized} : {}),
    ...(ability ? {ability} : {}),
    ...(p.item ? {item: p.item} : {}),
    ...(gender ? {gender} : {}),
  };
  return facts;
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
  const name = tier
    .replace(/\[gen\s*\d+\]/i, '') // drop the "[Gen 9]" prefix
    .replace(/\(.*?\)/g, '') //       drop "(Blitz)" and similar qualifiers
    .replace(/[^a-z]/gi, '')
    .toLowerCase();
  if (!name) return null;
  return {gen, formatId: `gen${gen}${name}`};
}
