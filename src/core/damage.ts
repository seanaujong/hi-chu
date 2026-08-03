// The damage layer: turn two ResolvedMon and a move name into a DamageReport.
//
// @smogon/calc owns the hard, generation-specific formula (STAB, Tera, items,
// abilities, burn-vs-Guts, screens, …). We own what it gets wrong for multi-hit:
// it models k hits as `k × one shared roll`, with no hit-count randomness, per-hit
// accuracy, or Skill Link/Loaded Dice. So we read ONE hit at a time out of it —
// one run for a uniform-power move, one per hit's true BP for Triple Axel/Triple
// Kick — and convolve those per-hit rolls over the real hit-count distribution
// (core/multihit.ts) to get the true total, and from it an exact single-use KO chance.
//
// We also own the moves it has no formula for at all. A `damageCallback` move (Super
// Fang, Ruination, Endeavor) carries no base power, so the calc runs the ordinary damage
// formula over a zero and honestly returns nothing — which the tooltip would then print
// as "0% - 0%", the most confident possible lie about a move that takes half your HP.
// The table is in core/moves.ts; the one thing the calc still answers for them is whether
// the move connects at all (see `connects`).
//
// Its PACKAGING has sharper edges than its math, and they land here because this is the
// only file that imports it. The library is CommonJS, and it publishes no type names of
// its own — there is no `TypeName` to import, however much the call sites look like there
// should be. A battle-sourced type string is therefore cast through the calc's own state
// types (`State.Pokemon['teraType']`), which is the same union reached by a route the
// package actually exports. Reaching for the import that ought to exist is the usual way
// this file stops compiling.

import {calculate, calcStat, Generations, Pokemon, Move, Field, toID, type GenerationNum, type State} from '@smogon/calc';
import type {FieldFacts, FullStats, ResolvedMon, SpeciesData, StatID} from './types.js';
import {damageCallback, multiHitProfile} from './moves.js';
import {type HitDamage, type HitsToBreak, bypassesSubstitute, hitsToBreak, substituteHP} from './substitute.js';
import {
  type HitCountMods,
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

/**
 * One HP change the ATTACKER takes on for landing this move, as a percent of its OWN max
 * HP — the side of a hit the "Damage:" line never shows. Magnitudes are always positive
 * and `direction` carries the sign, so the render layer never has to sniff the label or
 * juggle negative ranges.
 *
 * A LIST, not one net figure, because the causes genuinely stack: a Life Orb Giga Drain
 * both heals and hurts, and those read as two separate facts to a player deciding whether
 * the trade is worth it. Netting them would also hide which one is which.
 */
export interface SelfHpEffect {
  /** Names the cause for the tooltip: "Drains", "Recoil", "Life Orb", "Liquid Ooze". */
  readonly label: string;
  readonly direction: 'gain' | 'loss';
  readonly min: number;
  readonly max: number;
}

/**
 * The Substitute standing between this move and the defender, when one is — and when the
 * move can actually do something about it. Absent covers three situations that all render
 * the same way (nothing): no sub, a status move, and a move the defender is immune to,
 * whose "0%" damage line already says everything there is to say.
 */
export type SubstituteStanding =
  | {readonly kind: 'bypassed'} //                    a sound move / Infiltrator: it goes straight through
  | {readonly kind: 'absorbs'; readonly hits: HitsToBreak; readonly dented: boolean};

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
  /**
   * The attacker's own HP swing from landing this move (drain, recoil, Life Orb, Liquid
   * Ooze). Present only when requested (`CalcDamageOptions.selfHp`) — the move tooltip is
   * the one surface that shows it, and leaving it off everywhere else keeps those surfaces'
   * damage buckets keyed exactly as before (see `variants.resultKey`).
   */
  readonly selfHp?: readonly SelfHpEffect[];
  /**
   * The Substitute in the way, when there is one. Everything else on this report describes
   * the move's effect on the POKÉMON and is unchanged by it — a sub delays those numbers, it
   * does not alter them — which is why this rides alongside rather than rewriting them. The
   * render layer is what must not go on claiming a KO the sub makes unreachable.
   */
  readonly substitute?: SubstituteStanding;
  readonly defenderMaxHP: number;
  readonly defenderRemainingHP: number;
  /** @smogon/calc's own one-line description, kept for comparison/debugging. */
  readonly calcDesc: string;
  readonly notes: readonly string[];
}

