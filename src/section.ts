// The shell's orchestration, made pure and testable: given the live battle, the
// hovered thing, and the randbats data for the format, fold
//   read → infer/resolve → calc → render
// into tooltip section HTML. No DOM, no cache, no network — content.ts owns that
// plumbing and hands the cached data in. Keeping this pure is what lets the
// real-battle fixture test (section.test.ts) drive the exact code path a live hover
// runs, instead of a copy that can drift from it.
//
// Two entry points, one per tooltip we augment:
//   buildMoveSection    — a move-button hover: that move's damage vs the opposing active.
//   buildPokemonSection — a Pokémon hover: the still-possible sets (narrowed by reveals),
//     with damage numbers attached when the hovered mon is the opponent's.

import {calcDamage, moveCategory, painSplit, type DamageReport} from './core/damage.js';
import {resolveByRole, resolveMon, resolveVariants} from './core/resolve.js';
import {assumeDefenderVariants, type MoveSlant} from './core/assume.js';
import {inferSets} from './core/knowledge.js';
import {bucketByDamage, type DamageBucket} from './core/variants.js';
import {compareSpeed, finalSpeed, speedBuckets, type SpeedOrder} from './core/speed.js';
import {illusionSuspects, ILLUSION_SPECIES, type IllusionSuspect} from './core/illusion.js';
import {
  renderMoveSection,
  renderNotes,
  renderOwnMovesSection,
  renderPainSplit,
  renderSetsSection,
  renderSpeedSection,
  type CandidateBlock,
  type MoveKnowledgeRow,
  type SetsRenderModel,
  type SpeedLineModel,
} from './core/render.js';
import type {
  CandidateSet,
  FieldFacts,
  LiveFacts,
  RandbatsData,
  RandbatsEntry,
  ResolvedMon,
  SetVariant,
} from './core/types.js';
import {pickEntry, megaEntryForItem} from './data/randbats.js';
import {
  toLiveFacts,
  readBehaviors,
  readOwnItem,
  readOwnMoves,
  readOwnServerPokemon,
  readOwnStats,
  readOwnTeraType,
  readSpeciesData,
  serverPokemonFacts,
  serverStats,
  activesOpposing,
  findOpposingActive,
  findOpposingActives,
  nearSide,
  detectFormat,
  readFieldFacts,
  type ClientBattle,
  type ClientPokemon,
  type ClientServerPokemon,
  type ClientSide,
} from './battle/readState.js';

/** The one honesty caveat an open-format tooltip carries — appended ONCE per tooltip
 *  (never per foe section), naming exactly what the numbers assume. */
const OPEN_FORMAT_NOTE = 'foe EVs/item assumed';

/**
 * The still-possible defending sets for one move, per foe — the seam the two format
 * kinds plug into. Randbats closes over the feed (every foe's variants are the same
 * whatever we throw at them); open formats bracket the spread on the axis THIS move
 * attacks, so the variants depend on the move's category.
 */
type DefenderVariantsFor = (defenderFacts: LiveFacts) => (moveName: string) => readonly SetVariant[];

/** Every still-possible set for a foe: the hidden item/ability fan-out, plus any
 *  disguised Zoroark the reveals betray. Move-independent — the same pool answers
 *  "how hard does it get hit" and "how fast is it". */
function randbatsFoeVariants(data: RandbatsData, facts: LiveFacts): readonly SetVariant[] {
  const entry = entryFor(data, facts);
  return [...resolveVariants(facts, entryOrMinimal(entry, facts)), ...illusionVariants(facts, entry, data)];
}

/** The feed-driven supplier: every still-possible set, identical for every move. */
function randbatsVariantsFor(data: RandbatsData): DefenderVariantsFor {
  return (facts) => {
    const variants = randbatsFoeVariants(data, facts);
    return () => variants;
  };
}

/**
 * The pool a foe's possible SPEEDS are read from, for the ⚡ line in the matchup
 * block. A separate seam from `DefenderVariantsFor` because speed is move-independent
 * and, crucially, because only a feed can supply it: `assume.ts` brackets a spread on
 * the axis a MOVE attacks, and no honest speed falls out of that. An open format
 * passes nothing here, so the ⚡ line is randbats-only by construction rather than by
 * an `if` inside the shared block builder.
 */
type FoeSpeedVariantsFor = (defenderFacts: LiveFacts) => readonly SetVariant[];

/** The assumption-driven supplier: bracketing spreads × dex abilities (assume.ts),
 *  chosen per move category. Status moves (Pain Split included) get none — with the
 *  foe's max HP itself assumed, there is no honest number to show. */
