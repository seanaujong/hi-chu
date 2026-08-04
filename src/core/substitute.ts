// The Substitute law: a shield with its own HP bar, standing in front of a Pokémon.
//
// A Substitute is a doll made from a quarter of its maker's max HP. Every hit that would
// reach the Pokémon hits the doll instead, and the Pokémon takes NOTHING until the doll is
// gone — damage never spills over, so a hit worth three times the doll's HP still leaves the
// Pokémon untouched (gen 5+: the sim's substitute condition caps `damage` at the sub's
// remaining HP and returns `HIT_SUBSTITUTE`). A multi-hit move re-checks per HIT, not per
// use, so the sub can break partway through one Bullet Seed and the rest of that same use
// lands on the Pokémon.
//
// @smogon/calc models none of it — its move table lists Substitute as a 0-BP status move and
// stops — so a subbed target silently makes every damage surface here wrong, and wrong in the
// most confident direction: it reports a KO chance for a hit that cannot land.
//
// What the tooltip SAYS about it is deliberately small: one count, the hits it takes to break
// through. That is the decision a player actually makes at a hover ("do I get through this
// turn, or am I feeding it?"); it arrives in a shape the tooltip already speaks (a small
// range, like the damage line above it); and it reads identically whether the move hits once
// or five times, because the move's own hit count is already on screen. The richer answer is
// computable — this codebase owns a full per-hit damage distribution, so the exact chance
// that a Bullet Seed puts k hits through is a convolution away — and is deliberately not
// shown. Precision nobody can parse mid-turn is worth less than a coarse number they can.
//
// Pure: no DOM, no network, no @smogon/calc.

import {toId} from './facts.js';

/** The fraction of its maker's max HP a Substitute is made from. */
const SUBSTITUTE_FRACTION = 4;

/**
 * A Substitute's HP: a quarter of the max HP of the Pokémon that MADE it, rounded down —
 * the sim's own `Math.floor(target.maxhp / 4)`.
 *
 * "Made it", not "stands behind it", because Shed Tail separates the two: it builds the sub
 * on its user and then switches out, handing it to a teammate whose own max HP had nothing to
 * do with its size (the sim's `copyVolatileFrom` keeps exactly this one volatile across that
 * switch). Sizing such a sub on whoever is standing behind it now is simply a different
 * number, which is why the caller passes the maker's HP rather than the defender's.
 */
export function substituteHP(makerMaxHP: number): number {
  return Math.floor(makerMaxHP / SUBSTITUTE_FRACTION);
}

/** How many hits it takes to break a Substitute. The two ends are reached by the two extreme
 *  rolls, so this range IS the whole answer — nothing between them is unreachable. */
export interface HitsToBreak {
  readonly min: number;
  readonly max: number;
}

/** One hit's damage range. */
export interface HitDamage {
  readonly min: number;
  readonly max: number;
}

/** Nobody breaks a Substitute in a hundred hits; past that the move plainly cannot, and the
 *  cap is what keeps a zero-damage move from being counted forever. */
const HIT_LIMIT = 100;

/** The count of hits needed to reach `subHP`, every hit rolling the end `pick` chooses.
 *  Undefined when it never gets there. */
function countHits(perHit: readonly HitDamage[], subHP: number, pick: (hit: HitDamage) => number): number | undefined {
  let dealt = 0;
  for (let k = 1; k <= HIT_LIMIT; k++) {
    // Hits past the list repeat its last entry, the same convention `totalDamagePmf` uses:
    // a uniform-power move supplies one entry, Triple Axel one per hit.
    dealt += Math.max(0, pick(perHit[Math.min(k - 1, perHit.length - 1)]!));
    if (dealt >= subHP) return k;
  }
  return undefined;
}

/**
 * How many hits of a move dealing `perHit` damage it takes to break a Substitute of `subHP`.
 *
 * Exact rather than estimated, and it needs no probability at all. The sub breaks on the
 * first hit whose CUMULATIVE damage reaches its HP, so the fastest break is every roll at
 * maximum and the slowest is every roll at minimum, and every count between the two is
 * reachable by some sequence of rolls in between. The per-hit cap cannot disturb that: a hit
 * never takes off more than the sub has left, but the damage it discards is damage the sub
 * was never going to absorb anyway.
 *
 * Cumulative, rather than a division, because a move's hits are not always worth the same.
 * Triple Axel escalates 20/40/60, so its first hit is the weakest it will ever throw, and
 * dividing by the strongest would claim it breaks a sub sooner than it can.
 *
 * Undefined when the move cannot break it at all — a defender immune to the move rolls zero,
 * and no number of zeroes is a quarter of anything.
 */
export function hitsToBreak(perHit: readonly HitDamage[], subHP: number): HitsToBreak | undefined {
  if (perHit.length === 0 || subHP <= 0) return undefined;
  const min = countHits(perHit, subHP, (hit) => hit.max);
  const max = countHits(perHit, subHP, (hit) => hit.min);
  // The slow end going unbounded while the fast end lands would need a move whose minimum
  // roll is zero and maximum isn't, which the calc's 1 HP floor on a connecting hit rules
  // out. If it ever happens, say nothing rather than half of something.
  return min !== undefined && max !== undefined ? {min, max} : undefined;
}

/**
 * The damaging moves that go THROUGH a Substitute without being a sound move — Showdown's
 * `bypasssub` flag, minus everything the `sound` flag already covers.
 *
 * Splitting the rule that way is what keeps this table three entries long instead of
 * seventy-nine. Of the moves carrying `bypasssub`, the great majority are status moves that
 * never reach a damage calc; among the DAMAGING ones the two flags coincide exactly except
 * for these three, and every damaging sound move carries `bypasssub` (both directions checked
 * against the sim's own `data/moves.ts`). @smogon/calc exposes `sound` and has no notion of
 * `bypasssub`, so the flag it does expose carries the rule and this is the remainder.
 */
const BYPASSES_SUBSTITUTE_WITHOUT_SOUND: ReadonlySet<string> = new Set([
  'hyperspacefury',
  'hyperspacehole',
  'spectralthief',
]);

/**
 * Does this move reach the Pokémon itself rather than its Substitute?
 *
 * Two ways in, and they belong to different sides of the hit. The MOVE can carry the bypass
 * (every sound move, plus the three above). Or the ATTACKER can: Infiltrator sets
 * `move.infiltrates` on everything its holder throws. @smogon/calc already honours Infiltrator
 * for screens and Aurora Veil (`checkInfiltrator`) but has no substitutes to honour it
 * against, so that half is ours to add.
 */
export function bypassesSubstitute(
  move: {readonly name: string; readonly isSound: boolean},
  attackerAbility: string | undefined,
): boolean {
  if (move.isSound || BYPASSES_SUBSTITUTE_WITHOUT_SOUND.has(toId(move.name))) return true;
  return attackerAbility !== undefined && toId(attackerAbility) === 'infiltrator';
}
