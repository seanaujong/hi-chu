// The damage layer: turn two ResolvedMon and a move name into a DamageReport.
//
// @smogon/calc owns the hard, generation-specific formula (STAB, Tera, items,
// abilities, burn-vs-Guts, screens, …). We own what it gets wrong for multi-hit:
// it models k hits as `k × one shared roll`. So for uniform-power multi-hit moves
// we ask the calc for ONE hit, then convolve that per-hit roll over the real
// hit-count distribution (core/multihit.ts) to get the true total — and from the
// true total, an exact single-use KO chance.

import {calculate, Generations, Pokemon, Move, Field, type GenerationNum, type State} from '@smogon/calc';
import type {FieldFacts, ResolvedMon} from './types.js';
import {multiHitProfile} from './moves.js';
import {
  type Pmf,
  hitCountPmf,
  pmfFromSamples,
  totalDamagePmf,
  expectedValue,
  probabilityAtLeast,
  koLadder,
  summarize,
} from './multihit.js';

export interface HitCountBreakdown {
  readonly expected: number;
  /** [hitCount, probability] pairs, ascending by count. */
  readonly distribution: ReadonlyArray<readonly [number, number]>;
}

export interface DamageReport {
  readonly move: string;
  readonly category: 'Physical' | 'Special' | 'Status';
  readonly multiHit: boolean;
  /** True when we fell back to the calc's correlated total (variable-power moves). */
  readonly approximate: boolean;
  readonly hits?: HitCountBreakdown;
  /** Per-hit damage range, present for uniform-power multi-hit moves. */
  readonly perHit?: {readonly min: number; readonly max: number};
  readonly total: {readonly min: number; readonly max: number; readonly mean: number};
  readonly percent: {readonly min: number; readonly max: number; readonly mean: number};
  /** Probability that a single use of this move KOes the defender, in [0,1]. */
  readonly koChance: number;
  /**
   * The nHKO ladder — cumulative KO probability after 1..N uses — under two recovery
   * assumptions, so the caller shows the base figure and an "if Leftovers" one. Present
   * only when requested (`CalcDamageOptions.nhkoTurns`); `base[0]` equals `koChance`.
   */
  readonly nhko?: {readonly base: readonly number[]; readonly withLeftovers: readonly number[]};
  readonly defenderMaxHP: number;
  readonly defenderRemainingHP: number;
  /** @smogon/calc's own one-line description, kept for comparison/debugging. */
  readonly calcDesc: string;
  readonly notes: readonly string[];
}

type Gen = ReturnType<typeof Generations.get>;

function buildPokemon(gen: Gen, mon: ResolvedMon, curHP?: number): Pokemon {
  return new Pokemon(gen, mon.speciesForme, {
    level: mon.level,
    nature: mon.nature,
    evs: mon.evs,
    ivs: mon.ivs,
    ...(mon.ability !== undefined ? {ability: mon.ability} : {}),
    ...(mon.item !== undefined ? {item: mon.item} : {}),
    ...(mon.status !== undefined ? {status: mon.status} : {}),
    boosts: mon.boosts,
    // teraType is only ever set when the Pokémon has ACTUALLY terastallized
    // (resolveMon enforces this), and setting it is what activates Tera in the calc.
    // Cast: our teraType is a battle-sourced string; calc wants its TypeName union.
    ...(mon.teraType !== undefined ? {teraType: mon.teraType as NonNullable<State.Pokemon['teraType']>} : {}),
    ...(curHP !== undefined ? {curHP} : {}),
  });
}

/** Normalize @smogon/calc's `damage` (number | number[] | number[][]) to a flat roll list. */
function rollsOf(damage: number | readonly number[] | readonly number[][]): number[] {
  if (typeof damage === 'number') return [damage];
  if (Array.isArray(damage[0])) return (damage as readonly number[][]).flat();
  return [...(damage as readonly number[])];
}

function summarizeReport(
  moveName: string,
  category: DamageReport['category'],
  total: Pmf,
  remainingHP: number,
  maxHP: number,
  calcDesc: string,
  extras: {
    multiHit: boolean;
    approximate: boolean;
    notes: string[];
    hits?: HitCountBreakdown;
    perHit?: {min: number; max: number};
    nhkoTurns?: number;
  },
): DamageReport {
  const t = summarize(total);
  const pct = (d: number) => Math.round((d / maxHP) * 1000) / 10;
  // Leftovers heals 1/16 of max HP (rounded down) each turn.
  const nhko = extras.nhkoTurns
    ? {
        base: koLadder(total, remainingHP, maxHP, 0, extras.nhkoTurns),
        withLeftovers: koLadder(total, remainingHP, maxHP, Math.floor(maxHP / 16), extras.nhkoTurns),
      }
    : undefined;
  return {
    move: moveName,
    category,
    multiHit: extras.multiHit,
    approximate: extras.approximate,
    ...(extras.hits ? {hits: extras.hits} : {}),
    ...(extras.perHit ? {perHit: extras.perHit} : {}),
    total: {min: t.min, max: t.max, mean: Math.round(t.mean * 10) / 10},
    percent: {min: pct(t.min), max: pct(t.max), mean: pct(t.mean)},
    koChance: probabilityAtLeast(total, remainingHP),
    ...(nhko ? {nhko} : {}),
    defenderMaxHP: maxHP,
    defenderRemainingHP: remainingHP,
    calcDesc,
    notes: extras.notes,
  };
}

