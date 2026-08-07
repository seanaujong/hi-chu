// Read the Pokémon Showdown client's live battle objects into our own typed
// LiveFacts. The `ClientPokemon`/`ClientBattle`/`ClientSide` interfaces are a
// minimal structural view of the client's classes (which ship no types we can
// import) — only the fields we actually read, named as the client names them.
//
// `toLiveFacts` is pure and unit-tested with a stub; the navigation helpers are
// thin and defensive (the client's shape can shift between releases).

import type {FieldFacts, FullStats, LiveFacts, OrderedMove, SpeciesData, StatID, StatusName, TerrainName, TurnOrder, WeatherName} from '../core/types.js';
import {isMegaForme} from '../core/facts.js';
import {multiHitProfile} from '../core/moves.js';
import type {OwnSideHazards} from '../core/hazards.js';

export interface ClientPokemon {
  readonly speciesForme: string;
  readonly level: number;
  readonly hp: number;
  readonly maxhp: number;
  readonly status: string; // '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | '???'
  /**
   * OPTIONAL on purpose, though the live client usually sets it. These interfaces are
   * reverse-engineered from an untyped client, and declaring this required made the
   * compiler vouch for something we cannot promise: a real battle produced a `Pokemon`
   * with no `boosts` at all, and `p.boosts['atk']` — the first read in `BOOSTABLE`
   * order — threw `Cannot read properties of undefined (reading 'atk')` straight into
   * `content.ts`'s catch-all, silently costing that hover its whole hi-chu section.
   * Marking it optional is what makes the compiler demand the guard at every read.
   */
  readonly boosts?: Readonly<Record<string, number>>;
  readonly terastallized: string; // '' when not terastallized, else the Tera type
  readonly ability?: string;
  readonly baseAbility?: string;
  readonly item?: string;
  /** A revealed item the Pokémon no longer holds (consumed berry, knocked-off orb). */
  readonly prevItem?: string;
  /** Moves the battle has seen this Pokémon use. A leading "*" marks a move it has only
   *  by TRANSFORM — the client's `rememberMove` prefixes one while `volatiles.transform`
   *  is set — so a starred entry belongs to the COPIED Pokémon, not this one's set. */
  readonly moveTrack?: ReadonlyArray<readonly [string, unknown]>;
  readonly gender?: string;
  readonly side?: ClientSide;
  /** Side+name identity, e.g. "p1: Noivern" — matches the protocol log's actor tags
   *  (slot-independent, so a mid-battle switch doesn't misattribute a slot). */
  readonly ident?: string;
  /** Active volatiles, keyed by id; each is its own `[id, ...args]` tuple. Two of them
   *  carry the forme a Pokémon is CURRENTLY wearing (see `readLiveForme`):
   *  `formechange: ['formechange', 'Meloetta-Pirouette']` and
   *  `transform: ['transform', targetPokemon, shiny, gender, targetLevel]`. */
  readonly volatiles?: Readonly<Record<string, readonly unknown[] | undefined>>;
  /** Effects lasting only the CURRENT turn, keyed by id. Separate from `volatiles` because
   *  the client clears the whole table at end of turn — which is exactly what makes Roost's
   *  grounding last one turn and no longer (see `readRoosting`). */
  readonly turnstatuses?: Readonly<Record<string, unknown>>;
}

export interface ClientSide {
  readonly active: ReadonlyArray<ClientPokemon | null>;
  /** The side's whole ROSTER — filled from the `|poke|` team-preview lines and kept as each
   *  Pokémon is revealed, so unlike `active` it still holds one that has switched out. That
   *  is the only reason it is read: a Shed Tail sub outlives the Pokémon that cut it. */
  readonly pokemon?: ReadonlyArray<ClientPokemon>;
  /** True for the side rendered at the top of the screen — the opponent, from the viewer's seat. */
  readonly isFar?: boolean;
  /** Active side conditions keyed by id ("reflect", "lightscreen", "auroraveil", …). */
  readonly sideConditions?: Readonly<Record<string, unknown>>;
}

export interface ClientBattle {
  readonly gen: number;
  readonly tier: string;
  /** "singles" | "doubles" | … — the open-format doubles signal (a randbats battle's
   *  format id already carries it). */
  readonly gameType?: string;
  readonly sides: ReadonlyArray<ClientSide>;
  /** The battle room's id ("battle-gen9randombattle-123…") — the room's DOM element is
   *  `#room-<roomid>`, which scopes the Tera-toggle read to THIS battle's controls. */
  readonly roomid?: string;
  /** Weather id ("sunnyday", "raindance", …), or "" / undefined when clear. */
  readonly weather?: string;
  /** Field conditions including terrains; each entry is [displayName, …]. */
  readonly pseudoWeather?: ReadonlyArray<readonly [string, ...unknown[]]>;
  /** The raw `|`-delimited protocol log, one line per entry ("|move|…", "|-damage|…"). */
  readonly stepQueue?: ReadonlyArray<string>;
  /** The viewer's OWN team with full private detail (item/ability the opponent can't see),
   *  present only when the viewer is a player, not a spectator. */
  readonly myPokemon?: ReadonlyArray<ClientServerPokemon>;
  /** The client's dex — the same `battle.dex.species.get(...)` its own tooltips read. */
  readonly dex?: ClientDex;
}

export interface ClientDex {
  readonly species: {get(name: string): ClientSpecies | undefined};
  /** The client dex's items — read to turn a held Mega stone into the forme it unlocks
   *  (`readMegaForme`), the same lookup the client's own tooltip does. */
  readonly items?: {get(name: string): ClientItem | undefined};
  /** The client dex's moves — read for the PRIORITY bracket a move went in, which
   *  @smogon/calc's own move data does not carry for any negative bracket. See
   *  `readMoveOrder`. */
  readonly moves?: {get(name: string): ClientMove | undefined};
}

/** The client dex's move record, as much of it as the order law reads. */
export interface ClientMove {
  readonly priority?: number;
  readonly category?: string;
  readonly type?: string;
  /** The move's flag set. `heal` is the one read here — the client's `Move` class exposes
   *  `flags` but deliberately NOT `drain`, even though its raw data carries it, so `flags`
   *  is both the only reachable source and the one the sim's own Triage rule tests. */
  readonly flags?: Readonly<Record<string, unknown>>;
}

/** The client dex's item record. `megaStone` maps a base species NAME to the Mega forme
 *  its stone unlocks (`{"Charizard": "Charizard-Mega-X"}`) — the client keys it by
 *  `species.name`, and so do we. */
export interface ClientItem {
  readonly megaStone?: Readonly<Record<string, string>>;
}

/** The client dex's species record, loosely typed — it's reverse-engineered like the rest. */
export interface ClientSpecies {
  readonly exists?: boolean;
  readonly baseStats?: Readonly<Record<string, number>>;
  readonly types?: readonly string[];
  readonly weightkg?: number;
  /** Ability slots keyed "0"/"1"/"H"(/"S") — the open-format assumption pool. */
  readonly abilities?: Readonly<Record<string, string>>;
}

/** One entry of `battle.myPokemon`: the player's private view of their own Pokémon
 *  (the client's `ServerPokemon`). `item`/`ability`/`moves` are id form
 *  ("heavydutyboots"), unlike the display-name form the battle-view `ClientPokemon`
 *  carries. The client parses `details`/`condition` into the enrichment fields
 *  (`speciesForme`, `hp`, …); `serverPokemonFacts` prefers those and falls back to
 *  parsing the raw strings itself, so either client build works. */
export interface ClientServerPokemon {
  readonly ident: string; // "p1: Iron Bundle"
  readonly item?: string; // '' is meaningful: the item is KNOWN to be gone (knocked off/consumed)
  readonly ability?: string;
  readonly baseAbility?: string;
  /** The Tera type this Pokémon CAN terastallize into — the client sets it whether or
   *  not the Tera has been used ("always the Tera Type of the Pokemon"). */
  readonly teraType?: string;
  /** Falsy while not terastallized, else the active Tera type — same semantics as the
   *  battle view's `terastallized`. */
  readonly terastallized?: string;
  /** The full moveset, in id form ("dracometeor") — the server request data carries all
   *  four slots, unlike the battle view's `moveTrack` (revealed moves only). */
  readonly moves?: readonly string[];
  /** Raw protocol strings, always present on the real client. */
  readonly details?: string; // "Honchkrow, L86, F"
  readonly condition?: string; // "312/312" | "245/312 par" | "0 fnt"
  /** Client-parsed enrichments of the two strings above (PokemonDetails/PokemonHealth). */
  readonly speciesForme?: string;
  readonly level?: number;
  readonly gender?: string;
  readonly hp?: number;
  readonly maxhp?: number;
  readonly status?: string;
  /** The server-computed FINAL stats (no hp — that's `maxhp`), from the request JSON.
   *  Exact, private, and the only stat truth a team format offers (the request never
   *  carries EVs/nature). */
  readonly stats?: Readonly<Record<string, number>>;
}

const BATTLE_STATUSES = new Set<StatusName>(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);
const BOOSTABLE: readonly StatID[] = ['atk', 'def', 'spa', 'spd', 'spe'];

function asStatus(raw: string): StatusName | undefined {
  return BATTLE_STATUSES.has(raw as StatusName) ? (raw as StatusName) : undefined;
}

function asGender(raw: string | undefined): 'M' | 'F' | 'N' | undefined {
  return raw === 'M' || raw === 'F' || raw === 'N' ? raw : undefined;
}

/** Behaviours the SNAPSHOT can't show — deduced from the protocol log by the readers
 *  below and folded into LiveFacts. Absent flags default to false (nothing observed). */
export interface BehaviorSignals {
  readonly landedDamagingHit?: boolean;
  readonly tookEntryHazardDamage?: boolean;
  readonly switchedIntoStealthRockUnharmed?: boolean;
  readonly usedDifferentMovesSinceSwitchIn?: boolean;
  readonly switchedInWithoutAnnouncingBalloon?: boolean;
  readonly endedTurnUnstatused?: boolean;
  readonly proteanAlreadyFired?: boolean;
  readonly timesAttacked?: number;
  readonly substitute?: SubstituteReading;
}

