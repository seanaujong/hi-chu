// Tests the monkey-patch wiring in content.ts without a browser: that installing
// preserves Showdown's own tooltips (Pokémon AND move), never throws, and patches
// only once. (The data-driven path is covered end-to-end in integration.test.ts.)

import {describe, it, expect} from 'vitest';
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
  it('leaves both native tooltips untouched for non-random formats', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips() as unknown as Patched & {battle: unknown};
    t.battle = {gen: 9, tier: '[Gen 9] OU', sides: []};
    // detectFormat → null → no augmentation, exact native output preserved.
    expect(t.showPokemonTooltip({speciesForme: 'Gengar'})).toBe('NATIVE(Gengar)');
    expect(t.showMoveTooltip({name: 'Shadow Ball'}, '', {speciesForme: 'Gengar'})).toBe('NATIVE-MOVE(Shadow Ball)');
  });

  it('never throws when battle state is missing', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips() as unknown as Patched & {battle: unknown};
    t.battle = undefined;
    expect(() => t.showPokemonTooltip(undefined)).not.toThrow();
    expect(() => t.showMoveTooltip(undefined, '', undefined)).not.toThrow();
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
  it('return empty strings for a non-random battle', () => {
    const battle = {gen: 9, tier: '[Gen 9] OU', sides: []};
    expect(buildSection(battle, {} as never)).toBe('');
    expect(buildMoveButtonSection(battle, {} as never, 'Surf')).toBe('');
  });
});
