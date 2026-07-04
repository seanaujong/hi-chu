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
  readonly ability?: string;
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
 * What can be deduced about a Pokémon's set from public reveals alone: the
 * candidate roles that survive the evidence, and each dimension's options with
 * confirmed ones marked. Rendered on Pokémon hovers — for the opponent it answers
 * "what could they still have?", pointed at our own side it answers "what has the
 * opponent figured out about us?".
 */
export interface SetKnowledge {
  /** Role names still consistent with everything revealed. */
  readonly roles: readonly string[];
  /** How many roles the species can run in this format, before narrowing. */
  readonly totalRoles: number;
  readonly moves: readonly KnownOption[];
  readonly abilities: readonly KnownOption[];
  readonly items: readonly KnownOption[];
  /** Display only — a speculative Tera type must never reach the damage calc. */
  readonly teraTypes: readonly KnownOption[];
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
