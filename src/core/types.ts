// Shared vocabulary for the whole extension. Three distinct shapes, kept apart on
// purpose because they come from three different places and must not be confused:
//
//   RandbatsEntry  — STATIC possibilities for a species (fetched JSON).
//   LiveFacts      — what the live battle has actually REVEALED about one Pokémon.
//   ResolvedMon    — the single concrete set we feed the damage calc, after merging
//                    LiveFacts (known) over RandbatsEntry (assumed).

export type StatID = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatsTable = Partial<Record<StatID, number>>;
export type FullStats = Record<StatID, number>;

export type StatusName = 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';

// Field state. These two unions mirror @smogon/calc's `Weather`/`Terrain` exactly
// (so they assign straight through) but live here to keep the core calc-free.
export type WeatherName = 'Sand' | 'Sun' | 'Rain' | 'Hail' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain' | 'Strong Winds';
export type TerrainName = 'Electric' | 'Grassy' | 'Psychic' | 'Misty';

/** Battle-wide and per-side conditions that change a move's damage or the move ORDER.
 *  Sides are named by calc orientation (attacker/defender), same as `defenderScreens`.
 *  Absent optional fields mean "not active", matching `weather`. */
export interface FieldFacts {
  readonly weather?: WeatherName;
  readonly terrain?: TerrainName;
  /** Screens protecting the DEFENDER (the side taking the hit). */
  readonly defenderScreens: {
    readonly reflect: boolean;
    readonly lightScreen: boolean;
    readonly auroraVeil: boolean;
  };
  /** Trick Room: battle-wide, inverts speed ORDER (slower acts first). It never
   *  changes a speed stat — only the verdict layer (core/speed.ts) reads it. */
  readonly trickRoom?: boolean;
  /** Tailwind doubles Speed for the side it blows on. */
  readonly attackerTailwind?: boolean;
  readonly defenderTailwind?: boolean;
}

// --- Static randbats data (https://pkmn.github.io/randbats) -----------------

/** One named role a species can run (e.g. "Setup Sweeper"). */
export interface RandbatsRole {
  readonly abilities: readonly string[];
  readonly items: readonly string[];
  readonly teraTypes: readonly string[];
  readonly moves: readonly string[];
  readonly evs?: StatsTable;
  readonly ivs?: StatsTable;
  /** Set by pools whose sets have natures (assumed spreads, usage sets). The randbats
   *  feed never carries one — absent means the randbats baseline (Serious). */
  readonly nature?: string;
}

/** A species' full set of possibilities. Gen 9 entries carry per-role `roles`. */
export interface RandbatsEntry {
  readonly level: number;
  readonly abilities: readonly string[];
  readonly items: readonly string[];
  readonly teraTypes?: readonly string[];
  readonly moves?: readonly string[];
  readonly roles?: Readonly<Record<string, RandbatsRole>>;
  readonly evs?: StatsTable;
  readonly ivs?: StatsTable;
}

export type RandbatsData = Readonly<Record<string, RandbatsEntry>>;

// --- Live battle facts ------------------------------------------------------

/**
 * The client dex's base data for one species. Carried on `LiveFacts` so the damage
 * layer can calculate formes `@smogon/calc`'s own dex doesn't know — Champions invents
 * new Megas (Chandelure-Mega, Meganium-Mega) that never existed in a mainline game, but
 * the Showdown client's dex serves them (its own tooltips need the same data). The calc
 * uses this ONLY as a fallback for a species it lacks; a known species keeps the calc's
 * canonical record.
 */
export interface SpeciesData {
  readonly baseStats: FullStats;
  readonly types: readonly string[];
  /** Needed for weight-based moves (Heavy Slam, Low Kick). */
  readonly weightkg?: number;
  /** The species' dex ability slots (0/1/H) — the open-format assumption pool when no
   *  ability has been revealed. Optional and tolerated absent: the species fallback
   *  above must survive a client dex record that lacks it. */
  readonly abilities?: readonly string[];
}

