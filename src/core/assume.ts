// The open-format assumption law: what to feed the calc when NO pool enumerates the
// foe's possible sets (OU, VGC, Custom Game — anywhere without a randbats feed). The
// unknowable axes are BRACKETED instead of enumerated: the defensive spread by its two
// honest extremes (uninvested vs maxed on the axis this move attacks), the ability by
// the species' dex slots (public knowledge — a species can only have its slot
// abilities), the item by nothing at all (a v1 limitation the tooltip's ⚠ note owns).
//
// buildResolved (resolve.ts) stays the single writer, so known facts — status, boosts,
// HP, active Tera, a revealed item or ability — win here exactly as they do in
// randbats. There is deliberately NO narrowing: narrow.ts is an evidence law over feed
// roles, and an assumed spread has no move pool for evidence to test against.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts, RandbatsEntry, RandbatsRole, SetVariant} from './types.js';
import {buildResolved, dedupeVariants} from './resolve.js';

/** The damage categories that have a defensive axis to invest against. */
export type MoveSlant = 'Physical' | 'Special';

const ZERO_EVS = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
const NO_POOLS = {abilities: [], items: [], teraTypes: [], moves: []};

export interface AssumedSpread {
  /** The bucket label a damage line wears when spreads split the number. */
  readonly name: string;
  readonly role: RandbatsRole;
}

/** The two honest extremes of defensive investment against one damage category. A
 *  real spread lands between them, so the two labelled lines bracket the truth. */
export function assumedSpreads(slant: MoveSlant): readonly AssumedSpread[] {
  const bulk: AssumedSpread =
    slant === 'Physical'
      ? {name: 'max HP/Def', role: {...NO_POOLS, nature: 'Bold', evs: {...ZERO_EVS, hp: 252, def: 252}}}
      : {name: 'max HP/SpD', role: {...NO_POOLS, nature: 'Calm', evs: {...ZERO_EVS, hp: 252, spd: 252}}};
  return [{name: 'uninvested', role: {...NO_POOLS, nature: 'Serious', evs: ZERO_EVS}}, bulk];
}

/**
 * Every set the defender is assumed possibly running, for uncertainty-aware damage:
 * assumed spreads × the ability pool, exactly the shape `resolveVariants` produces
 * from a feed, so the bucketing/labelling machinery downstream needs no new case.
 */
export function assumeDefenderVariants(facts: LiveFacts, slant: MoveSlant): SetVariant[] {
  const entry: RandbatsEntry = {level: facts.level || 100, abilities: [], items: []};
  // The live ability drives the calc when known; otherwise any dex slot is possible.
  const abilities: (string | undefined)[] =
    facts.ability !== undefined
      ? [facts.ability]
      : facts.speciesData?.abilities?.length
        ? [...facts.speciesData.abilities]
        : [undefined];
  const variants: SetVariant[] = [];
  for (const spread of assumedSpreads(slant)) {
    for (const ability of abilities) {
      variants.push({
        mon: buildResolved(facts, spread.role, entry, facts.item, ability, [], undefined),
        role: spread.name,
      });
    }
  }
  return dedupeVariants(variants);
}