export type Gen = ReturnType<typeof Generations.get>;

type SpeciesOverrides = NonNullable<State.Pokemon['overrides']>;

/**
 * The base data the calc must use instead of its own dex record, if any. Two unrelated
 * reasons, and they compose through one `overrides`:
 *
 * A species the calc's dex does NOT know — Champions invents new Megas (Chandelure-Mega)
 * that never existed in a mainline game, so `gen.species.get` comes back empty and the
 * constructor would throw. The client's own dex knows them (its tooltips need the same
 * data), and that reading rides in on `mon.speciesData`. It is a FALLBACK: a species the
 * calc does know keeps its canonical record.
 *
 * A body that doesn't match its species — only Transform makes that happen, and then
 * `mon.speciesOverride` is authoritative even for a species the calc knows well (a
 * transformed Ditto is a Dragapult with Ditto's base HP; no dex record says that).
 *
 * The calc deep-merges `overrides` onto the dex record, so handing it base stats alone
 * leaves types and weight canonical.
 */
function speciesOverrides(gen: Gen, mon: ResolvedMon): {overrides: SpeciesOverrides} | Record<string, never> {
  const dexLacksSpecies = gen.species.get(toID(mon.speciesForme)) === undefined;
  const data = mon.speciesOverride ?? (dexLacksSpecies ? mon.speciesData : undefined);
  if (!data) return {};
  const {baseStats, types, weightkg} = data;
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

/**
 * The same id→name quirk as `knownItem`, for ability: `@smogon/calc`'s `Pokemon`
 * constructor takes whatever string it's given verbatim (`options.ability || ...`, no
 * normalization), and every ability-gated mechanic in the calc compares `this.ability`
 * against a display name ("Huge Power") — so an id-form ability ("hugepower", the shape
 * `battle.myPokemon` carries via `readOwnAbility`) would silently apply nothing at all.
 */
function knownAbility(gen: Gen, ability: string | undefined): string | undefined {
  if (ability === undefined) return undefined;
  return gen.abilities.get(toID(ability))?.name;
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

const RAGE_FIST_BASE_POWER = 50;
const RAGE_FIST_POWER_PER_HIT = 50;
const RAGE_FIST_MAX_POWER = 350;

/**
 * Rage Fist's power scales with how many times the USER has been hit this battle — a
 * mechanic @smogon/calc's own move data doesn't model at all (its table lists Rage Fist
 * as a flat `bp: 50`, and unlike Triple Axel/Triple Kick nothing in the calc's mechanics
 * recomputes it by name). `min(350, 50 + 50×timesAttacked)` is the sim's own formula
 * (`data/moves.ts`'s `ragefist.basePowerCallback`); passed in as `overrides.basePower`,
 * it reaches the calc cleanly for exactly that reason — nothing else touches it.
 */
function rageFistPower(timesAttacked: number): number {
  return Math.min(RAGE_FIST_MAX_POWER, RAGE_FIST_BASE_POWER + RAGE_FIST_POWER_PER_HIT * timesAttacked);
}

/**
 * One species' body as the calc knows it — base stats, types, weight. The calc's own dex
 * first; the client-dex reading the caller supplies (`SpeciesData`) fills in for a species
 * the calc lacks, which is the only reason that fallback exists.
 *
 * Exported because Transform builds a body out of two of them: the target's, wearing the
 * copier's base HP.
 */
export function speciesBody(gen: number, speciesForme: string, fallback?: SpeciesData): SpeciesData | undefined {
  const dex = Generations.get(gen as GenerationNum).species.get(toID(speciesForme));
  if (!dex?.baseStats || !dex.types) return fallback;
  return {
    baseStats: dex.baseStats as FullStats,
    types: [...dex.types],
    ...(typeof dex.weightkg === 'number' ? {weightkg: dex.weightkg} : {}),
  };
}

/** The base stats the calc will actually use for this mon — the body it is wearing, which
 *  is its species' own until Transform hands it someone else's. */
function baseStatsFor(gen: Gen, mon: ResolvedMon): FullStats | undefined {
  if (mon.speciesOverride) return mon.speciesOverride.baseStats;
  const dex = gen.species.get(toID(mon.speciesForme));
  return (dex?.baseStats as FullStats | undefined) ?? mon.speciesData?.baseStats;
}

/**
 * This Pokémon's FINAL stats — the numbers the calc will read once it is built. Exact
 * figures we already hold (the server's, or a Transform copy's) win; otherwise the calc's
 * own stat formula derives them from the resolved spread through `calcStat`, the very
 * function the Pokemon constructor uses — so this is what the calc computes, not an
 * imitation of it.
 *
 * Exported because Transform copies the TARGET's finals verbatim: we have to be able to
 * read them off the target before we can install them on the copier.
 */
export function finalStatsOf(gen: number, mon: ResolvedMon): FullStats | undefined {
  if (mon.knownStats) return mon.knownStats;
  const g = Generations.get(gen as GenerationNum);
  const base = baseStatsFor(g, mon);
  if (!base) return undefined;
  const stats = {} as FullStats;
  for (const stat of STAT_IDS) {
    stats[stat] = calcStat(g, stat, base[stat], mon.ivs[stat], mon.evs[stat], mon.level, mon.nature);
  }
  return stats;
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
  const ability = knownAbility(gen, mon.ability);
  // Exact server-reported finals win over the assumed spread — expressed as an
  // equivalent spread because that's the only form that survives calculate()'s clone.
  const solved = solvedSpread(gen, mon);
  return new Pokemon(gen, mon.speciesForme, {
    level: mon.level,
    ...speciesOverrides(gen, mon),
    nature: solved?.nature ?? mon.nature,
    evs: solved?.evs ?? mon.evs,
    ivs: solved?.ivs ?? mon.ivs,
    ...(ability !== undefined ? {ability} : {}),
    ...(item !== undefined ? {item} : {}),
    ...(mon.abilityOn ? {abilityOn: true} : {}),
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

/** A live HP percentage as raw HP: at least 1, since a Pokémon on the field hasn't
 *  fainted, and never above its own max. */
function currentHP(maxHP: number, hpPercent: number): number {
  return Math.max(1, Math.min(maxHP, Math.round(maxHP * hpPercent)));
}

/** The base power the immunity probe below lends a powerless move. Any positive number
 *  does — the probe reads only whether the answer came back zero. */
const IMMUNITY_PROBE_POWER = 50;

/**
 * Whether this move connects at all — the one question a `damageCallback` move still has
 * to put to the calc. Such a move ignores stats, items and screens, but NOT immunity:
 * Super Fang is Normal, so a Ghost takes nothing from it, and reporting half that Ghost's
 * HP would be a confident lie about a move that does literally nothing.
 *
 * Asked by lending the move a base power and reading whether the result is zero, rather
 * than by consulting a type chart here. The calc floors every connecting hit at 1 HP
 * (`getFinalDamage`'s `Math.max(1, …)`), so zero means it bailed out early — and it bails
 * for every reason at once: the type chart, an active Tera that changed the defender's
 * type, Levitate, Volt Absorb, Air Balloon, Wonder Guard, Psychic Terrain against
 * priority. Borrowing the calc's own answer is what keeps that list correct as the calc
 * grows, and it is the same "delegate the interactions" rule the rest of this file follows.
 */
function connects(gen: Gen, atk: Pokemon, def: Pokemon, moveName: string, field: Field | undefined): boolean {
  const probe = new Move(gen, moveName, {overrides: {basePower: IMMUNITY_PROBE_POWER}});
  return rollsOf(calculate(gen, atk, def, probe, field).damage).some((roll) => roll > 0);
}

/** The hit count we ask the calc for when we want ONE hit of a multi-hit move. Two, never one:
 *  `move.hits === 1` is how @smogon/calc recognizes a single-hit move and applies gen 9's Tera
 *  60 BP floor — a floor no multi-hit move ever takes. We read hit one back out of the result. */
const TERA_FLOOR_SAFE_HITS = 2;

/** ONE hit's rolls: the calc returns a row per hit for a multi-hit move, and the first row is
 *  the hit our convolution models — taken before `checkMultihitBoost` consumes an item or
 *  accrues a boost for the hits after it. Falls back to the whole list when there is one row. */
function firstHitRolls(damage: number | readonly number[] | readonly number[][]): number[] {
  if (typeof damage !== 'number' && Array.isArray(damage[0])) {
    return [...(damage as readonly number[][])[0]!];
  }
  return rollsOf(damage);
}

/**
 * The Substitute in this move's way, if any — the one place the two halves of the law meet:
 * whether the move goes round the doll at all, and if not, how many hits it takes to knock it
 * down. Undefined whenever there is nothing worth saying (no sub, or a move that cannot dent
 * one, whose 0% damage line already tells the whole story).
 *
 * The ability read is the calc-resolved `atk.ability`, not the raw `ResolvedMon` field, for
 * the same reason the multi-hit modifiers below use it: an own-side read hands abilities over
 * in id form ("infiltrator"), which would never match a display-name comparison.
 *
 * The sub's size is derived here rather than carried on the facts — a quarter of the max HP
 * this function was already handed. `sizedOnMaxHP` overrides it only for the one case where
 * that arithmetic is about the wrong Pokémon: a sub passed along by Shed Tail.
 */
function substituteStanding(
  defender: ResolvedMon,
  atk: Pokemon,
  dexMove: Move,
  perHit: readonly HitDamage[],
  defenderMaxHP: number,
): SubstituteStanding | undefined {
  const sub = defender.substitute;
  if (!sub) return undefined;
  if (bypassesSubstitute({name: dexMove.name, isSound: dexMove.flags.sound === 1}, atk.ability)) {
    return {kind: 'bypassed'};
  }
  const hits = hitsToBreak(perHit, substituteHP(sub.sizedOnMaxHP ?? defenderMaxHP));
  return hits ? {kind: 'absorbs', hits, dented: sub.dented} : undefined;
}

/** The per-hit damage range of a list of already-computed per-hit distributions. */
function hitDamages(perHitPmfs: readonly Pmf[]): HitDamage[] {
  return perHitPmfs.map((pmf) => {
    const {min, max} = summarize(pmf);
    return {min, max};
  });
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
    selfHp?: readonly SelfHpEffect[];
    substitute?: SubstituteStanding;
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
    ...(extras.selfHp && extras.selfHp.length > 0 ? {selfHp: extras.selfHp} : {}),
    ...(extras.substitute ? {substitute: extras.substitute} : {}),
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
  /**
   * Compute the attacker's own HP swing (drain/recoil/Life Orb/Liquid Ooze). Opt-in like
   * `nhkoTurns`, and for the same reason: only the move tooltip renders it, and a report
   * that doesn't carry it leaves `variants.resultKey` — and so every other surface's
   * bucketing — byte-identical to before.
   */
  readonly selfHp?: boolean;
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
  const remainingHP = currentHP(maxHP, defender.hpPercent);
  const def = buildPokemon(gen, defender, remainingHP);

  const profile = multiHitProfile(moveName);
  const notes: string[] = [];
  // The dex's own record: `.name` normalizes an id-form input ("dracometeor") to the
  // display name, so `report.move` is always presentable as-is.
  const dexMove = new Move(gen, moveName);
  const category = dexMove.category;
  const field = options.field ? buildField(options.field, options.doubles ?? false) : undefined;
  // Every path below reaches the same defender through the same move; only the per-hit
  // damage differs, so that is all each one supplies.
  const standingSub = (perHit: readonly HitDamage[]): SubstituteStanding | undefined =>
    substituteStanding(defender, atk, dexMove, perHit, maxHP);

  // --- A move whose damage is a callback, not a formula ----------------------
  // Looked up by the DEX's display name, so an id-form move name ("superfang", the shape
  // `battle.myPokemon` carries) finds the table entry too.
  const callback = damageCallback(dexMove.name);
  if (callback) {
    const dealt = connects(gen, atk, def, moveName, field)
      ? callback({attacker: currentHP(atk.maxHP(), attacker.hpPercent), defender: remainingHP})
      : 0;
    // The extras carry no nHKO ladder, and `nhkoTurns` is ignored rather than honoured.
    // `koLadder` re-applies the SAME damage every turn, which is the one assumption a
    // callback move breaks. Super Fang halves whatever is LEFT, so from full HP it reads
    // 50% and would ladder to a "2HKO 100%" that can never happen: it approaches 1 HP and
    // never reaches 0. Endeavor breaks it harder — its second use deals nothing at all,
    // the first having left both sides on equal HP. The single-use `koChance` stays exact
    // either way (Super Fang really does KO a target sitting on 1 HP), and the sets view's
    // `koTier` reads the absent ladder and correctly declines to flag a 2HKO.
    const total = pmfFromSamples([dealt]);
    // A callback move hits a Substitute like any other, and it is the one kind whose damage
    // does NOT decay as it chips away: Super Fang halves the Pokémon's HP, which a sub keeps
    // from changing, so every hit into the doll is worth the same as the first.
    const blocked = standingSub([{min: dealt, max: dealt}]);
    return summarizeReport(dexMove.name, category, total, remainingHP, maxHP, callbackDesc(dexMove.name, dealt), {
      notes,
      ...(blocked ? {substitute: blocked} : {}),
    });
  }

  // Rage Fist's actual power, not the dex's flat 50 — see `rageFistPower`.
  const powerOverride =
    toID(moveName) === 'ragefist' ? {overrides: {basePower: rageFistPower(attacker.timesAttacked)}} : {};

  const run = (hits?: number) =>
    calculate(gen, atk, def, new Move(gen, moveName, {...(hits !== undefined ? {hits} : {}), ...powerOverride}), field);

  // --- Ordinary single-hit move ---------------------------------------------
  if (!profile) {
    const result = run();
    const total = pmfFromSamples(rollsOf(result.damage));
    // One hit per use, so the move's whole damage range IS its per-hit range.
    const blocked = standingSub(hitDamages([total]));
    return summarizeReport(dexMove.name, category, total, remainingHP, maxHP, safeDesc(result), {
      notes,
      ...(blocked ? {substitute: blocked} : {}),
      ...(options.nhkoTurns ? {nhkoTurns: options.nhkoTurns} : {}),
      // Single-hit only, on purpose: below, the total damage is OUR convolved PMF rather
      // than the calc's own `result.damage`, so `recovery()`/`recoil()` would describe one
      // hit of a several-hit sequence. No gen-9 multi-hit move drains or takes recoil, so
      // this costs nothing today — revisit if one ever does.
      ...(options.selfHp ? {selfHp: selfHpEffects(atk, def, dexMove, result)} : {}),
    });
  }

  // --- Multi-hit: the corrected path -----------------------------------------
  // Compared against `atk`'s already-dex-resolved ability/item, not the raw ResolvedMon
  // fields — an own-side read (`readOwnAbility`/`readOwnItem`) can hand those in id form
  // ("skilllink"), which would never string-match the display name a bare `attacker.item`
  // read expects. No Guard is checked on BOTH built Pokémon for the same reason.
  // accuracyStage/evasionStage come straight off the plain ResolvedMon facts, not the
  // calc-built Pokemon — they never reach the calc (see `ResolvedMon.accuracyBoost`).
  const mods: HitCountMods = {
    skillLink: atk.ability === 'Skill Link',
    loadedDice: atk.item === 'Loaded Dice',
    wideLens: atk.item === 'Wide Lens',
    compoundEyes: atk.ability === 'Compound Eyes',
    hustle: atk.ability === 'Hustle' && category === 'Physical',
    noGuard: atk.ability === 'No Guard' || def.ability === 'No Guard',
    accuracyStage: attacker.accuracyBoost ?? 0,
    evasionStage: defender.evasionBoost ?? 0,
  };
  const counts = hitCountPmf(profile.spec, mods);

  // One damage PMF per distinct hit. A variable-power move (Triple Axel 20/40/60) needs
  // one calc run per hit's true BP — but the calc special-cases those moves BY NAME,
  // recomputing BP from `move.hits` and silently ignoring `overrides.basePower`, so each
  // hit runs through a stand-in instead: Fury Swipes, carrying the hit's BP and the real
  // move's type/category. Three things make it the right body to borrow, and all three are
  // load-bearing. It makes CONTACT, like every move it stands in for, so Tough Claws (and
  // Rocky Helmet, Rough Skin, Iron Barbs) still reach it, while carrying no
  // punch/slice/bite flag of its own for an ability to key on, and no name the calc
  // special-cases. It is GENUINELY multi-hit, which is why it isn't the simpler Pound: gen 9
  // raises a sub-60 BP move to 60 when it matches the attacker's ACTIVE Tera type, and
  // Showdown exempts multi-hit moves outright (`!dexMove.multihit`, sim/battle-actions.ts) —
  // an exemption @smogon/calc reads off `move.hits === 1`, so a single-hit stand-in takes a
  // floor the move it stands in for never takes. And its hit count is a RANGE, which is what
  // lets `hits` be passed explicitly below: the calc honours `options.hits` only for a range
  // move and silently ignores it for a fixed-count one (`Move`'s constructor), so borrowing a
  // fixed 2-hit body would leave this path relying on that body's own count instead of saying
  // what it wants. Both paths therefore ask for the same thing in the same way.
  //
  // Asking for one hit is what the uniform path must avoid too: ask for one and Tera Grass
  // Bullet Seed prices every hit at 60 BP instead of 25, an error the convolution below then
  // multiplies across the whole hit count.
  const perHitPmfs = profile.perHitPowers
    ? profile.perHitPowers.map((basePower) => {
        const standIn = new Move(gen, 'Fury Swipes', {
          hits: TERA_FLOOR_SAFE_HITS,
          overrides: {basePower, type: dexMove.type, category: dexMove.category},
        });
        return pmfFromSamples(firstHitRolls(calculate(gen, atk, def, standIn, field).damage));
      })
    : [pmfFromSamples(firstHitRolls(run(TERA_FLOOR_SAFE_HITS).damage))]; // uniform: every hit rolls the same

  const total = totalDamagePmf(perHitPmfs, counts);

  const distribution = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const hits: HitCountBreakdown = {expected: expectedValue(counts), distribution};
  const allRolls = perHitPmfs.flatMap((pmf) => [...pmf.keys()]);
  const perHit = {min: Math.min(...allRolls), max: Math.max(...allRolls)};

  // The sub is re-checked per HIT, not per use, so it reads the per-hit list — which for a
  // variable-power move is genuinely one entry per hit, in the order they land.
  const blocked = standingSub(hitDamages(perHitPmfs));
  return summarizeReport(dexMove.name, category, total, remainingHP, maxHP, safeDesc(run()), {
    notes,
    multiHit: {hits, perHit},
    ...(blocked ? {substitute: blocked} : {}),
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

/**
 * The attacker's own HP swing from landing this move — see `SelfHpEffect`. Delegated to
 * @smogon/calc wherever it really models the mechanic (`recovery()` covers drain and Shell
 * Bell; `recoil()` covers a move's own recoil, Rock Head included), with two corrections
 * it does NOT model. Each was found by probing the calc directly, not by reading it:
 *
 *   - MAGIC GUARD cancels recoil, and `getRecoil` only ever checks Rock Head — a Magic
 *     Guard Double-Edge still comes back reporting recoil damage.
 *   - LIQUID OOZE inverts a drain into damage; the calc reports the heal regardless. The
 *     siphon becomes a LOSS. Suppressed entirely in the one case the two can't be told
 *     apart — a Shell Bell attacker, whose heal `recovery()` sums into the same figure.
 *
 * Deliberately NOT covered: crash damage (High Jump Kick), Struggle, and Mind Blown / Steel
 * Beam. The calc returns those as a bare number instead of a range, and in '%' notation that
 * number is the /48 figure — High Jump Kick reports 24 next to its own "50% crash damage"
 * text. So only the tuple form is trusted, and the rest stays a known gap rather than a
 * confidently wrong number.
 */
function selfHpEffects(atk: Pokemon, def: Pokemon, move: Move, result: ReturnType<typeof calculate>): SelfHpEffect[] {
  const effects: SelfHpEffect[] = [];
  const pct = (hp: number): number => Math.round((hp / atk.maxHP()) * 1000) / 10;
  const magicGuard = atk.hasAbility('Magic Guard');

  // Unlike recoil's already-percent figures, `recovery()` comes back in raw HP.
  const {recovery} = result.recovery();
  const [healMin, healMax] = Array.isArray(recovery) ? recovery : [recovery, recovery];
  const oozed = move.drain !== undefined && def.hasAbility('Liquid Ooze');
  if (healMax > 0 && !(oozed && atk.hasItem('Shell Bell'))) {
    effects.push(oozed
      ? {label: 'Liquid Ooze', direction: 'loss', min: pct(healMin), max: pct(healMax)}
      : {label: 'Drains', direction: 'gain', min: pct(healMin), max: pct(healMax)});
  }

  if (!magicGuard) {
    const {recoil} = result.recoil();
    // Tuple form only — the bare-number branches carry the wrong figure in '%' notation.
    if (Array.isArray(recoil) && recoil[1] > 0) {
      effects.push({label: 'Recoil', direction: 'loss', min: recoil[0], max: recoil[1]});
    }
  }

  // Life Orb's cut is deliberately NOT reported, though the calc misses it and we could.
  // It is invariant: the same ~10% on every damaging move, every turn, for as long as the
  // item is held — so it tells you nothing about the move you are hovering, which is the
  // only question this tooltip answers. The item is already named a few lines up in the
  // native panel. A number that never changes is noise on every hover, and it was actively
  // misleading in red: red here means "this KOes them", and a self-inflicted cost wearing
  // it reads as the opposite of what it is. Drain, recoil and Liquid Ooze all stay, because
  // each varies by move and by the damage actually dealt.
  return effects;
}

/** @smogon/calc throws from desc()/kochance() when damage is 0 (immune); guard it. */
function safeDesc(result: ReturnType<typeof calculate>): string {
  try {
    return result.desc();
  } catch {
    return 'no damage';
  }
}

/** The stand-in for `desc()` on a callback move: the calc has no sentence to offer about a
 *  move it computed nothing for, so say the amount and why it came from elsewhere. Like
 *  every `calcDesc`, this is for comparison and debugging — no tooltip renders it. */
function callbackDesc(moveName: string, dealt: number): string {
  return `${moveName}: ${dealt} HP (damage callback — @smogon/calc has no model for it)`;
}