function openVariantsFor(gen: number): DefenderVariantsFor {
  return (facts) => {
    const bySlant = new Map<MoveSlant, SetVariant[]>();
    return (moveName) => {
      let category: ReturnType<typeof moveCategory>;
      try {
        category = moveCategory(gen, moveName);
      } catch {
        return []; // a move outside the calc's dex — no line beats a wrong one
      }
      if (category === 'Status') return [];
      let variants = bySlant.get(category);
      if (!variants) {
        variants = assumeDefenderVariants(facts, category);
        bySlant.set(category, variants);
      }
      return variants;
    };
  };
}

/** All of one Pokémon's live facts: the snapshot, the log-derived behaviours, and the
 *  client dex's species data (the calc's fallback for formes its own dex lacks). */
function factsFor(battle: ClientBattle, mon: ClientPokemon): LiveFacts {
  return toLiveFacts(mon, readBehaviors(battle, mon), readSpeciesData(battle, mon));
}

/** Showdown id form: lowercase, alphanumerics only ("Ice Punch" → "icepunch"). */
function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A defender entry when the feed doesn't cover it: facts only, default spread. */
function entryOrMinimal(entry: RandbatsEntry | undefined, facts: LiveFacts): RandbatsEntry {
  return entry ?? {level: facts.level, abilities: [], items: []};
}

/** The mon's set entry: the Mega set when it holds a Mega stone (it's running that set even
 *  before it evolves — see `megaEntryForItem`), otherwise the forme's own entry. */
function entryFor(data: RandbatsData, facts: LiveFacts): RandbatsEntry | undefined {
  return megaEntryForItem(data, facts.item) ?? pickEntry(data, facts.speciesForme);
}

/**
 * The viewer's OWN item for their active, as a display name the calc honours — read from
 * the private team and matched to `entry`'s item pool by id. Move buttons are always your
 * own Pokémon, and you know your item even when it's silent to the opponent (Heavy-Duty
 * Boots), so this makes your own damage exact instead of assuming the set's first item.
 * `undefined` when spectating, when nothing matches, or when the pool is unknown — in
 * which case the caller keeps the public-info behaviour. Matching by id is what bridges
 * the client's id form ("heavydutyboots") to the name @smogon/calc needs.
 */
function ownItemName(battle: ClientBattle, pokemon: ClientPokemon, entry: RandbatsEntry): string | undefined {
  const raw = readOwnItem(battle, pokemon);
  if (!raw) return undefined;
  const roleItems = entry.roles ? Object.values(entry.roles).flatMap((r) => r.items) : [];
  const pool = [...roleItems, ...(entry.items ?? [])];
  return pool.find((i) => toId(i) === toId(raw));
}

/**
 * Our own Pokémon as WE know it: its public battle state (HP, status, boosts, the live
 * ability a Trace may have changed, an active Tera) with the private team's IDENTITY
 * laid over it.
 *
 * Illusion is why this exists. The sim sends the disguise's details to the disguised
 * Pokémon's own side too, so our battle-view Zoroark really is a Noivern to the client:
 * wrong species, wrong base stats, wrong types, wrong level. Every calc we are the
 * SUBJECT of — our move's damage, the matchup view, our side of the ⚡ verdict, and the
 * foe's damage into us — has to run on the Pokémon that is really standing there. The
 * opponent's-knowledge views must NOT use this: the disguise is exactly what they see.
 *
 * The battle view is trusted whenever it agrees with the private team on the BASE
 * species, so a live forme change it knows about first (Aegislash-Blade, Mimikyu-Busted,
 * Terapagos-Terastal) still wins. Only a different Pokémon entirely — which nothing but
 * Illusion can produce — hands the decision to the private team.
 */
function ownTruth(battle: ClientBattle, mon: ClientPokemon, facts: LiveFacts): LiveFacts {
  const own = readOwnServerPokemon(battle, mon);
  const truth = own ? serverPokemonFacts(own) : undefined;
  if (!truth || baseSpecies(truth.speciesForme) === baseSpecies(facts.speciesForme)) return facts;
  // A different species means different dex data: the disguise's must not ride along.
  const {speciesData: _disguise, ...battleState} = facts;
  const speciesData = readSpeciesData(battle, truth);
  return {
    ...battleState,
    speciesForme: truth.speciesForme,
    level: truth.level,
    ...(truth.gender ? {gender: truth.gender} : {}),
    ...(speciesData ? {speciesData} : {}),
  };
}

/** "Zoroark-Hisui" → "Zoroark": the forme suffix dropped, so formes of one Pokémon compare equal. */
function baseSpecies(speciesForme: string): string {
  return toId(speciesForme.split('-')[0] ?? speciesForme);
}

