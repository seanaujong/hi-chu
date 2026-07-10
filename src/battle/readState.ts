// Read the Pokémon Showdown client's live battle objects into our own typed
// LiveFacts. The `ClientPokemon`/`ClientBattle`/`ClientSide` interfaces are a
// minimal structural view of the client's classes (which ship no types we can
// import) — only the fields we actually read, named as the client names them.
//
// `toLiveFacts` is pure and unit-tested with a stub; the navigation helpers are
// thin and defensive (the client's shape can shift between releases).

import type {FieldFacts, FullStats, LiveFacts, SpeciesData, StatID, StatusName, TerrainName, WeatherName} from '../core/types.js';

export interface ClientPokemon {
  readonly speciesForme: string;
  readonly level: number;
  readonly hp: number;
  readonly maxhp: number;
  readonly status: string; // '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | '???'
  readonly boosts: Readonly<Record<string, number>>;
  readonly terastallized: string; // '' when not terastallized, else the Tera type
  readonly ability?: string;
  readonly baseAbility?: string;
  readonly item?: string;
  /** A revealed item the Pokémon no longer holds (consumed berry, knocked-off orb). */
  readonly prevItem?: string;
  readonly moveTrack?: ReadonlyArray<readonly [string, unknown]>;
  readonly gender?: string;
  readonly side?: ClientSide;
  /** Side+name identity, e.g. "p1: Noivern" — matches the protocol log's actor tags
   *  (slot-independent, so a mid-battle switch doesn't misattribute a slot). */
  readonly ident?: string;
}

export interface ClientSide {
  readonly active: ReadonlyArray<ClientPokemon | null>;
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

export function toLiveFacts(p: ClientPokemon, signals: BehaviorSignals = {}, speciesData?: SpeciesData): LiveFacts {
  // moveTrack entries are [name, pp]; a leading "*" marks a transformed/mimicked move.
  const revealedMoves = (p.moveTrack ?? [])
    .map(([name]) => name.replace(/^\*/, ''))
    .filter((name) => name.length > 0);

  const boosts: Partial<Record<StatID, number>> = {};
  for (const stat of BOOSTABLE) {
    const v = p.boosts[stat];
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
    level: p.level,
    hpPercent: p.maxhp > 0 ? p.hp / p.maxhp : 1,
    boosts,
    terastallized: Boolean(p.terastallized),
    revealedMoves,
    landedDamagingHit: signals.landedDamagingHit ?? false,
    tookEntryHazardDamage: signals.tookEntryHazardDamage ?? false,
    switchedIntoStealthRockUnharmed: signals.switchedIntoStealthRockUnharmed ?? false,
    ...(asStatus(p.status) ? {status: asStatus(p.status)!} : {}),
    ...(p.terastallized ? {teraType: p.terastallized} : {}),
    ...(ability ? {ability} : {}),
    ...(baseAbility ? {baseAbility} : {}),
    ...(p.item ? {item: p.item} : {}),
    ...(p.prevItem ? {prevItem: p.prevItem} : {}),
    ...(gender ? {gender} : {}),
    ...(speciesData ? {speciesData} : {}),
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

/** Bundle the log-derived behaviours for one Pokémon, ready to hand to `toLiveFacts`. */
export function readBehaviors(battle: ClientBattle, mon: ClientPokemon): BehaviorSignals {
  return {
    landedDamagingHit: hasLandedDamagingHit(battle, mon),
    tookEntryHazardDamage: tookEntryHazardDamage(battle, mon),
    switchedIntoStealthRockUnharmed: switchedIntoStealthRockUnharmed(battle, mon),
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
  return ownServerPokemon(battle, mon)?.item || undefined;
}

/** `mon`'s entry in the viewer's private team view (absent when spectating). */
function ownServerPokemon(battle: ClientBattle, mon: ClientPokemon): ClientServerPokemon | undefined {
  const me = identKey(mon.ident);
  if (!me) return undefined;
  return (battle.myPokemon ?? []).find((p) => identKey(p.ident) === me);
}

/**
 * The viewer's OWN Tera type for `mon`, read from the private team — the client keeps
 * `teraType` set whether or not the Tera has been used, so this is what the pending
 * Terastallize WOULD activate. Same principle as `readOwnItem`: a private fact, feeding
 * only OUR-view surfaces (the move tooltip's selected-Tera preview), never the
 * opponent's-knowledge views. Undefined when spectating.
 */
export function readOwnTeraType(battle: ClientBattle, mon: ClientPokemon): string | undefined {
  return ownServerPokemon(battle, mon)?.teraType || undefined;
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
  const moves = ownServerPokemon(battle, mon)?.moves;
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
  const own = ownServerPokemon(battle, mon);
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
 * mirror.
 */
export function serverPokemonFacts(p: ClientServerPokemon): LiveFacts | undefined {
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

// The move panel's Terastallize checkbox: `name=terastallize` in the production client,
// `name=tera` in the preact client. Neither stores the toggle anywhere but the DOM (the
// production client reads the checkbox with jQuery at choice time), so the DOM is the
// one honest source. A client rename here can't be caught by drift-check (a spectator
// replay has no move controls) — verify by hand in a live game after a client update.
const TERA_TOGGLE_SELECTOR = 'input[name=terastallize], input[name=tera]';

/**
 * Is the Terastallize checkbox ticked in this battle's move panel? Scoped to the
 * battle's own room element (`#room-<roomid>`) so a second battle's checked box never
 * leaks in; falls back to a document-wide read only when the room element can't be
 * found (the preact client). False whenever the checkbox doesn't exist — already
 * terastallized, can't Tera, not our turn to choose.
 */
export function readTeraToggled(battle: ClientBattle, doc: ToggleDocument): boolean {
  const room = battle.roomid ? doc.getElementById(`room-${battle.roomid}`) : null;
  const box = (room ?? doc).querySelector(TERA_TOGGLE_SELECTOR);
  return (box as {checked?: unknown} | null)?.checked === true;
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