/** What the log says about the Substitute a Pokémon is currently standing behind — the
 *  raw reading, before the shell resolves `shedTailMaker` into an actual max HP. */
export interface SubstituteReading {
  readonly dented: boolean;
  /** The ident of the Pokémon whose Shed Tail built this sub, when one did — it is that
   *  Pokémon's max HP the doll was cut from, not this one's. */
  readonly shedTailMaker?: string;
}

/**
 * The client dex's base data for this Pokémon's species — the damage layer's fallback
 * for formes `@smogon/calc` doesn't know (Champions' invented Megas). Returns undefined
 * unless the dex serves a complete, well-formed record: a partial answer would make the
 * calc lie, and undefined merely keeps today's behaviour (no section for that mon).
 */
export function readSpeciesData(battle: ClientBattle, mon: {speciesForme: string}): SpeciesData | undefined {
  const species = battle.dex?.species.get(mon.speciesForme);
  if (!species || species.exists === false) return undefined;
  const baseStats = asFullStats(species.baseStats);
  const types = species.types;
  if (!baseStats || !Array.isArray(types) || types.length === 0) return undefined;
  if (!types.every((t) => typeof t === 'string' && t.length > 0)) return undefined;
  // Ability slots ride along TOLERANTLY: the calc fallback above is complete without
  // them, so a dex record lacking abilities must not cost us the whole reading.
  const abilities = Object.values(species.abilities ?? {}).filter((a) => typeof a === 'string' && a.length > 0);
  return {
    baseStats,
    types: [...types],
    ...(typeof species.weightkg === 'number' && species.weightkg > 0 ? {weightkg: species.weightkg} : {}),
    ...(abilities.length > 0 ? {abilities} : {}),
  };
}

function asFullStats(raw: Readonly<Record<string, number | undefined>> | undefined): FullStats | undefined {
  if (!raw) return undefined;
  const out = {hp: raw.hp, atk: raw.atk, def: raw.def, spa: raw.spa, spd: raw.spd, spe: raw.spe};
  const wellFormed = Object.values(out).every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  // Cast: the every() above just proved all six values are positive numbers.
  return wellFormed ? (out as FullStats) : undefined;
}

/**
 * The forme this Pokémon is wearing RIGHT NOW, when that differs from the species it was
 * built as — the client's own `getSpeciesForme()` law, `volatiles.formechange[1]` first.
 *
 * The client splits forme changes in two. A PERMANENT one (Mega Evolution, Palafin-Hero,
 * Terapagos-Terastal, Mimikyu-Busted) arrives as `|detailschange|` and rewrites
 * `speciesForme` outright — nothing to do here. A TEMPORARY one (Relic Song's
 * Meloetta-Pirouette, Stance Change, Zen Mode, Forecast, Shields Down — and Transform,
 * whose target forme the client records the same way) leaves `speciesForme` untouched and
 * records the live forme in the `formechange` volatile. Read only the field and every
 * temporary forme is invisible: we would calculate Meloetta-Pirouette (128 Spe, 128 Atk)
 * as plain Meloetta (90/77), and a transformed Ditto as a Ditto.
 *
 * Undefined when the Pokémon is simply itself.
 */
export function readLiveForme(p: ClientPokemon): string | undefined {
  const forme = p.volatiles?.formechange?.[1];
  if (typeof forme !== 'string' || forme.length === 0) return undefined;
  return forme === p.speciesForme ? undefined : forme;
}

/**
 * The types this Pokémon is standing there as, when a retype has moved them off the
 * species' own — the client's own `getTypes()` law, `volatiles.typechange` first.
 *
 * The retype is one mechanic with many triggers, which is why this reads the VOLATILE and
 * not any of them: Protean/Libero convert the user to the move it is about to throw, Soak
 * and Reflect Type are moves that do it to somebody else, Burn Up and Double Shock burn a
 * type away, and Camouflage/Conversion pick one off the field or the moveset. The client
 * flattens every one into the same `['typechange', 'Ice']` — or `'Fire/Flying'`, joined —
 * so one read covers all of them and a new trigger costs nothing.
 *
 * `typeadd` (Forest's Curse, Trick-or-Treat) rides along only when a typechange is already
 * standing, and that asymmetry is deliberate rather than an omission. It is an ADDITIVE
 * volatile: on its own it means "the species' own types, plus Ghost", so reading it here
 * would need the species record this function does not have and must not reach for — a
 * bare `['typeadd', 'Ghost']` read as a replacement would turn a Corviknight into a pure
 * Ghost and quadruple every Ground move into it. Alone it is therefore skipped, which
 * costs the added type's extra weakness and keeps every other type honest. Both moves are
 * absent from randbats entirely, so the case this declines is one no supported format rolls.
 *
 * Undefined once TERASTALLIZED, matching the client exactly: `getTypes` returns the Tera
 * type outright and the `-start` handler refuses to record a typechange on a
 * terastallized Pokémon at all. The calc reaches the same answer by its own route
 * (`teraType` already rides on the ResolvedMon), so handing it a stale pre-Tera retype
 * here would be two mechanisms arguing over one Pokémon's types.
 */
export function readLiveTypes(p: ClientPokemon): readonly string[] | undefined {
  if (p.terastallized) return undefined;
  const changed = p.volatiles?.['typechange']?.[1];
  if (typeof changed !== 'string' || changed.length === 0) return undefined;
  const added = p.volatiles?.['typeadd']?.[1];
  const types = [...changed.split('/'), ...(typeof added === 'string' ? [added] : [])].filter((t) => t.length > 0);
  return types.length > 0 ? types : undefined;
}

/**
 * Is this Pokémon ROOSTING — grounded for the rest of this turn, and so not Flying?
 *
 * Roost heals, and pays for it by suspending the user's Flying type until the end of the
 * turn: a Corviknight that roosts is pure Steel while it does, and a Gliscor pure Ground.
 * That is a defensive change worth a lot — the Corviknight stops resisting Ground entirely
 * and the Gliscor stops being immune to it — and it lands on precisely the turn a player is
 * hovering to decide what to throw at a Pokémon that just healed.
 *
 * A TURNSTATUS, not a volatile, and the distinction is the mechanic: the client wipes the
 * whole `turnstatuses` table at the end of every turn, which is what makes the grounding
 * expire on its own with no `-end` line to read. `|-singleturn|<mon>|move: Roost` sets it,
 * and the client only sets it for a Pokémon that HAS Flying to lose.
 *
 * Reported as a bare fact rather than as types, because the types it applies to belong to
 * the resolved forme — see `core/damage.ts`'s `speciesOverrides`, which is the one place
 * that knows what the Pokémon standing there actually is.
 */
export function readRoosting(p: ClientPokemon): boolean {
  return p.turnstatuses?.['roost'] !== undefined;
}

/**
 * The Pokémon this one has TRANSFORMED into, or undefined. The client keeps the target's
 * live `Pokemon` object right in the volatile — `['transform', target, shiny, gender,
 * level]` — so the copy can be read with exactly the machinery every other Pokémon on the
 * field is read with. That is the point: a transformed Ditto IS that Pokémon, and the
 * honest way to describe it is to go and resolve the one it copied.
 *
 * Structurally checked before it is handed back, like every other client read: the field is
 * untyped, and a malformed one must cost us the copy, not the tooltip.
 */
export function readTransformTarget(p: ClientPokemon): ClientPokemon | undefined {
  const target = p.volatiles?.transform?.[1];
  if (typeof target !== 'object' || target === null) return undefined;
  const mon = target as ClientPokemon;
  return typeof mon.speciesForme === 'string' && mon.speciesForme.length > 0 && typeof mon.level === 'number'
    ? mon
    : undefined;
}

/**
 * The Substitute this Pokémon is standing behind, or undefined.
 *
 * PRESENCE comes from the volatile, which is the authority: the client adds `substitute` on
 * the `|-start|` line and removes it on `|-end|`, so a bare `['substitute']` tuple is a fact
 * about right now rather than a replay of the log. What it does NOT carry is the doll's HP —
 * the client never tracks it — so everything else here is read from the log instead.
 *
 * The log is walked once, keeping only the state of the sub CURRENTLY standing: a `-start`
 * (or a Shed Tail hand-off) begins a fresh one and discards whatever was known about the
 * last, an `-activate … [damage]` dents it, and an `-end` or an ordinary switch ends it.
 * Reading `dented` off the whole log without that reset would carry a long-dead sub's damage
 * onto a doll made this turn.
 *
 * `shedTailMaker` is the one case where the sub's size belongs to somebody else. The sim
 * builds it on the Shed Tail user and hands it over on the way out, which the protocol shows
 * as two lines — `|-start|<user>|Substitute|[from] move: Shed Tail`, then the incoming mon's
 * `|switch|…|[from] Shed Tail` — so the maker is whoever the most recent such `-start` named.
 * (Captured from the sim directly rather than inferred from its source.)
 */
export function readSubstitute(battle: ClientBattle, mon: ClientPokemon): SubstituteReading | undefined {
  if (mon.volatiles?.['substitute'] === undefined) return undefined;
  const me = identKey(mon.ident);
  if (!me) return {dented: false}; // no ident to follow: report the sub, claim nothing about it

  let current: {dented: boolean; shedTailMaker?: string} | undefined;
  let lastShedTailMaker: string | undefined;
  for (const line of battle.stepQueue ?? []) {
    const parts = line.split('|'); // ['', TAG, 'p2a: Foo', …]
    const tag = parts[1];
    const who = identKey(parts[2]);
    const isSub = parts.some((p) => p === 'Substitute' || p === 'move: Substitute');
    const fromShedTail = parts.some((p) => p === '[from] Shed Tail' || p === '[from] move: Shed Tail');

    if (tag === '-start' && isSub) {
      // The RAW ident, not the comparison key: this one is handed on to `findByIdent`, which
      // does its own normalising. Keeping the key here made the hand-off silently find nobody.
      if (fromShedTail && parts[2]) lastShedTailMaker = parts[2];
      if (who === me) current = {dented: false};
    } else if (who !== me) {
      continue;
    } else if (tag === '-activate' && isSub && parts.includes('[damage]')) {
      if (current) current = {...current, dented: true};
    } else if (tag === '-end' && isSub) {
      current = undefined;
    } else if (tag === 'switch' || tag === 'drag') {
      // Volatiles clear on the way in — except a Shed Tail hand-off, which is the only way
      // a Pokémon arrives already wearing one, and it arrives wearing the MAKER's.
      current = fromShedTail && lastShedTailMaker ? {dented: false, shedTailMaker: lastShedTailMaker} : undefined;
    }
  }
  // The volatile already proved there IS one; an empty log (or a client whose lines we no
  // longer recognise) costs us its history, not the sub itself.
  return current ?? {dented: false};
}

