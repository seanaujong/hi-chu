// The Beat Up law: hit COUNT and per-hit base POWER both come from the user's own party
// roster, not from any dex data `@smogon/calc` could carry at all — a full calc gap, but
// shaped like a variable-power multi-hit move (Triple Axel) whose hit count and per-hit
// powers are DERIVED from the roster rather than constant.
//
// `sim/data/moves.ts`'s own implementation is the two rules this file states as one
// function each: `onModifyMove` builds the eligible-ally list (the user itself always
// counts, no matter its own status; every other roster member counts only while it is
// neither fainted nor statused), and `basePowerCallback` turns each surviving member's
// species into that hit's base power — `5 + floor(baseAtk / 10)` of the species' own BASE
// Attack stat, never the boosted/EV'd one. Everything else about the move (the attacker's
// own level, Attack stat, item, ability, STAB, the defender's Defense) is the ordinary
// damage formula, run once per hit through the same variable-power path Triple Axel
// already uses (`core/damage.ts`'s `beatUpProfile`) — this file supplies only the two
// numbers that formula could never derive from move data alone.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {RosterMember} from './types.js';

/**
 * One hit's base power per still-eligible roster member, in roster order — the whole of
 * what Beat Up needs beyond the ordinary damage formula.
 *
 * A species the base-stat lookup doesn't know is skipped rather than guessed, the same
 * "must not break the hover" rule every other calc gap follows here — that undercounts the
 * hit total rather than inventing a number for a Pokémon whose data isn't available.
 */
export function beatUpHitPowers(
  roster: readonly RosterMember[],
  baseAttackOf: (speciesForme: string) => number | undefined,
): readonly number[] {
  const powers: number[] = [];
  for (const member of roster) {
    if (!member.isSelf && (member.fainted || member.hasStatus)) continue;
    const baseAtk = baseAttackOf(member.speciesForme);
    if (baseAtk === undefined) continue;
    powers.push(5 + Math.floor(baseAtk / 10));
  }
  return powers;
}
