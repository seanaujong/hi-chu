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

import {calcDamage, finalStatsOf, moveCategory, painSplit, speciesBody, type DamageReport} from './core/damage.js';
import {resolveMon, resolveVariants} from './core/resolve.js';
import {assumeDefenderVariants, type MoveSlant} from './core/assume.js';
import {inferSets} from './core/knowledge.js';
import {bucketByDamage, type DamageBucket} from './core/variants.js';
import {compareSpeed, finalSpeed, speedBuckets, type SpeedOrder} from './core/speed.js';
import {illusionSuspects, type IllusionSuspect} from './core/illusion.js';
import {strengthSap} from './core/strengthsap.js';
import {buildableAbilities} from './core/narrow.js';
import {
  renderMoveSection,
  renderNotes,
  renderOwnMovesSection,
  renderPainSplit,
  renderSetsSection,
  renderSpeedSection,
  renderStrengthSap,
  type CandidateBlock,
  type MoveKnowledgeRow,
  type SpeedLineModel,
} from './core/render.js';
import type {CandidateSet, FieldFacts, KnownOption, LiveFacts, RandbatsData, RandbatsEntry, ResolvedMon, SetVariant, TransformCopy} from './core/types.js';
import {transformCopy} from './core/transform.js';
import {applySwitchInHazards} from './core/hazards.js';
import {
  hasMatchupBlock,
  pokemonHoverTarget,
  previewsSwitchInHazards,
  shows,
  type HoverTarget,
} from './core/surfaces.js';
import {variantsConsistentWithDamageDealt, variantsConsistentWithDamageTaken} from './core/itemreveal.js';
import {variantsConsistentWithOrder} from './core/speedreveal.js';
import {pickEntry, megaEntryForItem, megaEntriesFor} from './data/lookup.js';
import {
  toLiveFacts,
  readBehaviors,
  readTransformTarget,
  readOwnAbility,
  readOwnItem,
  readOwnMoves,
  readOwnServerPokemon,
  readOwnStats,
  readOwnTeraType,
  readOwnHazards,
  readMegaForme,
  readSpeciesData,
  readSubstitute,
  findByIdent,
  serverPokemonFacts,
  serverStats,
  activesOpposing,
  findOpposingActive,
  findOpposingActives,
  mostRecentCleanHit,
  mostRecentCleanOrder,
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

/**
 * Everything the battle log reveals about a foe that `narrow.ts` cannot see from the
 * snapshot — the two per-VARIANT reveals, gathered once per hover and applied in one place.
 *
 * They are gathered together because they must be APPLIED together. Each rules out variants
 * the other cannot: damage magnitude separates a Life Orb from a Choice Band and is blind to
 * a Choice Scarf (which changes no number at all), while move order separates the Scarf from
 * the Band and is blind to everything that does not touch Speed. A surface that consulted
 * one and not the other would contradict a surface that consulted both, on the same tooltip.
 *
 * Absent when there is nothing to read — no opposing active to compare against, no field, or
 * neither observation available — which is the common case and costs nothing.
 */
interface FoeReveals {
  readonly narrow: (variants: readonly SetVariant[]) => readonly SetVariant[];
}

/**
 * Our own active as the ATTACKER of a hit that has already landed: its public battle state
 * with the private team's real item and ability laid over it — the same composition
 * `buildMoveSection` uses for our outgoing damage, and for the same reason.
 *
 * `null` unless that item can be pinned exactly, and the outgoing damage reading is dropped
 * entirely when it is. This is not caution for its own sake: that reading divides the
 * observed number by what we think we hit with, so an item guessed from the set's pool
 * multiplies straight into the verdict. A Choice Specs read as Heavy-Duty Boots predicts two
 * thirds of the damage that really landed, which reads as a defence we never faced and
 * convicts whichever of the foe's items is bulkiest — the exact false rule-out this whole
 * layer exists to avoid. Spectating a replay (no `myPokemon` at all) and a Pokémon whose
 * item has been knocked off both land here, and both would rather say nothing.
 */
function exactOwnAttacker(
  battle: ClientBattle,
  mon: ClientPokemon,
  facts: LiveFacts,
  data: RandbatsData,
): ResolvedMon | null {
  const entry = entryFor(data, facts);
  if (!entry) return null;
  const item = ownItemName(battle, mon, entry);
  if (!item) return null;
  const ability = ownAbilityName(battle, mon, entry);
  return resolveMon({...facts, item, ...(ability ? {ability} : {})}, entry);
}

/**
 * The one place a foe's still-possible variants are narrowed by the log. EVERY surface that
 * shows a foe's set goes through it — the ⚡ verdict, the move tooltip's defender fan-out,
 * the sets view's damage, and the sets view's own Items line — because a rule-out that
 * reaches some of those and not others is worse than no rule-out at all: it puts a Choice
 * Scarf on the Items line of a block whose ⚡ line has just declared it impossible.
 */
function foeReveals(
  battle: ClientBattle,
  foe: ClientPokemon,
  ourMon: ClientPokemon | null,
  ourResolved: ResolvedMon | null,
  field: FieldFacts | undefined,
  format: {gen: number; doubles: boolean},
  // Our mon as it stood on the turn the ORDER was observed — a turn that has already been
  // fought, so a Mega or Tera merely TICKED in the move panel was not in effect for it.
  // Defaults to `ourResolved` for callers with no preview to strip.
  ourWhenItHappened: ResolvedMon | null = ourResolved,
  // Our mon with its PRIVATE item and ability, or null when they cannot be pinned. Only the
  // outgoing damage reading uses it, and only when it is non-null — see `exactOwnAttacker`.
  ourAttacker: ResolvedMon | null = null,
): FoeReveals | undefined {
  if (!ourMon || !ourResolved || !field) return undefined;
  // Every reading here judges a turn ALREADY FOUGHT, so all three want our mon as it stood
  // then — a Mega or Tera merely ticked in the move panel was in effect for none of them.
  const ourselvesThen = ourWhenItHappened ?? ourResolved;
  // Damage MAGNITUDE (core/itemreveal.ts) — not a side effect firing, but the NUMBER a past
  // hit dealt, read at BOTH ends. `mostRecentCleanHit` is a fact about an ordered pair, so
  // the same reader answers both: what THEY landed on us bounds their offensive item, what
  // WE landed on them bounds their defensive one (an Assault Vest is invisible otherwise).
  // Either hands back nothing unless it found one safe to compare.
  const theirHit = mostRecentCleanHit(battle, foe, ourMon);
  const ourHit = ourAttacker ? mostRecentCleanHit(battle, ourMon, foe) : undefined;
  // Move ORDER (core/speedreveal.ts) — the only reading that separates a Scarf from a Band.
  const order = mostRecentCleanOrder(battle, ourMon, foe);
  if (!theirHit && !ourHit && !order) return undefined;
  // Field orientation follows whoever is DEFENDING. `field` was read with OUR side as the
  // defender, which is right for a hit we TOOK; a hit we DEALT is the mirror, and reusing
  // the same reading would put their Reflect on us and ours on them.
  const theirField = ourHit ? readFieldFacts(battle, foe.side) : undefined;
  return {
    narrow: (variants) => {
      let kept = variants;
      if (theirHit) {
        kept = variantsConsistentWithDamageDealt(kept, ourselvesThen, {gen: format.gen, field, doubles: format.doubles}, theirHit);
      }
      if (ourHit && ourAttacker) {
        kept = variantsConsistentWithDamageTaken(
          kept,
          ourAttacker,
          {gen: format.gen, ...(theirField ? {field: theirField} : {}), doubles: format.doubles},
          ourHit,
        );
      }
      if (order && ourWhenItHappened) {
        kept = variantsConsistentWithOrder(kept, ourWhenItHappened, order, {
          gen: format.gen,
          field,
          // `field` is read with OUR side as the defender, so `defenderTailwind` is ours.
          // Swapping these silently doubles the wrong Pokémon's Speed.
          ourTailwind: Boolean(field.defenderTailwind),
          theirTailwind: Boolean(field.attackerTailwind),
        });
      }
      return kept;
    },
  };
}

/**
 * The reveals for one foe, built from OUR ACTIVE — whichever of our own Pokémon is hovered.
 *
 * That is the whole subtlety of using this on an own-side surface: the matchup view and the
 * switch menu are about a benched candidate, but the turn that was observed was fought by
 * whoever was actually standing there. The rule-out it produces is a fact about the FOE's
 * set, so it applies to every surface that shows that foe — including a ⚡ line inside a
 * bench mon's block, which would otherwise go on offering an "if Choice Scarf" aside the
 * foe's own hover had already deleted.
 */
function revealsAgainst(
  battle: ClientBattle,
  foe: ClientPokemon,
  data: RandbatsData,
  format: {gen: number; doubles: boolean},
  readFacts: FactsReader,
): FoeReveals | undefined {
  const ourActive = findOpposingActive(battle, foe);
  if (!ourActive) return undefined;
  const ourFacts = ownTruth(battle, ourActive, readFacts(ourActive));
  const resolved = resolveMon(ourFacts, entryOrMinimal(entryFor(data, ourFacts), ourFacts));
  return foeReveals(
    battle, foe, ourActive, resolved, readFieldFacts(battle, ourActive.side), format,
    resolved, exactOwnAttacker(battle, ourActive, ourFacts, data),
  );
}

/**
 * A candidate's displayed options, cut down to what the log-derived reveals leave standing.
 *
 * This is the half that makes the choke point a choke point rather than a second filter.
 * `inferSets` derives the Items and Abilities lines from `narrow.candidateItems`, which sees
 * only the snapshot — so without this a block would go on advertising a Choice Scarf that
 * the ⚡ line above it had already ruled out, and the "one rule decides a candidate's item
 * pool" invariant would hold everywhere except where it matters most.
 *
 * Only ever removes, and never removes everything: an option with no surviving variant to
 * justify it goes, and a candidate whose whole pool would empty is left exactly as it was.
 */
function narrowCandidate(candidate: CandidateSet, surviving: readonly SetVariant[]): CandidateSet {
  if (surviving.length === 0) return candidate;
  const items = new Set(surviving.map((v) => toId(v.mon.item ?? '')));
  const abilities = new Set(surviving.map((v) => toId(v.mon.ability ?? '')));
  const keep = (options: readonly KnownOption[], live: ReadonlySet<string>): readonly KnownOption[] => {
    const left = options.filter((o) => live.has(toId(o.name)));
    return left.length > 0 ? left : options;
  };
  return {...candidate, items: keep(candidate.items, items), abilities: keep(candidate.abilities, abilities)};
}

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
type FoeSpeedVariantsFor = (foe: ClientPokemon, defenderFacts: LiveFacts) => readonly SetVariant[];

/**
 * Every distinct move a hovered foe could still attack with, paired with the ATTACKER
 * variants (role × item/ability fan-out) that could carry it — the mirror of
 * `DefenderVariantsFor`. There, a fixed move fans out over hidden DEFENDER sets; here, a
 * fixed defender (the mon this tooltip is about) fans out over hidden ATTACKER sets, one
 * entry per still-possible move. `known` marks a move the foe has actually used, the same
 * ✓ the sets view already carries. Randbats-only for the same reason as
 * `FoeSpeedVariantsFor`: an assumed spread has no move pool to enumerate, so an open
 * format supplies nothing here rather than branching inside the shared block builder.
 */
type IncomingMovesFor = (
  foeFacts: LiveFacts,
) => readonly {readonly move: string; readonly known: boolean; readonly variants: readonly SetVariant[]}[];

/** The feed-driven supplier: the sets view's own per-role move knowledge, crossed with
 *  `resolveVariants`' full item/ability fan-out — aligned by ROLE NAME, the same
 *  alignment `groupByRole` uses for the sets view's own per-candidate damage. Never a
 *  set's first-guessed item: hidden Life Orb/Choice item splits an incoming line into
 *  labelled outcomes exactly like the move tooltip's defender side. */
function randbatsIncomingMovesFor(data: RandbatsData): IncomingMovesFor {
  return (foeFacts) => {
    const entry = entryFor(data, foeFacts);
    if (!entry) return [];
    const knowledge = inferSets(foeFacts, entry);
    const variants = resolveVariants(foeFacts, entry);
    const seen = new Map<string, {known: boolean; roles: Set<string>}>();
    for (const c of knowledge.candidates) {
      for (const m of c.moves) {
        const cur = seen.get(m.name) ?? {known: false, roles: new Set<string>()};
        cur.known = cur.known || m.known;
        cur.roles.add(c.name);
        seen.set(m.name, cur);
      }
    }
    return [...seen.entries()].map(([move, {known, roles}]) => ({
      move,
      known,
      variants: variants.filter((v) => roles.has(v.role)),
    }));
  };
}

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

/**
 * How this tooltip reads a Pokémon. Beyond the raw snapshot it resolves a TRANSFORM, and
 * that is why it has to be a seam rather than a free function: the copy a transformed
 * Pokémon wears IS the Pokémon it copied, so building it means resolving that other
 * Pokémon — which only a format-aware reader can do (the feed, for a randbats mon).
 *
 * Every surface reads facts through this one, so a transformed Ditto looks the same
 * wherever it appears: as a target, as an attacker, and on the ⚡ verdict.
 */
type FactsReader = (mon: ClientPokemon) => LiveFacts;

/** Resolve a Pokémon to the single set we would calculate it as — EXACTLY, or not at all.
 *  A randbats mon always resolves: the feed publishes its spread, ours and theirs alike.
 *  An open format has no feed, and its foe spreads are bracketed rather than guessed (see
 *  assume.ts) — a bracket is no basis for the exact numbers Transform installs, so it
 *  answers undefined and the copy falls back to body-only. */
type ExactResolver = (facts: LiveFacts) => ResolvedMon | undefined;

function exactResolver(data: RandbatsData | null): ExactResolver {
  return (facts) => {
    if (!data) return undefined;
    const entry = entryFor(data, facts);
    return entry ? resolveMon(facts, entry) : undefined;
  };
}

/**
 * The facts reader for this tooltip: the snapshot, plus the Transform copy for a Pokémon
 * that is wearing one.
 */
function factsReader(battle: ClientBattle, gen: number, data: RandbatsData | null): FactsReader {
  const resolve = exactResolver(data);
  return (mon) => {
    const base = factsFor(battle, mon);
    const inherited = shedTailMakerMaxHP(battle, gen, mon, resolve);
    const facts: LiveFacts = inherited !== undefined && base.substitute
      ? {...base, substitute: {...base.substitute, sizedOnMaxHP: inherited}}
      : base;
    const target = readTransformTarget(mon);
    if (!target) return facts;
    const copy = transformCopyFor(battle, gen, facts, target, resolve);
    return copy ? {...facts, transformedInto: copy} : facts;
  };
}

/**
 * The max HP a Shed Tail sub was actually cut from — its MAKER's, not the Pokémon now
 * standing behind it. Undefined for every ordinary sub, which the damage layer then sizes on
 * the defender it was already measuring.
 *
 * A seam for the same reason Transform is one: naming the maker takes only the log, but
 * turning that name into a number takes the feed, so it can only happen here. A maker we
 * can't resolve — an open format's foe, whose spread is bracketed rather than known — leaves
 * this undefined and the sub falls back to the wearer's own quarter. That is a guess we would
 * rather not make, but it is the SAME guess every surface made before this existed, and the
 * alternative is withholding the hit count from a mechanic that is usually a few HP either
 * way. (Its worst case is a bulky maker handing a doll to a frail teammate — Orthworm to a
 * Flutter Mane — where the count reads low.)
 */
function shedTailMakerMaxHP(
  battle: ClientBattle,
  gen: number,
  mon: ClientPokemon,
  resolve: ExactResolver,
): number | undefined {
  const maker = readSubstitute(battle, mon)?.shedTailMaker;
  if (maker === undefined) return undefined;
  const makerMon = findByIdent(battle, maker);
  if (!makerMon) return undefined;
  const resolved = resolve(factsFor(battle, makerMon));
  return resolved ? finalStatsOf(gen, resolved)?.hp : undefined;
}

/**
 * The copy a transformed Pokémon is wearing, built from the TARGET's own resolution — the
 * same pipeline that would answer "what is that Pokémon?" if you hovered it.
 *
 * Undefined when we can't even name the two bodies involved, which leaves the Pokémon
 * resolving as its plain self (it will still be calculated as the right SPECIES, since the
 * live forme rides on `facts.liveForme` regardless — this only costs the copied numbers).
 */
function transformCopyFor(
  battle: ClientBattle,
  gen: number,
  self: LiveFacts,
  target: ClientPokemon,
  resolve: ExactResolver,
): TransformCopy | undefined {
  // The client records the copied species in the same `formechange` volatile a forme change
  // uses, so the forme we are wearing IS the target's — no second reading needed.
  const forme = self.liveForme;
  if (forme === undefined) return undefined;
  const targetFacts = factsFor(battle, target);
  const ownBody = speciesBody(gen, self.speciesForme, self.speciesData);
  const targetBody = speciesBody(gen, forme, targetFacts.speciesData);
  if (!ownBody || !targetBody) return undefined;

  // The copier resolved as ITSELF: Transform displaces its body, but its own HP survives,
  // and that HP comes from the set it is still running (a Ditto's own Ditto set).
  const {liveForme: _wearingTheirs, ...asItself} = self;
  const own = resolve(asItself);
  const copied = resolve(targetFacts);
  const ownFinals = own ? finalStatsOf(gen, own) : undefined;
  const copiedFinals = copied ? finalStatsOf(gen, copied) : undefined;
  // Our own team knows its real moveset; a foe's is whatever its surviving sets could run.
  // (An our-view surface either way — a copy of OUR Pokémon is what is about to hit us, and
  // the opponent, having copied it, already knows every move we would be "revealing".)
  const ourMoves = readOwnMoves(battle, target);
  const moves = ourMoves ?? copied?.possibleMoves ?? [];

  return transformCopy(
    {baseStats: ownBody.baseStats, ...(ownFinals ? {finalStats: ownFinals} : {})},
    {
      body: targetBody,
      ...(copiedFinals ? {finalStats: copiedFinals} : {}),
      moves,
      movesKnown: ourMoves !== undefined,
      timesAttacked: targetFacts.timesAttacked,
    },
  );
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
 * The viewer's OWN CURRENT ability for their active, as a display name the calc honours —
 * same reasoning and shape as `ownItemName`. The public battle-view Pokémon only learns an
 * ability once something reveals it in the log, even for our own mon, so a SILENT ability
 * (Huge Power, Levitate, Serene Grace, …) would otherwise be invisible to our own damage
 * calc until something else happens to reveal it. `undefined` when spectating, gen ≤6 (the
 * request carries no live ability there), or when nothing in the pool matches — in which
 * case the caller keeps the public-info behaviour.
 */
function ownAbilityName(battle: ClientBattle, pokemon: ClientPokemon, entry: RandbatsEntry): string | undefined {
  const raw = readOwnAbility(battle, pokemon);
  if (!raw) return undefined;
  const roleAbilities = entry.roles ? Object.values(entry.roles).flatMap((r) => r.abilities) : [];
  const pool = [...roleAbilities, ...(entry.abilities ?? [])];
  return pool.find((a) => toId(a) === toId(raw));
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
  // A different species means a different BODY: neither the disguise's dex data nor any
  // forme it was wearing describes the Pokémon really standing there.
  const {speciesData: _disguise, liveForme: _itsForme, transformedInto: _itsCopy, ...battleState} = facts;
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

/** True when `mon` occupies one of its side's active slots right now — false for a
 *  revealed-but-benched sidebar icon and for a switch-menu candidate (which has no
 *  `.side` at all). Shared by every our-view surface that behaves differently for the
 *  mon actually on the field versus a switch-decision candidate. */
function isActiveMon(mon: ClientPokemon): boolean {
  return mon.side?.active.includes(mon) ?? false;
}

/**
 * One pending gimmick (a ticked Mega or Terastallize) applied to our own resolved mon,
 * whichever SIDE of the calc it is on. It is our attacker on the move tooltip and the
 * matchup view, and our defender on a foe hover — a Mega's base stats and a Tera's typing
 * change what we deal AND what we take, so one overlay has to serve both. Undefined from a
 * `…PreviewFor` builder means "nothing to preview", not "no change".
 */
type PreviewOverlay = (resolved: ResolvedMon) => ResolvedMon;

/**
 * Overlay the pending Mega forme onto OUR resolved mon: the mon the move panel's
 * Mega Evolution box is ticked for evolves this turn, so a calc where WE are the subject
 * sees its Mega forme — base stats and typing (from the forme's own dex record, or
 * `speciesData` when the calc lacks it, a Champions-invented Mega), and the forme-locked
 * ability (Charizard-Mega-X's Tough Claws). The set stays the same one: a mon holding a
 * stone already resolves to its Mega SET (moves/EVs, via `megaEntryForItem`); only the
 * calc-facing identity was still the base forme. Not speculation — a stone in hand plus
 * the user's ticked intent, the same footing as the Tera preview.
 *
 * Undefined when there's nothing to preview (box unticked, no stone held, already Mega).
 * A pure override on the ResolvedMon, applied ONLY to our-view surfaces for our ACTIVE
 * mon — never a foe's variants, the opponent's-knowledge views, or a benched mon (which
 * can't Mega on the turn it switches in).
 *
 * `knownStats` (an open format's server-reported finals) is dropped: those are the BASE
 * forme's finals and don't describe the Mega, so the forme's own spread drives instead —
 * the base forme hasn't evolved, so the server can't have shipped the Mega's finals.
 */
function megaPreviewFor(
  battle: ClientBattle,
  mon: ClientPokemon,
  megaSelected: boolean,
): PreviewOverlay | undefined {
  // The Mega box belongs to the mon whose move panel is open — our ACTIVE mon. A benched
  // or revealed-but-inactive mon we're hovering can't Mega this turn even holding a stone.
  if (!megaSelected || !isActiveMon(mon)) return undefined;
  const mega = readMegaForme(battle, mon);
  if (!mega) return undefined;
  return (resolved) => {
    const {knownStats: _baseFormeFinals, ...rest} = resolved;
    return {
      ...rest,
      speciesForme: mega.speciesForme,
      // A Mega's ability is forme-locked, so it REPLACES the base one. When the dex names
      // it (always for a Champions Mega the calc can't default), use it; when it doesn't,
      // clear the base ability so the calc falls back to the Mega forme's own default.
      ability: mega.ability,
      ...(mega.speciesData !== undefined ? {speciesData: mega.speciesData} : {}),
    };
  };
}

/** Mega Evolution's Speed counts for THIS turn's order only from gen 7 on — in gen 6 a
 *  Pokémon moved at its base Speed the turn it evolved (Showdown defers the move's
 *  priority to post-Mega only when `gen === 7`; gen 8/9 keep the same-turn behaviour).
 *  So the ⚡ verdict previews the Mega's Speed everywhere but gen 6, while the Mega's
 *  offensive stats reach damage in every gen. */
function megaSpeedApplies(gen: number): boolean {
  return gen >= 7;
}

/**
 * If Terastallize is ticked for our ACTIVE mon's pending move, overlay the preview Tera
 * type onto our resolved mon — the same footing as the Mega preview (our own private truth
 * plus the user's declared intent, not speculation; see `megaPreviewFor`). A pure overlay
 * rather than a facts merge before resolution, so every our-view surface that can carry a
 * pending Tera — the move tooltip, the own-hover matchup view, and a foe hover's damage
 * INTO us — shares one implementation instead of copies of the "which Tera type, if any"
 * law. The defensive surface is not a separate rule: the Tera that grants STAB on our move
 * is the same Tera that resists theirs, so the two directions cannot be allowed to disagree.
 *
 * Undefined when there's nothing to preview (box unticked, no private Tera type to show,
 * already terastallized, or not our active mon this turn — Tera, like Mega, only takes
 * effect on the turn the move is actually used, so a benched/switch-candidate mon never
 * gets it).
 *
 * EVERY surface that can carry a pending Tera must go through this one function, and the
 * reason is Protean/Libero specifically: `@smogon/calc`'s `getStabMod` grants their STAB
 * only while `!pokemon.teraType`, and a Tera once set overrides Protean's retype for STAB
 * purposes even when the previewed type doesn't match the move. That behaviour hangs on
 * exactly this value — so a second, slightly-different copy of the "which Tera type, if
 * any" decision would make the SAME move report two different numbers depending on which
 * tooltip you hovered.
 */
function teraPreviewFor(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  teraSelected: boolean,
  publicFacts: LiveFacts,
): PreviewOverlay | undefined {
  if (!teraSelected || publicFacts.terastallized || !isActiveMon(pokemon)) return undefined;
  const teraType = readOwnTeraType(battle, pokemon);
  if (!teraType) return undefined;
  return (resolved) => ({...resolved, terastallized: true, teraType});
}

/** Applies each preview overlay in turn (Mega, then a pending Tera), skipping any that
 *  don't apply — shared by every our-view surface that can carry both previews at once. */
function applyPreviews(base: ResolvedMon, previews: readonly (PreviewOverlay | undefined)[]): ResolvedMon {
  return previews.reduce((mon, apply) => (apply ? apply(mon) : mon), base);
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
  const {speciesData: _shownFormes, transformedInto: _notItsCopy, ...publicFacts} = defenderFacts;
  return suspectsFor(defenderFacts, defenderEntry, data).map(({species, entry}) => ({
    mon: resolveMon({...publicFacts, speciesForme: species, level: entry.level}, entry),
    role: species,
  }));
}

/**
 * Every species THIS format's feed could build with Illusion — the only ones able to wear
 * a disguise. Derived from the feed itself (`buildableAbilities`, the same pool law role
 * narrowing already uses) rather than a hardcoded species list, so a mod with a different —
 * or no — Illusion holder needs no code change here.
 */
function illusionHolders(data: RandbatsData): IllusionSuspect[] {
  return Object.keys(data)
    .map((species): IllusionSuspect | null => {
      const entry = pickEntry(data, species);
      return entry && buildableAbilities(entry).has('illusion') ? {species, entry} : null;
    })
    .filter((x): x is IllusionSuspect => x !== null);
}

/** The species the hovered mon might secretly be, given the feed's Illusion holders. */
function suspectsFor(facts: LiveFacts, entry: RandbatsEntry | undefined, data: RandbatsData): IllusionSuspect[] {
  return illusionSuspects(facts, entry, illusionHolders(data));
}

/**
 * The Mega forme(s) this Pokémon might still evolve into (Champions), while a held Mega
 * stone remains genuinely possible: nothing about the item has been revealed yet. A
 * revealed item either already resolved to the Mega set (`entryFor`'s own
 * `megaEntryForItem` check) or rules Mega out entirely — and a LOST item (`prevItem` set)
 * rules it out too, since Mega Evolution needs the stone in hand. `megaEntriesFor` finds
 * every still-possible Mega entry for the species; each becomes its own candidate source,
 * exactly like an Illusion suspect, so the sets view lists it instead of silently dropping it.
 */
function megaCandidatesFor(facts: LiveFacts, data: RandbatsData): readonly {forme: string; entry: RandbatsEntry}[] {
  if (facts.item !== undefined || facts.prevItem !== undefined) return [];
  return megaEntriesFor(data, facts.speciesForme);
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
  megaSelected: boolean,
  readFacts: FactsReader,
): string {
  if (foeVariants.length === 0) return '';
  const lines = ourActives.map((our): SpeedLineModel => {
    const publicFacts = ownTruth(battle, our, readFacts(our));
    const ourEntry = entryFor(data, publicFacts);
    const realItem = ourEntry ? ownItemName(battle, our, ourEntry) : undefined;
    const ourFacts = realItem ? {...publicFacts, item: realItem} : publicFacts;
    // A ticked Mega changes our effective Speed for the verdict — but only from gen 7
    // (see megaSpeedApplies). This is why the ⚡ read builds its own resolved mon rather
    // than sharing the damage attacker: the two diverge in gen 6.
    const applyMega = megaSpeedApplies(format.gen) ? megaPreviewFor(battle, our, megaSelected) : undefined;
    const baseMon = resolveMon(ourFacts, entryOrMinimal(ourEntry, ourFacts));
    const ourMon = applyMega ? applyMega(baseMon) : baseMon;
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
 *
 * `incomingMovesFor` adds the DEFENSIVE half — what the foe's own moves would do INTO
 * `attacker` — the other side of the same switch decision ("can it threaten?" is the
 * lines above; "does it survive?" is these). Its field is oriented the OPPOSITE way
 * from the outgoing lines' `field`: those read the foe as defender, this reads
 * `ourSide` as defender, so a screen or Tailwind on OUR side applies here and not
 * there (the same orientation trap `speedSection` vs this function's outgoing half
 * already has to get right). Absent in open formats, same reason as the ⚡ verdict —
 * and `ownHoverMatchup` withholds it again for the mon actually ACTIVE on the field,
 * regardless of format: hovering the FOE already shows their damage into our active
 * (the sets view's per-candidate move damage targets exactly that mon), so repeating
 * it here would be the same numbers twice. A switch-decision candidate — a revealed
 * bench mon's sidebar icon, or the switch menu — has no such other source, so it keeps
 * the group; that's the one case this half exists for at all.
 */
function ownMovesSection(
  battle: ClientBattle,
  ourSide: ClientSide | undefined,
  attacker: ResolvedMon,
  moves: readonly string[],
  format: {gen: number; doubles: boolean},
  readFacts: FactsReader,
  variantsFor: DefenderVariantsFor,
  foeSpeedVariants?: FoeSpeedVariantsFor,
  // The ⚡ line's own-side mon, when it must differ from the damage attacker: a pending
  // Mega changes damage in every gen but its Speed only counts for turn order from gen 7
  // (gen 6 moved at the base Speed the turn it evolved). Defaults to the damage attacker.
  speedAttacker: ResolvedMon = attacker,
  incomingMovesFor?: IncomingMovesFor,
  // True when hazards on switch-in would faint `attacker` before it can even take the
  // foe's hit — the caller already dropped `incomingMovesFor` in that case (there is
  // nothing left to survive), so this is what tells the render layer to say so instead
  // of silently showing no Incoming group at all. It has to be its own flag rather than
  // just piping 0% HP through: `calcDamage` floors remaining HP at 1, so a true 0 would
  // come back as a technically-real but dishonest "100% to KO at 0% HP". See
  // `core/hazards.ts`.
  hazardFaints = false,
): string {
  const sections = activesOpposing(battle, ourSide).map((foe) => {
    const defenderFacts = readFacts(foe);
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
      ? speedOrderVs(speedAttacker, foeSpeedVariants(foe, defenderFacts), field, format.gen)
      : undefined;
    // Incoming reads `ourSide` as the defender — the opposite orientation from `field` above.
    const incomingField = readFieldFacts(battle, ourSide);
    const incomingRows = (incomingMovesFor ? incomingMovesFor(defenderFacts) : [])
      .map(({move, known, variants}) => ({
        name: move,
        known,
        buckets: incomingDamageBuckets(attacker, variants, move, format.gen, incomingField, format.doubles),
      }))
      .filter((row) => row.buckets.length > 0);
    const incoming = incomingRows.length > 0
      ? {attackerHpPercent: attacker.hpPercent, moves: incomingRows}
      : hazardFaints ? {attackerHpPercent: attacker.hpPercent, moves: [], hazardFaints: true} : undefined;
    return {
      foeName: defenderFacts.speciesForme,
      defenderHpPercent: defenderFacts.hpPercent,
      moves: rows,
      ...(speed ? {speed} : {}),
      ...(incoming ? {incoming} : {}),
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
  target: HoverTarget,
  publicFacts: LiveFacts,
  data: RandbatsData,
  format: {gen: number; doubles: boolean},
  megaSelected: boolean,
  teraSelected: boolean,
  readFacts: FactsReader,
): string {
  const moves = readOwnMoves(battle, pokemon);
  const facts = ownTruth(battle, pokemon, publicFacts);
  const entry = entryFor(data, facts);
  if (!moves || !entry || facts.hpPercent <= 0) return '';
  // Your Pokémon, your damage: your real item and ability beat the set's assumed ones
  // (same principle as buildMoveSection's attacker).
  const realItem = ownItemName(battle, pokemon, entry);
  const realAbility = ownAbilityName(battle, pokemon, entry);
  const ownFacts = {...facts, ...(realItem ? {item: realItem} : {}), ...(realAbility ? {ability: realAbility} : {})};
  const base = resolveMon(ownFacts, entry);
  // A ticked Mega or a ticked Terastallize previews the same way as the move tooltip: their
  // offensive stats/STAB hit this view's damage exactly like they hit the tooltip's — one
  // preview law, two surfaces (see `teraPreviewFor`/`megaPreviewFor`). Speed stays Mega-only
  // (its Speed hits the ⚡ line from gen 7, `megaSpeedApplies`) — Tera never changes stats,
  // so it has nothing to add there.
  // Only the ⚡ line can still see a pending gimmick here, and only Mega — a Mega's Speed
  // moves the verdict from gen 7 (`megaSpeedApplies`), while Tera never changes Speed at
  // all. The DAMAGE side takes no preview because this view no longer computes damage for
  // an active mon (see `outgoingMoves` below), and a benched mon can neither Mega nor Tera
  // on the turn it switches in — so `base` is the honest attacker in both cases.
  const applyMega = megaPreviewFor(battle, pokemon, megaSelected);
  const attacker = base;
  const speedAttacker = applyMega && megaSpeedApplies(format.gen) ? applyMega(base) : base;
  // Our real item feeds the ⚡ line too: a Scarf we are holding is our own private
  // truth, and showing US our own speed as uncertain would be absurd.
  const speedFor = (foe: ClientPokemon, foeFacts: LiveFacts): readonly SetVariant[] => {
    const all = randbatsFoeVariants(data, foeFacts);
    return revealsAgainst(battle, foe, data, format, readFacts)?.narrow(all) ?? all;
  };
  // Which of the three halves this target carries is the grid's call, not this
  // function's — `core/surfaces.ts` holds both the cells and the reason each empty one is
  // empty (the two withheld here are one law: never show the same number on two
  // surfaces). Hazards ride on the same underlying fact, so they read from it too rather
  // than from a second copy of "is this mon on the field".
  const previewsHazards = previewsSwitchInHazards(target);
  const incomingMovesFor = shows(target, 'incoming') ? randbatsIncomingMovesFor(data) : undefined;
  const ownHazards = previewsHazards ? readOwnHazards(pokemon.side) : {stealthRock: false, spikesLayers: 0};
  const switchInAttacker = previewsHazards ? applySwitchInHazards(attacker, ownHazards, format.gen) : attacker;
  const hazardFaints = previewsHazards && switchInAttacker.hpPercent <= 0;
  const outgoingMoves = shows(target, 'outgoing') ? moves : [];
  return ownMovesSection(
    battle, pokemon.side, switchInAttacker, outgoingMoves, format, readFacts, randbatsVariantsFor(data), speedFor,
    speedAttacker, hazardFaints ? undefined : incomingMovesFor, hazardFaints,
  );
}

/**
 * Hovering a FOE's roster icon adds the direction the sets view doesn't cover: OUR
 * active's real moves' damage into THIS Pokémon, as though it were the one switched
 * in. The sets view (rendered right after this by the caller) already answers the
 * mirror question — their moves into us — for every foe hover, active or not; an
 * ACTIVE foe additionally already has THIS number on the move tooltip, so this stays
 * silent there rather than repeat it — the same reasoning `ownMovesSection` already
 * applies to withhold its own Incoming group from a mon already on the field. A
 * hovered foe with hazards up on ITS OWN side (Stealth Rock/Spikes we've set) previews
 * the chip it would take switching in, exactly like `applySwitchInHazards` already
 * does for our own switch candidates — hazards are public `sideConditions` on both
 * sides, so unlike our real item/ability this carries no privacy boundary to respect.
 */
function foeSwitchInDamage(
  battle: ClientBattle,
  hoveredFoe: ClientPokemon,
  foeFacts: LiveFacts,
  data: RandbatsData,
  format: {gen: number; doubles: boolean},
  megaSelected: boolean,
  teraSelected: boolean,
  readFacts: FactsReader,
): string {
  if (foeFacts.hpPercent <= 0) return ''; // fainted — can't switch in
  // "Opposing", read from the hovered FOE's own side, is US — the same read
  // `randbatsPokemonSection` already uses to find our defender for the sets view.
  const ourActive = findOpposingActive(battle, hoveredFoe);
  if (!ourActive) return '';
  const moves = readOwnMoves(battle, ourActive);
  if (!moves) return ''; // spectating — no private moveset to read
  const ourFacts = ownTruth(battle, ourActive, readFacts(ourActive));
  const ourEntry = entryFor(data, ourFacts);
  if (!ourEntry) return '';
  const realItem = ownItemName(battle, ourActive, ourEntry);
  const realAbility = ownAbilityName(battle, ourActive, ourEntry);
  const attackerFacts = {...ourFacts, ...(realItem ? {item: realItem} : {}), ...(realAbility ? {ability: realAbility} : {})};
  const base = resolveMon(attackerFacts, ourEntry);
  // A ticked Mega or Tera previews the same way as every other our-view attacker site
  // (`teraPreviewFor`/`megaPreviewFor`) — this is our ACTIVE mon's pending move, same
  // footing as the move tooltip and the matchup view.
  const applyMega = megaPreviewFor(battle, ourActive, megaSelected);
  const applyTera = teraPreviewFor(battle, ourActive, teraSelected, ourFacts);
  const attacker = applyPreviews(base, [applyMega, applyTera]);

  const foeVariants = randbatsFoeVariants(data, foeFacts);
  if (foeVariants.length === 0) return '';
  const hazards = readOwnHazards(hoveredFoe.side); // THEIR side's hazards chip THEM on the way in
  const switchedIn = foeVariants.map((v) => ({...v, mon: applySwitchInHazards(v.mon, hazards, format.gen)}));

  const field = readFieldFacts(battle, hoveredFoe.side); // the hovered foe is the defender here
  const rows = moves
    .map((move) => moveDamageBuckets(attacker, switchedIn, move, format.gen, field, format.doubles))
    .filter((buckets) => buckets.length > 0)
    .map((buckets) => ({name: buckets[0]!.report.move, buckets}));
  if (rows.length === 0) return '';

  return renderOwnMovesSection([{
    foeName: foeFacts.speciesForme,
    defenderHpPercent: switchedIn[0]!.mon.hpPercent,
    moves: rows,
  }]);
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
  const target: HoverTarget = 'switch-menu'; // this surface IS one target — the client gives it its own renderer
  const format = detectFormat(battle);
  if (!format) return '';
  const moves = server.moves ?? [];
  const facts = serverPokemonFacts(server, battle);
  if (!facts || facts.hpPercent <= 0 || moves.length === 0) return '';
  const speciesData = readSpeciesData(battle, facts);
  const factsWithDex = {...facts, ...(speciesData ? {speciesData} : {})};
  const ourSide = nearSide(battle);
  const readFacts = factsReader(battle, format.gen, data);

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
      const speedFor = (foe: ClientPokemon, foeFacts: LiveFacts): readonly SetVariant[] => {
        const all = randbatsFoeVariants(data, foeFacts);
        return revealsAgainst(battle, foe, data, format, readFacts)?.narrow(all) ?? all;
      };
      // Every switch-menu candidate is, by construction, not yet on the field — which is
      // why the hazard preview here needs no branch at all (`previewsSwitchInHazards` is
      // true for this whole surface), while `ownHoverMatchup`, whose target can be either,
      // has to ask.
      const ownHazards = readOwnHazards(ourSide);
      const switchInAttacker = applySwitchInHazards(attacker, ownHazards, format.gen);
      const hazardFaints = switchInAttacker.hpPercent <= 0;
      const incomingMovesFor = shows(target, 'incoming') ? randbatsIncomingMovesFor(data) : undefined;
      return ownMovesSection(
        battle, ourSide, switchInAttacker, shows(target, 'outgoing') ? moves : [], format, readFacts,
        randbatsVariantsFor(data), speedFor,
        switchInAttacker, hazardFaints ? undefined : incomingMovesFor, hazardFaints,
      );
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
      const html = ownMovesSection(battle, ourSide, attacker, moves, format, readFacts, openVariantsFor(format.gen));
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

/** Every still-possible set for ONE candidate role, keyed by role name — the same
 *  role-name alignment `randbatsIncomingMovesFor` already relies on, now used to fan a
 *  candidate's damage out over its own hidden item/ability instead of guessing one
 *  representative set the way `resolveByRole` did for this call site before (that
 *  function is unchanged and still tested directly in `resolve.test.ts` — just no
 *  longer consumed here). */
function groupByRole(variants: readonly SetVariant[]): Map<string, SetVariant[]> {
  const out = new Map<string, SetVariant[]>();
  for (const v of variants) {
    const list = out.get(v.role);
    if (list) list.push(v);
    else out.set(v.role, [v]);
  }
  return out;
}

/**
 * The distinct damage outcomes for each of `moves`, from every still-possible variant of
 * ONE candidate role into `defender` — the sets view's per-candidate damage, computed the
 * same way the Incoming section already computes an uncertain ATTACKER's threat
 * (`incomingDamageBuckets`): enumerate every item/ability the role could still be running
 * rather than picking a representative one and hoping. A role with no real uncertainty
 * (one variant, or every variant landing on the same number) still comes back as a single
 * bucket with an empty label — the caller renders that inline exactly as it always has;
 * only a REAL split (an Assault Vest that changes the number) grows a second outcome.
 * Status moves and moves the calc can't model for this role are simply absent.
 *
 * Requests the nHKO ladder up to turn 2 — `render.koTier` reads its turn-2 figure to color
 * a move '2hko' when it can't OHKO outright but a second use realistically could, so a fast
 * scan down the block still flags danger the raw percent alone wouldn't at a glance.
 */
function candidateDamageByMove(
  roleVariants: readonly SetVariant[],
  defender: ResolvedMon,
  moves: readonly string[],
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
): Map<string, DamageBucket[]> {
  const out = new Map<string, DamageBucket[]>();
  for (const move of moves) {
    const buckets = incomingDamageBuckets(defender, roleVariants, move, gen, field, doubles, 2);
    if (buckets.length > 0) out.set(toId(move), buckets);
  }
  return out;
}

/**
 * Score `moveName` over a pool of still-possible sets, one calc run per variant, and
 * bucket the results into the distinct outcomes. `build` picks which side of the calc
 * each variant fills — the shared core for both damage directions: `moveDamageBuckets`
 * varies the DEFENDER (a fixed attacker's move into an uncertain foe), and
 * `incomingDamageBuckets` varies the ATTACKER (an uncertain foe's move into a fixed
 * defender). Status and unmodellable variants are dropped; an all-dropped move yields
 * no buckets.
 */
function scoreVariants(
  variants: readonly SetVariant[],
  moveName: string,
  build: (mon: ResolvedMon) => readonly [attacker: ResolvedMon, defender: ResolvedMon],
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
  nhkoTurns?: number,
  selfHp = false,
): DamageBucket[] {
  const scored: {variant: SetVariant; report: DamageReport}[] = [];
  for (const variant of variants) {
    try {
      const [atk, def] = build(variant.mon);
      const report = calcDamage(atk, def, moveName, {
        gen,
        field,
        doubles,
        ...(nhkoTurns !== undefined ? {nhkoTurns} : {}),
        ...(selfHp ? {selfHp} : {}),
      });
      if (report.category !== 'Status') scored.push({variant, report});
    } catch {
      // A move outside the calc's world for this variant shouldn't drop the section.
    }
  }
  return bucketByDamage(scored);
}

/**
 * The distinct damage outcomes for `moveName` from `attacker` into the target, one
 * per still-possible defending set, merged where they land on the same number.
 * `nhkoTurns` requests the nHKO ladder (the move tooltip shows it; the compact
 * own-hover view doesn't, and skips the survival sim). `selfHp` requests the attacker's own
 * drain/recoil swing on exactly the same terms — the move tooltip renders it, the compact
 * views don't, and a view that doesn't ask keeps its buckets keyed as before.
 */
function moveDamageBuckets(
  attacker: ResolvedMon,
  defenderVariants: readonly SetVariant[],
  moveName: string,
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
  nhkoTurns?: number,
  selfHp = false,
): DamageBucket[] {
  return scoreVariants(defenderVariants, moveName, (mon) => [attacker, mon], gen, field, doubles, nhkoTurns, selfHp);
}

/**
 * The distinct damage outcomes for `moveName` from a still-uncertain ATTACKER into a fixed
 * `defender` — shared by two callers that vary the attacker instead of the defender: the
 * matchup view's defensive half (what a foe's move would do INTO the mon being evaluated;
 * `attackerVariants` from `IncomingMovesFor`, no nHKO ladder — matching `moveDamageBuckets`'
 * compact-view scope) and the sets view's per-candidate damage (`candidateDamageByMove`,
 * which DOES request the ladder — see `nhkoTurns`). `nhkoTurns` defaults to unrequested so
 * the Incoming section's own call stays exactly as compact as before.
 */
function incomingDamageBuckets(
  defender: ResolvedMon,
  attackerVariants: readonly SetVariant[],
  moveName: string,
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
  nhkoTurns?: number,
): DamageBucket[] {
  return scoreVariants(attackerVariants, moveName, (mon) => [mon, defender], gen, field, doubles, nhkoTurns);
}

/**
 * The move-button tooltip section: `moveName` from our active `pokemon` into the
 * opposing active. When the target's item is still unknown and it changes the number
 * (an Assault Vest that may or may not be there), the distinct outcomes each get a
 * labelled line; otherwise it's the plain "Damage:" line. Returns '' when there's
 * nothing to show (not a Random Battle, no target, untracked species, no modellable
 * outcome). `teraSelected`/`megaSelected` are the move panel's gimmick checkboxes
 * (content.ts reads the DOM): when ticked, the damage previews that gimmick as already
 * active — the Tera type, or the Mega forme's stats/ability/type.
 */
export function buildMoveSection(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  moveName: string,
  data: RandbatsData | null,
  teraSelected = false,
  megaSelected = false,
): string {
  const format = detectFormat(battle);
  if (!format) return '';

  // Both foes in doubles, one in singles — a damage section per target.
  const foes = findOpposingActives(battle, pokemon);
  if (foes.length === 0) return '';

  const readFacts = factsReader(battle, format.gen, data);
  // Our attacker: public battle state, private identity (Illusion disguises us to us too).
  const publicFacts = ownTruth(battle, pokemon, readFacts(pokemon));
  // Terastallize ticked: preview OUR private Tera type. Mega Evolution ticked: preview the
  // Mega forme's stats/ability/type. Both are the user's declared intent over our own private
  // truth, not speculation — see `teraPreviewFor`/`megaPreviewFor`. Both apply regardless of
  // generation (unlike the ⚡ Speed's Mega split, gen 7+) since offensive stats and STAB take
  // effect the same turn the gimmick is used.
  const applyMega = megaPreviewFor(battle, pokemon, megaSelected);
  const applyTera = teraPreviewFor(battle, pokemon, teraSelected, publicFacts);
  const withPreviews = (attacker: ResolvedMon): ResolvedMon => applyPreviews(attacker, [applyMega, applyTera]);

  switch (format.kind) {
    case 'randbats': {
      if (!data) return ''; // the feed is still warming — same silence as before it loads
      const attackerEntry = entryFor(data, publicFacts);
      if (!attackerEntry) return '';
      // Your move, your damage: prefer your REAL item and ability over the set's assumed
      // first pick, so a Heavy-Duty Boots Iron Bundle isn't calculated as Choice Specs, and
      // a not-yet-revealed Huge Power Azumarill isn't calculated as ability-less. Treated
      // like a revealed fact for resolution — but only here, never in the opponent's-
      // knowledge views.
      const realItem = ownItemName(battle, pokemon, attackerEntry);
      const realAbility = ownAbilityName(battle, pokemon, attackerEntry);
      const attackerFacts = {
        ...publicFacts,
        ...(realItem ? {item: realItem} : {}),
        ...(realAbility ? {ability: realAbility} : {}),
      };
      const attacker = withPreviews(resolveMon(attackerFacts, attackerEntry));
      // Name each target only when there's more than one (doubles) — singles keeps native parity.
      return foes.map((foe) => moveVsFoe(attacker, foe, moveName, format, data, battle, readFacts, foes.length > 1)).join('');
    }
    case 'open': {
      // No pool to match the item/ability against: the raw id form goes straight in — the
      // damage layer resolves ids through the calc's dex (`knownItem`/`knownAbility`). Our
      // exact finals come from the private team's stats table; the rest of the facts are
      // the public reads.
      const realItem = readOwnItem(battle, pokemon);
      const realAbility = readOwnAbility(battle, pokemon);
      const knownStats = readOwnStats(battle, pokemon);
      const attackerFacts = {
        ...publicFacts,
        ...(realItem ? {item: realItem} : {}),
        ...(realAbility ? {ability: realAbility} : {}),
        ...(knownStats ? {knownStats} : {}),
      };
      const attacker = withPreviews(resolveMon(attackerFacts, entryOrMinimal(undefined, attackerFacts)));
      const variantsFor = openVariantsFor(format.gen);
      const sections = foes
        .map((foe) => openMoveVsFoe(attacker, foe, moveName, format, battle, readFacts, variantsFor, foes.length > 1))
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
  readFacts: FactsReader,
  variantsFor: DefenderVariantsFor,
  label: boolean,
): string {
  const defenderFacts = readFacts(defenderMon);
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
  readFacts: FactsReader,
  label: boolean,
): string {
  const defenderFacts = readFacts(defenderMon);
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

  // Strength Sap deals no damage either — it siphons the target's Attack as HP, so the
  // calc's zero says nothing and the swing replaces it. It reads the same variants the
  // damage path does, because the axis that splits it is the target's own spread.
  if (toId(moveName) === 'strengthsap') {
    return renderStrengthSap(strengthSap(attacker, defenderVariants, format.gen), targetLabel);
  }

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
  const buckets = moveDamageBuckets(attacker, defenderVariants, moveName, format.gen, field, format.doubles, 3, true);
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
 * THIS set's own item/spread/species — one or more distinct outcomes per move, bucketed
 * over whatever the role's item/ability fan-out still leaves open. `species` is set only
 * for an Illusion candidate (a Zoroark the hovered mon might secretly be), which the
 * renderer flags as such.
 */
function toBlock(c: CandidateSet, species: string | undefined, damage: Map<string, readonly DamageBucket[]> | undefined): CandidateBlock {
  return {
    name: c.name,
    ...(species ? {species} : {}),
    abilities: c.abilities,
    items: c.items,
    gimmicks: c.gimmicks,
    moves: c.moves.map((m): MoveKnowledgeRow => {
      const buckets = damage?.get(toId(m.name));
      return {name: m.name, known: m.known, ...(buckets ? {buckets} : {})};
    }),
  };
}

/**
 * A transformed Pokémon attacks with the moveset it COPIED, so that is what its block must
 * show: its own set's moves are moot (Ditto's is a lone Transform, and it has been used).
 * Only the moves are replaced — Transform takes neither item nor ability — so the block goes
 * on naming the Ditto set that is holding the Choice Scarf, and lists under it the moves
 * actually about to be aimed at us, each with its damage.
 */
function withCopiedMoves(c: CandidateSet, facts: LiveFacts): CandidateSet {
  const copy = facts.transformedInto;
  if (!copy) return c;
  return {...c, moves: copy.moves.map((name) => ({name, known: copy.movesKnown}))};
}

/**
 * The Pokémon tooltip section: the still-possible sets, one block per candidate,
 * in the original Randbats Tooltip's layout. Hovering the opponent narrows their
 * sets by every public reveal and attaches each move's damage vs our active;
 * hovering our own Pokémon shows the mirror — what the opponent can deduce from
 * what we've made public. Returns '' when the format or species isn't covered.
 * `megaSelected`/`teraSelected` are the move panel's gimmick checkboxes (content.ts reads
 * the DOM): when ticked, our-view surfaces preview our active mon's Mega forme or Tera type.
 */
export function buildPokemonSection(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  data: RandbatsData | null,
  megaSelected = false,
  teraSelected = false,
): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const readFacts = factsReader(battle, format.gen, data);
  const facts = readFacts(pokemon);

  switch (format.kind) {
    case 'randbats':
      return data ? randbatsPokemonSection(battle, pokemon, facts, data, format, megaSelected, teraSelected, readFacts) : '';
    case 'open': {
      // No sets/mirror view (nothing to infer without a pool) and nothing on a FOE
      // hover in v1; our own mon gets the matchup view — the switch-decision answer —
      // built from the private team, exactly like the move tooltip's attacker.
      if (isFoe(battle, pokemon)) return '';
      const moves = readOwnMoves(battle, pokemon);
      if (!moves || facts.hpPercent <= 0) return '';
      const realItem = readOwnItem(battle, pokemon);
      const realAbility = readOwnAbility(battle, pokemon);
      const knownStats = readOwnStats(battle, pokemon);
      const ourFacts = ownTruth(battle, pokemon, facts);
      const attackerFacts = {
        ...ourFacts,
        ...(realItem ? {item: realItem} : {}),
        ...(realAbility ? {ability: realAbility} : {}),
        ...(knownStats ? {knownStats} : {}),
      };
      const base = resolveMon(attackerFacts, entryOrMinimal(undefined, attackerFacts));
      // A ticked Mega or Tera previews the same way as the move tooltip's open-format
      // arm (`teraPreviewFor`/`megaPreviewFor`); there's no ⚡ line in an open format (no
      // feed to read a foe Speed from), so Mega's gen-6 Speed split is moot either way.
      const applyMega = megaPreviewFor(battle, pokemon, megaSelected);
      const applyTera = teraPreviewFor(battle, pokemon, teraSelected, ourFacts);
      const attacker = applyPreviews(base, [applyMega, applyTera]);
      const html = ownMovesSection(battle, pokemon.side, attacker, moves, format, readFacts, openVariantsFor(format.gen));
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
  megaSelected: boolean,
  teraSelected: boolean,
  readFacts: FactsReader,
): string {
  const entry = entryFor(data, facts);
  if (!entry) return ''; // not a tracked randbats Pokémon

  const shown = inferSets(facts, entry);
  const notes = shown.uncertainReason ? [shown.uncertainReason] : [];

  // The hovered species, plus any Zoroark it might secretly be (Illusion) and any Mega
  // forme it might still evolve into (Champions), as candidate sources. Each contributes
  // its own blocks; an Illusion source tags its blocks with the species it might really be
  // (its own set + species drive that block's damage). A Mega candidate stays untagged — it
  // is still the same Pokémon, just a set living under a different feed entry.
  const sources = [
    {facts, entry, species: undefined as string | undefined, knowledge: shown},
    ...suspectsFor(facts, entry, data).map(({species, entry: e}) => {
      // A suspected Zoroark is a different Pokémon: neither the shown forme's dex data nor
      // any Transform copy belongs to it.
      const {transformedInto: _notItsCopy, ...shownFacts} = facts;
      const f: LiveFacts = {...shownFacts, speciesForme: species, level: e.level};
      return {facts: f, entry: e, species: species as string | undefined, knowledge: inferSets(f, e)};
    }),
    ...megaCandidatesFor(facts, data).map(({forme, entry: e}) => {
      const {transformedInto: _notItsCopy, ...shownFacts} = facts;
      const f: LiveFacts = {...shownFacts, speciesForme: forme, level: e.level};
      return {facts: f, entry: e, species: undefined as string | undefined, knowledge: inferSets(f, e)};
    }),
  ];

  // Which of the six surfaces this hover IS — decided once, from the only two facts that
  // distinguish them, and read from `core/surfaces.ts` everywhere below rather than
  // re-derived per section.
  const target = pokemonHoverTarget(isFoe(battle, pokemon), isActiveMon(pokemon));
  // Foe view: attach each possible move's damage into OUR active (their move buttons
  // aren't hoverable for us). The own-side mirror carries no damage — public info only.
  const ourMon = shows(target, 'sets') ? findOpposingActive(battle, pokemon) : null;
  // The threat lands on the Pokémon really standing there, not on the disguise we're wearing.
  const ourFacts = ourMon ? ownTruth(battle, ourMon, readFacts(ourMon)) : null;
  // A ticked Mega/Terastallize changes what the foe's moves do INTO us, not only what our
  // own moves do out of us — so the same overlay that previews our attacker everywhere else
  // previews our DEFENDER here. Unconditional, with no speed caveat: both resolve as their
  // own action ahead of every move (`sim/battle-queue.ts` orders `terastallize` 106 and
  // `megaEvo` 104 against a move's 200), so the new typing and stats are already in place no
  // matter who moves first. Same private-truth-plus-declared-intent footing as the offensive
  // preview, and deliberately the SAME `teraPreviewFor`/`megaPreviewFor` rather than a
  // defensive fork — a Tera that grants STAB on our move is the same Tera that resists
  // theirs, so the two directions must never disagree about which type is active.
  // Our mon WITHOUT the pending previews. Every log reading describes a turn already fought,
  // and a Mega or Tera merely ticked in the move panel was not in effect for any of them —
  // so `foeReveals` takes this one, while the DISPLAYED damage below takes the previewed
  // `defender`, which is a claim about the turn to come.
  const defenderNow = ourMon && ourFacts
    ? resolveMon(ourFacts, entryOrMinimal(entryFor(data, ourFacts), ourFacts))
    : null;
  const defender = defenderNow && ourMon && ourFacts
    ? applyPreviews(defenderNow, [
        megaPreviewFor(battle, ourMon, megaSelected),
        teraPreviewFor(battle, ourMon, teraSelected, ourFacts),
      ])
    : null;
  const field = ourMon ? readFieldFacts(battle, ourMon.side) : undefined;
  // What the LOG reveals about this foe, beyond anything the snapshot shows — the damage a
  // past hit dealt, and who moved first. Gathered once and applied everywhere below, so the
  // Items line, the per-move damage and the ⚡ verdict cannot disagree about the same set.
  // A no-op on the common hover where neither observation is safe to read.
  const reveals = foeReveals(
    battle, pokemon, ourMon, defender, field, format, defenderNow,
    ourMon && ourFacts ? exactOwnAttacker(battle, ourMon, ourFacts, data) : null,
  );

  const blocks: CandidateBlock[] = [];
  for (const s of sources) {
    const variants = resolveVariants(s.facts, s.entry);
    const narrowed = reveals ? reveals.narrow(variants) : variants;
    const variantsByRole = defender ? groupByRole(narrowed) : new Map<string, SetVariant[]>();
    // Grouped separately from the damage map, because the OPTIONS a block advertises must be
    // cut down even on a surface that shows no damage at all.
    const survivingByRole = groupByRole(narrowed);
    s.knowledge.candidates.forEach((c) => {
      const shown = withCopiedMoves(c, s.facts);
      const roleVariants = variantsByRole.get(c.name) ?? [];
      const damage = defender && field && roleVariants.length > 0
        ? candidateDamageByMove(roleVariants, defender, shown.moves.map((m) => m.name), format.gen, field, format.doubles)
        : undefined;
      const cut = reveals ? narrowCandidate(shown, survivingByRole.get(c.name) ?? []) : shown;
      blocks.push(toBlock(cut, s.species, damage));
    });
  }
  if (blocks.every((b) => b.moves.length === 0)) return '';

  // The at-a-glance verdict, above the set blocks — where the "if Choice Scarf" aside
  // sits directly over the candidate sets that produce that Scarf. Our own hover gets
  // its ⚡ line inside the matchup block instead (same pair, read from our side); what
  // stays foe-only is this placement, not the fact. The mirror below never gets one:
  // its honesty rests on carrying nothing but public info.
  const speedHtml = shows(target, 'speedLead')
    ? speedSection(
        battle,
        // The same narrowing the blocks below get: a Scarf the move order has ruled out must
        // not survive as an "if Choice Scarf" aside over a block that no longer lists it.
        (() => {
          const all = [...resolveVariants(facts, entry), ...illusionVariants(facts, entry, data)];
          return reveals ? reveals.narrow(all) : all;
        })(),
        findOpposingActives(battle, pokemon),
        data,
        format,
        megaSelected,
        readFacts,
      )
    : '';
  // Own view's at-a-glance answer: OUR moves' damage into the current foe (private
  // moveset — an our-view surface). Leads the tooltip like ⚡ does on a foe hover;
  // the mirror blocks below remain strictly public.
  const ownMovesHtml = hasMatchupBlock(target)
    ? ownHoverMatchup(battle, pokemon, target, facts, data, format, megaSelected, teraSelected, readFacts)
    : '';
  // Foe view's own at-a-glance answer, but only for a switch-decision candidate (not
  // yet active): OUR active's damage into THIS Pokémon if it switched in. An active
  // foe already carries this number on the move tooltip, so it's withheld there —
  // see foeSwitchInDamage's own doc comment for why.
  const foeMovesHtml = shows(target, 'ourDamageInto')
    ? foeSwitchInDamage(battle, pokemon, facts, data, format, megaSelected, teraSelected, readFacts)
    : '';

  return speedHtml + foeMovesHtml + ownMovesHtml + renderSetsSection({candidates: blocks, extraNotes: notes});
}