/** Everything the running battle has revealed about one Pokémon. */
export interface LiveFacts {
  /**
   * The Pokémon this IS — its identity, and the key its set is published under. A forme
   * it can never go back from (Mega, Palafin-Hero, Terapagos-Terastal) is part of that
   * identity and shows up here; the feed still finds the set, keyed on the base species.
   */
  readonly speciesForme: string;
  /**
   * The forme it is WEARING right now, set only while a reversible change (Relic Song's
   * Meloetta-Pirouette, Stance Change, Zen Mode — or Transform, copying another Pokémon
   * whole) makes that differ from `speciesForme`.
   *
   * The two are separate because they answer to different layers, exactly as `ability`
   * (live) and `baseAbility` (innate) do. The CALC must see the forme actually standing
   * there — its stats, its types. Set INFERENCE must not: a Meloetta-Pirouette is still
   * running a Meloetta set, and the feed publishes no Pirouette entry to look up. So the
   * inference layers (narrow, knowledge, the feed lookup) read `speciesForme`, and the
   * calc-facing writer — `resolve.buildResolved`, the one place a ResolvedMon is made —
   * reads this one in preference.
   */
  readonly liveForme?: string;
  /** Client-dex base data for `speciesForme` — see `SpeciesData`. */
  readonly speciesData?: SpeciesData;
  readonly level: number;
  /** Current HP as a fraction in [0,1]; for opponents we usually only know a %. */
  readonly hpPercent: number;
  readonly status?: StatusName;
  /** Stat stage changes in [-6, 6]; absent stats are unboosted. */
  readonly boosts: Readonly<Partial<Record<StatID, number>>>;
  /** The Tera type the Pokémon has ALREADY terastallized into, if any. */
  readonly teraType?: string;
  readonly terastallized: boolean;
  /** The CURRENT effective ability (post-Trace/Skill-Swap/suppression) — drives the calc. */
  readonly ability?: string;
  /** The INNATE ability the set was built with — drives set inference, not the live ability. */
  readonly baseAbility?: string;
  readonly item?: string;
  /** A revealed item no longer held (consumed berry, knocked-off orb) — still narrows the set. */
  readonly prevItem?: string;
  /** Moves actually seen this battle — used to narrow which role they are running. */
  readonly revealedMoves: readonly string[];
  /**
   * True once the battle log shows this Pokémon LANDING a damaging hit (a move it used
   * dealing damage to a foe). Life Orb takes 1/10 recoil on that hit and REVEALS itself
   * doing so — so a landed hit with no item yet revealed rules Life Orb out. It must be
   * a landed hit, not merely a move used: a miss or an immunity triggers no recoil and
   * proves nothing. The recoil-suppressor exceptions (Sheer Force, Magic Guard) are
   * applied downstream against each role's ability pool, so this stays a raw fact.
   */
  readonly landedDamagingHit: boolean;
  /**
   * True once the battle log shows this Pokémon TAKING entry-hazard damage (Stealth Rock,
   * Spikes) on a switch-in. Heavy-Duty Boots negates that damage, so having taken it rules
   * Boots out — an item that, like Life Orb, never reveals itself directly. Unambiguous:
   * taking the damage also rules out Magic Guard, so no ability guard is needed.
   */
  readonly tookEntryHazardDamage: boolean;
  /**
   * True once the log shows this Pokémon switching in while Stealth Rock was set on its OWN
   * side, yet taking no Stealth Rock damage. Only Heavy-Duty Boots and Magic Guard prevent
   * that (nothing is type-immune to Stealth Rock), so it CONFIRMS Boots — the positive twin
   * of `tookEntryHazardDamage` — once Magic Guard is excluded (done downstream against the
   * role's abilities). Keyed on Stealth Rock alone: grounded hazards have type/airborne
   * immunities that would muddy the read.
   */
  readonly switchedIntoStealthRockUnharmed: boolean;
  /**
   * How many times the battle log shows this Pokémon TAKING a direct move hit — RAGE
   * FIST's power scales with it (`min(350, 50 + 50×timesAttacked)`), the sim's own
   * `pokemon.timesAttacked`. Persists across switches (the sim never resets it), so this
   * is a running count over the WHOLE battle, not just the current stint on the field.
   */
  readonly timesAttacked: number;
  readonly gender?: 'M' | 'F' | 'N';
  /**
   * OUR OWN mon's exact final stats, as the server reports them in the request JSON
   * (`myPokemon[i].stats` + `maxhp`). Private truth: only our-view surfaces may set it
   * (the `myPokemon` principle), and only open formats need it — randbats spreads are
   * public knowledge, so the calc's own derivation is already exact there.
   */
  readonly knownStats?: FullStats;
  /**
   * The Pokémon this one has TRANSFORMED into (Ditto's Imposter, Mew's Transform), when
   * it has. Absent for everyone else — which is nearly everyone.
   *
   * Transform copies the target whole and keeps almost nothing of its own, so the copy —
   * not the copier's own set — is what every calc must read. The shell builds it, because
   * only the shell can resolve the TARGET (the same pipeline that would answer "what is
   * that Pokémon?" if you hovered it); the core then consumes it in one place,
   * `resolve.buildResolved`, so every surface sees the same copy.
   */
  readonly transformedInto?: TransformCopy;
  /**
   * This Pokémon's own accuracy/evasion stat stage, in [-6, 6] — absent means unboosted
   * (0). Read ONLY by the multi-hit per-hit-accuracy law (`core/multihit.ts`): the
   * attacker's `accuracyBoost` and the defender's `evasionBoost` combine there. Neither
   * reaches the damage calc directly — accuracy/evasion stages don't change a move's
   * damage, only whether it lands.
   */
  readonly accuracyBoost?: number;
  readonly evasionBoost?: number;
}

