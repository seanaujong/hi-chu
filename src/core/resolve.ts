// Merge what we KNOW (LiveFacts) over what we ASSUME (RandbatsEntry) into the one
// concrete set we calculate with. The rule is uniform: a revealed fact always wins;
// randbats fills only the gaps. This is where "account for the active Tera" and
// "don't halve a Guts mon's damage for burn" actually live — we hand the calc the
// true ability/item/tera/status, and let it resolve the interactions.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {
  FullStats,
  Gimmick,
  KnownOption,
  LiveFacts,
  RandbatsEntry,
  RandbatsRole,
  ResolvedMon,
  SetKnowledge,
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

/** True when every piece of revealed evidence is consistent with this role. */
function roleMatches(role: RandbatsRole, facts: LiveFacts): boolean {
  const have = new Set(role.moves.map(toId));
  for (const m of facts.revealedMoves) if (!have.has(toId(m))) return false;
  // An item revealed mid-battle (held, consumed, or knocked off) pins the set the
  // same way a used move does; likewise a revealed ability or an active Tera type.
  const revealedItem = facts.item ?? facts.prevItem;
  if (revealedItem && role.items.length > 0 && !role.items.some((i) => toId(i) === toId(revealedItem))) {
    return false;
  }
  if (facts.ability && role.abilities.length > 0 && !role.abilities.some((a) => toId(a) === toId(facts.ability!))) {
    return false;
  }
  const activeTera = facts.terastallized ? facts.teraType : undefined;
  if (activeTera && role.teraTypes.length > 0 && !role.teraTypes.some((t) => toId(t) === toId(activeTera))) {
    return false;
  }
  return true;
}

function anyEvidence(facts: LiveFacts): boolean {
  return facts.revealedMoves.length > 0 || facts.item !== undefined || facts.prevItem !== undefined ||
    facts.ability !== undefined || (facts.terastallized && facts.teraType !== undefined);
}

/**
 * Pick the role(s) consistent with everything the battle has revealed (moves used,
 * item, ability), and the single role we'll calculate with. If nothing is
 * consistent (or nothing has been revealed yet) we keep all roles and flag the
 * extra uncertainty.
 */
