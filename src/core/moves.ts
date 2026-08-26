// Move tables — data, derived directly from Pokémon Showdown's `data/moves.ts`. Three
// mechanics live here, and they share this file because they share a shape: a lookup
// by move name carrying something @smogon/calc's own move data does not.
//
//   multiHitProfile   — how many times a move hits, and at what power per hit.
//   damageCallback    — the damage of a move that has no damage formula at all.
//   randomPowerProfile — a single hit whose OWN base power is randomly chosen.
//
// --- The multi-hit table ----------------------------------------------------
// Every move whose Showdown definition carries a `multihit`. Three facts per move
// matter for our math:
//   - its HitSpec (how many times it hits),
//   - whether it checks accuracy before each hit (`multiaccuracy`, carried on the
//     HitSpec — Population Bomb, Triple Axel, Triple Kick, all 90%), and
//   - each hit's base power, when it varies by hit (Triple Axel 20/40/60, Triple
//     Kick 10/20/30 — the only two; every other multi-hit move rolls one power).
//
// All of them are modelled exactly by convolving per-hit rolls over the hit-count
// distribution (see core/multihit.ts); a variable-power move just supplies its own
// damage distribution per hit, where a uniform-power move reuses a single one.

import type {HitSpec} from './multihit.js';

export interface MultiHitMove {
  readonly spec: HitSpec;
  /** Base power of each successive hit, when it varies by hit (Triple Axel 20/40/60).
   *  Absent = every hit rolls the move's own base power. */
  readonly perHitPowers?: readonly number[];
}

const RANGE: HitSpec = {kind: 'range', min: 2, max: 5};

/** 2-5 hit moves with uniform base power. */
const RANGE_UNIFORM = [
  'Arm Thrust',
  'Barrage',
  'Bone Rush',
  'Bullet Seed',
  'Comet Punch',
  'Double Slap',
  'Fury Attack',
  'Fury Swipes',
  'Icicle Spear',
  'Pin Missile',
  'Rock Blast',
  'Scale Shot',
  'Spike Cannon',
  'Tail Slap',
  'Water Shuriken', // power varies by FORM (Ash-Greninja), not by hit, so still uniform per use
];

/** Fixed-count moves with uniform base power, keyed by hit count. */
const FIXED_UNIFORM: Readonly<Record<string, number>> = {
  Bonemerang: 2,
  'Double Hit': 2,
  'Double Iron Bash': 2,
  'Double Kick': 2,
  'Dragon Darts': 2,
  'Dual Chop': 2,
  'Dual Wingbeat': 2,
  'Gear Grind': 2,
  'Surging Strikes': 3,
  'Tachyon Cutter': 2,
  'Triple Dive': 3,
  'Twin Beam': 2,
  Twineedle: 2,
};

const TABLE: Map<string, MultiHitMove> = (() => {
  const t = new Map<string, MultiHitMove>();
  for (const name of RANGE_UNIFORM) t.set(name, {spec: RANGE});
  for (const [name, hits] of Object.entries(FIXED_UNIFORM)) {
    t.set(name, {spec: {kind: 'fixed', hits}});
  }
  // The multiaccuracy trio: each hit after the first checks 90% or the move ends.
  t.set('Population Bomb', {spec: {kind: 'fixed', hits: 10, accuracyPerHit: 90}});
  t.set('Triple Axel', {spec: {kind: 'fixed', hits: 3, accuracyPerHit: 90}, perHitPowers: [20, 40, 60]});
  t.set('Triple Kick', {spec: {kind: 'fixed', hits: 3, accuracyPerHit: 90}, perHitPowers: [10, 20, 30]});
  return t;
})();

/** The multi-hit profile of a move, or `undefined` for an ordinary single-hit move. */
export function multiHitProfile(moveName: string): MultiHitMove | undefined {
  return TABLE.get(moveName);
}

