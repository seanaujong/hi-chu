// The probability law behind multi-hit damage.
//
// @smogon/calc models a k-hit move as `k × one shared damage roll` — every hit
// rolls identically. That is wrong twice over: each hit actually rolls its damage
// independently (so the total is far less variable than k × one roll), and for a
// 2-5 hit move the *number* of hits is itself random. This module fixes both by
// working with explicit probability mass functions (PMFs) and convolving them.
//
// Everything here is pure: no DOM, no network, no @smogon/calc. It takes the
// 16 single-hit damage rolls (each equally likely, 1/16) and a hit-count
// distribution, and returns the full distribution of total damage — from which
// KO chance and expected damage fall out exactly.

/**
 * A probability mass function: outcome value → probability. Probabilities sum to 1.
 * Used for both "total damage" (key = HP) and "number of hits" (key = hit count).
 */
export type Pmf = ReadonlyMap<number, number>;

/** How many times a move hits, before ability/item modifiers. */
export type HitSpec =
  | {readonly kind: 'single'} //                       an ordinary one-hit move
  | {
      readonly kind: 'fixed';
      readonly hits: number; // Double Kick (2), Population Bomb (10), …
      /**
       * PS `multiaccuracy`: the move checks accuracy (this percent, e.g. 90) before every
       * hit AFTER the first and stops at the first miss — Population Bomb, Triple Axel,
       * Triple Kick. Absent = only the move's initial accuracy check, which (like every
       * damage calc) we condition on passing.
       */
      readonly accuracyPerHit?: number;
    }
  | {readonly kind: 'range'; readonly min: number; readonly max: number}; // 2-5 moves

/** Ability/item facts that change the hit-count distribution. */
export interface HitCountMods {
  /** Skill Link — a 2-5 move always hits the maximum number of times. */
  readonly skillLink: boolean;
  /** Loaded Dice — see `hitCountPmf` for the exact reshaping it applies. */
  readonly loadedDice: boolean;
  /** Wide Lens — raises each per-hit accuracy check (×4505/4096, PS rounding: 90 → 99). */
  readonly wideLens: boolean;
}

// ---------------------------------------------------------------------------
// Building PMFs
// ---------------------------------------------------------------------------

/** Turn a list of equally-likely outcomes into a PMF, merging duplicates. */
export function pmfFromSamples(samples: readonly number[]): Pmf {
  const p = 1 / samples.length;
  const pmf = new Map<number, number>();
  for (const value of samples) pmf.set(value, (pmf.get(value) ?? 0) + p);
  return pmf;
}

/**
 * The distribution over how many times a move hits.
 *
 * Mirrors Pokémon Showdown's `sim/battle-actions.ts` exactly:
 *   - 2-5 moves: 35/35/15/15 for 2/3/4/5 hits.
 *   - Skill Link: a 2-5 move always hits its max.
 *   - Loaded Dice on a 2-5 move: the 70% of rolls that would have been 2 or 3 are
 *     reassigned uniformly to {4,5}; the 30% already at 4/5 stay — netting {4:½, 5:½}.
 *   - Loaded Dice on Population Bomb (10): `10 - random(7)` → uniform over {4…10}.
 *   - `multiaccuracy` (Population Bomb, Triple Axel, Triple Kick): every hit after the
 *     first must pass its own accuracy check or the move ends — the stop-at-miss law.
 *     Loaded Dice DELETES the flag (PS `data/items.ts`), so its holder keeps every hit.
 */
export function hitCountPmf(spec: HitSpec, mods: HitCountMods): Pmf {
  switch (spec.kind) {
    case 'single':
      return new Map([[1, 1]]);

    case 'fixed':
      if (spec.hits === 10 && mods.loadedDice) {
        // Population Bomb + Loaded Dice: uniform 4..10 (and never misses a hit).
        return pmfFromSamples([4, 5, 6, 7, 8, 9, 10]);
      }
      if (spec.accuracyPerHit !== undefined && !mods.loadedDice) {
        return stopAtMissPmf(spec.hits, perHitChance(spec.accuracyPerHit, mods));
      }
      return new Map([[spec.hits, 1]]);

    case 'range': {
      const {min, max} = spec;
      if (mods.skillLink) return new Map([[max, 1]]);
      if (mods.loadedDice) {
        // Reassign every roll below 4 uniformly to {4,5}; keep 4/5 as-is.
        return reassignBelow4ToHigh(baseRangePmf(min, max));
      }
      return baseRangePmf(min, max);
    }
  }
}

/** The unmodified hit-count distribution for a range move. */
function baseRangePmf(min: number, max: number): Pmf {
  // The only real range move is 2-5, weighted 35/35/15/15. For any other range
  // (none exist today) fall back to uniform so the law stays total.
  if (min === 2 && max === 5) {
    return new Map([
      [2, 0.35],
      [3, 0.35],
      [4, 0.15],
      [5, 0.15],
    ]);
  }
  const samples: number[] = [];
  for (let h = min; h <= max; h++) samples.push(h);
  return pmfFromSamples(samples);
}

/**
 * The chance one per-hit accuracy check passes, as a probability. Wide Lens applies its
 * 4505/4096 with PS's own round-half-down `modify()` (90 → 99). Other accuracy modifiers
 * (accuracy/evasion boosts, Compound Eyes, Hustle, No Guard) are deliberately out of
 * scope — no randbats set pairs one with a multiaccuracy move.
 */
export function perHitChance(accuracyPercent: number, mods: HitCountMods): number {
  const acc = mods.wideLens ? Math.trunc((accuracyPercent * 4505 + 2048 - 1) / 4096) : accuracyPercent;
  return Math.min(1, acc / 100);
}