function selectRoles(entry: RandbatsEntry, facts: LiveFacts): {
  chosen: RandbatsRole | undefined;
  candidates: readonly RandbatsRole[];
  names: readonly string[];
  uncertain: string | undefined;
} {
  const named = entry.roles ? Object.entries(entry.roles) : [];
  if (named.length === 0) return {chosen: undefined, candidates: [], names: [], uncertain: undefined};

  const consistent = named.filter(([, r]) => roleMatches(r, facts));

  if (anyEvidence(facts) && consistent.length === 0) {
    // Revealed evidence matched no role (form change, transform, data drift) — don't
    // pretend; calculate with the first role but mark the assumptions as shaky.
    return {
      chosen: named[0]![1],
      candidates: named.map(([, r]) => r),
      names: named.map(([n]) => n),
      uncertain: 'revealed moves/item/ability matched no known set',
    };
  }
  const kept = consistent.length > 0 ? consistent : named;
  return {
    chosen: kept[0]![1],
    candidates: kept.map(([, r]) => r),
    names: kept.map(([n]) => n),
    uncertain: undefined,
  };
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
  const {chosen, candidates, uncertain} = selectRoles(entry, facts);

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

/** Union a pool into options, confirmed names first; dedup by id, keep display names. */
function unionOptions(pool: readonly string[], confirmed: readonly string[]): KnownOption[] {
  const seen = new Map<string, KnownOption>();
  for (const name of confirmed) if (!seen.has(toId(name))) seen.set(toId(name), {name, known: true});
  for (const name of pool) if (!seen.has(toId(name))) seen.set(toId(name), {name, known: false});
  return [...seen.values()];
}

/**
 * An exclusive dimension (ability, item, Tera type): once one value is confirmed,
 * the alternatives are no longer possible — unlike moves, where a confirmed move
 * only fills one of four slots.
 */
function exclusiveOptions(pool: readonly string[], confirmed: readonly string[]): KnownOption[] {
  if (confirmed.length > 0) return unionOptions([], confirmed);
  return unionOptions(pool, []);
}

/**
 * A held item is a Mega stone if it ends in "-ite" (optionally with an " X"/" Y"
 * variant). Eviolite is the one -ite item that isn't a stone, so it's excluded.
 */
function isMegaStone(item: string): boolean {
  return item !== 'Eviolite' && /ite( [XY])?$/.test(item);
}

/** A held item is a Z-crystal (gen7) if it ends in " Z" — "Firium Z",
 *  "Ultranecrozium Z". No non-crystal item ends that way, so the rule is exact. */
function isZCrystal(item: string): boolean {
  return / Z$/.test(item);
}

/** "Charizard" + "Charizardite Y" → "Charizard-Mega-Y". Species names the base; the
 *  stone's X/Y suffix names the variant (stone→species is irregular, species→forme
 *  is not, so we key off the hovered species, not the stone's prefix). */
function megaForme(baseSpecies: string, stone: string): string {
  const variant = / X$/.test(stone) ? '-X' : / Y$/.test(stone) ? '-Y' : '';
  return `${baseSpecies}-Mega${variant}`;
}

/**
 * Derive the transformations a candidate can perform from its already-resolved
 * dimensions. Tera is a genuine feed dimension; Mega is read out of the item
 * options (a stone implies the Mega). Dynamax has no set-data trigger, so it never
 * appears here — honest silence beats an invented line.
 */
function deriveGimmicks(items: readonly KnownOption[], teraTypes: readonly KnownOption[], baseSpecies: string): Gimmick[] {
  const gimmicks: Gimmick[] = [];
  if (teraTypes.length > 0) gimmicks.push({kind: 'tera', types: teraTypes});
  for (const item of items) {
    if (isMegaStone(item.name)) gimmicks.push({kind: 'mega', stone: item, forme: megaForme(baseSpecies, item.name)});
    else if (isZCrystal(item.name)) gimmicks.push({kind: 'zmove', crystal: item});
  }
  return gimmicks;
}

/** The hovered species with any live Mega/Tera forme suffix stripped, so a set's
 *  DERIVED Mega forme reads from the base ("Charizard-Mega-Y" → base "Charizard"). */
function baseSpecies(speciesForme: string): string {
  return speciesForme.replace(/-Mega(-[XY])?$/, '');
}

/**
 * Everything deducible about a Pokémon's set from public reveals: narrow the roles
 * with the same evidence rule the calc uses, and keep each surviving candidate
 * WHOLE (which item goes with which moves is the information), reveals marked.
 * Role-less gen ≤ 8 entries become a single unnamed candidate from the entry pools.
 */
export function inferSets(facts: LiveFacts, entry: RandbatsEntry): SetKnowledge {
  const {candidates, names, uncertain} = selectRoles(entry, facts);
  const totalRoles = entry.roles ? Object.keys(entry.roles).length : 0;

  const revealedItem = facts.item ?? facts.prevItem;
  const activeTera = facts.terastallized && facts.teraType ? [facts.teraType] : [];
  const species = baseSpecies(facts.speciesForme);

  const toCandidate = (name: string, role: RandbatsRole): SetKnowledge['candidates'][number] => {
    const items = exclusiveOptions(role.items, revealedItem ? [revealedItem] : []);
    const teraTypes = exclusiveOptions(role.teraTypes, activeTera);
    return {
      name,
      abilities: exclusiveOptions(role.abilities, facts.ability ? [facts.ability] : []),
      items,
      moves: unionOptions(role.moves, facts.revealedMoves),
      gimmicks: deriveGimmicks(items, teraTypes, species),
    };
  };

  const sets =
    candidates.length > 0
      ? candidates.map((role, i) => toCandidate(names[i] ?? '', role))
      : [
          toCandidate('', {
            abilities: entry.abilities,
            items: entry.items,
            teraTypes: entry.teraTypes ?? [],
            moves: entry.moves ?? [],
          }),
        ];

  return {
    candidates: sets,
    totalRoles,
    ...(uncertain ? {uncertainReason: uncertain} : {}),
  };
}