/**
 * If a revealed move betrays that the defender might be a disguised Zoroark (see
 * illusion.ts), a resolution of that Zoroark as an extra defender — so the move tooltip
 * shows a second "vs Zoroark-Hisui" damage line rather than one confidently-wrong number.
 * One representative set per suspect (not the full item fan-out) keeps the extra line to
 * a single, clearly-labelled bucket. Its own species/level drive the calc.
 */
function illusionVariants(defenderFacts: LiveFacts, defenderEntry: RandbatsEntry | undefined, data: RandbatsData): SetVariant[] {
  // The suspect is a DIFFERENT species than shown, so the shown forme's dex data
  // (facts.speciesData) must not ride along into the Zoroark's resolution.
  const {speciesData: _shownFormes, ...publicFacts} = defenderFacts;
  return suspectsFor(defenderFacts, defenderEntry, data).map(({species, entry}) => ({
    mon: resolveMon({...publicFacts, speciesForme: species, level: entry.level}, entry),
    role: species,
  }));
}

/** The Zoroark species the hovered mon might secretly be, given the feed's entries. */
function suspectsFor(facts: LiveFacts, entry: RandbatsEntry | undefined, data: RandbatsData): IllusionSuspect[] {
  const impostors = ILLUSION_SPECIES
    .map((species): IllusionSuspect | null => {
      const e = pickEntry(data, species);
      return e ? {species, entry: e} : null;
    })
    .filter((x): x is IllusionSuspect => x !== null);
  return illusionSuspects(facts, entry, impostors);
}

/**
 * The ⚡ speed-order line(s) for a hovered FOE: one per our active (one in singles,
 * both in doubles), each judging OUR effective speed against the foe's distinct
 * possible speeds (Scarf and weather-ability sets split into "if …" asides; a
 * possible disguised Zoroark rides along as its own outcome). Our side of the pair
 * uses our REAL item — private facts may feed any our-view surface; the own-side
 * mirror never gets this line at all, so it stays strictly public.
 */
function speedSection(
  battle: ClientBattle,
  foeVariants: readonly SetVariant[],
  ourActives: readonly ClientPokemon[],
  data: RandbatsData,
  format: {gen: number},
): string {
  if (foeVariants.length === 0) return '';
  const lines = ourActives.map((our): SpeedLineModel => {
    const publicFacts = ownTruth(battle, our, factsFor(battle, our));
    const ourEntry = entryFor(data, publicFacts);
    const realItem = ourEntry ? ownItemName(battle, our, ourEntry) : undefined;
    const ourFacts = realItem ? {...publicFacts, item: realItem} : publicFacts;
    const ourMon = resolveMon(ourFacts, entryOrMinimal(ourEntry, ourFacts));
    // Field read with OUR side as the defender, so defenderTailwind is ours and
    // attackerTailwind the foe's; weather/terrain/Trick Room are battle-wide.
    const field = readFieldFacts(battle, our.side);
    const ourSpeed = finalSpeed(ourMon, {gen: format.gen, field, tailwind: Boolean(field.defenderTailwind)});
    const foe = speedBuckets(foeVariants, {gen: format.gen, field, tailwind: Boolean(field.attackerTailwind)});
    const order = compareSpeed(ourSpeed, foe, Boolean(field.trickRoom));
    return {order, ...(ourActives.length > 1 ? {ourName: publicFacts.speciesForme} : {})};
  });
  return renderSpeedSection(lines);
}

/**
 * The own-hover matchup block: OUR Pokémon's real moves (private team — the battle
 * view only tracks revealed moves), each with its damage into the current foe
 * active(s) — the "would this Pokémon match up better?" switch-decision view.
 * Private facts feeding an our-view surface, like the move tooltip's real-item read.
 * The foe's hidden item/ability splits a line into labelled outcomes exactly as the
 * move tooltip does — never one confidently-wrong number. Callers resolve the
 * attacker (they differ in how they know its item); this folds it over the foes.
 *
 * `foeSpeedVariants` adds the ⚡ verdict to each block: speed order is a fact about
 * the (ours, theirs) PAIR, so it reads the same on this surface as on a foe hover —
 * and here it is the ONLY way to learn a benched Pokémon's speed matchup, since a
 * bench mon appears on no other tooltip. Absent in open formats (no pool to read a
 * foe speed from). Our speed is honest on both entry paths: an active carries its
 * live boosts, and a bench mon has none to carry.
 */
