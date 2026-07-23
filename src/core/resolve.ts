// The resolution law: merge what we KNOW (LiveFacts) over what we ASSUME (RandbatsEntry)
// into the concrete set(s) we hand the damage calc. The rule is uniform — a revealed fact
// always wins; randbats fills only the gaps — and `buildResolved` writes it exactly once,
// so the single-pick `resolveMon` and the per-variant enumerators can't drift apart. This
// is where "account for the active Tera" and "don't halve a Guts mon's damage" live: we
// pass the calc the true ability/item/tera/status and let it resolve the interactions.
// Which ROLES survive the evidence is narrow.ts's job; which items are ruled out is
// deductions.ts's; this module only turns surviving roles into calc-ready mons.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {FullStats, LiveFacts, RandbatsEntry, RandbatsRole, ResolvedMon, SetVariant, StatsTable} from './types.js';
import {toId} from './facts.js';
import {selectRoles} from './narrow.js';
import {survivingItems} from './deductions.js';
import {applyTransform} from './transform.js';

const RANDBATS_BASE_EVS = 85; // gen9 randbats starts every stat at 85 EVs…
const RANDBATS_BASE_IVS = 31; // …and 31 IVs, before per-set overrides.
const RANDBATS_NATURE = 'Serious'; // gen9 randbats does not use natures.

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

/** The mon has demonstrably LOST its item — knocked off, consumed, or Tricked away
 *  (`prevItem` set, nothing held now). We must resolve to NO item rather than guess the
 *  set's, or the calc keeps applying it: Knock Off stays ×1.5-boosted, Leftovers keeps
 *  "healing", an Assault Vest keeps padding SpD — all for an item that's gone. */
function itemGone(facts: LiveFacts): boolean {
  return facts.item === undefined && facts.prevItem !== undefined;
}

/** Unburden doubles Speed only while the item is confirmed GONE — reusing `itemGone` is
 *  what keeps it from firing for a mon that merely started itemless (randbats sets always
 *  start holding one, so `itemGone` already means "lost it mid-battle"). `@smogon/calc`
 *  can't derive this itself; it reads an explicit `abilityOn` flag (see `ResolvedMon`). */
function unburdenActive(facts: LiveFacts, ability: string | undefined): boolean {
  return ability !== undefined && toId(ability) === 'unburden' && itemGone(facts);
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
 * here, so "known wins, the pool fills the gaps" is written exactly once. Exported
 * because assume.ts (the open-format assumption pool) is the second sanctioned
 * producer of ResolvedMons — it reuses this writer so the known-wins law can't fork,
 * while bypassing the narrowing above (there is no evidence law over assumed spreads).
 */
export function buildResolved(
  facts: LiveFacts,
  role: RandbatsRole | undefined,
  entry: RandbatsEntry,
  item: string | undefined,
  ability: string | undefined,
  possibleMoves: readonly string[],
  uncertain: string | undefined,
): ResolvedMon {
  const resolved: ResolvedMon = {
    // The forme actually standing there — a Pokémon mid-Relic-Song attacks as
    // Meloetta-Pirouette, and everything the calc reads (base stats, types, weight) is
    // that forme's. Its SET is still Meloetta's, which is why the layers above kept
    // reading `facts.speciesForme` and only this one, calc-facing, prefers the live forme.
    speciesForme: facts.liveForme ?? facts.speciesForme,
    ...(facts.speciesData ? {speciesData: facts.speciesData} : {}),
    level: facts.level || entry.level,
    nature: role?.nature ?? RANDBATS_NATURE,
    evs: fillStats(RANDBATS_BASE_EVS, role?.evs ?? entry.evs),
    ivs: fillStats(RANDBATS_BASE_IVS, role?.ivs ?? entry.ivs),
    ability,
    item,
    ...(unburdenActive(facts, ability) ? {abilityOn: true} : {}),
    status: facts.status,
    boosts: facts.boosts,
    hpPercent: facts.hpPercent,
    // We never speculate a Tera type — only an ACTIVE terastallization counts.
    teraType: facts.terastallized ? facts.teraType : undefined,
    terastallized: facts.terastallized,
    possibleMoves: [...possibleMoves],
    ...(uncertain ? {assumptionsUncertainReason: uncertain} : {}),
    ...(facts.knownStats ? {knownStats: facts.knownStats} : {}),
    timesAttacked: facts.timesAttacked,
    ...(facts.accuracyBoost !== undefined ? {accuracyBoost: facts.accuracyBoost} : {}),
    ...(facts.evasionBoost !== undefined ? {evasionBoost: facts.evasionBoost} : {}),
  };
  // A Transformed Pokémon wears the copy for every calc, and its own set for everything
  // else — so the overlay lands here, after the set has been resolved, not instead of it.
  return facts.transformedInto ? applyTransform(resolved, facts.transformedInto) : resolved;
}

export function resolveMon(facts: LiveFacts, entry: RandbatsEntry): ResolvedMon {
  const {chosen, candidates, uncertain} = selectRoles(entry, facts);
  const possibleMoves = possibleMovesFor(facts, candidates, entry);
  // Assume an item we haven't already ruled out (deductions.ts), so the calc doesn't hand
  // a demonstrably item-less mon a Life Orb boost — but assume NOTHING once the item's gone.
  const item = facts.item ?? (itemGone(facts)
    ? undefined
    : firstDefined(
        chosen ? survivingItems(chosen.abilities, chosen.items, facts)[0] : undefined,
        survivingItems(entry.abilities, entry.items, facts)[0],
      ));
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
    // Drop any item the deductions ruled out, so a landed-hit mon never gets a phantom
    // Life Orb damage bucket alongside the item it's actually still allowed.
    const itemPool = survivingItems(abilityPool, role?.items?.length ? role.items : entry.items, facts);
    const items: (string | undefined)[] =
      facts.item !== undefined ? [facts.item] : itemGone(facts) ? [undefined] : itemPool.length ? [...itemPool] : [undefined];
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
    const item = facts.item ?? (itemGone(facts)
      ? undefined
      : firstDefined(
          role ? survivingItems(role.abilities, role.items, facts)[0] : undefined,
          survivingItems(entry.abilities, entry.items, facts)[0],
        ));
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
    m.teraType ?? null, m.terastallized, m.knownStats ?? null, m.speciesOverride ?? null,
  ]);
}

/** Exported alongside `buildResolved` for assume.ts, the second variant producer. */
export function dedupeVariants(variants: readonly SetVariant[]): SetVariant[] {
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
