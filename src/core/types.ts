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
  /**
   * The types actually standing there, when a retype (Protean/Libero, Soak, Reflect Type,
   * Burn Up, Conversion) has moved them off the species' own. Absent for the overwhelming
   * majority of Pokémon, which are simply their own types.
   *
   * The same split as `liveForme`, and for the same reason: the CALC must see the types
   * really on the field — they decide STAB going out and the whole type chart coming in —
   * while set INFERENCE must not. A Greninja that turned Ice is still running a Greninja
   * set out of the Greninja feed entry, so `narrow`, `knowledge` and the feed lookup read
   * `speciesForme` and never this.
   */
  readonly liveTypes?: readonly string[];
  /** True while this Pokémon is grounded by Roost — its Flying type suspended until the end
   *  of the turn. Carried as a flag rather than folded into `liveTypes`, because which types
   *  it removes depends on the forme actually standing there. */
  readonly roosting?: boolean;
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
   * True once the log shows this Pokémon FREELY selecting two different moves during a
   * single stint on the field. A Choice item locks its holder into one move until it
   * switches out, so that rules Choice Band/Specs/Scarf out — items which, like Life Orb,
   * never announce themselves. Scoped to one stint because the lock dies on switch-out:
   * `revealedMoves.length >= 2` is NOT the same fact and would lie. The exclusions that
   * make a selection "free" (called moves, a lock-rejected click, Struggle, Magic Room,
   * Embargo) are applied in the reader; Klutz is applied downstream against the role's
   * ability pool, so this stays a raw fact.
   */
  readonly usedDifferentMovesSinceSwitchIn: boolean;
  /**
   * True once the log shows this Pokémon completing a switch-in at which a held Air Balloon
   * would have had to ANNOUNCE itself, and staying silent. This is the mirror of every other
   * deduction here: those read items that never speak, and Air Balloon is the sim's only
   * item that always does — its `onStart` emits `|-item|<mon>|Air Balloon` each time its
   * holder comes in. So silence on the way in is proof of absence, and the balloon is worth
   * knowing about: it makes its holder immune to Ground moves outright.
   *
   * The suppressors that would make silence meaningless are split the usual way. Gravity and
   * Magic Room are time-scoped, so the reader judges them at the moment of the switch-in;
   * Klutz is an ability, so it is applied downstream against the role's ability pool, leaving
   * this a raw fact. Embargo — the third `ignoringItem()` case — needs no handling at all: it
   * is a volatile, and volatiles clear on the way out, so no mon can be Embargoed at the
   * instant it switches IN.
   */
  readonly switchedInWithoutAnnouncingBalloon: boolean;
  /**
   * True once the log shows this Pokémon finishing a turn on the field with no status on it.
   * Flame Orb and Toxic Orb status their own holder at the end of EVERY turn, revealing
   * themselves as they do — so one clean end-of-turn rules both out. The second silence-is-
   * evidence deduction, after the balloon above, and the one that reaches furthest: in the
   * randbats feed every orb role carries the orb as its ONLY item, so ruling it out drops
   * the whole role, and with it an ability worth a lot of damage (Guts, Quick Feet, Toxic
   * Boost, Poison Heal).
   *
   * The suppressors that would make the silence meaningless — a status already in place,
   * Misty Terrain, Magic Room, Embargo, and an active Tera changing what the holder can
   * even catch — are all judged in the reader, since each is time-scoped. Klutz is applied
   * downstream against the role's ability pool, so this stays a raw fact.
   */
  readonly endedTurnUnstatused: boolean;
  /**
   * True once the log shows Protean or Libero having ALREADY converted this Pokémon during
   * its current stint. Gen 9 fires them once per switch-in; @smogon/calc still models the
   * gen 6-8 rule and grants STAB to any move an owner throws, so this is what separates a
   * correct assumption from a stale one — see `battle/readState.ts`'s `proteanAlreadyFired`
   * for why it is read from the log's `[from]` attribution rather than from `liveTypes`.
   */
  readonly proteanAlreadyFired: boolean;
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
   * The Substitute standing in front of this Pokémon, when one is. Absent for nearly every
   * Pokémon, and absent is the ordinary case rather than a fallback.
   */
  readonly substitute?: SubstituteFacts;
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
 * A Substitute standing in front of a Pokémon: an HP pool that absorbs every hit in its
 * place until it breaks. Presence is the whole of what the client tells us directly — its
 * volatile is a bare `['substitute']` with no HP on it — so both fields below exist to say
 * how far the SIZE of that pool can be trusted. The size itself is derived where it is used
 * (`core/substitute.ts`), never stored.
 */
export interface SubstituteFacts {
  /**
   * Max HP of the Pokémon whose HP SIZED this sub, when that isn't the one standing behind
   * it. Only Shed Tail separates the two: it builds a sub on its user and hands it to a
   * teammate on the way out, so the doll keeps a size the mon now wearing it had no part in.
   * Absent in the ordinary case, where the damage layer sizes it on the defender it already
   * had to measure anyway.
   */
  readonly sizedOnMaxHP?: number;
  /**
   * True once the log shows this sub ABSORBING a hit. The client tracks that a sub exists
   * but never how much of it is left (`-activate … move: Substitute|[damage]` says a hit
   * landed on it, not how hard), so from that moment a full sub's hit count is an UPPER
   * bound — a weakened sub can only break sooner, never later.
   */
  readonly dented: boolean;
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

// --- Move order, as the speed-order reveal reads it -------------------------

/**
 * One move as the ORDER law needs to see it: its bracket, plus the two facts an ability can
 * move that bracket by (Prankster lifts a status move, Triage lifts a draining one).
 *
 * Priority comes from the CLIENT's dex rather than @smogon/calc's, and that is not a layering
 * preference — the calc's move data carries positive priorities and zeroes every negative
 * one, because nothing in a damage calculator ever orders two moves. Reading it there would
 * put Dragon Tail, Roar, Teleport, Focus Punch and Trick Room in the 0 bracket, and a foe
 * that moved second because of a -6 move would read as simply slow. The client's dex is
 * Showdown's own, which is why its move tooltips can show a priority at all.
 */
export interface OrderedMove {
  readonly name: string;
  readonly priority: number;
  readonly category: string;
  readonly type: string;
  /** Whether the move drains — the flag Triage's +3 keys on. */
  readonly drain: boolean;
}

/** One turn's worth of ordering evidence: who moved, with what, and in which order. */
export interface TurnOrder {
  readonly ours: OrderedMove;
  readonly theirs: OrderedMove;
  readonly theyMovedFirst: boolean;
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
  /**
   * The types actually standing there, when a retype has moved them off the species'
   * record. The calc-facing half of `LiveFacts.liveTypes` — set inference never sees it.
   */
  readonly types?: readonly string[];
  /**
   * True when Protean/Libero has ALREADY converted this Pokémon this stint, so the ability
   * is spent and grants nothing further. @smogon/calc models the gen 6-8 rule and would
   * otherwise hand STAB to every move — see `damage.ts`'s `knownAbility`.
   */
  readonly proteanSpent?: boolean;
  /** True while Roost has this Pokémon's Flying type suspended — see `damage.ts`'s
   *  `speciesOverrides`, which applies it to whichever types the forme really has. */
  readonly roosting?: boolean;
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
  /** See `LiveFacts.substitute` — carried through so the damage layer can put the shield
   *  in front of this mon. Identical across every variant of one Pokémon (it is live state,
   *  not a set dimension), so it is deliberately absent from `variantSignature`. */
  readonly substitute?: SubstituteFacts;
}