function ownMovesSection(
  battle: ClientBattle,
  ourSide: ClientSide | undefined,
  attacker: ResolvedMon,
  moves: readonly string[],
  format: {gen: number; doubles: boolean},
  variantsFor: DefenderVariantsFor,
  foeSpeedVariants?: FoeSpeedVariantsFor,
): string {
  const sections = activesOpposing(battle, ourSide).map((foe) => {
    const defenderFacts = factsFor(battle, foe);
    const variantsForMove = variantsFor(defenderFacts);
    // The FOE is the defender here, so `defenderTailwind` is theirs and `attackerTailwind`
    // is ours — the mirror image of speedSection's read, which orients on our own side.
    const field = readFieldFacts(battle, foe.side);
    const rows = moves
      .map((move) => moveDamageBuckets(attacker, variantsForMove(move), move, format.gen, field, format.doubles))
      .filter((buckets) => buckets.length > 0) // status / unmodellable moves get no line
      // The report's move name is dex-resolved, so the id form ("dracometeor") displays right.
      .map((buckets) => ({name: buckets[0]!.report.move, buckets}));
    const speed = foeSpeedVariants
      ? speedOrderVs(attacker, foeSpeedVariants(defenderFacts), field, format.gen)
      : undefined;
    return {
      foeName: defenderFacts.speciesForme,
      defenderHpPercent: defenderFacts.hpPercent,
      moves: rows,
      ...(speed ? {speed} : {}),
    };
  });
  return renderOwnMovesSection(sections);
}

/** Our resolved Pokémon's speed judged against a foe's still-possible speeds, with
 *  `field` oriented so the FOE is the defender (as `ownMovesSection` reads it).
 *  Undefined when no set survives — a verdict needs something to compare against. */
function speedOrderVs(
  ours: ResolvedMon,
  foeVariants: readonly SetVariant[],
  field: FieldFacts,
  gen: number,
): SpeedOrder | undefined {
  if (foeVariants.length === 0) return undefined;
  const ourSpeed = finalSpeed(ours, {gen, field, tailwind: Boolean(field.attackerTailwind)});
  const foe = speedBuckets(foeVariants, {gen, field, tailwind: Boolean(field.defenderTailwind)});
  return compareSpeed(ourSpeed, foe, Boolean(field.trickRoom));
}

/** The matchup block for an own-side hover that carries a battle-view Pokémon (the
 *  active, or a sidebar icon of a revealed mon). Empty when spectating (no private
 *  team) or fainted (it can't switch in). The attacker is the Pokémon that is really
 *  there (`ownTruth`) and so is its set — a disguised Zoroark's moves are Zoroark's,
 *  and they must not be calculated off the disguise's species. */
function ownHoverMatchup(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  publicFacts: LiveFacts,
  data: RandbatsData,
  format: {gen: number; doubles: boolean},
): string {
  const moves = readOwnMoves(battle, pokemon);
  const facts = ownTruth(battle, pokemon, publicFacts);
  const entry = entryFor(data, facts);
  if (!moves || !entry || facts.hpPercent <= 0) return '';
  // Your Pokémon, your damage: your real item beats the set's assumed one (same
  // principle as buildMoveSection's attacker).
  const realItem = ownItemName(battle, pokemon, entry);
  const attacker = resolveMon(realItem ? {...facts, item: realItem} : facts, entry);
  // Our real item feeds the ⚡ line too: a Scarf we are holding is our own private
  // truth, and showing US our own speed as uncertain would be absurd.
  const speedFor = (foeFacts: LiveFacts): readonly SetVariant[] => randbatsFoeVariants(data, foeFacts);
  return ownMovesSection(battle, pokemon.side, attacker, moves, format, randbatsVariantsFor(data), speedFor);
}

/**
 * The switch-menu tooltip section: the matchup block built straight from the private
 * `ServerPokemon`. This surface is why the block can't ride on `buildPokemonSection`:
 * the client passes NO battle-view Pokémon here (its side lookup is commented out —
 * a never-revealed benched mon has none), so hovering a switch button dispatches
 * `showPokemonTooltip(null, serverPokemon)`. No mirror blocks either — they would
 * have to be derived from these PRIVATE facts (a leak into the their-read-on-you
 * view), and the native switch tooltip already shows your full real set above ours.
 * `server.item === ''` is a KNOWN empty slot (knocked off / consumed) — the resolved
 * item is forced to none rather than letting the resolver assume the set's back on.
 */