export interface CalcDamageOptions {
  /** Generation number; defaults to 9. */
  readonly gen?: number;
  /** Optional field state (weather, terrain, defender's screens). */
  readonly field?: FieldFacts;
  /** Compute the nHKO ladder up to this many turns (omit to skip — the sets view does). */
  readonly nhkoTurns?: number;
}

/** Map our plain FieldFacts onto a @smogon/calc Field. */
function buildField(facts: FieldFacts): Field {
  return new Field({
    ...(facts.weather ? {weather: facts.weather} : {}),
    ...(facts.terrain ? {terrain: facts.terrain} : {}),
    defenderSide: {
      isReflect: facts.defenderScreens.reflect,
      isLightScreen: facts.defenderScreens.lightScreen,
      isAuroraVeil: facts.defenderScreens.auroraVeil,
    },
  });
}

export function calcDamage(
  attacker: ResolvedMon,
  defender: ResolvedMon,
  moveName: string,
  options: CalcDamageOptions = {},
): DamageReport {
  // gen originates from the live battle (a plain number); calc wants its 1-9 union.
  const gen = Generations.get((options.gen ?? 9) as GenerationNum);
  const atk = buildPokemon(gen, attacker);

  // Build the defender twice: once to learn its max HP, once with the real current HP
  // (curHP changes Multiscale, Sap Sipper-style abilities, and KO math).
  const maxHP = buildPokemon(gen, defender).maxHP();
  const remainingHP = Math.max(1, Math.min(maxHP, Math.round(maxHP * defender.hpPercent)));
  const def = buildPokemon(gen, defender, remainingHP);

  const profile = multiHitProfile(moveName);
  const notes: string[] = [];
  const category = new Move(gen, moveName).category;
  const field = options.field ? buildField(options.field) : undefined;

  const run = (hits?: number) =>
    calculate(gen, atk, def, new Move(gen, moveName, hits !== undefined ? {hits} : {}), field);

  // --- Ordinary single-hit move, or variable-power fallback -----------------
  if (!profile || !profile.uniformPower) {
    const result = run();
    const rolls = rollsOf(result.damage);
    if (profile && !profile.uniformPower) {
      notes.push('per-hit base power varies; total is @smogon/calc’s estimate (hits roll together)');
    }
    const total = pmfFromSamples(rolls);
    return summarizeReport(moveName, category, total, remainingHP, maxHP, safeDesc(result), {
      multiHit: Boolean(profile),
      approximate: Boolean(profile),
      notes,
      ...(options.nhkoTurns ? {nhkoTurns: options.nhkoTurns} : {}),
    });
  }

  // --- Uniform-power multi-hit: the corrected path --------------------------
  const single = run(1); // one hit's rolls, each equally likely
  const perHitRolls = rollsOf(single.damage);
  const perHitPmf = pmfFromSamples(perHitRolls);

  const mods = {
    skillLink: attacker.ability === 'Skill Link',
    loadedDice: attacker.item === 'Loaded Dice',
  };
  const counts = hitCountPmf(profile.spec, mods);

  if (profile.spec.kind === 'fixed' && profile.spec.hits === 10 && !mods.loadedDice) {
    notes.push('assumes all 10 hits land (Population Bomb checks accuracy per hit)');
  }

  const total = totalDamagePmf(perHitPmf, counts);

  const distribution = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const hits: HitCountBreakdown = {expected: expectedValue(counts), distribution};
  const perHit = {min: Math.min(...perHitRolls), max: Math.max(...perHitRolls)};

  return summarizeReport(moveName, category, total, remainingHP, maxHP, safeDesc(single), {
    multiHit: true,
    approximate: false,
    notes,
    hits,
    perHit,
    ...(options.nhkoTurns ? {nhkoTurns: options.nhkoTurns} : {}),
  });
}

/** Both mons' HP before and after Pain Split, as a percentage of their OWN max. */
export interface PainSplitReport {
  readonly user: {readonly before: number; readonly after: number};
  readonly foe: {readonly before: number; readonly after: number};
}

/**
 * Pain Split: something @smogon/calc doesn't model (it's HP redistribution, not damage).
 * Both mons are set to `floor((userHP + foeHP) / 2)` in RAW HP, each capped at its own
 * max — so the user gains when it's the lower of the two and loses when it's the higher.
 * Current HP is derived from each side's live % against the calc's max. Percentages are
 * of each mon's own max, so the two "after" values differ even though the raw HP is equal.
 */
export function painSplit(user: ResolvedMon, foe: ResolvedMon, gen = 9): PainSplitReport {
  const g = Generations.get(gen as GenerationNum);
  const userMax = buildPokemon(g, user).maxHP();
  const foeMax = buildPokemon(g, foe).maxHP();
  const userHP = Math.round(userMax * user.hpPercent);
  const foeHP = Math.round(foeMax * foe.hpPercent);
  const split = Math.floor((userHP + foeHP) / 2);
  const pct = (hp: number, max: number): number => Math.round((hp / max) * 1000) / 10;
  return {
    user: {before: pct(userHP, userMax), after: pct(Math.min(userMax, split), userMax)},
    foe: {before: pct(foeHP, foeMax), after: pct(Math.min(foeMax, split), foeMax)},
  };
}

/** @smogon/calc throws from desc()/kochance() when damage is 0 (immune); guard it. */
function safeDesc(result: ReturnType<typeof calculate>): string {
  try {
    return result.desc();
  } catch {
    return 'no damage';
  }
}
