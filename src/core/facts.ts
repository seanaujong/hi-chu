// Small pure readings of LiveFacts shared across the set-inference modules (narrow,
// resolve, knowledge, deductions). Kept in one leaf module so those layers don't have to
// depend on each other just to agree on "the innate ability" or "is this a Mega forme".
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts} from './types.js';

/** Showdown id form: lowercase, alphanumerics only ("U-turn" → "uturn"). */
export function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The ability that narrows the set: the INNATE one, not the live one. Trace, Skill Swap,
 * Worry Seed, Entrainment, Simple Beam, Gastro Acid, and Mummy/Wandering Spirit all
 * replace or suppress the current ability, but the randbats set is keyed to what the
 * Pokémon was BUILT with — so we match on `baseAbility` (falling back to `ability` when
 * nothing has changed and only the current one is known).
 */
export function innateAbility(facts: LiveFacts): string | undefined {
  return facts.baseAbility ?? facts.ability;
}

/**
 * True once a Pokémon has Mega Evolved (its forme carries the "-Mega" suffix). A Mega
 * forme's ability is forme-LOCKED — every Meganium-Mega has the same one — so it carries
 * no set-discriminating information, and it must not gate role matching: the live client
 * and the randbats feed can even name it differently (a Champions Meganium-Mega reports
 * ability "Mega Sol" while the feed lists "Leaf Guard"), which would otherwise reject
 * every role. The forme change plus the revealed Mega stone already pin the set.
 */
export function isMegaForme(speciesForme: string): boolean {
  return /-Mega(-[XY])?$/.test(speciesForme);
}