export function buildSwitchSection(battle: ClientBattle, server: ClientServerPokemon, data: RandbatsData | null): string {
  const format = detectFormat(battle);
  if (!format) return '';
  const moves = server.moves ?? [];
  const facts = serverPokemonFacts(server);
  if (!facts || facts.hpPercent <= 0 || moves.length === 0) return '';
  const speciesData = readSpeciesData(battle, facts);
  const factsWithDex = {...facts, ...(speciesData ? {speciesData} : {})};
  const ourSide = nearSide(battle);

  switch (format.kind) {
    case 'randbats': {
      if (!data) return ''; // the feed is still warming — same silence as before it loads
      const entry = entryFor(data, facts);
      if (!entry) return '';
      // The id-form item narrows the role fine (pools compare by id) and the damage layer
      // resolves it to the dex name for the calc — no pool mapping needed here.
      const resolved = resolveMon(factsWithDex, entry);
      const attacker = server.item === '' ? {...resolved, item: undefined} : resolved;
      // A benched mon's ⚡ line answers "if I send this in, do I outspeed?" — the whole
      // reason speed belongs on our side of the pair. Its item comes from the private
      // team (an id-form Choice Scarf; the damage layer resolves ids through the dex),
      // and it carries no boosts, because it enters with none.
      const speedFor = (foeFacts: LiveFacts): readonly SetVariant[] => randbatsFoeVariants(data, foeFacts);
      return ownMovesSection(battle, ourSide, attacker, moves, format, randbatsVariantsFor(data), speedFor);
    }
    case 'open': {
      // The ServerPokemon already carries the real item/ability in `facts`; its exact
      // finals come from the request's stats table. An empty item string is a KNOWN
      // empty slot — `serverPokemonFacts` leaves `item` unset and the minimal entry
      // assumes nothing, so the gone item stays gone.
      const knownStats = serverStats(server);
      const attacker = resolveMon(
        {...factsWithDex, ...(knownStats ? {knownStats} : {})},
        entryOrMinimal(undefined, facts),
      );
      const html = ownMovesSection(battle, ourSide, attacker, moves, format, openVariantsFor(format.gen));
      return html ? html + renderNotes([OPEN_FORMAT_NOTE]) : '';
    }
    default:
      return unreachable(format);
  }
}

/** Exhaustiveness backstop: a new BattleFormat kind fails the typecheck here. */
function unreachable(kind: never): never {
  throw new Error(`unhandled format kind: ${String(kind)}`);
}

/** True when the hovered Pokémon belongs to the opponent (the far side, from our seat). */
function isFoe(battle: ClientBattle, pokemon: ClientPokemon): boolean {
  if (pokemon.side?.isFar !== undefined) return pokemon.side.isFar;
  return pokemon.side === battle.sides[1]; // client default: near side is sides[0]
}

/**
 * The damage reports for `attacker`'s moves into `defender`, keyed by move id.
 * Status moves and moves the calc can't model are simply absent.
 */
function reportsByMove(
  attacker: ResolvedMon,
  defender: ResolvedMon,
  moves: readonly string[],
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
): Map<string, DamageReport> {
  const out = new Map<string, DamageReport>();
  for (const move of moves) {
    try {
      const report = calcDamage(attacker, defender, move, {gen, field});
      if (report.category !== 'Status') out.set(toId(move), report);
    } catch {
      // One unmodellable move shouldn't drop the whole section.
    }
  }
  return out;
}

/**
 * The distinct damage outcomes for `moveName` from `attacker` into the target, one
 * per still-possible defending set, merged where they land on the same number. Status
 * and unmodellable variants are dropped; an all-dropped move yields no buckets (→ '').
 * `nhkoTurns` requests the nHKO ladder (the move tooltip shows it; the compact
 * own-hover view doesn't, and skips the survival sim).
 */
function moveDamageBuckets(
  attacker: ResolvedMon,
  defenderVariants: readonly SetVariant[],
  moveName: string,
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
  nhkoTurns?: number,
): DamageBucket[] {
  const scored: {variant: SetVariant; report: DamageReport}[] = [];
  for (const variant of defenderVariants) {
    try {
      const report = calcDamage(attacker, variant.mon, moveName, {gen, field, doubles, ...(nhkoTurns !== undefined ? {nhkoTurns} : {})});
      if (report.category !== 'Status') scored.push({variant, report});
    } catch {
      // A move outside the calc's world for this variant shouldn't drop the section.
    }
  }
  return bucketByDamage(scored);
}

/**
 * The move-button tooltip section: `moveName` from our active `pokemon` into the
 * opposing active. When the target's item is still unknown and it changes the number
 * (an Assault Vest that may or may not be there), the distinct outcomes each get a
 * labelled line; otherwise it's the plain "Damage:" line. Returns '' when there's
 * nothing to show (not a Random Battle, no target, untracked species, no modellable
 * outcome). `teraSelected` is the move panel's Terastallize checkbox (content.ts reads
 * the DOM): when ticked, the damage previews the Tera as already active.
 */
