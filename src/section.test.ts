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
function loadBattle(over: {noivernTerastallized?: string; tentacruelItem?: string} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
  const sides: ClientSide[] = fixture.battle.sides.map((s, i) => {
    const side = {isFar: i === 1, sideConditions: {...s.sideConditions}, active: [] as (ClientPokemon | null)[]};
    side.active = s.active.map((p) => {
      const terastallized = p.speciesForme === 'Noivern' && over.noivernTerastallized !== undefined
        ? over.noivernTerastallized
        : p.terastallized;
      // Un-reveal Tentacruel's item to exercise the still-unknown-item split (its
      // Bulky Support set can run Assault Vest OR Leftovers).
      const item = p.speciesForme === 'Tentacruel' && over.tentacruelItem !== undefined ? over.tentacruelItem : p.item;
      return {...p, terastallized, item, side} as unknown as ClientPokemon;
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

/** The max-damage percentage the "Damage: X% - Y%" line prints. */
function maxPercent(html: string): number {
  const m = /Damage:<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
  if (!m) throw new Error(`no Damage line in:\n${html}`);
  return Number(m[1]);
}

describe('buildMoveSection on the real captured battle (our move buttons)', () => {
  const {battle, active} = loadBattle();

  it('renders the Damage line at native format for one move into the live active', () => {
    const html = buildMoveSection(battle, active('Noivern'), 'Draco Meteor', data);
    expect(html).toMatch(/<small>Damage:<\/small> \d+(\.\d+)?% - \d+(\.\d+)?%/);
  });

  it('labels our active Tera (Noivern terastallized to Fire in this replay)', () => {
    const html = buildMoveSection(battle, active('Noivern'), 'Flamethrower', data);
    expect(html).toContain('Tera Fire');
  });

  it('inserts nothing for a status move (Roost) — no section at all', () => {
    expect(buildMoveSection(battle, active('Noivern'), 'Roost', data)).toBe('');
  });

  it('reflects the defensive Tera: Surf hits the Tera-Fire Noivern far harder', () => {
    // Terastallizing to Fire makes Noivern a pure-Fire DEFENDER — 2× weak to Water.
    // The same Surf into a non-terastallized (Flying/Dragon) Noivern is only neutral.
    const tera = maxPercent(buildMoveSection(battle, active('Tentacruel'), 'Surf', data));
    const plain = loadBattle({noivernTerastallized: ''});
    const plainPct = maxPercent(buildMoveSection(plain.battle, plain.active('Tentacruel'), 'Surf', data));
    expect(tera).toBeGreaterThan(plainPct * 1.7);
  });
});

describe('buildMoveSection when the target item is still unknown (the Assault Vest split)', () => {
  // Tentacruel's Bulky Support can hold Assault Vest or Leftovers; un-reveal the item.
  const {battle, active} = loadBattle({tentacruelItem: ''});
  const noivern = () => active('Noivern');

  it('splits a special move into two labelled outcomes — AV vs not', () => {
    // Draco Meteor is special, so Assault Vest's +50% SpD changes the number.
    const html = buildMoveSection(battle, noivern(), 'Draco Meteor', data);
    expect(html).toContain('Damage (Assault Vest):');
    expect(html).toContain('Damage (Leftovers):');
    // The AV outcome must be strictly lower than the Leftovers one.
    const av = /Damage \(Assault Vest\):<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
    const lefto = /Damage \(Leftovers\):<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
    expect(Number(av![1])).toBeLessThan(Number(lefto![1]));
  });

  it('does NOT split a physical move — Assault Vest leaves it identical (no dupes)', () => {
    // U-turn is physical; AV boosts only SpD, so both items deal the same → one line.
    const html = buildMoveSection(battle, noivern(), 'U-turn', data);
    expect(html).toContain('<small>Damage:</small>');
    expect(html).not.toContain('Damage (');
  });

  it('collapses back to the plain line once the item is revealed', () => {
    const known = loadBattle(); // fixture default: Leftovers is revealed
    const html = buildMoveSection(known.battle, known.active('Noivern'), 'Draco Meteor', data);
    expect(html).toContain('<small>Damage:</small>');
    expect(html).not.toContain('Damage (');
  });
});

describe('buildPokemonSection hovering THEIR Tentacruel (possible sets)', () => {
  const {battle, active} = loadBattle();
  const html = buildPokemonSection(battle, active('Tentacruel'), data);

  it('renders each set as its own grey-panelled divider block (no summary header)', () => {
    expect(html).toContain('<div class="hichu-block">');
    expect(html).not.toContain('Possible sets'); // the removed top line
    expect(html).not.toContain('dmg vs');
  });

  it("renders the set as a named block in the original's layout", () => {
    expect(html).toContain('<span style="text-decoration: underline;">Bulky Support</span>');
    expect(html).toContain('<small>Tera Types:</small> Flying, Grass');
  });

  it('treats the revealed Leftovers as fact and drops Assault Vest entirely', () => {
    // The feed lists Assault Vest and Leftovers for Bulky Support; the battle
    // revealed Leftovers, so the item line is settled — not a list of maybes.
    expect(html).toContain('✓ Leftovers');
    expect(html).not.toContain('Assault Vest');
  });

  it('attaches damage in parens to damaging moves, and none to status moves', () => {
    // Nothing of Tentacruel's moveset is revealed at turn 5.
    expect(html).toMatch(/Surf \(\d+(\.\d+)?–\d+(\.\d+)?%\)/);
    expect(html).toContain('Haze');
    expect(html).not.toMatch(/Haze \(/);
  });
});

describe('buildPokemonSection hovering OUR Noivern (their read on us)', () => {
  const {battle, active} = loadBattle();
  const html = buildPokemonSection(battle, active('Noivern'), data);

  it('shows the mirror view: our public reveals give the set away', () => {
    // We terastallized Fire, and only Fast Support runs Tera Fire — so the
    // opponent can already pin our exact set from public info alone: one block.
    expect(html.match(/<div class="hichu-block">/g)).toHaveLength(1);
    expect(html).toContain('<span style="text-decoration: underline;">Fast Support</span>');
    expect(html).not.toContain('Boomburst'); // Fast Attacker is ruled out
  });

  it('marks what they have actually seen', () => {
    expect(html).toContain('✓ Flamethrower');
    expect(html).toContain('✓ Fire'); // the active Tera is public
  });

  it('carries no damage figures — this view is about information, not threat', () => {
    expect(html).not.toMatch(/\(\d+(\.\d+)?–\d+(\.\d+)?%\)/);
  });
});