/**
 * The Pokémon a protocol ident names, anywhere in the battle — bench included, which is the
 * point: the only caller wants the mon that used Shed Tail, and using it is exactly what took
 * it off the field. Matched on the same slot-independent key the log readers use, so "p1a:
 * Cyclizar" from a log line finds the roster's "p1: Cyclizar".
 */
export function findByIdent(battle: ClientBattle, ident: string): ClientPokemon | undefined {
  const want = identKey(ident);
  if (!want) return undefined;
  for (const side of battle.sides ?? []) {
    for (const mon of side.pokemon ?? side.active) {
      if (mon && identKey(mon.ident) === want) return mon;
    }
  }
  return undefined;
}

export function toLiveFacts(p: ClientPokemon, signals: BehaviorSignals = {}, speciesData?: SpeciesData): LiveFacts {
  // moveTrack entries are [name, pp]. A "*" marks a move held only by TRANSFORM: it is the
  // COPIED Pokémon's move, and reading it as this one's would narrow its set by evidence
  // that was never its own (a transformed Ditto "revealing" the moveset it is imitating).
  const revealedMoves = (p.moveTrack ?? [])
    .filter(([name]) => !name.startsWith('*'))
    .map(([name]) => name)
    .filter((name) => name.length > 0);
  const liveForme = readLiveForme(p);
  const liveTypes = readLiveTypes(p);
  const roosting = readRoosting(p);

  // `?? {}` because the client does not always have it — see the `boosts` field's own note.
  // An absent boost table means "no boosts", which is the honest reading and the common case.
  const live = p.boosts ?? {};
  const boosts: Partial<Record<StatID, number>> = {};
  for (const stat of BOOSTABLE) {
    const v = live[stat];
    if (v) boosts[stat] = v;
  }

  // The client tracks two abilities: `ability` is the CURRENT effective one (what
  // Trace/Skill Swap/Mummy/suppression left active — this drives the live calc), and
  // `baseAbility` is the INNATE one the set was built with (`rememberAbility` stamps
  // it once and never overwrites it). Set inference must use the innate ability — a
  // Gardevoir that Traced Teravolt is still a Trace set — so we carry both.
  const ability = p.ability || p.baseAbility || undefined;
  const baseAbility = p.baseAbility || p.ability || undefined;
  const gender = asGender(p.gender);

  const facts: LiveFacts = {
    speciesForme: p.speciesForme,
    ...(liveForme ? {liveForme} : {}),
    ...(liveTypes ? {liveTypes} : {}),
    ...(roosting ? {roosting: true} : {}),
    level: p.level,
    hpPercent: p.maxhp > 0 ? p.hp / p.maxhp : 1,
    boosts,
    terastallized: Boolean(p.terastallized),
    revealedMoves,
    landedDamagingHit: signals.landedDamagingHit ?? false,
    tookEntryHazardDamage: signals.tookEntryHazardDamage ?? false,
    switchedIntoStealthRockUnharmed: signals.switchedIntoStealthRockUnharmed ?? false,
    usedDifferentMovesSinceSwitchIn: signals.usedDifferentMovesSinceSwitchIn ?? false,
    switchedInWithoutAnnouncingBalloon: signals.switchedInWithoutAnnouncingBalloon ?? false,
    endedTurnUnstatused: signals.endedTurnUnstatused ?? false,
    proteanAlreadyFired: signals.proteanAlreadyFired ?? false,
    timesAttacked: signals.timesAttacked ?? 0,
    ...(asStatus(p.status) ? {status: asStatus(p.status)!} : {}),
    ...(p.terastallized ? {teraType: p.terastallized} : {}),
    ...(ability ? {ability} : {}),
    ...(baseAbility ? {baseAbility} : {}),
    ...(p.item ? {item: p.item} : {}),
    ...(p.prevItem ? {prevItem: p.prevItem} : {}),
    ...(gender ? {gender} : {}),
    ...(speciesData ? {speciesData} : {}),
    ...(live['accuracy'] ? {accuracyBoost: live['accuracy']} : {}),
    ...(live['evasion'] ? {evasionBoost: live['evasion']} : {}),
    // `shedTailMaker` deliberately does not come along: LiveFacts names no other Pokémon by
    // ident, and turning that ident into the max HP it stands for takes the feed. The shell
    // (`section.factsReader`) resolves it and overlays `sizedOnMaxHP`, exactly as it does for
    // a Transform target. Everything reachable without the feed is already correct here.
    ...(signals.substitute ? {substitute: {dented: signals.substitute.dented}} : {}),
  };
  return facts;
}

/** A protocol/client ident ("p1a: Noivern", "p1: Noivern") reduced to a slot-independent
 *  "side|name" key, so a log line's actor matches a client Pokémon across switches. */
function identKey(ident: string | undefined): string | undefined {
  if (!ident) return undefined;
  const colon = ident.indexOf(':');
  if (colon < 0) return undefined;
  const side = ident.slice(0, colon).trim().slice(0, 2); // "p1a" | "p1" → "p1"
  const name = ident.slice(colon + 1).trim().toLowerCase();
  return side && name ? `${side}|${name}` : undefined;
}

/**
 * Does this log line show the current mover dealing damage to someone OTHER than
 * itself — the event that reveals a held Life Orb via recoil? Three shapes count:
 *   - `-damage` on the target with no `[from]` tag (a bare `[from]` marks
 *     item/hazard/status/recoil damage, not the move's own — Life Orb's own recoil,
 *     `[from] item: Life Orb` on the user, is excluded on both the tag and the "not
 *     me" test, since it's handled by the positive item-reveal path instead);
 *   - a Substitute BREAKING (`-end … Substitute`); or
 *   - a Substitute ABSORBING the hit (`-activate … move: Substitute|[damage]`).
 * The Substitute cases matter because the sub takes the damage in the Pokémon's place,
 * so the foe's own HP bar never moves — yet the move still dealt damage. The `[damage]`
 * tag is what separates a dented sub from a status move the sub merely BLOCKED (no
 * damage, no tag). Sub hits count only in Gen 5+, as Gen 4 took no Life Orb recoil
 * against a substitute.
 */
function dealtDamageToFoe(line: string, me: string, subCountsAsHit: boolean): boolean {
  const parts = line.split('|'); // ['', TAG, 'p2a: Foo', …]
  const target = identKey(parts[2]);
  if (!target || target === me) return false;
  if (parts[1] === '-damage') return !parts.slice(4).some((p) => p.startsWith('[from]'));
  if (!subCountsAsHit) return false;
  const isSub = parts.some((p) => p === 'Substitute' || p === 'move: Substitute');
  if (parts[1] === '-end') return isSub; // a substitute only ends by being broken with damage
  if (parts[1] === '-activate') return isSub && parts.includes('[damage]');
  return false;
}

/**
 * Has `mon` landed a damaging hit — a move it used dealing damage to another Pokémon?
 * That hit is exactly the event that reveals a held Life Orb (1/10 recoil), so its
 * ABSENCE, with the item still unrevealed, is what rules Life Orb out. We can't see it
 * in a snapshot (`moveTrack` records that a move was USED, not that it landed — a miss
 * or an immunity leaves no trace there), so we read the protocol log, tracking the
 * current mover and asking `dealtDamageToFoe` of each following line. An unknown ident
 * or an empty log resolves to "no hit seen" — we would rather miss a rule-out than make
 * a false one.
 */
export function hasLandedDamagingHit(battle: ClientBattle, mon: ClientPokemon): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  const subCountsAsHit = (battle.gen || 9) >= 5;
  let moverIsMe = false;
  for (const line of battle.stepQueue ?? []) {
    if (line.startsWith('|move|')) {
      moverIsMe = identKey(line.split('|')[2]) === me;
    } else if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|turn|')) {
      moverIsMe = false; // a new actor context — don't let a later line borrow our move
    } else if (moverIsMe && dealtDamageToFoe(line, me, subCountsAsHit)) {
      return true;
    }
  }
  return false;
}

/**
 * How many times has `mon` been hit by another Pokémon's move — RAGE FIST's power scales
 * with exactly this count (`min(350, 50 + 50×timesAttacked)`, the sim's own
 * `pokemon.timesAttacked`), and it persists across switches (the sim never resets it), so
 * this is a running total over the WHOLE battle, not just the mon's current stint.
 *
 * Reads the log the mirror-image way from `hasLandedDamagingHit`: instead of "did the
 * mover deal damage", "did a bare `-damage` land on ME while someone ELSE was moving".
 * A multi-hit move emits one `-damage` line PER hit, so e.g. three Bullet Seed hits count
 * as three — matching the sim's own `target.timesAttacked += hit - 1`. A `[from]` tag
 * marks INDIRECT damage (status, hazard, recoil) and never counts, which is also what
 * excludes a Substitute-blocked hit for free: the sub absorbs it as `-activate`, not
 * `-damage`, on the real Pokémon, so no line ever matches. A self-inflicted hit
 * (confusion) is excluded because its mover IS `mon` — the sim's own increment carries
 * the same `pokemon !== target` guard.
 *
 * Takes just an `ident`, not a full `ClientPokemon` — a benched mon read from the private
 * `ServerPokemon` (`serverPokemonFacts`) carries one too, and the log itself is the only
 * source either shape needs.
 */