export function buildMoveSection(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  moveName: string,
  data: RandbatsData | null,
  teraSelected = false,
): string {
  const format = detectFormat(battle);
  if (!format) return '';

  // Both foes in doubles, one in singles — a damage section per target.
  const foes = findOpposingActives(battle, pokemon);
  if (foes.length === 0) return '';

  // Our attacker: public battle state, private identity (Illusion disguises us to us too).
  const publicFacts = ownTruth(battle, pokemon, factsFor(battle, pokemon));
  // Terastallize is ticked for this turn: preview the damage with the Tera active, using
  // OUR private Tera type (an our-view surface, like the real-item read). Not speculation —
  // the type is our own truth and activating it is the user's declared intent. Moot once
  // actually terastallized (the public facts already carry it); absent when spectating.
  const pendingTera = teraSelected && !publicFacts.terastallized ? readOwnTeraType(battle, pokemon) : undefined;
  const teraFacts = pendingTera ? {terastallized: true, teraType: pendingTera} : {};

  switch (format.kind) {
    case 'randbats': {
      if (!data) return ''; // the feed is still warming — same silence as before it loads
      const attackerEntry = entryFor(data, publicFacts);
      if (!attackerEntry) return '';
      // Your move, your damage: prefer your REAL item over the set's assumed first item, so a
      // Heavy-Duty Boots Iron Bundle isn't calculated as Choice Specs. Treated like a revealed
      // fact for resolution — but only here, never in the opponent's-knowledge views.
      const realItem = ownItemName(battle, pokemon, attackerEntry);
      const attacker = resolveMon({...publicFacts, ...(realItem ? {item: realItem} : {}), ...teraFacts}, attackerEntry);
      // Name each target only when there's more than one (doubles) — singles keeps native parity.
      return foes.map((foe) => moveVsFoe(attacker, foe, moveName, format, data, battle, foes.length > 1)).join('');
    }
    case 'open': {
      // No pool to match the item against: the raw id form goes straight in — the damage
      // layer resolves ids through the calc's dex (`knownItem`). Our exact finals come
      // from the private team's stats table; the rest of the facts are the public reads.
      const realItem = readOwnItem(battle, pokemon);
      const knownStats = readOwnStats(battle, pokemon);
      const attackerFacts = {
        ...publicFacts,
        ...(realItem ? {item: realItem} : {}),
        ...(knownStats ? {knownStats} : {}),
        ...teraFacts,
      };
      const attacker = resolveMon(attackerFacts, entryOrMinimal(undefined, attackerFacts));
      const variantsFor = openVariantsFor(format.gen);
      const sections = foes
        .map((foe) => openMoveVsFoe(attacker, foe, moveName, format, battle, variantsFor, foes.length > 1))
        .join('');
      return sections ? sections + renderNotes([OPEN_FORMAT_NOTE]) : '';
    }
    default:
      return unreachable(format);
  }
}

/** One target's open-format damage section: assumed defender variants for this move's
 *  category. Status moves (Pain Split included) yield '' — `openVariantsFor` returns
 *  no variants for them, since even Pain Split's HP swing would rest on an assumed max. */
function openMoveVsFoe(
  attacker: ResolvedMon,
  defenderMon: ClientPokemon,
  moveName: string,
  format: {gen: number; doubles: boolean},
  battle: ClientBattle,
  variantsFor: DefenderVariantsFor,
  label: boolean,
): string {
  const defenderFacts = factsFor(battle, defenderMon);
  const defenderVariants = variantsFor(defenderFacts)(moveName);
  if (defenderVariants.length === 0) return '';
  const field = readFieldFacts(battle, defenderMon.side);
  const targetLabel = label ? defenderFacts.speciesForme : undefined;
  return moveSectionHtml(attacker, defenderFacts, defenderVariants, moveName, format, field, targetLabel);
}

/** One target's damage section: `attacker`'s `moveName` into `defenderMon`. `label` names the
 *  target (doubles, where "which foe" is ambiguous). The doubles game type flows to the calc
 *  so spread moves take their 0.75×. */
