// What the LOG leaves standing: the three readings composed into one narrowing.
//
// `deductions.ts`, `itemreveal.ts` and `speedreveal.ts` each judge a foe's still-possible
// sets against one kind of evidence, and each is written to know nothing of the others.
// Somebody has to say which of our own resolutions each of them is judged against, and
// which orientation of the field belongs to which direction. That composition is a law in
// its own right — get it wrong and every reading below it is quietly wrong too — and it
// used to live in `section.ts` as three comments beside a chain of positional arguments,
// where the only way to test it was to build a whole battle.
//
// Two mistakes it exists to prevent, both of which have been made here:
//
//   - reading a past turn against the state on screen. Every observation describes a turn
//     already FOUGHT, so all three want our mon as it stood then — not carrying a Mega or
//     Tera merely ticked in the move panel, which was in effect for none of them.
//   - reading the field from the wrong end. Orientation follows whoever is DEFENDING, so a
//     hit we TOOK and a hit we DEALT need opposite readings of the same battle. Reusing one
//     for both puts their Reflect on us and ours on them, and nothing about the resulting
//     number looks wrong. The two are separate NAMED fields below for that reason: a
//     `field` and a `theirField` in positional argument lists is a swap waiting to happen.
//
// Pure, so `reveals.test.ts` can hand it an observation directly. Gathering the observations
// is the shell's job and stays there — `section.ts` owns the client reads, this owns what
// they mean together.

import {variantsConsistentWithDamageDealt, variantsConsistentWithDamageTaken} from './itemreveal.js';
import {variantsConsistentWithOrder} from './speedreveal.js';
import type {FieldFacts, ObservedHit, ResolvedMon, SetVariant, TurnOrder} from './types.js';

/**
 * What the log turned up, in whichever combination it managed. Every field is optional
 * because each reading has its own conditions for being safe to make at all, and a hover
 * with none of them is the common case.
 */
export interface LogObservations {
  /** A clean hit THEY landed on us — bounds their OFFENSIVE item. */
  readonly theirHit?: ObservedHit;
  /** A clean hit WE landed on them — bounds their DEFENSIVE item, which nothing else sees. */
  readonly ourHit?: ObservedHit;
  /** A turn whose move ORDER is safe to read — the only thing that finds a Choice Scarf. */
  readonly order?: TurnOrder;
}

/** Whether anything was observed at all, so a caller can skip the work entirely. */
export function hasObservation(observations: LogObservations): boolean {
  return Boolean(observations.theirHit ?? observations.ourHit ?? observations.order);
}

/**
 * Our side of the readings: who we were, and the field read from each end.
 *
 * `ourselvesThen` is our Pokémon as it stood on the turns observed. `ourAttacker` is the
 * same Pokémon with its PRIVATE item and ability laid over it, and is absent whenever those
 * cannot be pinned — the outgoing reading divides the observed number by what we think we
 * hit with, so an item guessed from a set's pool multiplies straight into the verdict.
 */
export interface RevealFrame {
  readonly gen: number;
  readonly doubles: boolean;
  readonly ourselvesThen: ResolvedMon;
  readonly ourAttacker?: ResolvedMon;
  /** The field with OUR side defending — for a hit we took, and for the speed reading. */
  readonly fieldDefendingUs: FieldFacts;
  /** The mirror, with THEIR side defending — for a hit we dealt. */
  readonly fieldDefendingThem?: FieldFacts;
}

/**
 * `variants` narrowed by every reading the log supports, applied in turn.
 *
 * Order does not matter to the result — each is an independent filter over the same pool,
 * and none of them may empty it — so this is a fold rather than a pipeline with stages. What
 * matters is that all of them run against the SAME pool, which is what stops one surface
 * showing a Choice Scarf that another has already declared impossible.
 *
 * A reading whose own preconditions are unmet is skipped rather than approximated: no
 * `ourAttacker` means no outgoing damage reading at all, not one taken against a guess.
 */
export function narrowByLog(
  variants: readonly SetVariant[],
  observations: LogObservations,
  frame: RevealFrame,
): readonly SetVariant[] {
  const {gen, doubles, ourselvesThen, ourAttacker, fieldDefendingUs, fieldDefendingThem} = frame;
  let kept = variants;

  if (observations.theirHit) {
    kept = variantsConsistentWithDamageDealt(
      kept,
      ourselvesThen,
      {gen, field: fieldDefendingUs, doubles},
      observations.theirHit,
    );
  }

  if (observations.ourHit && ourAttacker) {
    kept = variantsConsistentWithDamageTaken(
      kept,
      ourAttacker,
      {gen, ...(fieldDefendingThem ? {field: fieldDefendingThem} : {}), doubles},
      observations.ourHit,
    );
  }

  if (observations.order) {
    kept = variantsConsistentWithOrder(kept, ourselvesThen, observations.order, {
      gen,
      field: fieldDefendingUs,
      // Read with our side defending, so `defenderTailwind` is OURS. Swapping these
      // silently doubles the wrong Pokémon's Speed.
      ourTailwind: Boolean(fieldDefendingUs.defenderTailwind),
      theirTailwind: Boolean(fieldDefendingUs.attackerTailwind),
    });
  }

  return kept;
}
