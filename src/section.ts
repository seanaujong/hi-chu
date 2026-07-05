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
import {inferSets, resolveMon} from './core/resolve.js';
import {
  renderMoveSection,
  renderSetsSection,
  type CandidateBlock,
  type MoveKnowledgeRow,
  type SetsRenderModel,
} from './core/render.js';
import type {LiveFacts, RandbatsData, RandbatsEntry, ResolvedMon, SetKnowledge} from './core/types.js';
import {pickEntry} from './data/randbats.js';
import {
  toLiveFacts,
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
 * The move-button tooltip section: `moveName` from our active `pokemon` into the
 * opposing active. Returns '' when there's nothing to show (not a Random Battle,
 * no target, untracked species, unmodellable move).
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

  const attackerFacts = toLiveFacts(pokemon);
  const attackerEntry = pickEntry(data, attackerFacts.speciesForme);
  if (!attackerEntry) return '';

  const defenderFacts = toLiveFacts(defenderMon);
  const attacker = resolveMon(attackerFacts, attackerEntry);
  const defender = resolveMon(defenderFacts, entryOrMinimal(pickEntry(data, defenderFacts.speciesForme), defenderFacts));
  const field = readFieldFacts(battle, defenderMon.side);

  let report: DamageReport | undefined;
  try {
    const r = calcDamage(attacker, defender, moveName, {gen: format.gen, field});
    report = r.category === 'Status' ? undefined : r;
  } catch {
    return ''; // a move outside the calc's world (e.g. Struggle edge cases)
  }

  return renderMoveSection({
    defenderHpPercent: defenderFacts.hpPercent,
    extraNotes: [],
    ...(report ? {report} : {}),
    ...(attacker.teraType ? {attackerTera: attacker.teraType} : {}),
    ...(defender.teraType ? {defenderTera: defender.teraType} : {}),
  });
}

/** Attach damage reports (foe view) to each candidate set's move list. */
function toBlocks(knowledge: SetKnowledge, damage: Map<string, DamageReport> | undefined): CandidateBlock[] {
  return knowledge.candidates.map((c) => ({
    name: c.name,
    abilities: c.abilities,
    items: c.items,
    gimmicks: c.gimmicks,
    moves: c.moves.map((m): MoveKnowledgeRow => {
      const report = damage?.get(toId(m.name));
      return {name: m.name, known: m.known, ...(report ? {report} : {})};
    }),
  }));
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

  const facts = toLiveFacts(pokemon);
  const entry = pickEntry(data, facts.speciesForme);
  if (!entry) return ''; // not a tracked randbats Pokémon

  const knowledge = inferSets(facts, entry);
  if (knowledge.candidates.every((c) => c.moves.length === 0)) return '';

  const notes = knowledge.uncertainReason ? [knowledge.uncertainReason] : [];

  // Foe view: attach each possible move's damage into OUR active (their move buttons
  // aren't hoverable for us, so threat numbers must live on their Pokémon tooltip).
  // The own-side mirror carries no damage — it shows only what we've made public.
  let damage: Map<string, DamageReport> | undefined;
  if (isFoe(battle, pokemon)) {
    const ourMon = findOpposingActive(battle, pokemon);
    if (ourMon) {
      const ourFacts = toLiveFacts(ourMon);
      const attacker = resolveMon(facts, entry);
      const defender = resolveMon(ourFacts, entryOrMinimal(pickEntry(data, ourFacts.speciesForme), ourFacts));
      const field = readFieldFacts(battle, ourMon.side);
      const allMoves = [...new Set(knowledge.candidates.flatMap((c) => c.moves.map((m) => m.name)))];
      damage = reportsByMove(attacker, defender, allMoves, format.gen, field);
    }
  }

  return renderSetsSection({candidates: toBlocks(knowledge, damage), extraNotes: notes});
}