/**
 * What a Transformed Pokémon is wearing. Transform takes the target's species, types,
 * final stats, ability and moves; the copier keeps its own level, HP, item, status and
 * boosts. HP is the odd one out of the stats — it is never copied — so it is already
 * folded into both stat tables here, and neither `baseStats` nor `finalStats` describes
 * any single real Pokémon: they are the copier's HP grafted onto the target's body.
 */
export interface TransformCopy {
  /** The copied body: the target's base stats, types and weight — with the copier's OWN
   *  base HP, since the calc derives max HP from whatever species record it is handed. */
  readonly body: SpeciesData;
  /**
   * The stats Transform actually installs: the target's FINAL numbers, verbatim (it copies
   * the numbers, not the spread that made them), with the copier's own final HP. Absent
   * when the target's spread isn't knowable — an open format's foe, whose EVs we only ever
   * bracket — in which case the body still applies and the spread stays the assumed one.
   */
  readonly finalStats?: FullStats;
  /** The target's moves: what this Pokémon can actually attack with now. */
  readonly moves: readonly string[];
  /** True when those moves are the target's REAL four, not the pool its set could still be
   *  running — which is the usual case, since Imposter copies the opposing active and the
   *  opposing active, from our seat, is ours. Decides whether the sets view marks them
   *  confirmed (✓) or speculative. */
  readonly movesKnown: boolean;
  /** The TARGET's own `timesAttacked` — the sim copies it onto the copier verbatim
   *  (`transformInto`: `this.timesAttacked = pokemon.timesAttacked`), so a transformed
   *  Ditto's Rage Fist reads the hits ITS COPY has taken, not the Ditto underneath. */
  readonly timesAttacked: number;
}

// --- Inferred set knowledge (the information game) --------------------------

/** One candidate fact: `known` when the battle has confirmed it, else speculative. */
export interface KnownOption {
  readonly name: string;
  readonly known: boolean;
}

/**
 * A once-per-battle transformation a set can perform, as a discriminated union
 * rather than a fixed column per gimmick. Formats carry DIFFERENT ones — gen9 has
 * Tera, Champions has Mega, gen7 had Z-moves — and most sets have none. Modeling it
 * as a variant keeps "none / one / both" honest: a set simply lists the gimmicks it
 * actually has, and the renderer dispatches on `kind` (exhaustively). Only Tera is a
 * distinct feed dimension; Mega is DERIVED from a stone item — so this lives on the
 * derived SetKnowledge, never on the raw feed. Mirrors pokemon-battle's `GimmickKind`:
 * identity here, mechanics/legality in the layer that knows the format.
 *
 * A speculative gimmick is display only — it must never reach the damage calc (the
 * calc already sees the live forme/Tera through LiveFacts once it actually happens).
 */
export type Gimmick =
  | {readonly kind: 'tera'; readonly types: readonly KnownOption[]}
  | {readonly kind: 'mega'; readonly stone: KnownOption; readonly forme: string}
  | {readonly kind: 'zmove'; readonly crystal: KnownOption};