// --- The damage-callback table ----------------------------------------------
// A handful of moves have no base power at all: Showdown gives them a
// `damageCallback(pokemon, target)` and computes the damage from the battle state
// instead of from the damage formula. Stats, STAB, items, screens, weather and crits
// are all irrelevant to them — the answer is a formula over current HP.
//
// @smogon/calc models SOME of them (Seismic Toss, Night Shade, Dragon Rage, Sonic Boom,
// Final Gambit, Nature's Madness, Guardian of Alola) and simply lacks the rest, for which
// it falls through to the ordinary damage formula and returns the zero a 0-BP move
// deserves. Those are the ones below; the ones the calc already knows are deliberately
// absent, because re-deriving a mechanic the calc models is how the two answers drift.

/**
 * How much damage a move with no base power deals, given both sides' CURRENT HP in raw
 * points. The whole amount, not a roll: these moves have no 85–100% spread and cannot
 * crit, so one number is the complete answer.
 */
export type DamageCallback = (currentHP: {readonly attacker: number; readonly defender: number}) => number;

/** Half the target's current HP, and never less than 1 — Showdown's
 *  `clampIntRange(target.getUndynamaxedHP() / 2, 1)`, whose `clampIntRange` floors first.
 *  The clamp is what makes these moves KO a target already down to its last HP. */
const HALVE_CURRENT_HP: DamageCallback = ({defender}) => Math.max(1, Math.floor(defender / 2));

const DAMAGE_CALLBACKS: Map<string, DamageCallback> = new Map<string, DamageCallback>([
  ['Super Fang', HALVE_CURRENT_HP],
  ['Ruination', HALVE_CURRENT_HP],
  // Endeavor drags the target down to the ATTACKER's own HP, so it deals the difference.
  // It also fails outright unless the attacker is the lower of the two (Showdown guards it
  // with `onTryImmunity: pokemon.hp < target.hp`) — which the subtraction already says: a
  // difference that isn't positive is no damage, and the clamp keeps it from going negative.
  ['Endeavor', ({attacker, defender}) => Math.max(0, defender - attacker)],
]);

/** How this move computes its damage when it has no base power to compute it from, or
 *  `undefined` for the overwhelming majority of moves, which use the damage formula. */
export function damageCallback(moveName: string): DamageCallback | undefined {
  return DAMAGE_CALLBACKS.get(moveName);
}

// --- The random-power table ---------------------------------------------------
// A move that deals exactly ONE hit per use, like any ordinary move, but whose base power
// is itself a coin flip @smogon/calc's own move data carries no notion of: Fickle Beam is
// 80 BP with a flat 30% chance to double to 160. That is a different mechanic from
// multi-hit (several hits, one power each) and from Population Bomb's stop-at-miss hit
// COUNT — here the hit count is always 1, and the WEIGHT the calc's own roll deserves is
// what is missing, the same gap `core/multihit.ts`'s hit-count PMF fills for a multi-hit
// move. `core/damage.ts` runs the calc once per outcome and mixes the resulting PMFs by
// probability, so the KO% integrates over the coin flip rather than conditioning on
// whichever power the calc's own default (never doubled) happens to assume.
export interface RandomPowerOutcome {
  readonly basePower: number;
  /** In [0,1]; every outcome's probability for one move sums to 1. */
  readonly probability: number;
}

export interface RandomPowerMove {
  readonly outcomes: readonly RandomPowerOutcome[];
}

const RANDOM_POWER_TABLE: Map<string, RandomPowerMove> = new Map([
  ['Fickle Beam', {outcomes: [{basePower: 80, probability: 0.7}, {basePower: 160, probability: 0.3}]}],
]);

/** The base-power coin flip a move rolls on every use, or `undefined` for the overwhelming
 *  majority of moves, whose base power is fixed. */
export function randomPowerProfile(moveName: string): RandomPowerMove | undefined {
  return RANDOM_POWER_TABLE.get(moveName);
}
