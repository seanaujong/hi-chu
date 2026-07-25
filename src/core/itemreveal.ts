// Damage MAGNITUDE reveals an item — the direction deductions.ts doesn't cover. The
// deductions there rule an item out from a SIDE EFFECT firing or not (Life Orb recoil,
// Heavy-Duty Boots' hazard immunity); this rules items out from the NUMBER a hit dealt.
// Choice Band/Specs (×1.5), Life Orb (×1.3), Expert Belt (×1.2, super-effective only) each
// change a landed hit's damage by a fixed, known factor over the itemless baseline — so an
// observed hit's actual magnitude, compared against each still-possible set's own
// calculated range, rules out any set whose range provably could not have produced it.
//
// No item is special-cased: this reruns the real calc per candidate variant and checks
// range containment, the same "never lie" shape as deductions.ts — a variant is excluded
// only when its own math rules it out, never by picking the "closest" one. That also means
// it costs nothing to extend to any item @smogon/calc already knows how to apply.
//
// Goes through damage.ts's own calcDamage rather than @smogon/calc directly — no calc
// internals needed here, unlike speed.ts/hazards.ts — so this file stays off
// dependency-boundaries.test.ts's allowlist.

import {calcDamage} from './damage.js';
import type {FieldFacts, ResolvedMon, SetVariant} from './types.js';

/**
 * Observed magnitude of one clean hit — see `battle/readState.ts`'s `mostRecentCleanHit`
 * for how "clean" is defined (a single hit, no crit, no KO, nothing that would change the
 * calc has happened since).
 */
export interface ObservedHit {
  readonly move: string;
  /** Fraction of the DEFENDER's max HP actually lost to this one hit, in [0, 1]. */
  readonly damageFraction: number;
}

// A foe's HP bar is shown as "n/100" (rounded to the nearest percentage point), so the
// true fraction can differ from the displayed one by up to half a point either way — this
// tolerance covers that display rounding, not a hedge against unmodelled mechanics.
const DEFAULT_TOLERANCE = 0.006;

/**
 * `variants` narrowed to the ones whose calculated damage range for `observed.move`
 * against `defender` actually CONTAINS the observed fraction (the range widened by
 * `tolerance` for HP-display rounding on both ends). A variant the calc can't score this
 * move for at all (a status move, an immune matchup, a move outside its dex) is KEPT
 * rather than judged — this function only ever rules something OUT on a provable mismatch,
 * never in on a merely-plausible one.
 *
 * Never narrows to nothing: if every variant's range fails to contain the observation, that
 * says this READING is unsafe to trust (a mechanic it doesn't model — a damage-boosting
 * weather ability, a second hidden multiplier stacking with the item) rather than that every
 * remaining item is impossible, so the full pool comes back unfiltered rather than lie by
 * omission — the same "would rather miss a rule-out than make a false one" rule
 * `readState.ts`'s log-derived deductions already follow.
 */
export function variantsConsistentWithDamage(
  variants: readonly SetVariant[],
  defender: ResolvedMon,
  options: {readonly gen: number; readonly field?: FieldFacts; readonly doubles: boolean},
  observed: ObservedHit,
  tolerance = DEFAULT_TOLERANCE,
): SetVariant[] {
  const consistent = variants.filter((v) => {
    let report;
    try {
      report = calcDamage(v.mon, defender, observed.move, {
        gen: options.gen,
        ...(options.field ? {field: options.field} : {}),
        doubles: options.doubles,
      });
    } catch {
      return true; // outside the calc's world for this variant — not this reading's call
    }
    if (report.category === 'Status') return true; // nothing to compare a status move against
    const min = report.percent.min / 100 - tolerance;
    const max = report.percent.max / 100 + tolerance;
    return observed.damageFraction >= min && observed.damageFraction <= max;
  });
  return consistent.length > 0 ? consistent : [...variants];
}
