// The shell. Runs in Showdown's page (MAIN world), monkey-patches the tooltip
// renderer, and splices our damage section onto the end of every Pokémon tooltip.
//
// It stays trivial on purpose: read live facts → resolve against randbats → calc →
// render. All the real logic lives in the pure modules it folds together. Anything
// that can throw is wrapped so a bad calc never breaks Showdown's own tooltip.

import {calcDamage, type DamageReport} from './core/damage.js';
import {resolveMon} from './core/resolve.js';
import {renderDamageSection, TOOLTIP_STYLE, type RenderModel} from './core/render.js';
import type {LiveFacts, RandbatsEntry} from './core/types.js';
import {cachedRandbats, fetchRandbats, pickEntry} from './data/randbats.js';
import {
  toLiveFacts,
  findOpposingActive,
  detectFormat,
  type ClientBattle,
  type ClientPokemon,
} from './battle/readState.js';

declare global {
  interface Window {
    // The client's classes are untyped globals; we only touch this one.
    BattleTooltips?: {prototype: Record<string, unknown>};
  }
}

const FIELD_CAVEAT = 'weather, screens and hazards not yet included';

/** A defender entry when the feed doesn't cover it: facts only, default spread. */
function entryOrMinimal(entry: RandbatsEntry | undefined, facts: LiveFacts): RandbatsEntry {
  return entry ?? {level: facts.level, abilities: [], items: []};
}

/** Build our tooltip section for `pokemon` (the attacker) vs the opposing active. */
export function buildSection(battle: ClientBattle, pokemon: ClientPokemon): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const data = cachedRandbats(format.formatId);
  if (!data) {
    void fetchRandbats(format.formatId); // warm the cache; the next hover will render
    return '';
  }

  const defenderMon = findOpposingActive(battle, pokemon);
  if (!defenderMon) return ''; // team preview or no target on the field

  const attackerFacts = toLiveFacts(pokemon);
  const attackerEntry = pickEntry(data, attackerFacts.speciesForme);
  if (!attackerEntry) return ''; // not a tracked randbats Pokémon

  const defenderFacts = toLiveFacts(defenderMon);
  const attacker = resolveMon(attackerFacts, attackerEntry);
  const defender = resolveMon(defenderFacts, entryOrMinimal(pickEntry(data, defenderFacts.speciesForme), defenderFacts));

  const reports: DamageReport[] = [];
  for (const move of attacker.possibleMoves) {
    try {
      reports.push(calcDamage(attacker, defender, move, {gen: format.gen}));
    } catch {
      // A single move that the calc can't handle shouldn't drop the whole section.
    }
  }
  if (!reports.length) return '';

  const notes = [FIELD_CAVEAT];
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

function injectStyleOnce(): void {
  if (typeof document === 'undefined') return; // no DOM (e.g. under test)
  if (document.getElementById('rbtb-style')) return;
  document.head.insertAdjacentHTML('beforeend', TOOLTIP_STYLE);
}

const PATCH_FLAG = '__rbtbPatched';

export function install(BattleTooltips: {prototype: Record<string, unknown>}): void {
  const proto = BattleTooltips.prototype;
  if (proto[PATCH_FLAG]) return;
  proto[PATCH_FLAG] = true;

  const original = proto['showPokemonTooltip'] as (...args: unknown[]) => string;
  proto['showPokemonTooltip'] = function (this: {battle?: ClientBattle}, ...args: unknown[]): string {
    const buf = original.apply(this, args);
    try {
      const pokemon = args[0] as ClientPokemon | undefined;
      if (pokemon && this.battle) {
        const extra = buildSection(this.battle, pokemon);
        if (extra) return buf + extra;
      }
    } catch {
      // Never let our augmentation break the native tooltip.
    }
    return buf;
  };

  injectStyleOnce();
}

/** The client builds BattleTooltips lazily; wait for it, then patch its prototype. */
function bootstrap(): void {
  if (window.BattleTooltips) {
    install(window.BattleTooltips);
    return;
  }
  let tries = 0;
  const timer = window.setInterval(() => {
    if (window.BattleTooltips) {
      window.clearInterval(timer);
      install(window.BattleTooltips);
    } else if (++tries > 150) {
      window.clearInterval(timer); // ~30s; give up quietly if this isn't Showdown
    }
  }, 200);
}

// Auto-run only in the page; importing this module under test has no side effects.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bootstrap();
}