export function timesAttacked(battle: ClientBattle, mon: {readonly ident?: string}): number {
  const me = identKey(mon.ident);
  if (!me) return 0;
  let mover: string | null = null;
  let count = 0;
  for (const line of battle.stepQueue ?? []) {
    if (line.startsWith('|move|')) {
      mover = identKey(line.split('|')[2]) ?? null;
    } else if (line.startsWith('|switch|') || line.startsWith('|drag|') || line.startsWith('|turn|')) {
      mover = null; // a new actor context — don't let a later line borrow the last move
    } else if (line.startsWith('|-damage|') && mover !== null && mover !== me) {
      const parts = line.split('|');
      if (identKey(parts[2]) === me && !parts.slice(4).some((p) => p.startsWith('[from]'))) count++;
    }
  }
  return count;
}

// Entry hazards that deal switch-in damage — the only ones Heavy-Duty Boots negates and
// thus the only ones whose damage rules Boots out. (Toxic Spikes/Sticky Web don't damage.)
const DAMAGING_HAZARDS = ['Stealth Rock', 'Spikes', 'G-Max Steelsurge'];

/**
 * Has `mon` taken entry-hazard damage? Heavy-Duty Boots would have negated it, so a "yes"
 * rules Boots out (see deductions.ts). Read from the log: a `-damage` on this mon tagged
 * `[from] <hazard>` — e.g. "|-damage|p2a: Haxorus|214/244|[from] Stealth Rock".
 */
export function tookEntryHazardDamage(battle: ClientBattle, mon: ClientPokemon): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  for (const line of battle.stepQueue ?? []) {
    if (!line.startsWith('|-damage|')) continue;
    const parts = line.split('|');
    if (identKey(parts[2]) !== me) continue;
    if (parts.some((p) => DAMAGING_HAZARDS.some((h) => p === `[from] ${h}`))) return true;
  }
  return false;
}

/** The side an ident belongs to ("p1a: X" | "p1: user" → "p1"). */
function sideOf(ident: string | undefined): string {
  return (ident ?? '').slice(0, 2);
}

/** A `-sidestart`/`-sideend` line naming Stealth Rock ("move: Stealth Rock" on start,
 *  "Stealth Rock" on end). */
function isStealthRockSide(parts: readonly string[]): boolean {
  return parts.some((p) => p === 'Stealth Rock' || p === 'move: Stealth Rock');
}

/**
 * Did `mon` switch in while Stealth Rock was set on its OWN side, yet take no Stealth Rock
 * damage? That confirms Heavy-Duty Boots (once Magic Guard is excluded — see deductions.ts),
 * since nothing else lets a switch-in dodge Stealth Rock. Reads `stepQueue`: track the SR
 * side-condition, and on each of the mon's switch-ins into it, scan the switch-in resolution
 * (up to the next major action) for an SR `-damage` on the mon; its ABSENCE is the signal.
 */
export function switchedIntoStealthRockUnharmed(battle: ClientBattle, mon: ClientPokemon): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  const mySide = sideOf(mon.ident);
  const lines = battle.stepQueue ?? [];
  const srUp: Record<string, boolean> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const parts = line.split('|');
    if (line.startsWith('|-sidestart|') && isStealthRockSide(parts)) srUp[sideOf(parts[2])] = true;
    else if (line.startsWith('|-sideend|') && isStealthRockSide(parts)) srUp[sideOf(parts[2])] = false;
    else if ((line.startsWith('|switch|') || line.startsWith('|drag|')) && identKey(parts[2]) === me && srUp[mySide]) {
      let tookSr = false;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l === undefined || /^\|(switch|drag|move|turn|upkeep)\|/.test(l)) break; // resolution done
        const p = l.split('|');
        if (l.startsWith('|-damage|') && identKey(p[2]) === me && p.some((x) => x === '[from] Stealth Rock')) {
          tookSr = true;
          break;
        }
      }
      if (!tookSr) return true; // came in through Stealth Rock unscathed
    }
  }
  return false;
}

/** A `-fieldstart`/`-fieldend` line naming Magic Room, which suspends every held item. */
function isMagicRoom(parts: readonly string[]): boolean {
  return parts.some((p) => p === 'move: Magic Room' || p === 'Magic Room');
}

/** A `-start`/`-end` line putting Embargo on, or taking it off, `me`. */
function isEmbargoOn(parts: readonly string[], me: string): boolean {
  return identKey(parts[2]) === me && parts.some((p) => p === 'Embargo' || p === 'move: Embargo');
}

/** A `-fieldstart`/`-fieldend` line naming Gravity, which grounds the field — so a held
 *  Air Balloon neither lifts its holder nor announces itself. */
function isGravity(parts: readonly string[]): boolean {
  return parts.some((p) => p === 'move: Gravity' || p === 'Gravity');
}

// A switch-in's resolution runs until the next of these. Deliberately NOT `switch`/`drag`:
// when both sides come in at once — every battle's opening — the sim resolves both switches
// and only THEN runs the switch-in effects, so the lead's `-item` announcement sits after
// its opponent's `|switch|` line. Stopping at a switch would go blind exactly at the moment
// a player most wants this answer.
const SWITCH_IN_RESOLUTION_END = new Set(['move', 'turn', 'upkeep']);

/** Did the switch-in starting at `lines[start]` finish without `me` announcing a balloon?
 *  Requires the resolution to have COMPLETED: a log that simply stops partway has not yet
 *  told us anything, and reading it as silence would invent a rule-out. */
function switchInWasSilent(lines: ReadonlyArray<string>, start: number, me: string): boolean {
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l === undefined) continue;
    const parts = l.split('|');
    const tag = parts[1] ?? '';
    if (SWITCH_IN_RESOLUTION_END.has(tag)) return true; // heard the whole thing; no balloon in it
    if (tag === '-item' && identKey(parts[2]) === me && toId(parts[3] ?? '') === 'airballoon') return false;
  }
  return false; // log ends mid-resolution: the announcement may simply not have arrived yet
}

/**
 * Did `mon` switch in without a held Air Balloon announcing itself? Air Balloon is the only
 * item in the sim that reveals itself on the way in — `onStart` emits `|-item|<mon>|Air
 * Balloon` — so a completed, silent switch-in rules it out (see deductions.ts). Every other
 * deduction here reads an item that never speaks; this one reads the one that always does.
 *
 * Silence only counts where the announcement was actually obliged, which is the sim's own
 * condition (`!target.ignoringItem() && !gravity`) minus the parts that belong elsewhere:
 *   - Gravity and Magic Room suppress it, and both can go up and come down mid-battle, so
 *     they are tracked HERE and a switch-in under either is skipped rather than believed.
 *   - Klutz suppresses it too, but it is an ABILITY, so it is judged downstream against the
 *     role's ability pool — the way Sheer Force guards the Life Orb rule.
 *   - Embargo, the remaining `ignoringItem()` case, cannot apply: it is a volatile, and
 *     volatiles clear on switch-out, so nothing is ever Embargoed as it switches in.
 * ONE silent switch-in is enough, and the rule never expires: the balloon announces itself
 * every single time its holder comes in, so a mon that was quiet once was quiet holding
 * something else.
 */
export function switchedInWithoutAnnouncingBalloon(battle: ClientBattle, mon: {readonly ident?: string}): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  const lines = battle.stepQueue ?? [];
  let gravity = false;
  let magicRoom = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    if (tag === '-fieldstart' || tag === '-fieldend') {
      const on = tag === '-fieldstart';
      if (isGravity(parts)) gravity = on;
      else if (isMagicRoom(parts)) magicRoom = on;
    } else if ((tag === 'switch' || tag === 'drag') && identKey(parts[2]) === me && !gravity && !magicRoom) {
      if (switchInWasSilent(lines, i, me)) return true;
    }
  }
  return false;
}

/**
 * Has Protean or Libero ALREADY converted this Pokémon during its current stint?
 *
 * Gen 9 fires them once per switch-in and not again — `sim/data/abilities.ts` guards on
 * `if (this.effectState.protean) return;` and `effectState` dies with the stint — where
 * gens 6-8 fired them on every move. @smogon/calc still models the older rule, granting
 * STAB to whatever move it is handed whenever the attacker has the ability, so this is
 * the fact that tells a correct assumption from a stale one: BEFORE it fires, the move
 * being hovered really will convert the user and really does get STAB; after, the types
 * are frozen and only a move matching them is boosted.
 *
 * Read from the log rather than from the presence of `typechange`, and the difference is
 * a real case rather than a scruple: Soak or Reflect Type can set that volatile on a
 * Protean holder whose own ability has NOT fired yet, and reading the volatile alone
 * would call the ability spent and quietly drop a STAB the next move genuinely gets. The
 * sim names the source on the line it emits — `|-start|<mon>|typechange|Ice|[from]
 * ability: Protean` — so the attribution is there to be read.
 *
 * Scoped to the current stint, like the Choice rule-out and for the same reason: the flag
 * resets on switch-out, so a Greninja that converted, pivoted and came back is unspent
 * again, and a scan over the whole log would say otherwise for the rest of the battle.
 */
export function proteanAlreadyFired(battle: ClientBattle, mon: {readonly ident?: string}): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  let fired = false;
  let mySlot: string | undefined;
  for (const line of battle.stepQueue ?? []) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    if (tag === 'switch' || tag === 'drag') {
      // Both directions end the stint, and the way OUT is the one with no line of its own:
      // the log never says a Pokémon left, only that somebody else arrived in its slot. Miss
      // that and the flag survives the switch it dies with, muting a genuine STAB for the
      // rest of the battle.
      if (identKey(parts[2]) === me) {
        fired = false;
        mySlot = slotKey(parts[2]);
      } else if (mySlot !== undefined && slotKey(parts[2]) === mySlot) {
        fired = false;
      }
    } else if (tag === '-start' && identKey(parts[2]) === me && parts[3] === 'typechange') {
      const from = toId(parts.find((part) => part.startsWith('[from]')) ?? '');
      if (from === 'fromabilityprotean' || from === 'fromabilitylibero') fired = true;
    }
  }
  return fired;
}

