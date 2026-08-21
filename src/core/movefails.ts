// The outright-failure law: a move that is GUARANTEED to have no effect on its target,
// for a reason knowable ahead of the hit rather than a roll of it.
//
// Three reasons, and only these three — every other way a move can whiff (Protect, an
// accuracy check, a hidden ability like Magic Guard shrugging off a secondary) is a
// PROBABILITY, not a certainty, and this module says nothing about those. Saying nothing is
// the honest answer for them; "never lie: bracket or bucket, never guess" cuts the other way
// here — a *maybe* dressed as a *no effect* is worse than the silence a status move gets today.
//
//   substitute      — a standing Substitute absorbs any move that doesn't bypass it, status
//                      moves included (`substitute.ts`'s `bypassesSubstitute` already covers
//                      this move-generally; it was just never asked outside the damage path).
//   type-immune     — the target's type shields it, on either of two independent axes: the
//                      ordinary type chart (an Electric move has no effect on a Ground target,
//                      whether or not it deals damage), and a target's type being immune to the
//                      STATUS itself regardless of the move's own type (an Electric-type target
//                      cannot be paralyzed by anything, a Grass-type target is immune to powder
//                      moves and to Leech Seed specifically). @smogon/calc models the first —
//                      that's a damage-chart lookup, not a status mechanic — but has no notion
//                      of the second at all, so it's hand-modelled here, from tables measured
//                      against Showdown's own move data (`npm run status-move-data`; see the
//                      docblock below the tables).
//   already-statused — most status moves fail against a target already carrying a major
//                      status; a second Thunder Wave into an already-paralyzed foe does
//                      nothing either.
//
// Unified into ONE reason where the player's question is the same regardless of source — "what
// type is standing in the way" reads identically whether the answer is the powder flag, Leech
// Seed's own immunity, or the plain type chart. Splitting those into three reason KINDS would
// be a new kind of fact for every one of them; this codebase's stated hover-budget rule is to
// unify instead of branch.
//
// Pure: no DOM, no network, no @smogon/calc — the calc-derived inputs (a move's sound flag,
// type, target, and its effectiveness against the target's CURRENT types) are gathered by
// `damage.ts`'s `evaluateMoveFailure`, the only caller, exactly as `substituteStanding` already
// gathers `dexMove.flags.sound` before calling `bypassesSubstitute`.

import {toId} from './facts.js';
import {bypassesSubstitute} from './substitute.js';
import type {StatusName} from './types.js';

export type FailReason =
  | {readonly kind: 'substitute'}
  | {readonly kind: 'type-immune'; readonly immuneType: string}
  | {readonly kind: 'already-statused'; readonly existing: StatusName};

/** The `@smogon/calc` `Move.target` values that point at a single opposing Pokémon (or every
 *  one of them at once) — the only targets any of these three checks are meaningful for. A
 *  self-targeting move (Swords Dance) or a field/side move (Stealth Rock, Tailwind) never
 *  reaches a foe at all, so a Substitute or a type chart has nothing to say about it. */
const OPPONENT_TARGETS: ReadonlySet<string> = new Set(['normal', 'any', 'randomNormal', 'adjacentFoe', 'allAdjacentFoes']);

export function targetsOpponent(target: string): boolean {
  return OPPONENT_TARGETS.has(target);
}

/**
 * Status-category moves whose sole job is inflicting one major status — MEASURED against
 * Showdown's own move data, not recalled, the same discipline `choiceitems.ts`'s
 * `PAIRS_WITH_CHOICE` holds itself to: this is deterministic move data rather than emergent
 * generator behaviour, so `scripts/status-move-data.mjs` enumerates every gen's dex once
 * (`npm run status-move-data`) rather than sampling generated teams, and fails when this table
 * disagrees with what a move's `.status` field actually says. A rarity and a hand-recalled
 * mistake look identical from the outside — an early hand-typed version of this table claimed
 * Spore carries no `powder` flag (a commonly repeated belief, and wrong: it does, measured
 * directly off the gen 9 dex), which is exactly the kind of fact memory gets wrong and a
 * measurement doesn't.
 *
 * Deliberately excludes every move whose status is a SECONDARY effect on a damaging hit (Body
 * Slam's 30% paralysis, Scald's 30% burn) — those moves still deal damage, so "fails outright"
 * doesn't describe them; a missed secondary is a probability this module says nothing about.
 */
