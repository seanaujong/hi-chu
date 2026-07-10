// The damage layer: turn two ResolvedMon and a move name into a DamageReport.
//
// @smogon/calc owns the hard, generation-specific formula (STAB, Tera, items,
// abilities, burn-vs-Guts, screens, …). We own what it gets wrong for multi-hit:
// it models k hits as `k × one shared roll`, with no hit-count randomness, per-hit
// accuracy, or Skill Link/Loaded Dice. So we ask the calc for ONE hit at a time —
// one run for a uniform-power move, one per hit's true BP for Triple Axel/Triple
// Kick — and convolve those per-hit rolls over the real hit-count distribution
// (core/multihit.ts) to get the true total, and from it an exact single-use KO chance.

import {calculate, calcStat, Generations, Pokemon, Move, Field, toID, type GenerationNum, type State} from '@smogon/calc';
import type {FieldFacts, FullStats, ResolvedMon, StatID} from './types.js';
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
  /** Present only for a multi-hit move: the true hit-count breakdown and per-hit range
   *  (for a variable-power move, weakest hit's min to strongest hit's max). */
  readonly multiHit?: {
    readonly hits: HitCountBreakdown;
    readonly perHit: {readonly min: number; readonly max: number};
  };
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

export type Gen = ReturnType<typeof Generations.get>;

type SpeciesOverrides = NonNullable<State.Pokemon['overrides']>;

/**
 * Base data for a species the calc's dex does NOT know — Champions invents new Megas
 * (Chandelure-Mega) that never existed in a mainline game, so `gen.species.get` comes
 * back empty and the constructor would throw. The client's own dex knows them (its
 * tooltips need the same data), and that reading rides in on `mon.speciesData`; passed
 * as `overrides`, the calc computes stats, STAB, and the type chart correctly. A species
 * the calc DOES know keeps its canonical record — this is a fallback, never a replacement.
 */
function unknownSpeciesOverrides(gen: Gen, mon: ResolvedMon): {overrides: SpeciesOverrides} | Record<string, never> {
  if (!mon.speciesData || gen.species.get(toID(mon.speciesForme)) !== undefined) return {};
  const {baseStats, types, weightkg} = mon.speciesData;
  return {
    overrides: {
      baseStats,
      // Cast: battle-sourced type strings; the calc wants its TypeName tuple (same as teraType).
      types: types as unknown as NonNullable<SpeciesOverrides['types']>,
      ...(weightkg !== undefined ? {weightkg} : {}),
    },
  };
}

/**
 * An item the calc's dex doesn't know (a Champions-invented Mega stone like Chandelurite)
 * CRASHES gen-9 mechanics — Knock Off's stone check reads `item.megaEvolves` off the
 * missing record — so it resolves to NO item for the calc. That's also the honest number:
 * a Mega stone is damage-inert, and Knock Off's boost correctly stays off (mainline treats
 * an unremovable stone as boost-resisting). A known item comes back as the DEX's display
 * name: the calc's mechanics compare items by that exact string and silently ignore any
 * other form, so an id-form item ("choicespecs", the shape `battle.myPokemon` carries)
 * would otherwise apply nothing at all.
 */
function knownItem(gen: Gen, item: string | undefined): string | undefined {
  if (item === undefined) return undefined;
  return gen.items.get(toID(item))?.name;
}

const STAT_IDS: readonly StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/**
 * A (nature, EVs, IVs) spread that makes the calc's own stat formula land EXACTLY on
 * the given final stats. This is how our own server-reported finals (`knownStats`)
 * reach the damage math: `calculate()` clones both mons (calc.js — `attacker.clone()`),
 * and the clone re-derives `rawStats` from nature/EVs/IVs, so mutating `rawStats` on
 * the instance we build would silently vanish. A spread survives the clone. Solving is
 * exact because we verify each candidate against the calc's exported `calcStat` — the
 * very function the constructor uses — and the true spread that produced the server's
 * numbers is always in the search space. Returns undefined when nothing solves
 * (malformed input, forme drift): the caller keeps its assumed spread rather than lie.
 */
export function spreadForFinalStats(
  gen: Gen,
  baseStats: FullStats,
  level: number,
  finals: FullStats,
): {nature: string; evs: FullStats; ivs: FullStats} | undefined {
  // 0..94 covers every legal (IV ≤ 31, EV ≤ 252) combination: inner = IV + ⌊EV/4⌋.
  const solveStat = (stat: StatID, nature: string): {iv: number; ev: number} | undefined => {
    for (let inner = 0; inner <= 94; inner++) {
      const iv = Math.min(inner, 31);
      const ev = 4 * Math.max(0, inner - 31);
      if (calcStat(gen, stat, baseStats[stat], iv, ev, level, nature) === finals[stat]) return {iv, ev};
    }
    return undefined;
  };
  for (const nature of gen.natures) {
    const evs = {} as FullStats;
    const ivs = {} as FullStats;
    let solved = true;
    for (const stat of STAT_IDS) {
      const s = solveStat(stat, nature.name);
      if (!s) {
        solved = false;
        break;
      }
      ivs[stat] = s.iv;
      evs[stat] = s.ev;
    }
    // Any solving nature is equivalent: it reproduces the exact finals, which is all
    // the mechanics ever read (they never key on the nature itself).
    if (solved) return {nature: nature.name, evs, ivs};
  }
  return undefined;
}

/** The move's damage category, for choosing which defensive axis an assumed spread
 *  should invest (core/assume.ts asks before any calc runs). */
