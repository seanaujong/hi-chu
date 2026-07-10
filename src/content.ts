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
import {detectFormat, readTeraToggled, readMegaToggled, type ClientBattle, type ClientPokemon, type ClientServerPokemon} from './battle/readState.js';
import {buildMoveSection, buildPokemonSection, buildSwitchSection} from './section.js';

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
 * The set source for this battle: the cached randbats feed in a random format
 * (warming the fetch on a miss — the next hover renders), or no feed at all in an
 * open format, where section.ts assumes instead of enumerating. Null means "nothing
 * to render yet": no battle info, or a feed-backed format whose feed hasn't landed.
 */
function sourceFor(battle: ClientBattle): {data: ReturnType<typeof cachedRandbats>} | null {
  const format = detectFormat(battle);
  if (!format) return null;
  if (format.kind === 'open') return {data: null}; // no feed exists — never fetch
  const data = cachedRandbats(format.formatId);
  if (!data) {
    void fetchRandbats(format.formatId);
    return null;
  }
  return {data};
}

/** Pokémon hover: the information-game section (or '' while data warms). The Mega
 *  Evolution box (DOM-only) previews our active mon's Mega forme on our-view surfaces —
 *  the ⚡ verdict on a foe hover, the matchup view on our own. */
export function buildSection(battle: ClientBattle, pokemon: ClientPokemon): string {
  const src = sourceFor(battle);
  if (!src) return '';
  const megaSelected = typeof document !== 'undefined' && readMegaToggled(battle, document);
  return buildPokemonSection(battle, pokemon, src.data, megaSelected);
}

/** Switch-menu hover (a ServerPokemon, no battle-view Pokémon): the matchup block. */
export function buildSwitchPokemonSection(battle: ClientBattle, server: ClientServerPokemon): string {
  const src = sourceFor(battle);
  return src ? buildSwitchSection(battle, server, src.data) : '';
}

/** Move-button hover: the single-move damage section (or '' while data warms).
 *  The gimmick checkboxes (Terastallize, Mega Evolution) live only in the DOM (both
 *  clients), so this shell reads them here and hands the pure orchestration plain flags. */
export function buildMoveButtonSection(battle: ClientBattle, pokemon: ClientPokemon, moveName: string): string {
  const src = sourceFor(battle);
  if (!src) return '';
  const hasDom = typeof document !== 'undefined';
  const teraSelected = hasDom && readTeraToggled(battle, document);
  const megaSelected = hasDom && readMegaToggled(battle, document);
  return buildMoveSection(battle, pokemon, moveName, src.data, teraSelected, megaSelected);
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

  // showPokemonTooltip(clientPokemon, serverPokemon?, isActive?, illusionIndex?).
  // The switch menu passes NO clientPokemon (null, serverPokemon) — a never-revealed
  // benched mon has no battle-view object — so that shape routes to the matchup block.
  append(proto, 'showPokemonTooltip', (self, args) => {
    const pokemon = args[0] as ClientPokemon | undefined;
    const server = args[1] as ClientServerPokemon | undefined;
    if (!self.battle) return '';
    if (pokemon) return buildSection(self.battle, pokemon);
    return server ? buildSwitchPokemonSection(self.battle, server) : '';
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
