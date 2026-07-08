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
  SetVariant,
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
/**
 * The ability that narrows the set: the INNATE one, not the live one. Trace, Skill
 * Swap, Worry Seed, Entrainment, Simple Beam, Gastro Acid, and Mummy/Wandering
 * Spirit all replace or suppress the current ability, but the randbats set is keyed
 * to what the Pokémon was BUILT with — so we match on `baseAbility` (falling back to
 * `ability` when nothing has changed and only the current one is known).
 */
function innateAbility(facts: LiveFacts): string | undefined {
  return facts.baseAbility ?? facts.ability;
}

// Items that reveal themselves by damaging their own holder after a damaging move.
// Life Orb (1/10 recoil) is the only one in the covered gens; kept a set so the
// rule reads as "recoil-on-attack items" rather than a single hard-coded string.
const RECOIL_ON_ATTACK_ITEMS = new Set(['lifeorb']);

// Abilities that suppress that recoil, so its absence proves nothing: Magic Guard
// negates all indirect damage; Sheer Force cancels Life Orb recoil on any move it
// boosts. A set that could be running either keeps Life Orb as a live possibility.
const RECOIL_SUPPRESSORS = new Set(['sheerforce', 'magicguard']);

/**
 * Can we trust "landed a damaging hit, saw no item ⇒ no recoil-on-attack item" for
 * THIS role? Only when a damaging hit actually landed, no item has been revealed
 * (a revealed item is already the stronger, positive evidence), and no
 * recoil-suppressing ability is in play — judged against the KNOWN innate ability
 * when we have it, otherwise against everything this role could still be running.
 * The "never lie" rule: if the role could be a Sheer Force / Magic Guard set whose
 * ability we haven't seen, we don't rule Life Orb out.
 */
function recoilRevealTrusted(abilities: readonly string[], facts: LiveFacts): boolean {
  if (!facts.landedDamagingHit) return false;
  if (facts.item !== undefined || facts.prevItem !== undefined) return false;
  const known = innateAbility(facts);
  if (known !== undefined) return !RECOIL_SUPPRESSORS.has(toId(known));
  return !abilities.some((a) => RECOIL_SUPPRESSORS.has(toId(a)));
}

/** An item pool minus any recoil-on-attack item ruled out by the mon having
 *  attacked without one revealing itself — judged against `abilities`, the pool the
 *  ability could still be drawn from. Unchanged unless the reveal is trusted. */
function survivingItems(
  abilities: readonly string[],
  items: readonly string[],
  facts: LiveFacts,
): readonly string[] {
  if (!recoilRevealTrusted(abilities, facts)) return items;
  return items.filter((i) => !RECOIL_ON_ATTACK_ITEMS.has(toId(i)));
}

