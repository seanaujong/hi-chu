// Who moves first — the speed-order law.
//
// In randbats a foe's raw Speed is EXACT, not a range: the level is public and the
// feed pins the spread (mainline: 85 EVs / 31 IVs / Serious on every set). All the
// real uncertainty lives on the two axes resolveVariants already enumerates — the
// item (Choice Scarf) and the ability (Swift Swim under rain, …) — so speed gets
// the same distinct-outcome treatment as damage: one effective speed per surviving
// variant, identical numbers collapsed into one bucket, each bucket named by the
// axis that differs. The tooltip shows one plain number in the common case and
// splits only when a Scarf (or a disguised Zoroark) genuinely survives the evidence.
//
// The speed ARITHMETIC is delegated to @smogon/calc's getFinalSpeed — boosts,
// paralysis (with its Quick Feet and gen-6/7 differences), Tailwind, Choice Scarf,
// Iron Ball, every weather/terrain speed ability, Slow Start, Protosynthesis/Quark
// Drive — the same "never hand-apply modifiers" rule the damage layer follows.
// What the calc has no concept of, we own: Trick Room is not a speed change but an
// ORDER inversion, so `compareSpeed` flips the verdict and never touches a number.
//
// This answers "who is faster", not "who acts first" — priority moves, Gale Wings,
// Quick Claw are deliberately out of scope (the native tooltip already shows moves).

// Deep import, deliberately: getFinalSpeed is implemented and typed in @smogon/calc
// but not re-exported from the package index. The package has no `exports` map, so
// the path is reachable — and speed.test.ts pins known composite values, so a calc
// upgrade that moves or changes it fails the build instead of the hover.
import {getFinalSpeed} from '@smogon/calc/dist/mechanics/util';
import {Field, Generations, type GenerationNum} from '@smogon/calc';
import {buildPokemon} from './damage.js';
import {labelBuckets} from './variants.js';
import type {FieldFacts, ResolvedMon, SetVariant} from './types.js';

/** The conditions one mon's effective speed depends on. `tailwind` is THIS mon's own
 *  side's — FieldFacts carries both sides; the caller picks the right one. */
export interface SpeedContext {
  /** Generation number; defaults to 9. */
  readonly gen?: number;
  /** Weather/terrain, which arm the speed abilities (Swift Swim needs the rain). */
  readonly field?: FieldFacts;
  readonly tailwind?: boolean;
}

/** One mon's effective Speed stat under the live conditions. */
export function finalSpeed(mon: ResolvedMon, ctx: SpeedContext = {}): number {
  const gen = Generations.get((ctx.gen ?? 9) as GenerationNum);
  const pokemon = buildPokemon(gen, mon);
  // getFinalSpeed reads weather/terrain from the field and Tailwind from the side we
  // hand it — one side is enough, since we compute each mon's speed independently.
  const field = new Field({
    ...(ctx.field?.weather ? {weather: ctx.field.weather} : {}),
    ...(ctx.field?.terrain ? {terrain: ctx.field.terrain} : {}),
    attackerSide: {isTailwind: Boolean(ctx.tailwind)},
  });
  return getFinalSpeed(gen, pokemon, field, field.attackerSide);
}

/** One distinct possible speed for a mon whose set isn't fully revealed. */
export interface SpeedBucket {
  readonly speed: number;
  /** '' when there is a single outcome; else what tells it apart ("Choice Scarf"). */
  readonly label: string;
  /** How many surviving variants land on this speed — the first bucket (most sets)
   *  is the one the tooltip leads with; the rest become "if …" asides. */
  readonly weight: number;
}

/**
 * The distinct effective speeds across every still-possible set, most-supported
 * bucket first (ties broken faster-first), each labelled by the axis that differs —
 * the same collapse-identical-outcomes law as bucketByDamage.
 */
export function speedBuckets(variants: readonly SetVariant[], ctx: SpeedContext = {}): SpeedBucket[] {
  const groups = new Map<number, SetVariant[]>();
  for (const variant of variants) {
    const speed = finalSpeed(variant.mon, ctx);
    const group = groups.get(speed);
    if (group) group.push(variant);
    else groups.set(speed, [variant]);
  }
  const entries = [...groups.entries()];
  const labels = labelBuckets(entries.map(([, group]) => group));
  return entries
    .map(([speed, group], i) => ({speed, label: labels[i] ?? '', weight: group.length}))
    .sort((a, b) => b.weight - a.weight || b.speed - a.speed);
}

export type MovesFirst = 'ours' | 'theirs' | 'tie';

/** One possible foe speed, judged against ours: who would move first if it holds. */
export interface SpeedOutcome {
  readonly speed: number;
  readonly label: string;
  readonly first: MovesFirst;
}

/** The full verdict for one our-active × foe pair, ready to render. */
export interface SpeedOrder {
  readonly ourSpeed: number;
  readonly trickRoom: boolean;
  readonly outcomes: readonly SpeedOutcome[];
}

/**
 * Judge our speed against each of the foe's possible speeds. Under Trick Room the
 * slower mon acts first, so the verdict flips — the numbers never change, and a
 * true speed tie stays a tie (it's a 50/50 in either room).
 */
export function compareSpeed(ourSpeed: number, foe: readonly SpeedBucket[], trickRoom = false): SpeedOrder {
  const outcomes = foe.map(({speed, label}): SpeedOutcome => {
    const faster: MovesFirst = ourSpeed > speed ? 'ours' : ourSpeed < speed ? 'theirs' : 'tie';
    const first: MovesFirst = faster === 'tie' || !trickRoom ? faster : faster === 'ours' ? 'theirs' : 'ours';
    return {speed, label, first};
  });
  return {ourSpeed, trickRoom, outcomes};
}
