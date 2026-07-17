// The Transform law: what a Pokémon becomes when it copies another one whole (Ditto's
// Imposter, Mew's Transform, Zoroark's… no — that one's a disguise, see illusion.ts).
//
// Transform is not a forme change. A forme change swaps the body and keeps the Pokémon:
// Meloetta-Pirouette still has Meloetta's EVs, level and spread, and the calc derives its
// stats the ordinary way once it knows the forme. Transform swaps the Pokémon and keeps
// almost nothing — the sim copies the target's FINAL stat numbers verbatim
// (`Pokemon.transformInto`, sim/pokemon.ts: `this.storedStats[stat] = pokemon.storedStats[stat]`),
// not the spread that produced them. So a Ditto that copies a level-77 Dragapult carries
// Dragapult's level-77 stats around at its OWN level 87 — and the damage formula reads the
// ATTACKER's level, so the copy hits harder than the Pokémon it copied.
//
// What it keeps: level, HP (the one stat never copied), item, status, boosts, and its own
// identity for the information game — a transformed Ditto is still a Ditto running the
// Ditto set, and that is what the sets view must go on saying.
//
// Pure: no DOM, no network, no @smogon/calc. The numbers arrive already computed, because
// only the shell can resolve the target (see `LiveFacts.transformedInto`).

import type {FullStats, ResolvedMon, SpeciesData, TransformCopy} from './types.js';

/** The copier, as it was before it copied anyone: the only thing it keeps of its own body
 *  is HP, so that is the only stat read off it. `finalStats` is absent when its own spread
 *  isn't knowable (an open format's foe — see `TransformCopy.finalStats`). */
export interface Copier {
  readonly baseStats: FullStats;
  readonly finalStats?: FullStats;
}

/** The Pokémon being copied, as far as we can resolve it. */
export interface CopyTarget {
  readonly body: SpeciesData;
  readonly finalStats?: FullStats;
  readonly moves: readonly string[];
  /** Its REAL four moves, rather than the pool its set could still be running. */
  readonly movesKnown: boolean;
  /** The target's own `timesAttacked` — Transform adopts it whole (see `TransformCopy`). */
  readonly timesAttacked: number;
}

/**
 * Build the copy: the target's body and numbers, with the copier's HP grafted in — the one
 * stat Transform leaves alone (`transformInto` copies `storedStats` for every stat but HP,
 * and never touches `maxhp`). Written once, here, so no surface can forget the exception.
 *
 * The copied NUMBERS are only installed when BOTH spreads are known, because the copy is a
 * relation between them: the target's finals are what gets installed, the copier's own HP
 * is what survives, and a half-known pair would put a guessed number where an exact one
 * belongs. Then the body still applies (right species, right types, its own HP) and the
 * spread stays whatever the format assumes — which in an open format is bracketed anyway.
 */
export function transformCopy(copier: Copier, target: CopyTarget): TransformCopy {
  const ownHp = copier.finalStats?.hp;
  const copied = target.finalStats;
  return {
    body: {...target.body, baseStats: {...target.body.baseStats, hp: copier.baseStats.hp}},
    ...(copied && ownHp !== undefined ? {finalStats: {...copied, hp: ownHp}} : {}),
    moves: [...target.moves],
    movesKnown: target.movesKnown,
    timesAttacked: target.timesAttacked,
  };
}

/**
 * Overlay the copy onto the copier's own resolution — the single writer for "what the calc
 * sees when a Pokémon is Transformed", applied by `resolve.buildResolved` so every surface
 * (move damage, the matchup view, the ⚡ speed verdict) reads the same copy.
 *
 * The copied stats ride in as `knownStats`, the same channel the server's own final stats
 * use in an open format: both say "these are the exact numbers, don't derive them from a
 * spread", and the damage layer already knows how to make the calc reproduce exact finals.
 * That also DISPLACES any stale `knownStats` the copier came with — and they are always
 * stale under Transform, because the sim's request JSON ships `baseStoredStats`, which
 * `transformInto` deliberately never updates.
 */
export function applyTransform(mon: ResolvedMon, copy: TransformCopy): ResolvedMon {
  // The copier's own dex fallback describes the body it is no longer wearing; the copy
  // carries the right one, and letting the old one ride would hand the calc Ditto's base
  // stats for a Pokémon that is currently a Dragapult.
  const {speciesData: _ownBody, knownStats: _staleServerStats, ...rest} = mon;
  return {
    ...rest,
    speciesOverride: copy.body,
    possibleMoves: [...copy.moves],
    ...(copy.finalStats ? {knownStats: copy.finalStats} : {}),
    // The sim copies `timesAttacked` onto the copier verbatim (`transformInto`), so a
    // transformed Ditto's Rage Fist reads the hits its COPY has taken, not its own.
    timesAttacked: copy.timesAttacked,
  };
}
