// Merge what we KNOW (LiveFacts) over what we ASSUME (RandbatsEntry) into the one
// concrete set we calculate with. The rule is uniform: a revealed fact always wins;
// randbats fills only the gaps. This is where "account for the active Tera" and
// "don't halve a Guts mon's damage for burn" actually live — we hand the calc the
// true ability/item/tera/status, and let it resolve the interactions.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {
  FullStats,
  LiveFacts,
  RandbatsEntry,
  RandbatsRole,
  ResolvedMon,
  StatsTable,
} from './types.js';

const RANDBATS_BASE_EVS = 85; // gen9 randbats starts every stat at 85 EVs…
const RANDBATS_BASE_IVS = 31; // …and 31 IVs, before per-set overrides.
const RANDBATS_NATURE = 'Serious'; // gen9 randbats does not use natures.

/** Showdown move id: lowercase, alphanumerics only ("U-turn" → "uturn"). */
function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fillStats(base: number, override: StatsTable | undefined): FullStats {
  const s: FullStats = {hp: base, atk: base, def: base, spa: base, spd: base, spe: base};
  if (override) {
    for (const k of Object.keys(s) as (keyof FullStats)[]) {
      const v = override[k];
      if (v !== undefined) s[k] = v;
    }
  }
  return s;
}

/**
 * Pick the role(s) consistent with the moves we've actually seen used, and the
 * single role we'll calculate with. A role is consistent when every revealed move
 * appears in it. If nothing is consistent (or nothing has been revealed yet) we
 * keep all roles and flag the extra uncertainty.
 */
function selectRoles(entry: RandbatsEntry, revealedMoves: readonly string[]): {
  chosen: RandbatsRole | undefined;
  candidates: readonly RandbatsRole[];
  uncertain: string | undefined;
} {
  const roles = entry.roles ? Object.values(entry.roles) : [];
  if (roles.length === 0) return {chosen: undefined, candidates: [], uncertain: undefined};

  const revealedIds = new Set(revealedMoves.map(toId));
  const consistent = roles.filter((r) => {
    const have = new Set(r.moves.map(toId));
    for (const id of revealedIds) if (!have.has(id)) return false;
    return true;
  });

  if (revealedIds.size > 0 && consistent.length === 0) {
    // A revealed move matched no role (form change, transform, data drift) — don't
    // pretend; calculate with the first role but mark the assumptions as shaky.
    return {chosen: roles[0], candidates: roles, uncertain: 'revealed move matched no known role'};
  }
  const candidates = consistent.length > 0 ? consistent : roles;
  return {chosen: candidates[0], candidates, uncertain: undefined};
}

/** Union of all moves across the given roles (falling back to the entry's moves). */
function unionMoves(candidates: readonly RandbatsRole[], entry: RandbatsEntry): string[] {
  if (candidates.length === 0) return [...(entry.moves ?? [])];
  const seen = new Map<string, string>(); // id → display name, dedup but keep readable
  for (const role of candidates) for (const m of role.moves) if (!seen.has(toId(m))) seen.set(toId(m), m);
  return [...seen.values()];
}

function firstDefined<T>(...vals: (T | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined) return v;
  return undefined;
}

export function resolveMon(facts: LiveFacts, entry: RandbatsEntry): ResolvedMon {
  const {chosen, candidates, uncertain} = selectRoles(entry, facts.revealedMoves);

  const evsOverride = chosen?.evs ?? entry.evs;
  const ivsOverride = chosen?.ivs ?? entry.ivs;

  // Revealed moves are certainties; union with the chosen role's pool for the rest.
  const pool = unionMoves(candidates, entry);
  const poolIds = new Set(pool.map(toId));
  const possibleMoves = [
    ...facts.revealedMoves.filter((m) => !poolIds.has(toId(m))),
    ...pool,
  ];

  const resolved: ResolvedMon = {
    speciesForme: facts.speciesForme,
    level: facts.level || entry.level,
    nature: RANDBATS_NATURE,
    evs: fillStats(RANDBATS_BASE_EVS, evsOverride),
    ivs: fillStats(RANDBATS_BASE_IVS, ivsOverride),
    ability: firstDefined(facts.ability, chosen?.abilities[0], entry.abilities[0]),
    item: firstDefined(facts.item, chosen?.items[0], entry.items[0]),
    status: facts.status,
    boosts: facts.boosts,
    hpPercent: facts.hpPercent,
    // We never speculate a Tera type — only an ACTIVE terastallization counts.
    teraType: facts.terastallized ? facts.teraType : undefined,
    terastallized: facts.terastallized,
    possibleMoves,
    ...(uncertain ? {assumptionsUncertainReason: uncertain} : {}),
  };
  return resolved;
}
