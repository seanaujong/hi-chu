// The shell's orchestration, made pure and testable: given the live battle, the
// hovered Pokémon, and the randbats data for the format, fold
//   read → resolve → calc → render
// into the tooltip section HTML. No DOM, no cache, no network — content.ts owns
// that plumbing and hands the cached data in. Keeping this pure is what lets the
// real-battle fixture test (section.test.ts) drive the exact code path a live hover
// runs, instead of a copy that can drift from it.

import {calcDamage, type DamageReport} from './core/damage.js';
import {resolveMon} from './core/resolve.js';
import {renderDamageSection, type RenderModel} from './core/render.js';
import type {LiveFacts, RandbatsData, RandbatsEntry} from './core/types.js';
import {pickEntry} from './data/randbats.js';
import {
  toLiveFacts,
  findOpposingActive,
  detectFormat,
  readFieldFacts,
  type ClientBattle,
  type ClientPokemon,
} from './battle/readState.js';

/** A defender entry when the feed doesn't cover it: facts only, default spread. */
function entryOrMinimal(entry: RandbatsEntry | undefined, facts: LiveFacts): RandbatsEntry {
  return entry ?? {level: facts.level, abilities: [], items: []};
}

/**
 * The tooltip section HTML for `pokemon` (the attacker) vs the opposing active,
 * using the randbats `data` for this format. Returns '' when there's nothing to
 * show: not a Random Battle, no target on the field (team preview), an untracked
 * species, or no move the calc can handle.
 */
export function buildDamageSection(battle: ClientBattle, pokemon: ClientPokemon, data: RandbatsData): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const defenderMon = findOpposingActive(battle, pokemon);
  if (!defenderMon) return ''; // team preview or no target on the field

  const attackerFacts = toLiveFacts(pokemon);
  const attackerEntry = pickEntry(data, attackerFacts.speciesForme);
  if (!attackerEntry) return ''; // not a tracked randbats Pokémon

  const defenderFacts = toLiveFacts(defenderMon);
  const attacker = resolveMon(attackerFacts, attackerEntry);
  const defender = resolveMon(defenderFacts, entryOrMinimal(pickEntry(data, defenderFacts.speciesForme), defenderFacts));

  // Weather, terrain, and the defender's screens all change the numbers.
  const field = readFieldFacts(battle, defenderMon.side);

  const reports: DamageReport[] = [];
  for (const move of attacker.possibleMoves) {
    try {
      reports.push(calcDamage(attacker, defender, move, {gen: format.gen, field}));
    } catch {
      // A single move that the calc can't handle shouldn't drop the whole section.
    }
  }
  if (!reports.length) return '';

  const notes: string[] = [];
  if (attacker.assumptionsUncertainReason) notes.unshift(attacker.assumptionsUncertainReason);

  const model: RenderModel = {
    defenderName: defender.speciesForme,
    defenderHpPercent: defenderFacts.hpPercent,
    reports,
    extraNotes: notes,
    ...(attacker.teraType ? {attackerTera: attacker.teraType} : {}),
    ...(defender.teraType ? {defenderTera: defender.teraType} : {}),
  };
  return renderDamageSection(model);
}
