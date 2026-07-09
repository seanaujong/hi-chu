// The multi-hit move table — data, derived directly from Pokémon Showdown's
// `data/moves.ts` (every move whose definition carries a `multihit`).
//
// Three facts per move matter for our math:
//   - its HitSpec (how many times it hits),
//   - whether it checks accuracy before each hit (`multiaccuracy`, carried on the
//     HitSpec — Population Bomb, Triple Axel, Triple Kick, all 90%), and
//   - each hit's base power, when it varies by hit (Triple Axel 20/40/60, Triple
//     Kick 10/20/30 — the only two; every other multi-hit move rolls one power).
//
// All of them are modelled exactly by convolving per-hit rolls over the hit-count
// distribution (see core/multihit.ts); a variable-power move just supplies one
// damage roll per hit instead of one shared roll.

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