/** A `-fieldstart`/`-fieldend` line naming Misty Terrain, which blocks status outright. */
function isMistyTerrain(parts: readonly string[]): boolean {
  return parts.some((p) => p === 'move: Misty Terrain' || p === 'Misty Terrain');
}

/** The SLOT half of a protocol ident — "p1a: Gliscor" → "p1a". Kept whole, unlike
 *  `identKey`, because who is standing where is exactly a per-slot fact in doubles. */
function slotKey(ident: string | undefined): string | undefined {
  const colon = (ident ?? '').indexOf(':');
  const slot = colon > 0 ? ident!.slice(0, colon).trim() : '';
  return slot || undefined;
}

/** The status riding along in a `switch`/`drag` line's HP token — "239/239 tox" → "tox". */
function switchLineStatus(parts: readonly string[]): string {
  return (parts[4] ?? '').split(' ')[1] ?? '';
}

/**
 * Did `mon` finish a turn on the field carrying no status? Flame Orb and Toxic Orb inflict
 * one on their OWN holder at the end of every turn (`onResidualOrder: 28`, the sim's
 * `pokemon.trySetStatus(status, pokemon)`) and announce themselves doing it
 * (`|-status|<mon>|brn|[from] item: Flame Orb`), so a turn that ended with the holder clean
 * rules both orbs out — see deductions.ts. Like Air Balloon, this reads an item's SILENCE.
 *
 * `|upkeep|` is the marker, and it is the right one where `|turn|` is not: the sim emits it
 * only once the residuals have run. The opening `|switch|`es are followed straight by
 * `|turn|1` with no residual between them, and a fainted mon's replacement comes in AFTER
 * `|upkeep|` — keying on turn lines would credit both with a residual they never sat through.
 *
 * Every suppressor below leaves NO trace in the log — each was checked against the sim,
 * which reports them only as `|debug|` lines the client does not carry — so silence has to
 * be earned by tracking the conditions rather than by looking for a failure message:
 *   - a status ALREADY on the holder: `setStatus` returns early, and the `-fail` it can emit
 *     is gated on a MOVE's own `status` field, which an item has not got. Tracked along the
 *     log rather than read off the snapshot, because a status inflicted then cured leaves
 *     the snapshot clean while those turns proved nothing.
 *   - Misty Terrain, which blocks the status outright. Time-scoped, so it is tracked here
 *     alongside Magic Room and Embargo, the item-suspending pair
 *     `usedDifferentMovesSinceSwitchIn` already tracks. Applied as a blanket skip even
 *     though the sim blocks only GROUNDED targets: over-cautious costs a rule-out,
 *     under-cautious invents one.
 *   - the holder's own TYPE once Terastallized — Tera Fire cannot be burned, Tera Poison or
 *     Steel cannot be poisoned. Rather than model which orb a given Tera type defuses, the
 *     scan simply STOPS at the `|-terastallize|` line, keeping every quiet turn before it.
 * Klutz, the last `ignoringItem()` case, is an ABILITY and so is judged downstream against
 * the role's pool, the way Sheer Force guards the Life Orb rule. Safeguard is deliberately
 * NOT tracked: its `onSetStatus` interrupts only when `target !== source`, and an orb
 * statuses its own holder.
 *
 * ONE quiet turn is enough and the rule never expires, exactly as for the balloon: an orb
 * fires at the end of EVERY turn, so a holder that was ever quiet was holding something else.
 */
export function endedTurnUnstatused(battle: ClientBattle, mon: {readonly ident?: string}): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  const standing = new Map<string, string>(); // slot → who is in it
  let status = '';
  let mistyTerrain = false;
  let magicRoom = false;
  let embargo = false;
  for (const line of battle.stepQueue ?? []) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    const who = identKey(parts[2]);
    if (tag === '-terastallize' && who === me) break; // its types are no longer the set's
    else if (tag === '-fieldstart' || tag === '-fieldend') {
      const on = tag === '-fieldstart';
      if (isMistyTerrain(parts)) mistyTerrain = on;
      else if (isMagicRoom(parts)) magicRoom = on;
    } else if (tag === '-start' && isEmbargoOn(parts, me)) embargo = true;
    else if (tag === '-end' && isEmbargoOn(parts, me)) embargo = false;
    else if (tag === 'switch' || tag === 'drag') {
      const slot = slotKey(parts[2]);
      if (slot && who) standing.set(slot, who);
      if (who === me) {
        status = switchLineStatus(parts); // a returning mon can bring one back with it
        embargo = false; // volatiles clear on the way out, so a fresh stint starts clean
      }
    } else if (tag === 'faint') {
      const slot = slotKey(parts[2]);
      if (slot) standing.delete(slot);
    } else if (tag === '-status' && who === me) status = parts[3] ?? '';
    else if (tag === '-curestatus' && who === me) status = '';
    else if (tag === 'upkeep') {
      const onField = [...standing.values()].includes(me);
      if (onField && !status && !mistyTerrain && !magicRoom && !embargo) return true;
    }
  }
  return false;
}

/**
 * Did `mon` freely select two DIFFERENT moves during a single stint on the field? A Choice
 * item locks its holder into the first move it picks until it switches out, so a "yes"
 * rules Choice Band/Specs/Scarf out (see deductions.ts).
 *
 * The stint scoping is the whole rule, not a detail: the lock dies when the mon leaves the
 * field (its volatile clears, and the item's own `onStart` clears it again on the way back
 * in). So the tempting one-liner — `revealedMoves.length >= 2` — is WRONG, because revealed
 * moves accumulate across switches, and a mon that clicked Move A, switched out, came back
 * and clicked Move B was never once un-locked. Only two free selections between the same
 * pair of switch-ins prove anything.
 *
 * "Freely" is the other half, and each exclusion below is the sim's own condition rather
 * than an approximation of it (`data/conditions.ts` `choicelock`):
 *   - a `[from]` attribute is the protocol's spelling of the sim's `sourceEffect`, so it
 *     covers every CALLED move (Sleep Talk, Metronome, Dancer, a bounced or snatched move)
 *     and the continuation turns of a locked move (Outrage, Fly). The player chose the
 *     caller, never the callee, so only the caller's own line is evidence.
 *   - `[still]` means no animation played, which is exactly how the lock REJECTS a
 *     different selection: `onBeforeMove` emits the move line, tags it `[still]` and fails
 *     it. Counting that line would read the lock's own signature as proof of its absence.
 *   - Struggle is exempted by the sim by name (`move.id !== 'struggle'`) — a locked mon out
 *     of PP has nothing else it can do, so Struggling proves nothing.
 *   - Magic Room and Embargo make the holder `ignoringItem()`, which suspends the lock
 *     outright. Both are time-scoped, which is why they are tracked HERE rather than handed
 *     downstream as a flag: either can go up and come down inside one stint.
 * Klutz, the third `ignoringItem()` case, is an ABILITY and so is guarded downstream
 * against the role's ability pool, the way Sheer Force guards the Life Orb rule.
 */
export function usedDifferentMovesSinceSwitchIn(battle: ClientBattle, mon: {readonly ident?: string}): boolean {
  const me = identKey(mon.ident);
  if (!me) return false;
  let chosen: string | null = null; // the move that armed the lock this stint, if any
  let magicRoom = false;
  let embargo = false;
  for (const line of battle.stepQueue ?? []) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    if (tag === '-fieldstart' && isMagicRoom(parts)) magicRoom = true;
    else if (tag === '-fieldend' && isMagicRoom(parts)) magicRoom = false;
    else if (tag === '-start' && isEmbargoOn(parts, me)) embargo = true;
    else if (tag === '-end' && isEmbargoOn(parts, me)) embargo = false;
    else if ((tag === 'switch' || tag === 'drag') && identKey(parts[2]) === me) {
      chosen = null; // a fresh stint — whatever lock there was is gone, and so is Embargo
      embargo = false;
    } else if (tag === 'move' && identKey(parts[2]) === me) {
      const move = parts[3];
      if (!move || magicRoom || embargo || toId(move) === 'struggle') continue;
      if (parts.slice(4).some((a) => a.startsWith('[from]') || a === '[still]')) continue;
      if (chosen === null) chosen = move;
      else if (chosen !== move) return true;
    }
  }
  return false;
}

// Anything in this set, seen AFTER an otherwise-clean hit, means CURRENT field/boost/
// status/item/ability/forme facts no longer describe the state that hit happened under —
// comparing against them would be guessing, not reading, so `mostRecentCleanHit` treats
// the hit as stale rather than risk a false rule-out downstream (core/itemreveal.ts).
const STATE_CHANGING_TAGS = new Set([
  '-weather', '-fieldstart', '-fieldend',
  '-boost', '-unboost', '-setboost', '-swapboost',
  '-clearboost', '-clearallboost', '-clearpositiveboost', '-clearnegativeboost', '-invertboost',
  '-sidestart', '-sideend',
  '-status', '-curestatus', '-cureteam',
  '-ability', '-endability',
  '-terastallize', '-formechange', 'detailschange',
  '-item', '-enditem',
]);

/** "245/312 par" / "48/100" / "0 fnt" → the HP fraction, or undefined if unparseable. */
function hpToken(token: string | undefined): number | undefined {
  const [hpPart] = (token ?? '').split(' ');
  if (hpPart === '0') return 0;
  const m = /^(\d+)\/(\d+)$/.exec(hpPart ?? '');
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : undefined;
}

/**
 * The most recent CLEAN single hit `attacker` has landed on `defender` — "clean" meaning
 * its observed magnitude is safe to compare against a calculated damage range, the way
 * `core/itemreveal.ts` (the only consumer) reveals an item from the NUMBER a hit dealt
 * rather than from a side effect firing (compare `hasLandedDamagingHit`'s recoil check).
 * Four things make a hit unsafe to read, so each disqualifies it outright rather than let
 * a caller guess around it:
 *   - a MULTI-HIT move (`multiHitProfile`) — the shown number is a SUM of several rolls,
 *     not the one roll a range comparison needs;
 *   - a CRITICAL hit — a flat ×1.5 that has nothing to do with a held item;
 *   - a hit that KOed the target — the display clips at 0, so the true damage is only a
 *     LOWER bound, not the exact figure a range check needs;
 *   - anything in `STATE_CHANGING_TAGS` occurring AFTER the hit, on EITHER side — past
 *     that point, current field/boost/status/item/ability/forme facts no longer describe
 *     the state the hit happened under.
 * Returns undefined rather than a guess whenever nothing qualifies — we would rather miss
 * a rule-out than manufacture a false one.
 */