function moveVsFoe(
  attacker: ResolvedMon,
  defenderMon: ClientPokemon,
  moveName: string,
  format: {gen: number; doubles: boolean},
  data: RandbatsData,
  battle: ClientBattle,
  label: boolean,
): string {
  const defenderFacts = factsFor(battle, defenderMon);
  const defenderEntry = entryFor(data, defenderFacts);
  const targetLabel = label ? defenderFacts.speciesForme : undefined;

  // Pain Split deals no damage — it averages both mons' HP — so @smogon/calc has nothing to
  // say and the normal damage path would insert a blank. Show the HP swing instead.
  if (toId(moveName) === 'painsplit') {
    const defender = resolveMon(defenderFacts, entryOrMinimal(defenderEntry, defenderFacts));
    return renderPainSplit(painSplit(attacker, defender, format.gen), targetLabel);
  }

  // The defender's hidden item/ability can each split the damage — enumerate the
  // still-possible sets and let identical outcomes collapse back to one bucket.
  const defenderVariants = [
    ...resolveVariants(defenderFacts, entryOrMinimal(defenderEntry, defenderFacts)),
    ...illusionVariants(defenderFacts, defenderEntry, data),
  ];
  const field = readFieldFacts(battle, defenderMon.side);
  return moveSectionHtml(attacker, defenderFacts, defenderVariants, moveName, format, field, targetLabel);
}

/**
 * The format-blind tail of a move-vs-target section, shared by the randbats and open
 * paths: bucket the outcomes over whatever defender variants the caller believes in,
 * attach the foe-level item caveats, render. The item caveats read the RESOLVED
 * variants, so an empty pool (open formats, nothing revealed) silences them and a
 * revealed item still grades 'certain' in either format.
 */
function moveSectionHtml(
  attacker: ResolvedMon,
  defenderFacts: LiveFacts,
  defenderVariants: readonly SetVariant[],
  moveName: string,
  format: {gen: number; doubles: boolean},
  field: ReturnType<typeof readFieldFacts>,
  targetLabel: string | undefined,
): string {
  const buckets = moveDamageBuckets(attacker, defenderVariants, moveName, format.gen, field, format.doubles, 3);
  if (buckets.length === 0) return ''; // status / unmodellable move

  // The live Tera is shared by every variant (it's a revealed fact, not a hidden set).
  const defenderTera = defenderVariants[0]?.mon.teraType;
  // How firmly the foe holds `itemId`, read from the RESOLVED variants — so a revealed item
  // is 'certain', a still-open pool entry 'possible', and a knocked-off/consumed item counts
  // as nothing at all (resolveVariants already dropped it; a gone Leftovers heals no one).
  const itemStanding = (itemId: string): 'certain' | 'possible' | undefined => {
    const holders = defenderVariants.filter((v) => toId(v.mon.item ?? '') === itemId).length;
    if (holders === 0) return undefined;
    return holders === defenderVariants.length ? 'certain' : 'possible';
  };
  // Leftovers changes the nHKO ladder (recovery between turns) and Focus Sash denies a
  // single-hit KO from full HP — foe-level facts that qualify the lines without changing
  // the damage rolls, shown only when there's a single outcome to attach them to.
  const leftovers = buckets.length === 1 ? itemStanding('leftovers') : undefined;
  const focusSash = buckets.length === 1 ? itemStanding('focussash') : undefined;
  return renderMoveSection({
    defenderHpPercent: defenderFacts.hpPercent,
    extraNotes: [],
    buckets,
    ...(targetLabel ? {targetLabel} : {}),
    ...(leftovers ? {leftovers} : {}),
    ...(focusSash ? {focusSash} : {}),
    ...(attacker.teraType ? {attackerTera: attacker.teraType} : {}),
    ...(defenderTera ? {defenderTera} : {}),
  });
}

/**
 * One candidate set → a render block, with each move's damage (foe view) attached from
 * THIS set's own item/spread/species. `species` is set only for an Illusion candidate (a
 * Zoroark the hovered mon might secretly be), which the renderer flags as such.
 */
function toBlock(c: CandidateSet, species: string | undefined, damage: Map<string, DamageReport> | undefined): CandidateBlock {
  return {
    name: c.name,
    ...(species ? {species} : {}),
    abilities: c.abilities,
    items: c.items,
    gimmicks: c.gimmicks,
    moves: c.moves.map((m): MoveKnowledgeRow => {
      const report = damage?.get(toId(m.name));
      return {name: m.name, known: m.known, ...(report ? {report} : {})};
    }),
  };
}

/**
 * The Pokémon tooltip section: the still-possible sets, one block per candidate,
 * in the original Randbats Tooltip's layout. Hovering the opponent narrows their
 * sets by every public reveal and attaches each move's damage vs our active;
 * hovering our own Pokémon shows the mirror — what the opponent can deduce from
 * what we've made public. Returns '' when the format or species isn't covered.
 */
