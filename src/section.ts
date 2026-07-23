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
  TransformCopy,
} from './core/types.js';
import {transformCopy} from './core/transform.js';
import {applySwitchInHazards} from './core/hazards.js';
import {pickEntry, megaEntryForItem, megaEntriesFor} from './data/randbats.js';
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
 *  alignment `resolveByRole` already relies on for the sets view's own per-candidate
 *  damage. Never a set's first-guessed item: hidden Life Orb/Choice item splits an
 *  incoming line into labelled outcomes exactly like the move tooltip's defender side. */
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
    const facts = factsFor(battle, mon);
    const target = readTransformTarget(mon);
    if (!target) return facts;
    const copy = transformCopyFor(battle, gen, facts, target, resolve);
    return copy ? {...facts, transformedInto: copy} : facts;
  };
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
 * Overlay the pending Mega forme onto OUR resolved attacker: the mon the move panel's
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
): ((attacker: ResolvedMon) => ResolvedMon) | undefined {
  // The Mega box belongs to the mon whose move panel is open — our ACTIVE mon. A benched
  // or revealed-but-inactive mon we're hovering can't Mega this turn even holding a stone.
  if (!megaSelected || !isActiveMon(mon)) return undefined;
  const mega = readMegaForme(battle, mon);
  if (!mega) return undefined;
  return (attacker) => {
    const {knownStats: _baseFormeFinals, ...rest} = attacker;
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
  // of silently showing no Incoming group at all. See `core/hazards.ts`.
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
      ? speedOrderVs(speedAttacker, foeSpeedVariants(defenderFacts), field, format.gen)
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
  publicFacts: LiveFacts,
  data: RandbatsData,
  format: {gen: number; doubles: boolean},
  megaSelected: boolean,
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
  // A ticked Mega previews the Mega forme here just as on the move tooltip: its stats hit
  // the damage every gen, its Speed hits the ⚡ line from gen 7 (megaSpeedApplies).
  const applyMega = megaPreviewFor(battle, pokemon, megaSelected);
  const attacker = applyMega ? applyMega(base) : base;
  const speedAttacker = applyMega && megaSpeedApplies(format.gen) ? attacker : base;
  // Our real item feeds the ⚡ line too: a Scarf we are holding is our own private
  // truth, and showing US our own speed as uncertain would be absurd.
  const speedFor = (foeFacts: LiveFacts): readonly SetVariant[] => randbatsFoeVariants(data, foeFacts);
  // The mon actually on the field gets its Incoming numbers from hovering the FOE
  // instead (see the doc comment above) — only a switch-decision candidate keeps them,
  // and only a switch-decision candidate can still be hit by hazards on the way in (an
  // active mon's HP already reflects anything that already happened to it).
  const isSwitchCandidate = !isActiveMon(pokemon);
  const incomingMovesFor = isSwitchCandidate ? randbatsIncomingMovesFor(data) : undefined;
  const ownHazards = isSwitchCandidate ? readOwnHazards(pokemon.side) : {stealthRock: false, spikesLayers: 0};
  const switchInAttacker = isSwitchCandidate ? applySwitchInHazards(attacker, ownHazards, format.gen) : attacker;
  const hazardFaints = isSwitchCandidate && switchInAttacker.hpPercent <= 0;
  return ownMovesSection(
    battle, pokemon.side, switchInAttacker, moves, format, readFacts, randbatsVariantsFor(data), speedFor,
    speedAttacker, hazardFaints ? undefined : incomingMovesFor, hazardFaints,
  );
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
      const speedFor = (foeFacts: LiveFacts): readonly SetVariant[] => randbatsFoeVariants(data, foeFacts);
      // Every switch-menu candidate is, by construction, not yet on the field — so
      // unlike ownHoverMatchup there's no active-mon branch to skip here.
      const ownHazards = readOwnHazards(ourSide);
      const switchInAttacker = applySwitchInHazards(attacker, ownHazards, format.gen);
      const hazardFaints = switchInAttacker.hpPercent <= 0;
      return ownMovesSection(
        battle, ourSide, switchInAttacker, moves, format, readFacts, randbatsVariantsFor(data), speedFor,
        switchInAttacker, hazardFaints ? undefined : randbatsIncomingMovesFor(data), hazardFaints,
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
): DamageBucket[] {
  const scored: {variant: SetVariant; report: DamageReport}[] = [];
  for (const variant of variants) {
    try {
      const [atk, def] = build(variant.mon);
      const report = calcDamage(atk, def, moveName, {gen, field, doubles, ...(nhkoTurns !== undefined ? {nhkoTurns} : {})});
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
  return scoreVariants(defenderVariants, moveName, (mon) => [attacker, mon], gen, field, doubles, nhkoTurns);
}

/**
 * The distinct damage outcomes for `moveName` from a still-uncertain FOE into a fixed
 * `defender` — the defensive half of the matchup view: what the foe's move would do
 * INTO the mon being evaluated, rather than the other way round. `attackerVariants`
 * comes from `IncomingMovesFor`, already narrowed to the roles that could carry this
 * move. No nHKO ladder here either, matching `moveDamageBuckets`' compact-view scope.
 */
function incomingDamageBuckets(
  defender: ResolvedMon,
  attackerVariants: readonly SetVariant[],
  moveName: string,
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
): DamageBucket[] {
  return scoreVariants(attackerVariants, moveName, (mon) => [mon, defender], gen, field, doubles);
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
  // Terastallize is ticked for this turn: preview the damage with the Tera active, using
  // OUR private Tera type (an our-view surface, like the real-item read). Not speculation —
  // the type is our own truth and activating it is the user's declared intent. Moot once
  // actually terastallized (the public facts already carry it); absent when spectating.
  const pendingTera = teraSelected && !publicFacts.terastallized ? readOwnTeraType(battle, pokemon) : undefined;
  const teraFacts = pendingTera ? {terastallized: true, teraType: pendingTera} : {};
  // Mega Evolution is ticked: preview our attacker as the Mega forme. The Mega's Attack
  // (and typing/ability) apply the moment it evolves, on the same turn, in every gen —
  // so this rides on the damage regardless of generation (unlike the ⚡ Speed, gen 7+).
  const applyMega = megaPreviewFor(battle, pokemon, megaSelected);
  const asMega = (attacker: ResolvedMon): ResolvedMon => (applyMega ? applyMega(attacker) : attacker);

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
        ...teraFacts,
      };
      const attacker = asMega(resolveMon(attackerFacts, attackerEntry));
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
        ...teraFacts,
      };
      const attacker = asMega(resolveMon(attackerFacts, entryOrMinimal(undefined, attackerFacts)));
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
 * `megaSelected` is the move panel's Mega Evolution box (content.ts reads the DOM):
 * when ticked, our-view surfaces preview our active mon's Mega forme.
 */
export function buildPokemonSection(battle: ClientBattle, pokemon: ClientPokemon, data: RandbatsData | null, megaSelected = false): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const readFacts = factsReader(battle, format.gen, data);
  const facts = readFacts(pokemon);

  switch (format.kind) {
    case 'randbats':
      return data ? randbatsPokemonSection(battle, pokemon, facts, data, format, megaSelected, readFacts) : '';
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
      // A ticked Mega previews the forme's damage in every gen; there's no ⚡ line in an
      // open format (no feed to read a foe Speed from), so the gen-6 Speed split is moot.
      const applyMega = megaPreviewFor(battle, pokemon, megaSelected);
      const attacker = applyMega ? applyMega(base) : base;
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

  // Foe view: attach each possible move's damage into OUR active (their move buttons
  // aren't hoverable for us). The own-side mirror carries no damage — public info only.
  const foe = isFoe(battle, pokemon);
  const ourMon = foe ? findOpposingActive(battle, pokemon) : null;
  // The threat lands on the Pokémon really standing there, not on the disguise we're wearing.
  const ourFacts = ourMon ? ownTruth(battle, ourMon, readFacts(ourMon)) : null;
  const defender = ourFacts ? resolveMon(ourFacts, entryOrMinimal(entryFor(data, ourFacts), ourFacts)) : null;
  const field = ourMon ? readFieldFacts(battle, ourMon.side) : undefined;

  const blocks: CandidateBlock[] = [];
  for (const s of sources) {
    const attackers = defender ? resolveByRole(s.facts, s.entry) : []; // aligned 1:1 with candidates
    s.knowledge.candidates.forEach((c, i) => {
      const attacker = attackers[i]?.mon ?? attackers[0]?.mon;
      const shown = withCopiedMoves(c, s.facts);
      const damage = defender && attacker && field
        ? reportsByMove(attacker, defender, shown.moves.map((m) => m.name), format.gen, field)
        : undefined;
      blocks.push(toBlock(shown, s.species, damage));
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
        megaSelected,
        readFacts,
      )
    : '';
  // Own view's at-a-glance answer: OUR moves' damage into the current foe (private
  // moveset — an our-view surface). Leads the tooltip like ⚡ does on a foe hover;
  // the mirror blocks below remain strictly public.
  const ownMovesHtml = foe ? '' : ownHoverMatchup(battle, pokemon, facts, data, format, megaSelected, readFacts);

  return speedHtml + ownMovesHtml + renderSetsSection({candidates: blocks, extraNotes: notes});
}