export function mostRecentCleanHit(
  battle: ClientBattle,
  attacker: {readonly ident?: string},
  defender: {readonly ident?: string},
): {readonly move: string; readonly damageFraction: number} | undefined {
  const atk = identKey(attacker.ident);
  const def = identKey(defender.ident);
  if (!atk || !def) return undefined;

  const hp: Record<string, number> = {};
  let mover: string | null = null;
  let moveName: string | null = null;
  let critTarget: string | null = null;
  let found: {move: string; damageFraction: number} | undefined;
  let stale = false;

  for (const line of battle.stepQueue ?? []) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';

    if (tag === 'move') {
      mover = identKey(parts[2]) ?? null;
      moveName = parts[3] ?? null;
    } else if (tag === 'switch' || tag === 'drag') {
      mover = null;
      moveName = null;
      const who = identKey(parts[2]);
      const frac = hpToken(parts[4]);
      if (who && frac !== undefined) hp[who] = frac;
    } else if (tag === 'turn') {
      mover = null;
      moveName = null;
    } else if (tag === '-crit') {
      critTarget = identKey(parts[2]) ?? null;
    } else if (tag === '-damage' || tag === '-heal' || tag === '-sethp') {
      const who = identKey(parts[2]);
      const frac = hpToken(parts[3]);
      const wasCrit = who !== null && who === critTarget;
      if (wasCrit) critTarget = null;
      if (tag === '-damage' && who === def && mover === atk && moveName && frac !== undefined) {
        const indirect = parts.slice(4).some((p) => p.startsWith('[from]'));
        const fainted = frac === 0;
        const multiHit = multiHitProfile(moveName) !== undefined;
        if (!indirect && !wasCrit && !fainted && !multiHit) {
          const before = hp[who] ?? 1;
          found = {move: moveName, damageFraction: Math.max(0, before - frac)};
          stale = false;
        }
      }
      if (who && frac !== undefined) hp[who] = frac;
    } else if (STATE_CHANGING_TAGS.has(tag)) {
      if (found) stale = true;
    }
  }
  return stale ? undefined : found;
}

/**
 * A `-boost`-family / `-sidestart`-family line that could move somebody's SPEED, judged by
 * what the line itself names. Every other tag in `STATE_CHANGING_TAGS` is treated as
 * speed-relevant wholesale (a status can be paralysis, an item can be a Scarf, a field can
 * be Trick Room); these two are singled out because the protocol says which stat and which
 * condition, and taking them wholesale would throw away most of a real battle. Stealth Rock
 * going up and an Attack drop are the common cases, and neither moves anybody's Speed.
 */
function affectsSpeed(tag: string, parts: readonly string[]): boolean {
  if (tag === '-boost' || tag === '-unboost' || tag === '-setboost') return parts[3] === 'spe';
  if (tag === '-sidestart' || tag === '-sideend') return parts.some((p) => p.endsWith('Tailwind'));
  // A volatile only matters here when it is one of the three that carry a Speed component.
  // `-start` is otherwise the commonest tag in the log (Substitute, confusion, Leech Seed).
  if (tag === '-start' || tag === '-end') {
    const what = toId(parts[3] ?? '');
    return what.startsWith('quarkdrive') || what.startsWith('protosynthesis') || what === 'slowstart';
  }
  return STATE_CHANGING_TAGS.has(tag);
}

/** Moves that hand somebody else's turn around, so the order they produce is not a speed
 *  fact about anybody. A turn containing one is discarded whole. */
const ORDER_BENDING_MOVES = new Set(['afteryou', 'quash', 'instruct']);

/** The client dex's record for one move, as the order law needs it — undefined when the dex
 *  is absent or the record is not the shape we read, so a caller abstains rather than
 *  assuming the 0 bracket. */
function readMoveOrder(battle: ClientBattle, name: string): OrderedMove | undefined {
  const record = battle.dex?.moves?.get(name);
  if (!record || typeof record.priority !== 'number') return undefined;
  const category = typeof record.category === 'string' ? record.category : '';
  const type = typeof record.type === 'string' ? record.type : '';
  if (!category || !type) return undefined;
  return {name, priority: record.priority, category, type, healing: record.flags?.['heal'] !== undefined};
}

/**
 * The most recent turn whose MOVE ORDER is safe to read as a fact about speed — the third
 * kind of item reveal, after "did a side effect fire" (`deductions.ts`) and "what number did
 * a hit deal" (`itemreveal.ts`). Who moved first is a fact about the pair, and our own speed
 * is exact, so it bounds theirs — which is what rules a Choice Scarf in or out.
 *
 * "Safe" is doing a great deal of work, and every condition below exists because getting it
 * wrong invents a rule-out rather than missing one:
 *   - BOTH must have used exactly one move that turn. A switch, a sleep, a flinch or a full
 *     paralysis produces no `|move|` line (or a `|cant|`), and a turn where only one side
 *     acted says nothing about the other.
 *   - Neither `|move|` may carry a `[from]`. A called move (Copycat, Dancer, Sleep Talk) is
 *     not the mon's own ordered action — the same convention the Choice rule-out reads.
 *   - Nothing may ACTIVATE in the turn. Quick Claw, Quick Draw and Custap Berry all announce
 *     themselves with `|-activate|`, and each hands its owner a priority bracket it did not
 *     earn. Rather than enumerate them, any activation at all disqualifies the turn: the
 *     cost is a few readable turns, and the alternative is a confidently wrong verdict.
 *   - No After You / Quash / Instruct anywhere in the turn.
 *   - Nothing speed-relevant may happen DURING the turn, because the order was decided
 *     before it and the speeds we compare against are read from the state now.
 *   - …nor SINCE, on either side, which is the same `stale` mechanism `mostRecentCleanHit`
 *     uses, narrowed to what actually moves a Speed stat (`affectsSpeed`).
 *   - Neither mon may have left the field since, or the observation is about somebody else.
 *
 * What it deliberately does NOT decide is what the order MEANS. Priority brackets, Trick
 * Room and the foe's own possible speeds all belong to `core/speedreveal.ts`, which judges
 * them per still-possible set — a Prankster variant explains moving first without being
 * fast, and only the layer that knows which variants exist can say so.
 */
export function mostRecentCleanOrder(
  battle: ClientBattle,
  ours: {readonly ident?: string},
  theirs: {readonly ident?: string},
): TurnOrder | undefined {
  const us = identKey(ours.ident);
  const them = identKey(theirs.ident);
  if (!us || !them) return undefined;

  let found: TurnOrder | undefined;
  let stale = false;
  // Per-turn accumulation: the moves each side made, and whether anything disqualified it.
  let moves: {who: string; move: string}[] = [];
  let spoiled = false;
  // Which slots the pair are standing in. Tracked because a Pokémon LEAVING the field has no
  // line of its own — the log only ever says somebody else arrived in its slot — so this is
  // the only way to notice that the observation's subject is gone.
  const slots = new Map<string, string>();

  const endTurn = (): void => {
    const ourMove = moves.find((m) => m.who === us);
    const theirMove = moves.find((m) => m.who === them);
    if (!spoiled && moves.length === 2 && ourMove && theirMove) {
      const ours = readMoveOrder(battle, ourMove.move);
      const theirs = readMoveOrder(battle, theirMove.move);
      // A move the dex cannot describe leaves the bracket unknown, and an unknown bracket
      // is not the 0 bracket — the turn goes unread rather than half-read.
      if (ours && theirs) {
        found = {ours, theirs, theyMovedFirst: moves[0]!.who === them};
        stale = false;
      }
    }
    moves = [];
    spoiled = false;
  };

  for (const line of battle.stepQueue ?? []) {
    const parts = line.split('|');
    const tag = parts[1] ?? '';
    const who = identKey(parts[2]);

    if (who === us || who === them) {
      const slot = slotKey(parts[2]);
      if (slot) slots.set(who, slot);
    }

    if (tag === 'turn') {
      endTurn();
    } else if (tag === 'move') {
      const move = parts[3] ?? '';
      if (ORDER_BENDING_MOVES.has(toId(move))) spoiled = true;
      const called = parts.slice(4).some((p) => p.startsWith('[from]'));
      if (who === us || who === them) {
        if (called) spoiled = true;
        else moves.push({who, move});
      }
    } else if (tag === 'cant') {
      if (who === us || who === them) spoiled = true;
    } else if (tag === 'switch' || tag === 'drag') {
      // Either of the pair leaving ends the observation's SUBJECT, not merely its turn — and
      // so does either of them arriving, which starts a fresh stint with fresh boosts.
      const slot = slotKey(parts[2]);
      const replacesOne = slot !== undefined && [...slots.values()].includes(slot);
      if (who === us || who === them || replacesOne) {
        found = undefined;
        stale = false;
      }
      spoiled = true;
    } else if (tag === '-activate') {
      spoiled = true; // Quick Claw, Quick Draw, Custap — an unearned bracket, always announced
    } else if (affectsSpeed(tag, parts)) {
      spoiled = true;
      if (found) stale = true;
    }
  }
  endTurn();
  return stale ? undefined : found;
}

