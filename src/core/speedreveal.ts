// Who moved first REVEALS an item — the third direction, after `deductions.ts` (did a side
// effect fire?) and `itemreveal.ts` (what number did a hit deal?). Move order is a fact about
// the PAIR, and our own speed is exact, so an observed order bounds theirs: a foe that moved
// second cannot have been holding the Choice Scarf that would have outrun us.
//
// Scarf is the prize, and it is the one axis damage can never reveal — a Scarf changes no
// number at all, so `itemreveal.ts` is blind to it and `deductions.ts` only ever rules out
// all three Choice items together (two freely-chosen moves in a stint). This is the only
// reading that separates the Scarf from the Band.
//
// The shape is `itemreveal.ts`'s: rerun the real model per still-possible variant, keep the
// ones the observation cannot rule out, and never narrow to nothing. Nothing is
// special-cased by item name — a variant is excluded only when its own predicted order
// contradicts what actually happened.
//
// The reading itself (which turn is safe to read at all) is `battle/readState.ts`'s
// `mostRecentCleanOrder`. What lives here is what the order MEANS, and that cannot be
// decided without knowing which sets are still possible: a Prankster variant explains
// moving first with a status move without being fast at all, so the same observation
// convicts one variant and acquits another.

import {finalSpeed, type SpeedContext} from './speed.js';
import type {FieldFacts, OrderedMove, ResolvedMon, SetVariant, TurnOrder} from './types.js';
import {toId} from './facts.js';

/**
 * Abilities that move a Pokémon's PRIORITY bracket in ways this reading models. Each is the
 * sim's own rule, applied per variant rather than per Pokémon — which is the whole reason
 * this judgement lives beside the variants instead of in the reader.
 */
const PRANKSTER = 'prankster';
const TRIAGE = 'triage';

/**
 * Abilities that bend the order in ways this reading does NOT model, so a variant carrying
 * one is kept unjudged rather than convicted. Each fails for its own reason, and all four
 * fail in the same direction — they could produce the observed order without the speed the
 * comparison would otherwise infer:
 *   - Gale Wings needs the holder's HP at the MOMENT it acted, which the log's current
 *     snapshot cannot supply — HP moves every turn and nothing here tracks it backwards.
 *   - Stall and Mycelium Might send their owner LAST inside its bracket regardless of speed.
 *   - Quick Draw is a coin flip, so no order it produces proves anything either way.
 * Abstaining costs a rule-out; convicting invents one, and the house rule is clear about
 * which way to fail.
 */
const UNREADABLE_ABILITIES = new Set(['galewings', 'stall', 'myceliummight', 'quickdraw']);

/** Grassy Glide gains +1, but only while Grassy Terrain is up — the one move in gen 9 whose
 *  bracket depends on the field rather than on its own record. */
const GRASSY_GLIDE = 'grassyglide';

/** The bracket `move` really went in for a Pokémon with `ability`, or undefined when that
 *  ability puts the answer out of reach. */
function bracket(move: OrderedMove, ability: string | undefined, terrain: string | undefined): number | undefined {
  const id = toId(ability ?? '');
  if (UNREADABLE_ABILITIES.has(id)) return undefined;
  let priority = move.priority;
  if (toId(move.name) === GRASSY_GLIDE && terrain === 'Grassy') priority += 1;
  if (id === PRANKSTER && move.category === 'Status') priority += 1;
  if (id === TRIAGE && move.healing) priority += 3;
  return priority;
}

/** Which side a given (ours, theirs) speed pair puts first, or 'tie'. Trick Room inverts the
 *  comparison and never the numbers — the same law `speed.compareSpeed` states. */
function predictTheyMoveFirst(ourSpeed: number, theirSpeed: number, trickRoom: boolean): boolean | 'tie' {
  if (ourSpeed === theirSpeed) return 'tie';
  const theyAreFaster = theirSpeed > ourSpeed;
  return trickRoom ? !theyAreFaster : theyAreFaster;
}

export interface OrderContext {
  readonly gen: number;
  readonly field: FieldFacts;
  /** Our side's Tailwind, and theirs — read from the same FieldFacts, which carries both.
   *  Getting these the wrong way round silently doubles the wrong Pokémon. */
  readonly ourTailwind: boolean;
  readonly theirTailwind: boolean;
}

/**
 * `variants` narrowed to those whose own predicted move order matches what actually
 * happened. A variant survives whenever it COULD have produced the observation:
 *
 *   - a different priority bracket decides the turn outright, and any variant whose bracket
 *     explains the observed order survives on that alone — its speed is never consulted,
 *     which is what stops a Prankster set being convicted of being fast;
 *   - inside one bracket, a variant is ruled out only when its effective speed predicts the
 *     opposite order. A true speed TIE survives either way, since the sim breaks it at
 *     random and both outcomes were really possible;
 *   - a variant whose ability puts the bracket out of reach at all is kept unjudged.
 *
 * Never narrows to nothing: if no variant survives, the READING is what is unsafe — some
 * mechanic this does not model decided that turn — so the pool comes back whole rather than
 * declaring every remaining set impossible. The same rule `variantsConsistentWithDamage`
 * follows, and for the same reason.
 */
export function variantsConsistentWithOrder(
  variants: readonly SetVariant[],
  ours: ResolvedMon,
  observed: TurnOrder,
  ctx: OrderContext,
): SetVariant[] {
  const ourCtx: SpeedContext = {gen: ctx.gen, field: ctx.field, tailwind: ctx.ourTailwind};
  const ourBracket = bracket(observed.ours, ours.ability, ctx.field.terrain);
  if (ourBracket === undefined) return [...variants];
  const ourSpeed = finalSpeed(ours, ourCtx);
  const trickRoom = Boolean(ctx.field.trickRoom);

  const consistent = variants.filter((v) => {
    const theirBracket = bracket(observed.theirs, v.mon.ability, ctx.field.terrain);
    if (theirBracket === undefined) return true; // out of reach — not this reading's call
    if (theirBracket !== ourBracket) return (theirBracket > ourBracket) === observed.theyMovedFirst;
    const theirSpeed = finalSpeed(v.mon, {gen: ctx.gen, field: ctx.field, tailwind: ctx.theirTailwind});
    const predicted = predictTheyMoveFirst(ourSpeed, theirSpeed, trickRoom);
    return predicted === 'tie' || predicted === observed.theyMovedFirst;
  });
  return consistent.length > 0 ? consistent : [...variants];
}