function roleMatches(role: RandbatsRole, facts: LiveFacts): boolean {
  const have = new Set(role.moves.map(toId));
  for (const m of facts.revealedMoves) if (!have.has(toId(m))) return false;
  // An item revealed mid-battle (held, consumed, or knocked off) pins the set the
  // same way a used move does; likewise the innate ability or an active Tera type.
  const revealedItem = facts.item ?? facts.prevItem;
  if (revealedItem && role.items.length > 0 && !role.items.some((i) => toId(i) === toId(revealedItem))) {
    return false;
  }
  // A role whose only items are recoil-on-attack items the mon has just shown it
  // ISN'T holding (landed a hit, none revealed) can no longer be that role.
  if (role.items.length > 0 && survivingItems(role.abilities, role.items, facts).length === 0) return false;
  const ability = innateAbility(facts);
  if (ability && role.abilities.length > 0 && !role.abilities.some((a) => toId(a) === toId(ability))) {
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
    innateAbility(facts) !== undefined || (facts.terastallized && facts.teraType !== undefined);
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

/** Revealed moves (certainties) unioned over the candidate roles' pool for the rest. */
function possibleMovesFor(facts: LiveFacts, candidates: readonly RandbatsRole[], entry: RandbatsEntry): string[] {
  const pool = unionMoves(candidates, entry);
  const poolIds = new Set(pool.map(toId));
  return [...facts.revealedMoves.filter((m) => !poolIds.has(toId(m))), ...pool];
}

/**
 * Assemble one concrete calc-ready mon: known facts (status, boosts, HP, active Tera)
 * always; the given role's spread and the given item/ability for the hidden rest.
 * The single-pick `resolveMon` and the per-variant enumerators all funnel through
 * here, so "known wins, randbats fills the gaps" is written exactly once.
 */
function buildResolved(
  facts: LiveFacts,
  role: RandbatsRole | undefined,
  entry: RandbatsEntry,
  item: string | undefined,
  ability: string | undefined,
  possibleMoves: readonly string[],
  uncertain: string | undefined,
): ResolvedMon {
  return {
    speciesForme: facts.speciesForme,
    level: facts.level || entry.level,
    nature: RANDBATS_NATURE,
    evs: fillStats(RANDBATS_BASE_EVS, role?.evs ?? entry.evs),
    ivs: fillStats(RANDBATS_BASE_IVS, role?.ivs ?? entry.ivs),
    ability,
    item,
    status: facts.status,
    boosts: facts.boosts,
    hpPercent: facts.hpPercent,
    // We never speculate a Tera type — only an ACTIVE terastallization counts.
    teraType: facts.terastallized ? facts.teraType : undefined,
    terastallized: facts.terastallized,
    possibleMoves: [...possibleMoves],
    ...(uncertain ? {assumptionsUncertainReason: uncertain} : {}),
  };
}

export function resolveMon(facts: LiveFacts, entry: RandbatsEntry): ResolvedMon {
  const {chosen, candidates, uncertain} = selectRoles(entry, facts);
  const possibleMoves = possibleMovesFor(facts, candidates, entry);
  // Assume an item we haven't already ruled out by the recoil-reveal rule, so the calc
  // doesn't hand a demonstrably item-less mon a Life Orb boost.
  const item = firstDefined(
    facts.item,
    chosen ? survivingItems(chosen.abilities, chosen.items, facts)[0] : undefined,
    survivingItems(entry.abilities, entry.items, facts)[0],
  );
  const ability = firstDefined(facts.ability, chosen?.abilities[0], entry.abilities[0]);
  return buildResolved(facts, chosen, entry, item, ability, possibleMoves, uncertain);
}

/** The surviving roles as a walkable list, with a single unnamed pseudo-role for
 *  role-less (older-gen) entries so both enumerators below share one shape. */
function survivingRoles(facts: LiveFacts, entry: RandbatsEntry): {name: string; role: RandbatsRole | undefined}[] {
  const {candidates, names} = selectRoles(entry, facts);
  return candidates.length > 0
    ? candidates.map((role, i) => ({name: names[i] ?? '', role: role as RandbatsRole | undefined}))
    : [{name: '', role: undefined}];
}

/**
 * Every DISTINCT set the target could still be running, for uncertainty-aware damage.
 * A revealed item or ability pins that axis to one value; otherwise each surviving
 * role is crossed with the item/ability pool it could roll. Variants identical in
 * every calc-relevant field (spread, item, ability, live facts) collapse to one — so
 * three roles that share a spread and item produce a single variant, not three. The
 * caller runs the calc per variant and merges any that land on the same number.
 */
export function resolveVariants(facts: LiveFacts, entry: RandbatsEntry): SetVariant[] {
  const {candidates, uncertain} = selectRoles(entry, facts);
  const possibleMoves = possibleMovesFor(facts, candidates, entry);

  const variants: SetVariant[] = [];
  for (const {name, role} of survivingRoles(facts, entry)) {
    const abilityPool = role?.abilities?.length ? role.abilities : entry.abilities;
    // Drop any item the recoil-reveal rule ruled out, so a landed-hit mon never gets a
    // phantom Life Orb damage bucket alongside the item it's actually still allowed.
    const itemPool = survivingItems(abilityPool, role?.items?.length ? role.items : entry.items, facts);
    const items: (string | undefined)[] = facts.item !== undefined ? [facts.item] : itemPool.length ? [...itemPool] : [undefined];
    const abilities: (string | undefined)[] =
      facts.ability !== undefined ? [facts.ability] : abilityPool.length ? [...abilityPool] : [undefined];
    for (const item of items) {
      for (const ability of abilities) {
        variants.push({mon: buildResolved(facts, role, entry, item, ability, possibleMoves, uncertain), role: name});
      }
    }
  }
  return dedupeVariants(variants);
}

/**
 * One resolution per surviving role, each with that role's representative item/ability
 * (or the revealed one). Aligns 1:1 with `inferSets`' candidates, so the sets view can
 * attach each block's own damage instead of one set's numbers shared across all blocks.
 */
export function resolveByRole(facts: LiveFacts, entry: RandbatsEntry): SetVariant[] {
  const {candidates, uncertain} = selectRoles(entry, facts);
  const possibleMoves = possibleMovesFor(facts, candidates, entry);
  return survivingRoles(facts, entry).map(({name, role}) => {
    const item = firstDefined(
      facts.item,
      role ? survivingItems(role.abilities, role.items, facts)[0] : undefined,
      survivingItems(entry.abilities, entry.items, facts)[0],
    );
    const ability = firstDefined(facts.ability, role?.abilities[0], entry.abilities[0]);
    return {mon: buildResolved(facts, role, entry, item, ability, possibleMoves, uncertain), role: name};
  });
}

/** A stable signature over the fields @smogon/calc actually reads, so variants that
 *  compute identically (a shared spread, a defensively-inert item) collapse to one. */
function variantSignature(m: ResolvedMon): string {
  return JSON.stringify([
    m.speciesForme, m.level, m.nature, m.evs, m.ivs,
    m.ability ?? null, m.item ?? null, m.status ?? null, m.boosts, m.hpPercent,
    m.teraType ?? null, m.terastallized,
  ]);
}

function dedupeVariants(variants: readonly SetVariant[]): SetVariant[] {
  const seen = new Set<string>();
  const out: SetVariant[] = [];
  for (const v of variants) {
    const key = variantSignature(v.mon);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
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
  const revealedAbility = innateAbility(facts);
  const activeTera = facts.terastallized && facts.teraType ? [facts.teraType] : [];
  const species = baseSpecies(facts.speciesForme);

  const toCandidate = (name: string, role: RandbatsRole): SetKnowledge['candidates'][number] => {
    const items = exclusiveOptions(survivingItems(role.abilities, role.items, facts), revealedItem ? [revealedItem] : []);
    const teraTypes = exclusiveOptions(role.teraTypes, activeTera);
    return {
      name,
      abilities: exclusiveOptions(role.abilities, revealedAbility ? [revealedAbility] : []),
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
