// Damage MAGNITUDE reveals an item — the direction deductions.ts doesn't cover. The
// deductions there rule an item out from a SIDE EFFECT firing or not (Life Orb recoil,
// Heavy-Duty Boots' hazard immunity); this rules items out from the NUMBER a hit dealt.
//
// A hit reveals an item at BOTH ends, and the two ends answer different questions. What the
// foe's own hit dealt bounds its OFFENSIVE item — Choice Band/Specs (×1.5), Life Orb (×1.3),
// Expert Belt (×1.2, super-effective only). What OUR hit dealt into the foe bounds its
// DEFENSIVE one — an Assault Vest's ×1.5 SpD is invisible from every other angle, since it
// changes no damage the foe deals, fires no side effect, and bends no move order. That
// direction is also the sharper of the two: our own set is read exactly from the private
// team, so the only unknown in the calculation is the thing being solved for.
//
// No item is special-cased in either direction: this reruns the real calc per candidate
// variant and checks range containment, the same "never lie" shape as deductions.ts — a
// variant is excluded only when its own math rules it out, never by picking the "closest"
// one. That also means it costs nothing to extend to any item @smogon/calc already knows
// how to apply.
//
// Goes through damage.ts's own calcDamage rather than @smogon/calc directly — no calc
// internals needed here, unlike speed.ts/hazards.ts — so this file stays off
// dependency-boundaries.test.ts's allowlist.

import {calcDamage} from './damage.js';
import type {FieldFacts, ObservedHit, ResolvedMon, SetVariant} from './types.js';

// A foe's HP bar is shown as "n/100" (rounded to the nearest percentage point), so the
// true fraction can differ from the displayed one by up to half a point either way — this
// tolerance covers that display rounding, not a hedge against unmodelled mechanics.
const DEFAULT_TOLERANCE = 0.006;

interface CalcOptions {
  readonly gen: number;
  readonly field?: FieldFacts;
  readonly doubles: boolean;
}

/**
 * The shared law, with the pair left to the caller: `variants` narrowed to the ones whose
 * calculated range for `observed.move` actually CONTAINS the observed fraction (widened by
 * `tolerance` for HP-display rounding on both ends). A variant the calc can't score this
 * move for at all (a status move, an immune matchup, a move outside its dex) is KEPT rather
 * than judged — this only ever rules something OUT on a provable mismatch, never in on a
 * merely-plausible one.
 *
 * Both mons are calculated with the boosts and remaining HP recorded ON THE OBSERVATION
 * rather than the ones they carry now. A move's own secondary lands between the hit and the
 * hover, so those are different tables — and reading the wrong one is not a near-miss but a
 * false rule-out: Bug Buzz drops the defender's SpD, so the boosts standing now predict a
 * bigger hit than actually landed and would convict sets that were never impossible. HP is
 * the same story across a threshold rather than a stage: a Blaze holder that has since
 * dropped under a third would have its Fire moves read at x1.5 for a hit it landed at full
 * health, and a Multiscale defender that has since been chipped loses a halving that was in
 * force when the hit resolved.
 *
 * Never narrows to nothing: if every variant's range fails to contain the observation, that
 * says this READING is unsafe to trust (a mechanic it doesn't model — a damage-boosting
 * weather ability, a second hidden multiplier stacking with the item) rather than that every
 * remaining item is impossible, so the full pool comes back unfiltered rather than lie by
 * omission — the same "would rather miss a rule-out than make a false one" rule
 * `readState.ts`'s log-derived deductions already follow.
 */
function narrowByObservedDamage(
  variants: readonly SetVariant[],
  options: CalcOptions,
  observed: ObservedHit,
  pairFor: (variant: SetVariant) => {attacker: ResolvedMon; defender: ResolvedMon},
  tolerance: number,
): SetVariant[] {
  const consistent = variants.filter((v) => {
    const {attacker, defender} = pairFor(v);
    let report;
    try {
      report = calcDamage(
        {...attacker, boosts: observed.attackerBoosts, hpPercent: observed.attackerHpPercent},
        {...defender, boosts: observed.defenderBoosts, hpPercent: observed.defenderHpPercent},
        observed.move,
        {gen: options.gen, ...(options.field ? {field: options.field} : {}), doubles: options.doubles},
      );
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

/**
 * The foe's still-possible sets, narrowed by what a hit IT landed on us actually dealt —
 * so `variants` stand as the ATTACKER and `defender` is our own resolved Pokémon.
 * Bounds the foe's offensive item. See `narrowByObservedDamage` for the law.
 */
export function variantsConsistentWithDamageDealt(
  variants: readonly SetVariant[],
  defender: ResolvedMon,
  options: CalcOptions,
  observed: ObservedHit,
  tolerance = DEFAULT_TOLERANCE,
): SetVariant[] {
  return narrowByObservedDamage(variants, options, observed, (v) => ({attacker: v.mon, defender}), tolerance);
}

/**
 * The mirror: the foe's still-possible sets narrowed by what a hit WE landed on IT dealt —
 * so `variants` stand as the DEFENDER and `attacker` is our own resolved Pokémon. Bounds the
 * foe's defensive item, which nothing else can see.
 *
 * The `field` in `options` must be read with the FOE as the defending side, since that is
 * whose screens and Tailwind the calculation is about — the opposite orientation from
 * `variantsConsistentWithDamageDealt`, and the trap this codebase falls into most often.
 */
export function variantsConsistentWithDamageTaken(
  variants: readonly SetVariant[],
  attacker: ResolvedMon,
  options: CalcOptions,
  observed: ObservedHit,
  tolerance = DEFAULT_TOLERANCE,
): SetVariant[] {
  return narrowByObservedDamage(variants, options, observed, (v) => ({attacker, defender: v.mon}), tolerance);
}
