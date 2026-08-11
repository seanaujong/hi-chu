// One move's damage, over every set the other side could still BE.
//
// `damage.ts` answers the question for one concrete pair. `variants.ts` collapses many
// answers into the few DISTINCT outcomes a player needs to read. This is the step between:
// run the calc once per still-possible set, drop the ones the calc cannot model, and hand
// the results to `bucketByDamage`.
//
// It is a module rather than a few lines in either neighbour because neither can hold it.
// `damage.ts` is the calc boundary and would have to import `variants.ts` to bucket, which
// `variants.ts` already type-imports back. And `variants.ts` is deliberately general —
// `speed.ts` and `strengthsap.ts` reuse its labelling for outcomes that are not damage at
// all — so teaching it to run the damage calc would specialise a law that three different
// domains share.
//
// The loop itself lived in `section.ts`, where its only tie to the shell was a parameter
// typed `ReturnType<typeof readFieldFacts>` — an alias for `FieldFacts` wearing a shell
// function's name, and the whole reason 200-odd lines of pure logic looked shell-bound.

import {calcDamage, type DamageReport} from './damage.js';
import {toId} from './facts.js';
import {bucketByDamage, type DamageBucket} from './variants.js';
import type {FieldFacts, ResolvedMon, SetVariant} from './types.js';

/** The field and format one calc run needs, shared by every entry point here. */
export interface DamageContext {
  readonly gen: number;
  readonly field: FieldFacts;
  readonly doubles: boolean;
  /** Request the nHKO ladder up to this turn. Absent on the compact views, which skip
   *  the survival sim entirely. */
  readonly nhkoTurns?: number;
  /** Request the attacker's own drain/recoil swing — the move tooltip renders it, the
   *  compact views don't, and a view that doesn't ask keeps its buckets keyed as before. */
  readonly selfHp?: boolean;
}

/**
 * Score `moveName` over a pool of still-possible sets, one calc run per variant, and bucket
 * the results into the distinct outcomes. `build` picks which side of the calc each variant
 * fills — the shared core for both directions: `moveDamageBuckets` varies the DEFENDER (a
 * fixed attacker's move into an uncertain foe), and `incomingDamageBuckets` varies the
 * ATTACKER (an uncertain foe's move into a fixed defender). Status and unmodellable variants
 * are dropped; an all-dropped move yields no buckets.
 */
function scoreVariants(
  variants: readonly SetVariant[],
  moveName: string,
  build: (mon: ResolvedMon) => readonly [attacker: ResolvedMon, defender: ResolvedMon],
  ctx: DamageContext,
): DamageBucket[] {
  const scored: {variant: SetVariant; report: DamageReport}[] = [];
  for (const variant of variants) {
    try {
      const [atk, def] = build(variant.mon);
      const report = calcDamage(atk, def, moveName, {
        gen: ctx.gen,
        field: ctx.field,
        doubles: ctx.doubles,
        ...(ctx.nhkoTurns !== undefined ? {nhkoTurns: ctx.nhkoTurns} : {}),
        ...(ctx.selfHp ? {selfHp: ctx.selfHp} : {}),
      });
      if (report.category !== 'Status') scored.push({variant, report});
    } catch {
      // A move outside the calc's world for this variant shouldn't drop the section.
    }
  }
  return bucketByDamage(scored);
}

/**
 * The distinct damage outcomes for `moveName` from `attacker` into the target, one per
 * still-possible DEFENDING set, merged where they land on the same number.
 */
export function moveDamageBuckets(
  attacker: ResolvedMon,
  defenderVariants: readonly SetVariant[],
  moveName: string,
  ctx: DamageContext,
): DamageBucket[] {
  return scoreVariants(defenderVariants, moveName, (mon) => [attacker, mon], ctx);
}

/**
 * The mirror: the distinct outcomes for `moveName` from a still-uncertain ATTACKER into a
 * fixed `defender`. Two callers vary the attacker rather than the defender — the matchup
 * view's defensive half (what a foe's move would do INTO the mon being evaluated) and the
 * sets view's per-candidate damage (`candidateDamageByMove`, which also asks for the ladder).
 */
export function incomingDamageBuckets(
  defender: ResolvedMon,
  attackerVariants: readonly SetVariant[],
  moveName: string,
  ctx: DamageContext,
): DamageBucket[] {
  return scoreVariants(attackerVariants, moveName, (mon) => [mon, defender], ctx);
}

/**
 * The distinct damage outcomes for each of `moves`, from every still-possible variant of ONE
 * candidate role into `defender` — the sets view's per-candidate damage. It enumerates every
 * item/ability the role could still be running rather than picking a representative one and
 * hoping. A role with no real uncertainty (one variant, or every variant landing on the same
 * number) still comes back as a single bucket with an empty label, which the caller renders
 * inline exactly as it always has; only a REAL split (an Assault Vest that changes the
 * number) grows a second outcome. Status moves and moves the calc can't model for this role
 * are simply absent.
 *
 * Requests the nHKO ladder up to turn 2: `render.koTier` reads its turn-2 figure to colour a
 * move '2hko' when it can't OHKO outright but a second use realistically could, so a fast
 * scan down the block still flags danger the raw percent alone wouldn't at a glance.
 */
export function candidateDamageByMove(
  roleVariants: readonly SetVariant[],
  defender: ResolvedMon,
  moves: readonly string[],
  ctx: DamageContext,
): Map<string, DamageBucket[]> {
  const out = new Map<string, DamageBucket[]>();
  for (const move of moves) {
    const buckets = incomingDamageBuckets(defender, roleVariants, move, {...ctx, nhkoTurns: 2});
    if (buckets.length > 0) out.set(toId(move), buckets);
  }
  return out;
}