/** Bundle the log-derived behaviours for one Pokémon, ready to hand to `toLiveFacts`. */
export function readBehaviors(battle: ClientBattle, mon: ClientPokemon): BehaviorSignals {
  const substitute = readSubstitute(battle, mon);
  return {
    landedDamagingHit: hasLandedDamagingHit(battle, mon),
    tookEntryHazardDamage: tookEntryHazardDamage(battle, mon),
    switchedIntoStealthRockUnharmed: switchedIntoStealthRockUnharmed(battle, mon),
    usedDifferentMovesSinceSwitchIn: usedDifferentMovesSinceSwitchIn(battle, mon),
    switchedInWithoutAnnouncingBalloon: switchedInWithoutAnnouncingBalloon(battle, mon),
    endedTurnUnstatused: endedTurnUnstatused(battle, mon),
    proteanAlreadyFired: proteanAlreadyFired(battle, mon),
    timesAttacked: timesAttacked(battle, mon),
    ...(substitute ? {substitute} : {}),
  };
}

/**
 * The viewer's OWN held item for `mon`, read from the private `battle.myPokemon` (absent
 * when spectating). Returned in the client's id form ("heavydutyboots"); the caller maps
 * it to a set's display name. This is the one place we read private team data — it feeds
 * only OUR-view surfaces (the player's own move damage, and our side of the speed-order
 * line), where a silent item like Heavy-Duty Boots or a Scarf we're holding is invisible
 * to the opponent so the public battle view can't supply it. It must never feed the
 * opponent's-knowledge views, which stay strictly public.
 */
export function readOwnItem(battle: ClientBattle, mon: ClientPokemon): string | undefined {
  return readOwnServerPokemon(battle, mon)?.item || undefined;
}

/**
 * The viewer's OWN CURRENT ability for `mon`, read from the private `battle.myPokemon`
 * (absent when spectating, or in gen ≤6 where the request never carries one). Returned in
 * the client's id form ("hugepower"); the caller maps it to a set's display name, same as
 * `readOwnItem`.
 *
 * The public battle-view Pokémon only learns an ability once something reveals it in the
 * log — even for our own active — so a SILENT ability (Huge Power, Levitate, Serene Grace,
 * Regenerator, …) is invisible to a damage calc that reads only the public field, until
 * something else happens to reveal it mid-battle. Same principle as `readOwnItem`: a
 * private fact, feeding only OUR-view surfaces, never the opponent's-knowledge views.
 *
 * This is the CURRENT effective ability (Trace/Mummy/Skill Swap included), matching what
 * the public `ability` field represents — not the innate one narrowing keys on. The
 * request reports it fresh each turn (`this.ability`, gen 7+), so it tracks a live
 * infection/suppression exactly as the public field eventually would, just earlier.
 */
export function readOwnAbility(battle: ClientBattle, mon: ClientPokemon): string | undefined {
  return readOwnServerPokemon(battle, mon)?.ability || undefined;
}

/**
 * `mon`'s entry in the viewer's private team view (absent when spectating, or when `mon`
 * isn't ours).
 *
 * An ACTIVE Pokémon is found by its SLOT: `battle.myPokemon[i]` is whoever really occupies
 * active slot `i`, which is how the client's own tooltips index it. Its `ident` names only
 * what the battle view SHOWS in that slot — and under Illusion those differ, because the
 * sim sends the disguise's details to the disguised Pokémon's OWN side too. Matching a
 * disguised Zoroark on ident finds the teammate it is imitating, and every private read
 * (item, Tera type, moveset, stats) then answers for the wrong Pokémon. A benched Pokémon
 * has no slot and can wear no disguise, so it matches on ident.
 */
export function readOwnServerPokemon(battle: ClientBattle, mon: ClientPokemon): ClientServerPokemon | undefined {
  const team = battle.myPokemon;
  if (!team) return undefined;
  const side = mon.side;
  // The slot index is only ours to read on our own side; a foe's slot 0 is not our slot 0.
  if (side && side === nearSide(battle)) {
    const slot = side.active.indexOf(mon);
    if (slot >= 0) return team[slot];
  }
  const me = identKey(mon.ident);
  if (!me) return undefined;
  return team.find((p) => identKey(p.ident) === me);
}

/** The viewer's own side — the one rendered at the bottom of the screen. */
export function nearSide(battle: ClientBattle): ClientSide | undefined {
  return battle.sides.find((s) => s.isFar === false) ?? battle.sides[0];
}

/**
 * The viewer's OWN Tera type for `mon`, read from the private team — the client keeps
 * `teraType` set whether or not the Tera has been used, so this is what the pending
 * Terastallize WOULD activate. Same principle as `readOwnItem`: a private fact, feeding
 * only OUR-view surfaces (the move tooltip's selected-Tera preview), never the
 * opponent's-knowledge views. Undefined when spectating.
 */
export function readOwnTeraType(battle: ClientBattle, mon: ClientPokemon): string | undefined {
  return readOwnServerPokemon(battle, mon)?.teraType || undefined;
}

/**
 * The viewer's OWN full moveset for `mon`, read from the private team, in the client's
 * id form ("dracometeor"). The battle view only tracks REVEALED moves (`moveTrack`), so
 * this is the one source that knows a benched Pokémon's whole kit. Same principle as
 * `readOwnItem`: a private fact, feeding only OUR-view surfaces (the own-hover "your
 * moves vs their active" damage), never the opponent's-knowledge views. Undefined when
 * spectating or when the private team doesn't know this Pokémon.
 */
export function readOwnMoves(battle: ClientBattle, mon: ClientPokemon): readonly string[] | undefined {
  const moves = readOwnServerPokemon(battle, mon)?.moves;
  return moves && moves.length > 0 ? moves : undefined;
}

/**
 * One Pokémon's exact final stats from its private `ServerPokemon`: the request's five
 * `stats` plus `maxhp` as the HP total. Whole-or-nothing — a partial table would make
 * the calc half-exact, which is worse than the assumed spread it replaces. Same
 * principle as `readOwnItem`: private truth, OUR-view surfaces only. Only open formats
 * consume it (a randbats spread is public knowledge and already exact).
 */
export function serverStats(p: ClientServerPokemon): FullStats | undefined {
  if (!p.stats || typeof p.maxhp !== 'number') return undefined;
  return asFullStats({hp: p.maxhp, atk: p.stats.atk, def: p.stats.def, spa: p.stats.spa, spd: p.stats.spd, spe: p.stats.spe});
}

/** `serverStats` for `mon`'s entry in the viewer's private team (absent when spectating). */
export function readOwnStats(battle: ClientBattle, mon: ClientPokemon): FullStats | undefined {
  const own = readOwnServerPokemon(battle, mon);
  return own ? serverStats(own) : undefined;
}

/** "Honchkrow, L86, F" → its parts. Level defaults upstream; extra tokens (shiny,
 *  tera:…) are ignored. */
function parseServerDetails(details: string | undefined): {speciesForme?: string; level?: number; gender?: 'M' | 'F'} {
  const parts = (details ?? '').split(',').map((s) => s.trim());
  const speciesForme = parts[0];
  let level: number | undefined;
  let gender: 'M' | 'F' | undefined;
  for (const part of parts.slice(1)) {
    if (/^L\d+$/.test(part)) level = Number(part.slice(1));
    else if (part === 'M' || part === 'F') gender = part;
  }
  return {...(speciesForme ? {speciesForme} : {}), ...(level !== undefined ? {level} : {}), ...(gender ? {gender} : {})};
}

/** "245/312 par" → HP fraction + status; "0 fnt" → 0. Unparseable → full HP (the
 *  native tooltip is already showing exact HP; ours only gates KO math). */
function parseServerCondition(condition: string | undefined): {hpPercent: number; status?: StatusName} {
  const [hpPart = '', statusPart = ''] = (condition ?? '').split(' ');
  if (statusPart === 'fnt' || hpPart === '0') return {hpPercent: 0};
  const m = /^(\d+)\/(\d+)$/.exec(hpPart);
  const hpPercent = m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 1;
  const status = asStatus(statusPart);
  return {hpPercent, ...(status ? {status} : {})};
}

/**
 * LiveFacts for one of the viewer's OWN Pokémon straight from its private
 * `ServerPokemon` — the switch menu's tooltip surface, where the client passes NO
 * battle-view Pokémon at all (its side lookup is commented out; a never-revealed
 * benched mon has none to look up). Prefers the client's parsed fields and falls back
 * to parsing `details`/`condition` itself. Undefined when even the species can't be
 * read — no section beats a wrong one. Boosts are empty by construction: a benched mon
 * has none, and the active's own surfaces pass the full battle-view Pokémon instead.
 * These facts are PRIVATE (real item/ability) — our-view surfaces only, never the
 * mirror. `battle` is optional (only the log gives `timesAttacked` a real count) so a
 * caller that hasn't got a battle handy still gets a well-formed `LiveFacts`, just with
 * that count at its default 0 — the same graceful-absence rule every other log-derived
 * signal here already follows.
 */
export function serverPokemonFacts(p: ClientServerPokemon, battle?: ClientBattle): LiveFacts | undefined {
  const parsed = parseServerDetails(p.details);
  const speciesForme = p.speciesForme || parsed.speciesForme;
  if (!speciesForme) return undefined;
  const condition = parseServerCondition(p.condition);
  const hpPercent = typeof p.hp === 'number' && typeof p.maxhp === 'number' && p.maxhp > 0
    ? p.hp / p.maxhp
    : condition.hpPercent;
  const status = asStatus(p.status ?? '') ?? condition.status;
  const gender = asGender(p.gender) ?? parsed.gender;
  const ability = p.ability || p.baseAbility || undefined;
  const baseAbility = p.baseAbility || p.ability || undefined;
  return {
    speciesForme,
    level: p.level ?? parsed.level ?? 100,
    hpPercent,
    boosts: {},
    terastallized: Boolean(p.terastallized),
    revealedMoves: [],
    landedDamagingHit: false,
    tookEntryHazardDamage: false,
    switchedIntoStealthRockUnharmed: false,
    usedDifferentMovesSinceSwitchIn: battle ? usedDifferentMovesSinceSwitchIn(battle, {ident: p.ident}) : false,
    // Our own item comes straight off the private entry below, so no behavioural deduction
    // about it could ever speak — the same reason the Boots signals are hard-coded here.
    switchedInWithoutAnnouncingBalloon: false,
    endedTurnUnstatused: false,
    // A switch CANDIDATE is off the field, and Protean's once-per-stint flag dies there —
    // so whatever it converted into last time it was out, it comes back in unspent.
    proteanAlreadyFired: false,
    timesAttacked: battle ? timesAttacked(battle, {ident: p.ident}) : 0,
    ...(status ? {status} : {}),
    ...(p.terastallized ? {teraType: p.terastallized} : {}),
    ...(ability ? {ability} : {}),
    ...(baseAbility ? {baseAbility} : {}),
    ...(p.item ? {item: p.item} : {}),
    ...(gender ? {gender} : {}),
  };
}