export function moveCategory(gen: number, moveName: string): 'Physical' | 'Special' | 'Status' {
  return new Move(Generations.get(gen as GenerationNum), moveName).category;
}

/** The base stats the calc will actually use for this mon: its own dex record when it
 *  knows the species, else the client-dex fallback riding on `speciesData`. */
function baseStatsFor(gen: Gen, mon: ResolvedMon): FullStats | undefined {
  const dex = gen.species.get(toID(mon.speciesForme));
  return (dex?.baseStats as FullStats | undefined) ?? mon.speciesData?.baseStats;
}

/** The spread that reproduces `mon.knownStats` exactly, when finals are known and solvable. */
function solvedSpread(gen: Gen, mon: ResolvedMon): ReturnType<typeof spreadForFinalStats> {
  if (!mon.knownStats) return undefined;
  const base = baseStatsFor(gen, mon);
  return base ? spreadForFinalStats(gen, base, mon.level, mon.knownStats) : undefined;
}

/** A calc-ready Pokemon from a ResolvedMon, with the Champions safety nets applied
 *  (client-dex overrides for a species the calc lacks, unknown items dropped).
 *  Exported for core/speed.ts, which reads the same Pokemon's effective Speed. */
export function buildPokemon(gen: Gen, mon: ResolvedMon, curHP?: number): Pokemon {
  const item = knownItem(gen, mon.item);
  // Exact server-reported finals win over the assumed spread — expressed as an
  // equivalent spread because that's the only form that survives calculate()'s clone.
  const solved = solvedSpread(gen, mon);
  return new Pokemon(gen, mon.speciesForme, {
    level: mon.level,
    ...unknownSpeciesOverrides(gen, mon),
    nature: solved?.nature ?? mon.nature,
    evs: solved?.evs ?? mon.evs,
    ivs: solved?.ivs ?? mon.ivs,
    ...(mon.ability !== undefined ? {ability: mon.ability} : {}),
    ...(item !== undefined ? {item} : {}),
    ...(mon.status !== undefined ? {status: mon.status} : {}),
    boosts: mon.boosts,
    // teraType is only ever set when the Tera is ACTIVE for this calc — actually
    // terastallized (resolveMon enforces this), or our own attacker with Terastallize
    // ticked for the pending move (buildMoveSection's preview, our private type).
    // Setting it is what activates Tera in the calc.
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
    notes: string[];
    multiHit?: DamageReport['multiHit'];
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
    ...(extras.multiHit ? {multiHit: extras.multiHit} : {}),
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
  /** Doubles: sets the calc's game type so spread moves take their 0.75× reduction. */
  readonly doubles?: boolean;
}

/** Map our plain FieldFacts onto a @smogon/calc Field. `doubles` sets the game type so the
 *  calc applies the spread-move 0.75× (it reads the move's target from the dex itself). */
function buildField(facts: FieldFacts, doubles: boolean): Field {
  return new Field({
    gameType: doubles ? 'Doubles' : 'Singles',
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
  // The dex's own record: `.name` normalizes an id-form input ("dracometeor") to the
  // display name, so `report.move` is always presentable as-is.
  const dexMove = new Move(gen, moveName);
  const category = dexMove.category;
  const field = options.field ? buildField(options.field, options.doubles ?? false) : undefined;

  const run = (hits?: number) =>
    calculate(gen, atk, def, new Move(gen, moveName, hits !== undefined ? {hits} : {}), field);

  // --- Ordinary single-hit move ---------------------------------------------
  if (!profile) {
    const result = run();
    const total = pmfFromSamples(rollsOf(result.damage));
    return summarizeReport(dexMove.name, category, total, remainingHP, maxHP, safeDesc(result), {
      notes,
      ...(options.nhkoTurns ? {nhkoTurns: options.nhkoTurns} : {}),
    });
  }

  // --- Multi-hit: the corrected path -----------------------------------------
  const mods = {
    skillLink: attacker.ability === 'Skill Link',
    loadedDice: attacker.item === 'Loaded Dice',
    wideLens: attacker.item === 'Wide Lens',
  };
  const counts = hitCountPmf(profile.spec, mods);

  // One damage PMF per distinct hit. A variable-power move (Triple Axel 20/40/60) needs
  // one calc run per hit's true BP — but the calc special-cases those moves BY NAME,
  // recomputing BP from `move.hits` and silently ignoring `overrides.basePower`, so each
  // hit runs through a stand-in instead: Pound, a plain physical contact move with no
  // special-casing, carrying the hit's BP and the real move's type/category. Probe-verified
  // exact against the real move's hits:1 rolls, Technician and Tough Claws included (both
  // moves, like Pound, are contact and carry no punch/slice/bite flag an ability keys on).
  const perHitPmfs = profile.perHitPowers
    ? profile.perHitPowers.map((basePower) => {
        const standIn = new Move(gen, 'Pound', {overrides: {basePower, type: dexMove.type, category: dexMove.category}});
        return pmfFromSamples(rollsOf(calculate(gen, atk, def, standIn, field).damage));
      })
    : [pmfFromSamples(rollsOf(run(1).damage))]; // uniform power: every hit rolls the same

  const total = totalDamagePmf(perHitPmfs, counts);

  const distribution = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const hits: HitCountBreakdown = {expected: expectedValue(counts), distribution};
  const allRolls = perHitPmfs.flatMap((pmf) => [...pmf.keys()]);
  const perHit = {min: Math.min(...allRolls), max: Math.max(...allRolls)};

  return summarizeReport(dexMove.name, category, total, remainingHP, maxHP, safeDesc(run()), {
    notes,
    multiHit: {hits, perHit},
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