const INFLICTS_STATUS: ReadonlyMap<string, StatusName> = new Map([
  ['thunderwave', 'par'],
  ['stunspore', 'par'],
  ['glare', 'par'],
  ['willowisp', 'brn'],
  ['poisonpowder', 'psn'],
  ['poisongas', 'psn'],
  ['toxic', 'tox'],
  ['toxicthread', 'psn'],
  ['spore', 'slp'],
  ['sleeppowder', 'slp'],
  ['hypnosis', 'slp'],
  ['sing', 'slp'],
  ['grasswhistle', 'slp'],
  ['darkvoid', 'slp'],
  ['lovelykiss', 'slp'],
]);

/** Moves carrying Showdown's `powder` flag — blocked outright by a Grass-type target,
 *  independent of whatever status (if any) they'd otherwise inflict. Spore IS here: despite
 *  a common belief otherwise, the gen 9 dex flags it as powder same as Sleep Powder — see
 *  this file's header. */
const POWDER_MOVES: ReadonlySet<string> = new Set([
  'stunspore', 'poisonpowder', 'sleeppowder', 'cottonspore', 'powder', 'ragepowder', 'spore', 'magicpowder',
]);

/** Per-move immunities that are neither the powder flag nor a status-type immunity below —
 *  Leech Seed carries its own, separate Grass-type immunity in Showdown's move data. */
const NO_EFFECT_ON: ReadonlyMap<string, readonly string[]> = new Map([['leechseed', ['Grass']]]);

/** The type(s) categorically immune to each major status, regardless of the inflicting move's
 *  own type — Electric-type Pokémon cannot be paralyzed even by a Normal-type Body Slam. No
 *  type is immune to sleep, so `slp` carries no entry. */
const STATUS_IMMUNE_TYPES: Partial<Record<StatusName, readonly string[]>> = {
  par: ['Electric'],
  brn: ['Fire'],
  psn: ['Poison', 'Steel'],
  tox: ['Poison', 'Steel'],
  frz: ['Ice'],
};

export interface MoveFailInput {
  readonly move: {
    readonly id: string;
    readonly target: string;
    readonly isSound: boolean;
    /** The move's own type — carried into a `type-immune` reason from the ordinary type
     *  chart, so the line can name what actually blocked it. */
    readonly type: string;
  };
  readonly defender: {
    readonly types: readonly string[];
    readonly status: StatusName | undefined;
    readonly substitute: {readonly sizedOnMaxHP?: number; readonly dented: boolean} | undefined;
  };
  readonly attackerAbility: string | undefined;
  /** The move's effectiveness against the defender's CURRENT types (Tera-aware) — 0 means the
   *  ordinary type chart already blocks it. Supplied by the caller (`damage.ts`) rather than
   *  computed here, the same split `hazards.ts` uses for its own type-chart reads: the chart
   *  lookup needs `@smogon/calc`, which this module deliberately stays free of. */
  readonly moveTypeEffectiveness: number;
}

/** Does `move` have no effect on `defender` at all? `null` when nothing here says so — never a
 *  guess, and never for a move this table has no data on (a status move we haven't catalogued
 *  above renders exactly as it does today: nothing). Checked in this order because Substitute
 *  is the most unconditional blocker and a type immunity is a fact about the pair regardless of
 *  battle state; the three CAN overlap (a burned Ground-type behind a Substitute), but only one
 *  line is worth showing. */
export function moveFailsOutright(input: MoveFailInput): FailReason | null {
  if (!targetsOpponent(input.move.target)) return null;
  const moveId = toId(input.move.id);

  if (
    input.defender.substitute &&
    !bypassesSubstitute({name: input.move.id, isSound: input.move.isSound}, input.attackerAbility)
  ) {
    return {kind: 'substitute'};
  }

  if (input.moveTypeEffectiveness === 0) {
    return {kind: 'type-immune', immuneType: input.move.type};
  }

  const perMoveImmunity = NO_EFFECT_ON.get(moveId) ?? (POWDER_MOVES.has(moveId) ? ['Grass'] : undefined);
  const blockedByPerMove = perMoveImmunity?.find((t) => input.defender.types.includes(t));
  if (blockedByPerMove) return {kind: 'type-immune', immuneType: blockedByPerMove};

  const status = INFLICTS_STATUS.get(moveId);
  if (!status) return null;

  const blockedByStatusType = STATUS_IMMUNE_TYPES[status]?.find((t) => input.defender.types.includes(t));
  if (blockedByStatusType) return {kind: 'type-immune', immuneType: blockedByStatusType};

  if (input.defender.status !== undefined) return {kind: 'already-statused', existing: input.defender.status};

  return null;
}
