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

/** Battle-wide and defender-side conditions that change a move's damage. */
export interface FieldFacts {
  readonly weather?: WeatherName;
  readonly terrain?: TerrainName;
  /** Screens protecting the DEFENDER (the side taking the hit). */
  readonly defenderScreens: {
    readonly reflect: boolean;
    readonly lightScreen: boolean;
    readonly auroraVeil: boolean;
  };
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

/** Everything the running battle has revealed about one Pokémon. */
export interface LiveFacts {
  readonly speciesForme: string;
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
  readonly gender?: 'M' | 'F' | 'N';
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

/** The single concrete set we calculate with: known facts win, the rest assumed. */
export interface ResolvedMon {
  readonly speciesForme: string;
  readonly level: number;
  readonly nature: string;
  readonly evs: FullStats;
  readonly ivs: FullStats;
  readonly ability: string | undefined;
  readonly item: string | undefined;
  readonly status: StatusName | undefined;
  readonly boosts: Readonly<Partial<Record<StatID, number>>>;
  readonly hpPercent: number;
  readonly teraType: string | undefined;
  readonly terastallized: boolean;
  /** Moves this Pokémon could use, for the tooltip to enumerate damage over. */
  readonly possibleMoves: readonly string[];
  /** True when no role was consistent with revealed moves (assumptions are weaker). */
  readonly assumptionsUncertainReason?: string;
}
