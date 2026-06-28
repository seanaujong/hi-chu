// The shell. Runs in Showdown's page (MAIN world), monkey-patches the tooltip
// renderer, and splices our damage section onto the end of every Pokémon tooltip.
//
// It stays trivial on purpose: read live facts → resolve against randbats → calc →
// render. All the real logic lives in the pure modules it folds together. Anything
// that can throw is wrapped so a bad calc never breaks Showdown's own tooltip.

import {TOOLTIP_STYLE} from './core/render.js';
import {cachedRandbats, fetchRandbats} from './data/randbats.js';
import {detectFormat, type ClientBattle, type ClientPokemon} from './battle/readState.js';
import {buildDamageSection} from './section.js';

declare global {
  interface Window {
    // The client's classes are untyped globals; we only touch this one.
    BattleTooltips?: {prototype: Record<string, unknown>};
  }
}

/**
 * Build our tooltip section for `pokemon` (the attacker) vs the opposing active.
 * This is the thin cache/DOM shell: resolve the format, look up (or warm) the
 * cached randbats data, then hand off to the pure `buildDamageSection`.
 */
export function buildSection(battle: ClientBattle, pokemon: ClientPokemon): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const data = cachedRandbats(format.formatId);
  if (!data) {
    void fetchRandbats(format.formatId); // warm the cache; the next hover will render
    return '';
  }

  return buildDamageSection(battle, pokemon, data);
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
