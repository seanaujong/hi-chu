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
 * The ability that narrows the set: the INNATE one, not the live one, and only when the
 * species could actually HAVE it.
 *
 * Innate, because Trace, Skill Swap, Worry Seed, Entrainment, Simple Beam, Gastro Acid and
 * Mummy/Wandering Spirit all replace or suppress the current ability, while the randbats
 * set is keyed to what the Pokémon was BUILT with — so we read `baseAbility` (falling back
 * to `ability` when nothing has changed and only the current one is known).
 *
 * Verified against the species' own dex ability slots, because the client can hand us a
 * name no set can carry. A composite ability is announced under an UMBRELLA name the dex
 * has never heard of: Calyrex-Shadow's `As One (Spectrier)` arrives as `|-ability| As One`
 * followed by its components (`Unnerve`, then `Grim Neigh` when it procs), and the client's
 * `rememberAbility` stamps that first line — `As One` — into `baseAbility`. The fallback
 * above can also land on a *borrowed* ability, when nothing revealed the innate one before
 * a Skill Swap replaced it. Neither name is one of the species' slots, and a feed role only
 * ever lists a species' real abilities — so such a name can only ever REJECT every role
 * ("matched no known set"), never select one. It tells us nothing, so it narrows nothing.
 * (Absent dex slots — an older client, a fixture with no `battle.dex` — we take the name as
 * given, exactly as before.)
 */
export function innateAbility(facts: LiveFacts): string | undefined {
  const reported = facts.baseAbility ?? facts.ability;
  if (reported === undefined) return undefined;
  const slots = facts.speciesData?.abilities ?? [];
  if (slots.length > 0 && !slots.some((a) => toId(a) === toId(reported))) return undefined;
  return reported;
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