/** One candidate set, kept whole: its name and every dimension, reveals marked. */
export interface CandidateSet {
  /** The feed's role name ("Bulky Setup"); '' for role-less (older-gen) entries. */
  readonly name: string;
  readonly abilities: readonly KnownOption[];
  readonly items: readonly KnownOption[];
  readonly moves: readonly KnownOption[];
  /** The transformations this set can perform in this format — often empty. */
  readonly gimmicks: readonly Gimmick[];
}

/**
 * What can be deduced about a Pokémon's set from public reveals alone: the
 * candidate sets that survive the evidence, each kept whole (which item goes with
 * which moves is the information). Rendered on Pokémon hovers — for the opponent it
 * answers "what could they still have?", pointed at our own side it answers "what
 * has the opponent figured out about us?".
 */
export interface SetKnowledge {
  readonly candidates: readonly CandidateSet[];
  /** How many roles the species can run in this format, before narrowing. */
  readonly totalRoles: number;
  /** Set when the reveals contradict every known role (form change, data drift). */
  readonly uncertainReason?: string;
}

// --- Resolved set fed to the calc ------------------------------------------

/**
 * One concrete way a Pokémon's still-hidden set could resolve, for uncertainty-aware
 * damage. When the item or ability isn't revealed yet, the target could be running
 * any of its surviving sets — each a different calc (Assault Vest halving special
 * hits is the loud case). A variant pairs the calc-ready mon with the role it
 * assumes, so a bucket of identical-damage variants can be named by what differs.
 */
export interface SetVariant {
  readonly mon: ResolvedMon;
  /** The role this variant assumes ('' for role-less older-gen entries). */
  readonly role: string;
}

/** The single concrete set we calculate with: known facts win, the rest assumed. */
export interface ResolvedMon {
  readonly speciesForme: string;
  /** Client-dex base data for `speciesForme` — the calc's fallback for a species it lacks. */
  readonly speciesData?: SpeciesData;
  /**
   * Base data that REPLACES the species record, rather than filling in for a missing one:
   * the calc must use this even for a species it knows perfectly well. Only Transform sets
   * it, because only Transform makes a Pokémon's body stop matching its species — a
   * transformed Ditto has Dragapult's base stats but its own base HP, which no dex record
   * describes. (`speciesData` above is the opposite: a fallback, ignored when the calc's
   * own dex has the species.)
   */
  readonly speciesOverride?: SpeciesData;
  readonly level: number;
  readonly nature: string;
  readonly evs: FullStats;
  readonly ivs: FullStats;
  readonly ability: string | undefined;
  readonly item: string | undefined;
  /**
   * True when a CONDITIONAL ability's boost is currently ACTIVE and the calc has no way to
   * infer that itself. `@smogon/calc`'s `getFinalSpeed` reads Unburden's ×2 Speed off an
   * explicit `abilityOn` flag on the calc's `Pokemon` — the same generic toggle other
   * gen-8/9 abilities (Flash Fire, Slow Start, Stakeout, …) use — rather than deriving it
   * from `item`/turn count itself. hi-chu sets it only for Unburden today:
   * `resolve.buildResolved` turns it on exactly when the ability is Unburden AND the item
   * is confirmed GONE, never merely absent (Unburden triggers on a mid-battle LOSS, not a
   * mon that started itemless). Absent/false means "not applicable — off".
   */
  readonly abilityOn?: boolean;
  readonly status: StatusName | undefined;
  readonly boosts: Readonly<Partial<Record<StatID, number>>>;
  readonly hpPercent: number;
  readonly teraType: string | undefined;
  readonly terastallized: boolean;
  /** Moves this Pokémon could use, for the tooltip to enumerate damage over. */
  readonly possibleMoves: readonly string[];
  /** True when no role was consistent with revealed moves (assumptions are weaker). */
  readonly assumptionsUncertainReason?: string;
  /** Exact server-reported final stats (see `LiveFacts.knownStats`). When set, the
   *  damage layer makes the calc reproduce these exactly instead of deriving stats
   *  from the assumed nature/EVs/IVs. */
  readonly knownStats?: FullStats;
  /** See `LiveFacts.timesAttacked` — carried through so the damage layer can compute
   *  Rage Fist's actual power, something @smogon/calc's own move data doesn't model. */
  readonly timesAttacked: number;
  /** See `LiveFacts.accuracyBoost`/`evasionBoost` — carried through for the multi-hit
   *  per-hit-accuracy law only; never passed to the damage calc itself. */
  readonly accuracyBoost?: number;
  readonly evasionBoost?: number;
}
