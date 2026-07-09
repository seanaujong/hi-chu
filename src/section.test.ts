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
function loadBattle(over: {noivernTerastallized?: string; tentacruelItem?: string; tentacruelPrevItem?: string; tentacruelBoosts?: Record<string, number>; myNoivernItem?: string; myNoivernTera?: string; myNoivernMoves?: string[]; fullHp?: boolean} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
  const sides: ClientSide[] = fixture.battle.sides.map((s, i) => {
    const side = {isFar: i === 1, sideConditions: {...s.sideConditions}, active: [] as (ClientPokemon | null)[]};
    side.active = s.active.map((p) => {
      const terastallized = p.speciesForme === 'Noivern' && over.noivernTerastallized !== undefined
        ? over.noivernTerastallized
        : p.terastallized;
      // Un-reveal Tentacruel's item to exercise the still-unknown-item split (its
      // Bulky Support set can run Assault Vest OR Leftovers).
      const item = p.speciesForme === 'Tentacruel' && over.tentacruelItem !== undefined ? over.tentacruelItem : p.item;
      // Side 0 is ours (p1), side 1 theirs (p2); the client tags actors this way.
      const ident = `p${i + 1}: ${p.speciesForme}`;
      return {
        ...p,
        terastallized,
        item,
        side,
        ident,
        // A knocked-off item: nothing held, prevItem names what was lost.
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelPrevItem !== undefined ? {prevItem: over.tentacruelPrevItem} : {}),
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelBoosts !== undefined ? {boosts: over.tentacruelBoosts} : {}),
        ...(over.fullHp ? {hp: p.maxhp} : {}),
      } as unknown as ClientPokemon;
    });
    return side as unknown as ClientSide;
  });
  const battle = {
    gen: fixture.battle.gen,
    tier: fixture.battle.tier,
    weather: fixture.battle.weather,
    pseudoWeather: fixture.battle.pseudoWeather,
    sides,
    // Our private team view — the item, Tera type, and moveset the opponent can't see. Only Noivern.
    ...(over.myNoivernItem !== undefined || over.myNoivernTera !== undefined || over.myNoivernMoves !== undefined
      ? {myPokemon: [{
          ident: 'p1: Noivern',
          ...(over.myNoivernItem !== undefined ? {item: over.myNoivernItem} : {}),
          ...(over.myNoivernTera !== undefined ? {teraType: over.myNoivernTera} : {}),
          ...(over.myNoivernMoves !== undefined ? {moves: over.myNoivernMoves} : {}),
        }]}
      : {}),
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

  it('shows the HP swing for Pain Split (a status move the calc can’t model)', () => {
    const html = buildMoveSection(battle, active('Noivern'), 'Pain Split', data);
    expect(html).toContain('<small>Pain Split:</small>');
    expect(html).toMatch(/you [\d.]+% → [\d.]+%/);
    expect(html).toMatch(/foe [\d.]+% → [\d.]+%/);
  });

  it('doubles: shows a labelled damage section for EACH foe', () => {
    // Two foes on the far side → one "vs <name>" section apiece (singles shows one, unlabelled).
    const clientMon = (speciesForme: string, side: unknown, slot: string): ClientPokemon =>
      ({speciesForme, level: 80, hp: 100, maxhp: 100, status: '', boosts: {}, terastallized: '', moveTrack: [], ident: `${slot}: ${speciesForme}`, side} as unknown as ClientPokemon);
    const near = {isFar: false, sideConditions: {}, active: [] as ClientPokemon[]};
    const far = {isFar: true, sideConditions: {}, active: [] as ClientPokemon[]};
    near.active = [clientMon('Noivern', near, 'p1a')];
    far.active = [clientMon('Tentacruel', far, 'p2a'), clientMon('Noivern', far, 'p2b')];
    const dbl = {gen: 9, tier: '[Gen 9] Random Doubles Battle', sides: [near, far]} as unknown as ClientBattle;

    const html = buildMoveSection(dbl, near.active[0]!, 'Draco Meteor', data);
    expect(html).toContain('<b>Tentacruel</b>');
    expect(html).toContain('<b>Noivern</b>');
    expect((html.match(/<small>vs<\/small>/g) ?? []).length).toBe(2); // a headed section per foe
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

describe('buildMoveSection uses YOUR real item for your own attacker (via myPokemon)', () => {
  // Our Noivern's set can be Choice Specs (Fast Attacker) or Heavy-Duty Boots (Fast
  // Support). Boots is silent, so without the private team the calc assumes the first
  // item — Choice Specs — and over-reads a special move's damage by ~1.5×.
  const dm = (b: ReturnType<typeof loadBattle>) => maxPercent(buildMoveSection(b.battle, b.active('Noivern'), 'Draco Meteor', data));
  // Un-terastallize so the set ISN'T already narrowed to Boots by the live Tera Fire —
  // this is the bug scenario, where the item is genuinely undeducible from public info.
  const untera = {noivernTerastallized: ''};

  it('un-narrowed, the default assumes Choice Specs; your real Boots corrects it', () => {
    const assumed = dm(loadBattle(untera)); // no private team → assumes Choice Specs (the bug)
    const real = dm(loadBattle({...untera, myNoivernItem: 'heavydutyboots'})); // your actual item, id form
    expect(real).toBeLessThan(assumed); // the phantom ~1.5× Specs boost is gone
  });

  it('bridges the id form to the calc name (choicespecs must map to Choice Specs)', () => {
    // The calc ignores a raw id — so if the mapping failed, both would fall to the neutral
    // no-item number and be equal. Boots < Specs proves the override reached the calc as a
    // real name for both.
    expect(dm(loadBattle({...untera, myNoivernItem: 'heavydutyboots'})))
      .toBeLessThan(dm(loadBattle({...untera, myNoivernItem: 'choicespecs'})));
  });
});

describe('buildMoveSection with Terastallize ticked (the pre-move Tera preview)', () => {
  // Un-terastallize Noivern and pin its item to Boots on BOTH sides of each comparison, so
  // the only thing the toggle changes is the Tera itself (the pending Tera type also narrows
  // the role, which could otherwise shift the assumed item and muddy the number).
  const base = {noivernTerastallized: '', myNoivernItem: 'heavydutyboots'};
  const flame = (b: ReturnType<typeof loadBattle>, teraSelected: boolean) =>
    buildMoveSection(b.battle, b.active('Noivern'), 'Flamethrower', data, teraSelected);

  it('previews OUR private Tera type: Flamethrower gains Fire STAB and the line says so', () => {
    const plain = flame(loadBattle(base), false);
    const tera = flame(loadBattle({...base, myNoivernTera: 'Fire'}), true);
    expect(tera).toContain('Tera Fire');
    expect(plain).not.toContain('Tera Fire');
    // Flamethrower is non-STAB on Flying/Dragon Noivern; Tera Fire makes it STAB (×1.5).
    expect(maxPercent(tera)).toBeGreaterThan(maxPercent(plain) * 1.4);
  });

  it('changes nothing when the private team carries no Tera type to preview', () => {
    expect(flame(loadBattle(base), true)).toBe(flame(loadBattle(base), false));
  });

  it('changes nothing once actually terastallized (the public facts already drive the calc)', () => {
    const already = {myNoivernItem: 'heavydutyboots', myNoivernTera: 'Fire'}; // fixture Noivern IS Tera Fire
    expect(flame(loadBattle(already), true)).toBe(flame(loadBattle(already), false));
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

describe('foe-level item facts qualifying the KO/nHKO lines', () => {
  it('a knocked-off Leftovers no longer heals — the nHKO ladder drops the recovery', () => {
    // Held and revealed: the 3HKO figure silently bakes in the between-turns heal.
    const held = loadBattle();
    expect(buildMoveSection(held.battle, held.active('Noivern'), 'Draco Meteor', data)).toContain('3HKO 96%');
    // Knocked off (prevItem set, nothing held): the heal must go with the item.
    const knocked = loadBattle({tentacruelItem: '', tentacruelPrevItem: 'Leftovers'});
    const html = buildMoveSection(knocked.battle, knocked.active('Noivern'), 'Draco Meteor', data);
    expect(html).toContain('3HKO 100%');
    expect(html).not.toContain('Leftovers');
  });

  it('a possible Focus Sash caveats the KO claim against a full-HP defender', () => {
    // Give Noivern's one surviving role (Fast Support — its active Tera Fire pins it) a
    // Focus Sash option, and make Tentacruel's Surf a genuine OHKO with +2 SpA.
    const clone = JSON.parse(JSON.stringify(fixture.randbats)) as {Noivern: {roles: {'Fast Support': {items: string[]}}}};
    clone.Noivern.roles['Fast Support'].items.push('Focus Sash');
    const sashData = clone as unknown as RandbatsData;
    const {battle, active} = loadBattle({fullHp: true, tentacruelBoosts: {spa: 2}});
    const html = buildMoveSection(battle, active('Tentacruel'), 'Surf', sashData);
    expect(html).toContain('guaranteed KO');
    expect(html).toContain('(if Focus Sash: survives at 1 HP)');
    // The same hover with the real feed (no Sash in the pool) carries no caveat.
    const plain = buildMoveSection(battle, active('Tentacruel'), 'Surf', data);
    expect(plain).toContain('guaranteed KO');
    expect(plain).not.toContain('Focus Sash');
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

describe('buildPokemonSection speed order (the ⚡ line on a foe hover)', () => {
  const {battle, active} = loadBattle();

  it('leads the foe tooltip with the verdict, before any set block', () => {
    const html = buildPokemonSection(battle, active('Tentacruel'), data);
    // Real numbers off the real battle: our Noivern 249 Spe vs their Tentacruel 216.
    expect(html).toContain('⚡ you move first — 249 vs 216');
    expect(html.indexOf('⚡')).toBeLessThan(html.indexOf('Bulky Support'));
  });

  it('does not split the line over an item that cannot change speed (AV vs Leftovers)', () => {
    const {battle: b, active: a} = loadBattle({tentacruelItem: ''});
    const html = buildPokemonSection(b, a('Tentacruel'), data);
    expect(html).toContain('⚡ you move first — 249 vs 216');
    expect(html).not.toContain('<small>if '); // no speed asides — both items are speed-inert
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

  it('carries no speed line either — judging it would use private facts, and the mirror stays public', () => {
    expect(html).not.toContain('⚡');
  });
});

describe('buildPokemonSection hovering OUR Noivern as the player (the matchup view)', () => {
  // The private team knows the whole kit — Fast Support's real moves, in the client's
  // id form — even though only Flamethrower is publicly revealed at turn 5.
  const moves = ['dracometeor', 'flamethrower', 'hurricane', 'roost'];
  const mine = {myNoivernItem: 'heavydutyboots', myNoivernMoves: moves};

  it('leads with our moves vs their active, before the mirror blocks', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toMatch(/Draco Meteor: [\d.]+% - [\d.]+%/); // id form displayed as the real name
    expect(html.indexOf('<b>Tentacruel</b>')).toBeLessThan(html.indexOf('Fast Support'));
  });

  it('gives status moves no line — damage is the question here', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).not.toContain('Roost:');
  });

  it('shows the same numbers the move tooltip would — one truth per move', () => {
    const {battle, active} = loadBattle(mine);
    const hover = buildPokemonSection(battle, active('Noivern'), data);
    const line = /Draco Meteor: ([\d.]+)% - ([\d.]+)%/.exec(hover)!;
    const button = buildMoveSection(battle, active('Noivern'), 'Draco Meteor', data);
    expect(button).toContain(`<small>Damage:</small> ${line[1]}% - ${line[2]}%`);
  });

  it("splits a move into labelled outcomes when the foe's item is still unknown", () => {
    // Tentacruel's Bulky Support can hold Assault Vest or Leftovers; Draco Meteor is
    // special, so the hidden Vest changes the number — never one confidently-wrong line.
    const {battle, active} = loadBattle({...mine, tentacruelItem: ''});
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).toMatch(/Draco Meteor: <small>\((Assault Vest|Leftovers)\)<\/small>/);
  });

  it('keeps the mirror blocks strictly public — the private moveset never leaks into them', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    const mirror = html.slice(html.indexOf('Fast Support'));
    // Hurricane is in our private kit but publicly unrevealed — the mirror may list it
    // only as a speculative pool option, never as a confirmed ✓.
    expect(mirror).not.toContain('✓ Hurricane');
    expect(mirror).toContain('✓ Flamethrower');
  });
});
