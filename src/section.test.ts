// Drives the real shell orchestration with a REAL battle: client objects captured
// live from a Showdown replay, not hand-built stubs. This is the one test that
// exercises the full two-sided ClientBattle graph the way a live hover does —
// findOpposingActive walking real `.side` references, the live HP / active-Tera /
// revealed-item read straight off the client, and the sets resolved from the real
// randbats feed — then pins the rendered tooltips. integration.test.ts covers the
// value chain with synthetic mons; this covers it with reality.
//
// The captured position (turn 5): our Noivern (near side, terastallized Fire,
// Flamethrower revealed) vs their Tentacruel (far side, Leftovers revealed,
// 256/272 HP ≈ 94.1%).

import {describe, it, expect} from 'vitest';
import fixture from './__fixtures__/replay-gen9randombattle-2640322654-turn5.json';
import {buildMoveSection, buildPokemonSection} from './section.js';
import type {ClientBattle, ClientPokemon, ClientSide} from './battle/readState.js';
import type {RandbatsData} from './core/types.js';

const data = fixture.randbats as unknown as RandbatsData;

/**
 * Rebuild the client's object graph from the captured JSON, wiring the
 * `pokemon.side` back-references the live client maintains (and that
 * findOpposingActive / readFieldFacts depend on). Side 0 is the near side (ours),
 * side 1 the far side (theirs) — the client's seating for the recorded player.
 * The client's classes are untyped and cyclic, so the reconstruction casts through
 * `unknown` — the shapes match readState's structural interfaces.
 */
function loadBattle(over: {noivernTerastallized?: string} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
  const sides: ClientSide[] = fixture.battle.sides.map((s, i) => {
    const side = {isFar: i === 1, sideConditions: {...s.sideConditions}, active: [] as (ClientPokemon | null)[]};
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

/** The mean-damage percentage a rendered dmg span prints, e.g. "… (66.3%)". */
function meanPercent(html: string): number {
  const m = /rbtb-dmg">[^(]*\(([\d.]+)%\)/.exec(html);
  if (!m) throw new Error(`no damage span in:\n${html}`);
  return Number(m[1]);
}

describe('buildMoveSection on the real captured battle (our move buttons)', () => {
  const {battle, active} = loadBattle();

  it('calculates one move into the live opposing active at its real HP', () => {
    const html = buildMoveSection(battle, active('Noivern'), 'Draco Meteor', data);
    expect(html).toContain('vs Tentacruel (94.1% HP)');
    expect(html).toContain('rbtb-dmg');
  });

  it('labels our active Tera (Noivern terastallized to Fire in this replay)', () => {
    const html = buildMoveSection(battle, active('Noivern'), 'Flamethrower', data);
    expect(html).toContain('[Tera Fire]');
  });

  it('renders a status move as an explicit no-damage line', () => {
    const html = buildMoveSection(battle, active('Noivern'), 'Roost', data);
    expect(html).toContain('no damage (status move)');
  });

  it('reflects the defensive Tera: Surf hits the Tera-Fire Noivern far harder', () => {
    // Terastallizing to Fire makes Noivern a pure-Fire DEFENDER — 2× weak to Water.
    // The same Surf into a non-terastallized (Flying/Dragon) Noivern is only neutral.
    const tera = meanPercent(buildMoveSection(battle, active('Tentacruel'), 'Surf', data));
    const plain = loadBattle({noivernTerastallized: ''});
    const plainPct = meanPercent(buildMoveSection(plain.battle, plain.active('Tentacruel'), 'Surf', data));
    expect(tera).toBeGreaterThan(plainPct * 1.7);
  });
});

describe('buildPokemonSection hovering THEIR Tentacruel (the information game)', () => {
  const {battle, active} = loadBattle();
  const html = buildPokemonSection(battle, active('Tentacruel'), data);

  it('shows the possible-sets view with damage aimed at our live active', () => {
    expect(html).toContain('Possible sets');
    expect(html).toContain('dmg vs Noivern (100% HP)');
    expect(html).toContain('[vs Tera Fire]'); // our Noivern is the terastallized one
  });

  it('treats the revealed Leftovers as fact and drops Assault Vest entirely', () => {
    // The feed lists Assault Vest and Leftovers for Bulky Support; the battle
    // revealed Leftovers, so the item dimension is settled — not a list of maybes.
    expect(html).toContain('✓ Leftovers');
    expect(html).not.toContain('Assault Vest');
  });

  it('lists unrevealed feed moves as speculative, with damage attached', () => {
    // Nothing of Tentacruel's moveset is revealed at turn 5.
    expect(html).toMatch(/rbtb-mv">Surf<\/span>\?/);
    expect(html).toMatch(/Surf<\/span>\?<\/span> <span class="rbtb-dmg">/);
    expect(html).toContain('rbtb-mv">Knock Off');
  });

  it('keeps status moves in the set list but without damage figures', () => {
    expect(html).toMatch(/rbtb-mv">Haze<\/span>\?/);
    expect(html).not.toMatch(/Haze<\/span>\?<\/span> <span class="rbtb-dmg">/);
  });

  it('offers their still-possible Tera types without ever activating one', () => {
    expect(html).toContain('Flying?');
    expect(html).toContain('Grass?');
    expect(html).not.toContain('[Tera Flying'); // display-only: no active-Tera label for them
  });
});

describe('buildPokemonSection hovering OUR Noivern (their read on us)', () => {
  const {battle, active} = loadBattle();
  const html = buildPokemonSection(battle, active('Noivern'), data);

  it('shows the mirror view: what our public reveals give away', () => {
    expect(html).toContain('Their read on you');
    // Flamethrower is the one move we've shown — and it sits in both feed roles,
    // so the opponent still can't tell Fast Attacker from Fast Support.
    expect(html).toContain('✓ <span class="rbtb-mv">Flamethrower</span>');
    expect(html).toContain('2 of 2 sets');
    expect(html).toMatch(/rbtb-mv">Boomburst<\/span>\?/);
    expect(html).toMatch(/rbtb-mv">Roost<\/span>\?/);
  });

  it('carries no damage figures — this view is about information, not threat', () => {
    expect(html).not.toContain('rbtb-dmg');
  });

  it('shows our active Tera as settled information', () => {
    expect(html).toContain('✓ Fire');
  });
});