export function buildPokemonSection(battle: ClientBattle, pokemon: ClientPokemon, data: RandbatsData | null): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const facts = factsFor(battle, pokemon);

  switch (format.kind) {
    case 'randbats':
      return data ? randbatsPokemonSection(battle, pokemon, facts, data, format) : '';
    case 'open': {
      // No sets/mirror view (nothing to infer without a pool) and nothing on a FOE
      // hover in v1; our own mon gets the matchup view — the switch-decision answer —
      // built from the private team, exactly like the move tooltip's attacker.
      if (isFoe(battle, pokemon)) return '';
      const moves = readOwnMoves(battle, pokemon);
      if (!moves || facts.hpPercent <= 0) return '';
      const realItem = readOwnItem(battle, pokemon);
      const knownStats = readOwnStats(battle, pokemon);
      const ourFacts = ownTruth(battle, pokemon, facts);
      const attackerFacts = {...ourFacts, ...(realItem ? {item: realItem} : {}), ...(knownStats ? {knownStats} : {})};
      const attacker = resolveMon(attackerFacts, entryOrMinimal(undefined, attackerFacts));
      const html = ownMovesSection(battle, pokemon.side, attacker, moves, format, openVariantsFor(format.gen));
      return html ? html + renderNotes([OPEN_FORMAT_NOTE]) : '';
    }
    default:
      return unreachable(format);
  }
}

/** The randbats Pokémon hover, exactly as it has always been: the still-possible sets
 *  (narrowed by reveals), the ⚡ verdict on a foe, the matchup view + mirror on our own. */
function randbatsPokemonSection(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  facts: LiveFacts,
  data: RandbatsData,
  format: {gen: number; doubles: boolean},
): string {
  const entry = entryFor(data, facts);
  if (!entry) return ''; // not a tracked randbats Pokémon

  const shown = inferSets(facts, entry);
  const notes = shown.uncertainReason ? [shown.uncertainReason] : [];

  // The hovered species, plus any Zoroark it might secretly be (Illusion), as candidate
  // sources. Each contributes its own blocks; an Illusion source tags its blocks with the
  // species it might really be (its own set + species drive that block's damage).
  const sources = [
    {facts, entry, species: undefined as string | undefined, knowledge: shown},
    ...suspectsFor(facts, entry, data).map(({species, entry: e}) => {
      const f: LiveFacts = {...facts, speciesForme: species, level: e.level};
      return {facts: f, entry: e, species: species as string | undefined, knowledge: inferSets(f, e)};
    }),
  ];

  // Foe view: attach each possible move's damage into OUR active (their move buttons
  // aren't hoverable for us). The own-side mirror carries no damage — public info only.
  const foe = isFoe(battle, pokemon);
  const ourMon = foe ? findOpposingActive(battle, pokemon) : null;
  // The threat lands on the Pokémon really standing there, not on the disguise we're wearing.
  const ourFacts = ourMon ? ownTruth(battle, ourMon, factsFor(battle, ourMon)) : null;
  const defender = ourFacts ? resolveMon(ourFacts, entryOrMinimal(entryFor(data, ourFacts), ourFacts)) : null;
  const field = ourMon ? readFieldFacts(battle, ourMon.side) : undefined;

  const blocks: CandidateBlock[] = [];
  for (const s of sources) {
    const attackers = defender ? resolveByRole(s.facts, s.entry) : []; // aligned 1:1 with candidates
    s.knowledge.candidates.forEach((c, i) => {
      const attacker = attackers[i]?.mon ?? attackers[0]?.mon;
      const damage = defender && attacker && field
        ? reportsByMove(attacker, defender, c.moves.map((m) => m.name), format.gen, field)
        : undefined;
      blocks.push(toBlock(c, s.species, damage));
    });
  }
  if (blocks.every((b) => b.moves.length === 0)) return '';

  // The at-a-glance verdict, above the set blocks — where the "if Choice Scarf" aside
  // sits directly over the candidate sets that produce that Scarf. Our own hover gets
  // its ⚡ line inside the matchup block instead (same pair, read from our side); what
  // stays foe-only is this placement, not the fact. The mirror below never gets one:
  // its honesty rests on carrying nothing but public info.
  const speedHtml = foe
    ? speedSection(
        battle,
        [...resolveVariants(facts, entry), ...illusionVariants(facts, entry, data)],
        findOpposingActives(battle, pokemon),
        data,
        format,
      )
    : '';
  // Own view's at-a-glance answer: OUR moves' damage into the current foe (private
  // moveset — an our-view surface). Leads the tooltip like ⚡ does on a foe hover;
  // the mirror blocks below remain strictly public.
  const ownMovesHtml = foe ? '' : ownHoverMatchup(battle, pokemon, facts, data, format);

  return speedHtml + ownMovesHtml + renderSetsSection({candidates: blocks, extraNotes: notes});
}
