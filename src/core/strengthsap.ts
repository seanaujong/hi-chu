// The Strength Sap law: a move that deals no damage and heals by a STAT.
//
// @smogon/calc has nothing to say about it — 0 base power, Status category, so the
// ordinary damage path returns the zero a 0-BP move deserves. That is the same gap Pain
// Split falls into, and the same surface catches both. What replaces the damage line is
// not a roll at all. Showdown heals the user by `target.getStat('atk', false, true)`, and
// those two flags ARE the law: boosts applied, every other modifier skipped. No Choice
// Band, no Huge Power, no Guts, no Hustle, no weather ability. So the amount is a pure
// function of two things already known — the target's raw final Attack and its public
// Attack stage — one exact integer per still-possible set, with no 85-100% spread and no
// crit to average over. Where the damage layer buckets a RANGE per variant, this buckets
// a single number, which is why it reads like core/speed.ts rather than core/damage.ts.
//
// Every number this computes is pinned against the SIMULATOR rather than read off its
// source, because `getStat`'s two flags are easy to invert on a reading and nothing about
// a wrong one looks wrong — see the header of strengthsap.test.ts for the battles that
// produced them. The tell that the flags are the right way round is a Huge Power
// Azumarill: the sim reports 132 here and 264 for its actual attacking stat.
//
// TWO THINGS THE HEAL PASSES THROUGH, and only one is modelled:
//   - LIQUID OOZE inverts the siphon into damage to the user (`canOoze` names
//     'strengthsap' outright), which is why an outcome here can lower our HP instead of
//     raising it. Reachable in randbats — Swalot and Tentacruel both carry it.
//   - BIG ROOT multiplies it by 5324/4096. Deliberately NOT modelled: no set in the
//     randbats feed holds one, on either side, so there is no flow to earn it. The
//     rounding was measured anyway and belongs in the commit that found it, not in a
//     branch nothing can reach.
//
// The cap is the reason this reports an HP position rather than an amount: a siphon
// worth 99% of a Sinistcha's max HP heals 10% when it is already at 90%, and the
// question the hover answers is where the sap LEAVES us, not what it was worth in the
// abstract.
//
// Pure: no DOM, no network, and no @smogon/calc — the stat maths is arithmetic over the
// spread, so this module reaches the calc only through damage.ts's `finalStatsOf`.

import {finalStatsOf} from './damage.js';
import {labelBuckets} from './variants.js';
import {toId} from './facts.js';
import type {ResolvedMon, SetVariant} from './types.js';

/** Showdown's boost multipliers, indexed by absolute stage — multiplied going up,
 *  DIVIDED going down, each floored. Lifted from `sim/pokemon.ts`'s `getStat`. */
const BOOST_TABLE = [1, 1.5, 2, 2.5, 3, 3.5, 4];

/** One distinct place the sap could leave us, over the target's still-possible sets. */
export interface SapOutcome {
  /** Our own HP after the sap, as a percent of our max. */
  readonly after: number;
  /** '' when there is a single outcome; else what tells it apart ("Bulky Attacker"). */
  readonly label: string;
  /** How many surviving sets land here — the first outcome is the best-supported one. */
  readonly weight: number;
}

/** Where a Strength Sap leaves the USER, per still-possible target set. */
export interface StrengthSapReport {
  /** Our HP now, as a percent of our own max — shared by every outcome below. */
  readonly before: number;
  /** Distinct outcomes, best-supported first (ties broken most-HP-first). */
  readonly outcomes: readonly SapOutcome[];
}

/**
 * The Attack this move reads off a target: `getStat('atk', false, true)` — the raw final
 * stat moved by its boost stage and by nothing else. Undefined when the species' base
 * stats are unavailable, which is the same silence the damage layer keeps.
 */
export function sappedAttack(mon: ResolvedMon, gen = 9): number | undefined {
  const stats = finalStatsOf(gen, mon);
  if (!stats) return undefined;
  const stage = Math.max(-6, Math.min(6, mon.boosts.atk ?? 0));
  return stage >= 0
    ? Math.floor(stats.atk * (BOOST_TABLE[stage] ?? 1))
    : Math.floor(stats.atk / (BOOST_TABLE[-stage] ?? 1));
}

/**
 * Where a Strength Sap into each still-possible target set would leave us. Identical
 * outcomes collapse into one, the same distinct-outcome law damage and speed already
 * follow, so a fan-out that changes nothing about our HP renders as a single line.
 *
 * The fan-out is real rather than theoretical: the randbats generator zeroes both the EVs
 * and the IVs of a set with no physical move, so a species whose surviving roles disagree
 * about that genuinely siphons two different amounts.
 *
 * A target already at -6 Attack makes the move fail outright, which this reports as the
 * zero heal it is — an outcome equal to our current HP, and the honest answer to the only
 * question asked here.
 */
export function strengthSap(user: ResolvedMon, targets: readonly SetVariant[], gen = 9): StrengthSapReport {
  const maxHP = finalStatsOf(gen, user)?.hp;
  if (!maxHP) return {before: 0, outcomes: []}; // a species we can't size: say nothing
  const currentHP = Math.round(maxHP * user.hpPercent);
  const pct = (hp: number): number => Math.round((hp / maxHP) * 1000) / 10;

  const groups = new Map<number, SetVariant[]>();
  for (const variant of targets) {
    // Showdown bails before reading the stat at all when Attack is already bottomed out
    // (`if (target.boosts.atk === -6) return false`), so the move heals nothing. That is a
    // fact about the MOVE failing rather than about the stat, which is why it lives here
    // and not in `sappedAttack` — the Attack is still perfectly readable, just unusable.
    const bottomedOut = (variant.mon.boosts.atk ?? 0) <= -6;
    const siphoned = bottomedOut ? 0 : (sappedAttack(variant.mon, gen) ?? 0);
    // Liquid Ooze turns the siphon around: the same amount, taken off us instead.
    const after = toId(variant.mon.ability ?? '') === 'liquidooze'
      ? Math.max(0, currentHP - siphoned)
      : Math.min(maxHP, currentHP + siphoned);
    const group = groups.get(after);
    if (group) group.push(variant);
    else groups.set(after, [variant]);
  }

  const entries = [...groups.entries()];
  const labels = labelBuckets(entries.map(([, group]) => group));
  const outcomes = entries
    .map(([after, group], i): SapOutcome => ({after: pct(after), label: labels[i] ?? '', weight: group.length}))
    .sort((a, b) => b.weight - a.weight || b.after - a.after);
  return {before: pct(currentHP), outcomes};
}