/** The one DOM shape `readTeraToggled` needs — `document` satisfies it structurally,
 *  and a stub can stand in under test. */
export interface ToggleDocument {
  getElementById(id: string): {querySelector(selectors: string): unknown} | null;
  querySelector(selectors: string): unknown;
}

// A move-panel gimmick checkbox lives ONLY in the DOM in both clients (the production
// client reads it with jQuery at choice time; the preact client tracks it in component
// state, still rendered as a checked input) — so the DOM is the one honest source. Each
// gimmick has a production name and a preact name. A client rename here can't be caught
// by drift-check (a spectator replay has no move controls) — verify by hand in a live
// game (`npm run player-check`) after a client update.
const TERA_TOGGLE_SELECTOR = 'input[name=terastallize], input[name=tera]';
const MEGA_TOGGLE_SELECTOR = 'input[name=megaevo], input[name=mega]';

/**
 * Is `selector`'s checkbox ticked in this battle's move panel? Scoped to the battle's own
 * room element (`#room-<roomid>`) so a second battle's checked box never leaks in; falls
 * back to a document-wide read only when the room element can't be found (the preact
 * client). False whenever the checkbox doesn't exist — the gimmick's already been used,
 * can't be used, or it isn't our turn to choose.
 */
function readToggle(battle: ClientBattle, doc: ToggleDocument, selector: string): boolean {
  const room = battle.roomid ? doc.getElementById(`room-${battle.roomid}`) : null;
  const box = (room ?? doc).querySelector(selector);
  return (box as {checked?: unknown} | null)?.checked === true;
}

/** Is the Terastallize checkbox ticked? — the move tooltip previews the pending Tera. */
export function readTeraToggled(battle: ClientBattle, doc: ToggleDocument): boolean {
  return readToggle(battle, doc, TERA_TOGGLE_SELECTOR);
}

/** Is the Mega Evolution checkbox ticked? — our surfaces preview the pending Mega forme
 *  (its stats/ability/type in damage; its Speed in the ⚡ verdict, gen 7+ only). */
export function readMegaToggled(battle: ClientBattle, doc: ToggleDocument): boolean {
  return readToggle(battle, doc, MEGA_TOGGLE_SELECTOR);
}

/**
 * The Mega forme our `mon` evolves into this turn, if it's holding the stone for one —
 * the private-item read (`readOwnItem`) turned into a forme through the client dex's
 * `megaStone` map, exactly as the client's own tooltip resolves it. Returns the forme's
 * name plus the dex data the calc needs (base stats/types for a forme it doesn't know —
 * a Champions-invented Mega — and the forme-locked ability). Undefined when the mon holds
 * no stone, the dex can't resolve the forme, or it has ALREADY Mega Evolved (its live
 * forme already carries the "-Mega" suffix, so there's nothing to preview).
 */
export function readMegaForme(
  battle: ClientBattle,
  mon: ClientPokemon,
): {speciesForme: string; speciesData?: SpeciesData; ability?: string} | undefined {
  if (isMegaForme(mon.speciesForme)) return undefined;
  const stoneId = readOwnItem(battle, mon);
  const megaStone = stoneId ? battle.dex?.items?.get(stoneId)?.megaStone : undefined;
  if (!megaStone) return undefined;
  // The client keys the map by `species.name`; fall back to the sole value when a
  // forme-specific base (Floette-Eternal → Floettite) keys it under a name we don't hold.
  const values = Object.values(megaStone);
  const speciesForme = megaStone[mon.speciesForme] ?? (values.length === 1 ? values[0] : undefined);
  if (!speciesForme) return undefined;
  const speciesData = readSpeciesData(battle, {speciesForme});
  return {
    speciesForme,
    ...(speciesData ? {speciesData} : {}),
    ...(speciesData?.abilities?.[0] ? {ability: speciesData.abilities[0]} : {}),
  };
}

/** Every active Pokémon on a side other than `side` — one in singles, both foes in
 *  doubles. Side-keyed so surfaces with no battle-view Pokémon (the switch menu's
 *  ServerPokemon) can still find their targets. */
export function activesOpposing(battle: ClientBattle, side: ClientSide | undefined): ClientPokemon[] {
  const out: ClientPokemon[] = [];
  for (const s of battle.sides) {
    if (s === side) continue;
    for (const mon of s.active) if (mon) out.push(mon);
  }
  return out;
}

/** Every active Pokémon on a side other than the hovered Pokémon's own — one in singles,
 *  both foes in doubles. The move tooltip shows damage into each. */
export function findOpposingActives(battle: ClientBattle, hovered: ClientPokemon): ClientPokemon[] {
  return activesOpposing(battle, hovered.side);
}

/** The first opposing active — the single defender for the sets-view threat calc. */
export function findOpposingActive(battle: ClientBattle, hovered: ClientPokemon): ClientPokemon | null {
  return findOpposingActives(battle, hovered)[0] ?? null;
}

/**
 * What kind of battle this is, as a discriminated union the section layer switches on
 * exhaustively. `randbats` carries the feed id ("gen9randombattle") — the set-inference
 * surfaces exist only there; `open` is every other format (OU, VGC, Custom Game), where
 * the foe's set is assumed, not enumerated. Null only when the battle carries no tier
 * yet. `doubles` drives the calc's game type (spread moves take a 0.75× hit) and
 * showing damage into both foes; an open format has no id to sniff it from, so it reads
 * the client's `gameType`.
 */
export type BattleFormat =
  | {readonly kind: 'randbats'; readonly gen: number; readonly formatId: string; readonly doubles: boolean}
  | {readonly kind: 'open'; readonly gen: number; readonly doubles: boolean};

export function detectFormat(battle: ClientBattle): BattleFormat | null {
  const tier = battle.tier || '';
  if (!tier) return null;
  const gen = battle.gen || 9;
  if (!/random/i.test(tier)) return {kind: 'open', gen, doubles: battle.gameType === 'doubles'};
  // Derive the id the way PS itself does: toID over the whole title, digits kept.
  // Pattern-matching only a "[Gen 9]" prefix broke tags with extra words —
  // "[Gen 9 Champions] Random Battle" must become "gen9championsrandombattle".
  // Parenthesised qualifiers like "(Blitz)" share the base format's sets, so they
  // are dropped before the id is formed.
  const name = tier
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  if (!name) return null;
  const formatId = name.startsWith('gen') ? name : `gen${gen}${name}`;
  return {kind: 'randbats', gen, formatId, doubles: formatId.includes('doubles')};
}

function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Client weather/terrain ids → @smogon/calc names.
const WEATHER_BY_ID: Readonly<Record<string, WeatherName>> = {
  sunnyday: 'Sun',
  raindance: 'Rain',
  sandstorm: 'Sand',
  hail: 'Hail',
  snow: 'Snow',
  snowscape: 'Snow',
  desolateland: 'Harsh Sunshine',
  primordialsea: 'Heavy Rain',
  deltastream: 'Strong Winds',
};
const TERRAIN_BY_ID: Readonly<Record<string, TerrainName>> = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};

/** Is the side condition with this id ("tailwind", "reflect", …) active on `side`? */
function hasSideCondition(side: ClientSide | undefined, id: string): boolean {
  return Boolean(side?.sideConditions?.[id]);
}

/** The entry hazards up on `side` — what a mon switching INTO it would trigger. Read
 *  only where a switch-in is actually being previewed (see `core/hazards.ts`); every
 *  other damage read deliberately ignores hazards. `sideConditions`' values are really
 *  `unknown` (the client ships no types), so the layer count is narrowed defensively
 *  rather than trusted as a tuple — malformed data falls back to 0 layers, never a
 *  false hazard. */
export function readOwnHazards(side: ClientSide | undefined): OwnSideHazards {
  const spikes = side?.sideConditions?.['spikes'];
  const layer = Array.isArray(spikes) && typeof spikes[1] === 'number' ? spikes[1] : 0;
  return {
    stealthRock: hasSideCondition(side, 'stealthrock'),
    spikesLayers: Math.max(0, Math.min(3, Math.round(layer))),
  };
}

/**
 * Read the field conditions that change damage or move order: weather, terrain,
 * the screens on the DEFENDER's side, Trick Room, and each side's Tailwind (the
 * attacker's side is whichever one isn't the defender's — battles have two sides).
 * (Hazards are intentionally excluded — they affect switch-in HP, not a move's
 * damage, and we already read live HP.)
 */
export function readFieldFacts(battle: ClientBattle, defenderSide: ClientSide | undefined): FieldFacts {
  const weather = WEATHER_BY_ID[toId(battle.weather ?? '')];

  let terrain: TerrainName | undefined;
  let trickRoom = false;
  for (const entry of battle.pseudoWeather ?? []) {
    const id = toId(entry[0]);
    const match = TERRAIN_BY_ID[id];
    if (match) terrain = match;
    if (id === 'trickroom') trickRoom = true;
  }

  const has = (id: string): boolean => hasSideCondition(defenderSide, id);
  const attackerSide = defenderSide ? battle.sides.find((s) => s !== defenderSide) : undefined;

  return {
    ...(weather ? {weather} : {}),
    ...(terrain ? {terrain} : {}),
    defenderScreens: {
      reflect: has('reflect'),
      lightScreen: has('lightscreen'),
      auroraVeil: has('auroraveil'),
    },
    ...(trickRoom ? {trickRoom} : {}),
    ...(hasSideCondition(attackerSide, 'tailwind') ? {attackerTailwind: true} : {}),
    ...(has('tailwind') ? {defenderTailwind: true} : {}),
  };
}
