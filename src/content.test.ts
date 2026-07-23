// Tests the monkey-patch wiring in content.ts without a browser: that installing
// preserves Showdown's own tooltips (Pokémon AND move), never throws, and patches
// only once. (The data-driven path is covered end-to-end in integration.test.ts.)

import {describe, it, expect, vi} from 'vitest';
import {install, buildSection, buildMoveButtonSection} from './content.js';

class FakeTooltips {
  battle: unknown;
  showPokemonTooltip(pokemon: {speciesForme?: string} | undefined): string {
    return `NATIVE(${pokemon?.speciesForme ?? '?'})`;
  }
  showMoveTooltip(move: {name?: string} | undefined): string {
    return `NATIVE-MOVE(${move?.name ?? '?'})`;
  }
}

type Patched = {
  showPokemonTooltip: (p: unknown) => string;
  showMoveTooltip: (...args: unknown[]) => string;
};

describe('install (tooltip monkey-patch)', () => {
  it('preserves the exact native output when our section throws or is empty (open format, bare stubs)', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips() as unknown as Patched & {battle: unknown};
    t.battle = {gen: 9, tier: '[Gen 9] OU', sides: []};
    // An open format now takes the assumption path, but these stubs carry no battle-view
    // fields — the section throws or yields '', and append's guard keeps the native text.
    expect(t.showPokemonTooltip({speciesForme: 'Gengar'})).toBe('NATIVE(Gengar)');
    expect(t.showMoveTooltip({name: 'Shadow Ball'}, '', {speciesForme: 'Gengar'})).toBe('NATIVE-MOVE(Shadow Ball)');
  });

  it('logs to console.error when the augmentation throws, without breaking the native tooltip', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
      install(Fake);
      const t = new FakeTooltips() as unknown as Patched & {battle: unknown};
      // A Proxy that throws on ANY property read forces our section to throw,
      // regardless of exactly which field it happens to touch first — decoupled
      // from section.ts's internals, unlike crafting a specific malformed battle.
      t.battle = new Proxy({}, {get: () => { throw new Error('boom'); }});
      expect(t.showPokemonTooltip({speciesForme: 'Gengar'})).toBe('NATIVE(Gengar)');
      expect(t.showMoveTooltip({name: 'Shadow Ball'}, '', {speciesForme: 'Gengar'})).toBe('NATIVE-MOVE(Shadow Ball)');
      expect(consoleSpy).toHaveBeenCalledWith('[hi-chu] showPokemonTooltip augmentation failed:', expect.any(Error));
      expect(consoleSpy).toHaveBeenCalledWith('[hi-chu] showMoveTooltip augmentation failed:', expect.any(Error));
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('never throws when battle state is missing', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips() as unknown as Patched & {battle: unknown};
    t.battle = undefined;
    expect(() => t.showPokemonTooltip(undefined)).not.toThrow();
    expect(() => t.showMoveTooltip(undefined, '', undefined)).not.toThrow();
  });

  it('routes a switch-menu call (null clientPokemon + serverPokemon) without breaking the native tooltip', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips() as unknown as {showPokemonTooltip: (p: unknown, s?: unknown) => string; battle: unknown};
    t.battle = {gen: 9, tier: '[Gen 9] OU', sides: []}; // open format; no parseable species → ''
    expect(t.showPokemonTooltip(null, {ident: 'p1: Noivern', moves: ['dracometeor']})).toBe('NATIVE(?)');
  });

  it('patches the prototype only once', () => {
    class Once {
      battle: unknown;
      showPokemonTooltip(): string {
        return 'X';
      }
      showMoveTooltip(): string {
        return 'Y';
      }
    }
    install(Once as unknown as {prototype: Record<string, unknown>});
    const afterFirst = {pokemon: Once.prototype.showPokemonTooltip, move: Once.prototype.showMoveTooltip};
    install(Once as unknown as {prototype: Record<string, unknown>});
    expect(Once.prototype.showPokemonTooltip).toBe(afterFirst.pokemon); // not re-wrapped
    expect(Once.prototype.showMoveTooltip).toBe(afterFirst.move);
  });

  it('tolerates a client build that renamed a method (leaves the rest patched)', () => {
    class NoMoveTooltip {
      battle: unknown;
      showPokemonTooltip(): string {
        return 'X';
      }
    }
    expect(() => install(NoMoveTooltip as unknown as {prototype: Record<string, unknown>})).not.toThrow();
    expect((NoMoveTooltip.prototype as unknown as Record<string, unknown>)['showMoveTooltip']).toBeUndefined();
    expect(NoMoveTooltip.prototype.showPokemonTooltip).not.toBe(undefined);
  });
});

describe('shell sections', () => {
  const mon = (over: Record<string, unknown> = {}): never =>
    ({
      speciesForme: 'Gengar',
      level: 100,
      hp: 100,
      maxhp: 100,
      status: '',
      boosts: {},
      moveTrack: [],
      ...over,
    }) as never;

  it('renders nothing in an open format when there is nothing to show', () => {
    const battle = {gen: 9, tier: '[Gen 9] OU', sides: []};
    // A hover with no side reads as a foe (v1: no foe section), and a move hover with
    // no opposing active has no target — both stay silent, native tooltip untouched.
    expect(buildSection(battle, mon())).toBe('');
    expect(buildMoveButtonSection(battle, mon(), 'Surf')).toBe('');
  });

  it('never fetches the set feed in an open format — there is nothing to fetch', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const battle = {gen: 9, tier: '[Gen 9] OU', sides: []};
      buildSection(battle, mon());
      buildMoveButtonSection(battle, mon(), 'Surf');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
