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

import {calcDamage, painSplit, type DamageReport} from './core/damage.js';
import {resolveByRole, resolveMon, resolveVariants} from './core/resolve.js';
import {inferSets} from './core/knowledge.js';
import {bucketByDamage, type DamageBucket} from './core/variants.js';
import {illusionSuspects, ILLUSION_SPECIES, type IllusionSuspect} from './core/illusion.js';
import {
  renderMoveSection,
  renderPainSplit,
  renderSetsSection,
  type CandidateBlock,
  type MoveKnowledgeRow,
  type SetsRenderModel,
} from './core/render.js';
import type {CandidateSet, LiveFacts, RandbatsData, RandbatsEntry, ResolvedMon, SetVariant} from './core/types.js';
import {pickEntry, megaEntryForItem} from './data/randbats.js';
import {
  toLiveFacts,
  readBehaviors,
  readOwnItem,
  findOpposingActive,
  detectFormat,
  readFieldFacts,
  type ClientBattle,
  type ClientPokemon,
} from './battle/readState.js';

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
 * If a revealed move betrays that the defender might be a disguised Zoroark (see
 * illusion.ts), a resolution of that Zoroark as an extra defender — so the move tooltip
 * shows a second "vs Zoroark-Hisui" damage line rather than one confidently-wrong number.
 * One representative set per suspect (not the full item fan-out) keeps the extra line to
 * a single, clearly-labelled bucket. Its own species/level drive the calc.
 */
function illusionVariants(defenderFacts: LiveFacts, defenderEntry: RandbatsEntry | undefined, data: RandbatsData): SetVariant[] {
  return suspectsFor(defenderFacts, defenderEntry, data).map(({species, entry}) => ({
    mon: resolveMon({...defenderFacts, speciesForme: species, level: entry.level}, entry),
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
 */
function moveDamageBuckets(
  attacker: ResolvedMon,
  defenderVariants: readonly SetVariant[],
  moveName: string,
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
): DamageBucket[] {
  const scored: {variant: SetVariant; report: DamageReport}[] = [];
  for (const variant of defenderVariants) {
    try {
      const report = calcDamage(attacker, variant.mon, moveName, {gen, field, nhkoTurns: 3});
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
 * outcome).
 */
export function buildMoveSection(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  moveName: string,
  data: RandbatsData,
): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const defenderMon = findOpposingActive(battle, pokemon);
  if (!defenderMon) return '';

  const publicFacts = toLiveFacts(pokemon, readBehaviors(battle, pokemon));
  const attackerEntry = entryFor(data, publicFacts);
  if (!attackerEntry) return '';

  // Your move, your damage: prefer your REAL item over the set's assumed first item, so a
  // Heavy-Duty Boots Iron Bundle isn't calculated as Choice Specs. Treated like a revealed
  // fact for resolution — but only here, never in the opponent's-knowledge views.
  const realItem = ownItemName(battle, pokemon, attackerEntry);
  const attackerFacts = realItem ? {...publicFacts, item: realItem} : publicFacts;

  const defenderFacts = toLiveFacts(defenderMon, readBehaviors(battle, defenderMon));
  const attacker = resolveMon(attackerFacts, attackerEntry);
  // The defender's hidden item/ability can each split the damage — enumerate the
  // still-possible sets and let identical outcomes collapse back to one bucket.
  const defenderEntry = entryFor(data, defenderFacts);

  // Pain Split deals no damage — it averages both mons' HP — so @smogon/calc has nothing
  // to say and the normal damage path would insert a blank. Show the HP swing instead.
  if (toId(moveName) === 'painsplit') {
    const defender = resolveMon(defenderFacts, entryOrMinimal(defenderEntry, defenderFacts));
    return renderPainSplit(painSplit(attacker, defender, format.gen));
  }

  const defenderVariants = [
    ...resolveVariants(defenderFacts, entryOrMinimal(defenderEntry, defenderFacts)),
    ...illusionVariants(defenderFacts, defenderEntry, data),
  ];
  const field = readFieldFacts(battle, defenderMon.side);

  const buckets = moveDamageBuckets(attacker, defenderVariants, moveName, format.gen, field);
  if (buckets.length === 0) return ''; // status / unmodellable move

  // The live Tera is shared by every variant (it's a revealed fact, not a hidden set).
  const defenderTera = defenderVariants[0]?.mon.teraType;
  // Leftovers changes the nHKO ladder (recovery between turns) without changing damage, so
  // it's a foe-level fact, shown only when there's a single outcome to attach it to.
  const revealedItem = defenderFacts.item ?? defenderFacts.prevItem;
  const leftovers = buckets.length !== 1 ? undefined
    : revealedItem ? (toId(revealedItem) === 'leftovers' ? 'certain' : undefined)
    : defenderVariants.some((v) => toId(v.mon.item ?? '') === 'leftovers') ? 'possible'
    : undefined;
  return renderMoveSection({
    defenderHpPercent: defenderFacts.hpPercent,
    extraNotes: [],
    buckets,
    ...(leftovers ? {leftovers} : {}),
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
export function buildPokemonSection(battle: ClientBattle, pokemon: ClientPokemon, data: RandbatsData): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const facts = toLiveFacts(pokemon, readBehaviors(battle, pokemon));
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
  const ourMon = isFoe(battle, pokemon) ? findOpposingActive(battle, pokemon) : null;
  const ourFacts = ourMon ? toLiveFacts(ourMon, readBehaviors(battle, ourMon)) : null;
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

  return renderSetsSection({candidates: blocks, extraNotes: notes});
}
