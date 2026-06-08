// The multi-hit move table — data, derived directly from Pokémon Showdown's
// `data/moves.ts` (every move whose definition carries a `multihit`).
//
// Two facts per move matter for our math:
//   - its HitSpec (how many times it hits), and
//   - whether each hit has UNIFORM base power.
//
// Uniform-power moves can be modelled exactly by convolving one per-hit roll
// (see core/multihit.ts). Triple Axel and Triple Kick are the only multi-hit
// moves whose base power changes per hit (20/40/60 and 10/20/30), so a single
// per-hit roll does not describe them — those fall back to @smogon/calc's own
// (correlated) total. Population Bomb's power IS uniform, so it convolves; its
// only wrinkle is the per-hit accuracy check, noted where it's resolved.

import type {HitSpec} from './multihit.js';

export interface MultiHitMove {
  readonly spec: HitSpec;
  /** True when every hit has the same base power (so per-hit convolution is exact). */
  readonly uniformPower: boolean;
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
  'Population Bomb': 10, // uniform power; per-hit accuracy handled at resolve time
};

/** Fixed-count moves whose base power changes per hit — cannot use one per-hit roll. */
const VARIABLE_POWER: Readonly<Record<string, number>> = {
  'Triple Axel': 3,
  'Triple Kick': 3,
};

const TABLE: Map<string, MultiHitMove> = (() => {
  const t = new Map<string, MultiHitMove>();
  for (const name of RANGE_UNIFORM) t.set(name, {spec: RANGE, uniformPower: true});
  for (const [name, hits] of Object.entries(FIXED_UNIFORM)) {
    t.set(name, {spec: {kind: 'fixed', hits}, uniformPower: true});
  }
  for (const [name, hits] of Object.entries(VARIABLE_POWER)) {
    t.set(name, {spec: {kind: 'fixed', hits}, uniformPower: false});
  }
  return t;
})();

/** The multi-hit profile of a move, or `undefined` for an ordinary single-hit move. */
export function multiHitProfile(moveName: string): MultiHitMove | undefined {
  return TABLE.get(moveName);
}
