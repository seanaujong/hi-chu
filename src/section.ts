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

import {calcDamage, type DamageReport} from './core/damage.js';
import {inferSets, resolveByRole, resolveMon, resolveVariants} from './core/resolve.js';
import {bucketByDamage, type DamageBucket} from './core/variants.js';
import {
  renderMoveSection,
  renderSetsSection,
  type CandidateBlock,
  type MoveKnowledgeRow,
  type SetsRenderModel,
} from './core/render.js';
import type {LiveFacts, RandbatsData, RandbatsEntry, ResolvedMon, SetKnowledge, SetVariant} from './core/types.js';
import {pickEntry} from './data/randbats.js';
import {
  toLiveFacts,
  hasLandedDamagingHit,
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
      const report = calcDamage(attacker, variant.mon, moveName, {gen, field});
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

  const attackerFacts = toLiveFacts(pokemon, hasLandedDamagingHit(battle, pokemon));
  const attackerEntry = pickEntry(data, attackerFacts.speciesForme);
  if (!attackerEntry) return '';

  const defenderFacts = toLiveFacts(defenderMon, hasLandedDamagingHit(battle, defenderMon));
  const attacker = resolveMon(attackerFacts, attackerEntry);
  // The defender's hidden item/ability can each split the damage — enumerate the
  // still-possible sets and let identical outcomes collapse back to one bucket.
  const defenderVariants = resolveVariants(defenderFacts, entryOrMinimal(pickEntry(data, defenderFacts.speciesForme), defenderFacts));
  const field = readFieldFacts(battle, defenderMon.side);

  const buckets = moveDamageBuckets(attacker, defenderVariants, moveName, format.gen, field);
  if (buckets.length === 0) return ''; // status / unmodellable move

  // The live Tera is shared by every variant (it's a revealed fact, not a hidden set).
  const defenderTera = defenderVariants[0]?.mon.teraType;
  return renderMoveSection({
    defenderHpPercent: defenderFacts.hpPercent,
    extraNotes: [],
    buckets,
    ...(attacker.teraType ? {attackerTera: attacker.teraType} : {}),
    ...(defenderTera ? {defenderTera} : {}),
  });
}

/**
 * Attach damage reports (foe view) to each candidate set's move list. `damagePerSet`
 * is aligned 1:1 with `knowledge.candidates` — each block's numbers come from THAT
 * set's own item/spread, not one set's figures shared across every block.
 */
function toBlocks(knowledge: SetKnowledge, damagePerSet: readonly (Map<string, DamageReport> | undefined)[]): CandidateBlock[] {
  return knowledge.candidates.map((c, i) => {
    const damage = damagePerSet[i];
    return {
      name: c.name,
      abilities: c.abilities,
      items: c.items,
      gimmicks: c.gimmicks,
      moves: c.moves.map((m): MoveKnowledgeRow => {
        const report = damage?.get(toId(m.name));
        return {name: m.name, known: m.known, ...(report ? {report} : {})};
      }),
    };
  });
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

  const facts = toLiveFacts(pokemon, hasLandedDamagingHit(battle, pokemon));
  const entry = pickEntry(data, facts.speciesForme);
  if (!entry) return ''; // not a tracked randbats Pokémon

  const knowledge = inferSets(facts, entry);
  if (knowledge.candidates.every((c) => c.moves.length === 0)) return '';

  const notes = knowledge.uncertainReason ? [knowledge.uncertainReason] : [];

  // Foe view: attach each possible move's damage into OUR active (their move buttons
  // aren't hoverable for us, so threat numbers must live on their Pokémon tooltip).
  // Each set block is calculated from ITS OWN set — a Choice Band set and a Life Orb
  // set of the same species threaten different numbers. The own-side mirror carries no
  // damage — it shows only what we've made public.
  let damagePerSet: (Map<string, DamageReport> | undefined)[] = knowledge.candidates.map(() => undefined);
  if (isFoe(battle, pokemon)) {
    const ourMon = findOpposingActive(battle, pokemon);
    if (ourMon) {
      const ourFacts = toLiveFacts(ourMon, hasLandedDamagingHit(battle, ourMon));
      const defender = resolveMon(ourFacts, entryOrMinimal(pickEntry(data, ourFacts.speciesForme), ourFacts));
      const field = readFieldFacts(battle, ourMon.side);
      const attackers = resolveByRole(facts, entry); // aligned 1:1 with knowledge.candidates
      damagePerSet = knowledge.candidates.map((c, i) => {
        const attacker = (attackers[i] ?? attackers[0])?.mon;
        if (!attacker) return undefined;
        return reportsByMove(attacker, defender, c.moves.map((m) => m.name), format.gen, field);
      });
    }
  }

  return renderSetsSection({candidates: toBlocks(knowledge, damagePerSet), extraNotes: notes});
}
