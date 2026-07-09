// The shell. Runs in Showdown's page (MAIN world), monkey-patches the two tooltip
// renderers we care about, and splices our sections onto the end of each:
//
//   showMoveTooltip    → that move's damage vs the opposing active
//   showPokemonTooltip → the information game (possible sets, narrowed by reveals)
//
// It stays trivial on purpose: all the real logic lives in the pure modules
// section.ts folds together. Anything that can throw is wrapped so a bad calc
// never breaks Showdown's own tooltips.

import {TOOLTIP_STYLE} from './core/render.js';
import {cachedRandbats, fetchRandbats} from './data/randbats.js';
import {detectFormat, readTeraToggled, type ClientBattle, type ClientPokemon} from './battle/readState.js';
import {buildMoveSection, buildPokemonSection} from './section.js';

declare global {
  interface Window {
    // The client's classes are untyped globals; we only touch this one.
    BattleTooltips?: {prototype: Record<string, unknown>};
  }
}

/** The client's Dex.Move — we only need the display name. */
interface ClientMove {
  readonly name: string;
}

/**
 * Look up (or start warming) the cached randbats data for this battle's format.
 * Returns null until the fetch lands — the next hover will render.
 */
function dataFor(battle: ClientBattle): ReturnType<typeof cachedRandbats> {
  const format = detectFormat(battle);
  if (!format) return null;
  const data = cachedRandbats(format.formatId);
  if (!data) void fetchRandbats(format.formatId);
  return data;
}

/** Pokémon hover: the information-game section (or '' while data warms). */
export function buildSection(battle: ClientBattle, pokemon: ClientPokemon): string {
  const data = dataFor(battle);
  return data ? buildPokemonSection(battle, pokemon, data) : '';
}

/** Move-button hover: the single-move damage section (or '' while data warms).
 *  The Terastallize checkbox lives only in the DOM (both clients), so this shell
 *  reads it here and hands the pure orchestration a plain flag. */
export function buildMoveButtonSection(battle: ClientBattle, pokemon: ClientPokemon, moveName: string): string {
  const data = dataFor(battle);
  if (!data) return '';
  const teraSelected = typeof document !== 'undefined' && readTeraToggled(battle, document);
  return buildMoveSection(battle, pokemon, moveName, data, teraSelected);
}

function injectStyleOnce(): void {
  if (typeof document === 'undefined') return; // no DOM (e.g. under test)
  if (document.getElementById('hichu-style')) return;
  document.head.insertAdjacentHTML('beforeend', TOOLTIP_STYLE);
}

const PATCH_FLAG = '__hichuPatched';

/** Wrap a tooltip method so our section is appended and a failure changes nothing. */
function append(
  proto: Record<string, unknown>,
  method: string,
  section: (self: {battle?: ClientBattle}, args: unknown[]) => string,
): void {
  const original = proto[method] as ((...args: unknown[]) => string) | undefined;
  if (typeof original !== 'function') return; // client renamed the method; leave it native
  proto[method] = function (this: {battle?: ClientBattle}, ...args: unknown[]): string {
    const buf = original.apply(this, args);
    try {
      const extra = section(this, args);
      if (extra) return buf + extra;
    } catch {
      // Never let our augmentation break the native tooltip.
    }
    return buf;
  };
}

export function install(BattleTooltips: {prototype: Record<string, unknown>}): void {
  const proto = BattleTooltips.prototype;
  if (proto[PATCH_FLAG]) return;
  proto[PATCH_FLAG] = true;

  // showPokemonTooltip(clientPokemon, serverPokemon?, isActive?, illusionIndex?)
  append(proto, 'showPokemonTooltip', (self, args) => {
    const pokemon = args[0] as ClientPokemon | undefined;
    return pokemon && self.battle ? buildSection(self.battle, pokemon) : '';
  });

  // showMoveTooltip(move, isZOrMax, pokemon, serverPokemon, gmaxMove?) — `pokemon`
  // is always OUR active (the client only shows move tooltips for our own buttons).
  append(proto, 'showMoveTooltip', (self, args) => {
    const move = args[0] as ClientMove | undefined;
    const pokemon = args[2] as ClientPokemon | undefined;
    return move?.name && pokemon && self.battle ? buildMoveButtonSection(self.battle, pokemon, move.name) : '';
  });

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
