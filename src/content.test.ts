// Tests the monkey-patch wiring in content.ts without a browser: that installing
// preserves Showdown's own tooltip, never throws, and patches only once.
// (The data-driven path is covered end-to-end in integration.test.ts.)

import {describe, it, expect} from 'vitest';
import {install, buildSection} from './content.js';

class FakeTooltips {
  battle: unknown;
  showPokemonTooltip(pokemon: {speciesForme?: string} | undefined): string {
    return `NATIVE(${pokemon?.speciesForme ?? '?'})`;
  }
}

describe('install (tooltip monkey-patch)', () => {
  it('leaves the native tooltip untouched for non-random formats', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips();
    t.battle = {gen: 9, tier: '[Gen 9] OU', sides: []};
    // detectFormat → null → no augmentation, exact native output preserved.
    expect((t as unknown as {showPokemonTooltip: (p: unknown) => string}).showPokemonTooltip({speciesForme: 'Gengar'}))
      .toBe('NATIVE(Gengar)');
  });

  it('never throws when battle state is missing', () => {
    const Fake = FakeTooltips as unknown as {prototype: Record<string, unknown>};
    install(Fake);
    const t = new FakeTooltips();
    t.battle = undefined;
    expect(() => (t as unknown as {showPokemonTooltip: (p: unknown) => string}).showPokemonTooltip(undefined)).not.toThrow();
  });

  it('patches the prototype only once', () => {
    class Once {
      battle: unknown;
      showPokemonTooltip(): string {
        return 'X';
      }
    }
    install(Once as unknown as {prototype: Record<string, unknown>});
    const afterFirst = Once.prototype.showPokemonTooltip;
    install(Once as unknown as {prototype: Record<string, unknown>});
    expect(Once.prototype.showPokemonTooltip).toBe(afterFirst); // not re-wrapped
  });
});

describe('buildSection', () => {
  it('returns empty string for a non-random battle', () => {
    expect(buildSection({gen: 9, tier: '[Gen 9] OU', sides: []}, {} as never)).toBe('');
  });
});
