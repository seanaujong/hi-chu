// Drives the real shell orchestration (buildDamageSection) with a REAL battle:
// client objects captured live from a Showdown replay, not hand-built stubs. This
// is the one test that exercises the full two-sided ClientBattle graph the way a
// live hover does — findOpposingActive walking real `.side` references, the live
// HP / active-Tera read straight off the client, and the move set resolved from the
// real randbats feed — then pins the rendered tooltip. integration.test.ts covers
// the value chain with synthetic mons; this covers it with reality.

import {describe, it, expect} from 'vitest';
import fixture from './__fixtures__/replay-gen9randombattle-2640322654-turn5.json';
import {buildDamageSection} from './section.js';
import type {ClientBattle, ClientPokemon, ClientSide} from './battle/readState.js';
import type {RandbatsData} from './core/types.js';

const data = fixture.randbats as unknown as RandbatsData;

/**
 * Rebuild the client's object graph from the captured JSON, wiring the
 * `pokemon.side` back-references the live client maintains (and that
 * findOpposingActive / readFieldFacts depend on). The client's classes are
 * untyped and cyclic, so the reconstruction casts through `unknown` — the shapes
 * match readState's structural interfaces.
 */
function loadBattle(over: {noivernTerastallized?: string} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
  const sides: ClientSide[] = fixture.battle.sides.map((s) => {
    const side = {sideConditions: {...s.sideConditions}, active: [] as (ClientPokemon | null)[]};
    side.active = s.active.map((p) => {
      const terastallized = p.speciesForme === 'Noivern' && over.noivernTerastallized !== undefined
        ? over.noivernTerastallized
        : p.terastallized;
      return {...p, terastallized, side} as unknown as ClientPokemon;
    });
    return side as unknown as ClientSide;
  });
  const battle = {
    gen: fixture.battle.gen,
    tier: fixture.battle.tier,
    weather: fixture.battle.weather,
    pseudoWeather: fixture.battle.pseudoWeather,
    sides,
  } as unknown as ClientBattle;
  const active = (name: string): ClientPokemon =>
    sides.flatMap((s) => s.active).find((p): p is ClientPokemon => p?.speciesForme === name)!;
  return {battle, active};
}

/** The mean-damage percentage the render prints for `move`, e.g. "Surf … (66.3%)". */
function meanPercentOf(html: string, move: string): number {
  const m = new RegExp(`${move}</span> <span class="rbtb-dmg">[^(]*\\(([\\d.]+)%\\)`).exec(html);
  if (!m) throw new Error(`no damage row for ${move} in:\n${html}`);
  return Number(m[1]);
}

describe('buildDamageSection on a real captured battle', () => {
  const {battle, active} = loadBattle();
  const vsTentacruel = buildDamageSection(battle, active('Noivern'), data);
  const vsNoivern = buildDamageSection(battle, active('Tentacruel'), data);

  it('reads the live defender, its current HP, and the attacker’s active Tera', () => {
    // Noivern terastallized to Fire in this replay; Tentacruel is at 256/272 ≈ 94.1%.
    expect(vsTentacruel).toContain('vs Tentacruel');
    expect(vsTentacruel).toContain('(94.1%)');
    expect(vsTentacruel).toContain('[Tera Fire]');
  });

  it('resolves the attacker’s move set from the feed and ranks by damage', () => {
    // Noivern's possible moves come from both randbats roles, merged.
    expect(vsTentacruel).toContain('Draco Meteor');
    expect(vsTentacruel).toContain('Flamethrower');
    // Dragon STAB survives the Tera, so Draco Meteor outranks the resisted Fire move.
    expect(vsTentacruel.indexOf('Draco Meteor')).toBeLessThan(vsTentacruel.indexOf('Flamethrower'));
  });

  it('splits the attacker’s status moves out of the damage rows', () => {
    expect(vsTentacruel).toMatch(/Status:.*Defog/);
    expect(vsTentacruel).toMatch(/Status:.*Roost/);
  });

  it('labels the opposing Tera when the defender is the terastallized one', () => {
    expect(vsNoivern).toContain('vs Noivern');
    expect(vsNoivern).toContain('[vs Tera Fire]');
    expect(vsNoivern).toContain('Surf');
  });

  it('reflects the defensive Tera: Surf hits the Tera-Fire Noivern far harder', () => {
    // Terastallizing to Fire makes Noivern a pure-Fire DEFENDER — 2× weak to Water.
    // The same Surf into a non-terastallized (Flying/Dragon) Noivern is only neutral.
    const teraNoivern = meanPercentOf(vsNoivern, 'Surf');
    const plain = loadBattle({noivernTerastallized: ''});
    const plainNoivern = meanPercentOf(buildDamageSection(plain.battle, plain.active('Tentacruel'), data), 'Surf');
    expect(teraNoivern).toBeGreaterThan(plainNoivern * 1.7);
  });
});