/**
 * The stop-at-miss hit-count law (PS `multiaccuracy`): hit 1 is certain — damage calcs
 * always condition on the shown move connecting — and each further hit lands with
 * probability `p`, the move ending at the first miss. P(k) = p^(k-1)·(1-p) below the
 * cap, p^(maxHits-1) at it.
 */
function stopAtMissPmf(maxHits: number, p: number): Pmf {
  if (p >= 1) return new Map([[maxHits, 1]]);
  const pmf = new Map<number, number>();
  let reach = 1; // probability the move is still going when hit k is attempted
  for (let k = 1; k < maxHits; k++) {
    pmf.set(k, reach * (1 - p));
    reach *= p;
  }
  pmf.set(maxHits, reach);
  return pmf;
}

/** Loaded Dice reshaping: mass on hit counts <4 is split evenly between 4 and 5. */
function reassignBelow4ToHigh(base: Pmf): Pmf {
  let movable = 0;
  const result = new Map<number, number>();
  for (const [hits, prob] of base) {
    if (hits < 4) movable += prob;
    else result.set(hits, prob);
  }
  result.set(4, (result.get(4) ?? 0) + movable / 2);
  result.set(5, (result.get(5) ?? 0) + movable / 2);
  return result;
}

// ---------------------------------------------------------------------------
// Combining PMFs
// ---------------------------------------------------------------------------

/** Distribution of X + Y for independent X, Y. */
export function convolve(a: Pmf, b: Pmf): Pmf {
  const sum = new Map<number, number>();
  for (const [x, px] of a) {
    for (const [y, py] of b) {
      const k = x + y;
      sum.set(k, (sum.get(k) ?? 0) + px * py);
    }
  }
  return sum;
}

/** Distribution of the sum of `n` independent draws from `base` (n ≥ 0). */
export function convolveN(base: Pmf, n: number): Pmf {
  let acc: Pmf = new Map([[0, 1]]); // sum of zero hits is 0 with certainty
  for (let i = 0; i < n; i++) acc = convolve(acc, base);
  return acc;
}

/**
 * Total damage when both the per-hit rolls and the hit count are random.
 *
 * `perHit[i-1]` is hit i's damage distribution; hits past the array's end repeat its
 * last entry, so a uniform-power move passes ONE element and a variable-power move
 * (Triple Axel 20/40/60) one per hit. For each possible hit count k (weighted by
 * `hitCounts`), the total is the sum of the first k hits' independent rolls; mixing
 * those by their hit-count probability gives the exact total-damage distribution.
 * This is the corrected replacement for the calc's `k × one shared roll`.
 */
export function totalDamagePmf(perHit: readonly Pmf[], hitCounts: Pmf): Pmf {
  const total = new Map<number, number>();
  let prefix: Pmf = new Map([[0, 1]]); // distribution of the first `hitsConvolved` hits' sum
  let hitsConvolved = 0;
  for (const [k, pk] of [...hitCounts.entries()].sort((a, b) => a[0] - b[0])) {
    while (hitsConvolved < k) {
      prefix = convolve(prefix, perHit[Math.min(hitsConvolved, perHit.length - 1)]!);
      hitsConvolved++;
    }
    for (const [dmg, pd] of prefix) {
      total.set(dmg, (total.get(dmg) ?? 0) + pk * pd);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Reading answers off a PMF
// ---------------------------------------------------------------------------

export function expectedValue(pmf: Pmf): number {
  let mean = 0;
  for (const [value, p] of pmf) mean += value * p;
  return mean;
}

/** P(X ≥ threshold) — used for "does this move KO?" when threshold = remaining HP. */
export function probabilityAtLeast(pmf: Pmf, threshold: number): number {
  let p = 0;
  for (const [value, prob] of pmf) if (value >= threshold) p += prob;
  return p;
}

/**
 * Cumulative KO probability after 1..`turns` uses of a move — the nHKO ladder. Tracks the
 * defender's HP distribution across turns: each turn a use deals `perUse` damage; mass that
 * reaches 0 is an absorbing KO, and a survivor heals `recovery` (capped at `maxHP`) at the
 * end of the turn, before the next use. Returns `[P(KO by turn 1), …, P(KO by turn n)]`.
 *
 * This is what a plain "n × mean ≥ HP" misses: the rolls compound independently, and between
 * turns the defender recovers (Leftovers). `recovery = 0` gives the no-recovery ladder.
 */
export function koLadder(perUse: Pmf, remainingHP: number, maxHP: number, recovery: number, turns: number): number[] {
  let alive: Map<number, number> = new Map([[remainingHP, 1]]); // surviving HP → probability
  let dead = 0;
  const ladder: number[] = [];
  for (let t = 0; t < turns; t++) {
    const next = new Map<number, number>();
    for (const [hp, p] of alive) {
      for (const [dmg, pd] of perUse) {
        const afterHit = hp - dmg;
        if (afterHit <= 0) dead += p * pd; // KO'd — dead mons don't heal
        else {
          const healed = Math.min(maxHP, afterHit + recovery);
          next.set(healed, (next.get(healed) ?? 0) + p * pd);
        }
      }
    }
    ladder.push(dead);
    alive = next;
  }
  return ladder;
}

export interface PmfSummary {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
}

export function summarize(pmf: Pmf): PmfSummary {
  let min = Infinity;
  let max = -Infinity;
  for (const value of pmf.keys()) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return {min, max, mean: expectedValue(pmf)};
}
