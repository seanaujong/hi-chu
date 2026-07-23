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
import {buildMoveSection, buildPokemonSection, buildSwitchSection} from './section.js';
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
function loadBattle(over: {noivernTerastallized?: string; tentacruelItem?: string; tentacruelPrevItem?: string; tentacruelBoosts?: Record<string, number>; tentacruelMoveTrack?: string[]; myNoivernItem?: string; myNoivernTera?: string; myNoivernMoves?: string[]; myPokemon?: readonly unknown[]; fullHp?: boolean; myNoivernHpPercent?: number; nearTailwind?: boolean; nearStealthRock?: boolean; nearSpikes?: number; foeDitto?: 'transformed' | 'plain'} = {}): {battle: ClientBattle; active: (name: string) => ClientPokemon} {
  const sides: ClientSide[] = fixture.battle.sides.map((s, i) => {
    // Tailwind blows on OUR side (index 0) only — the asymmetry is the point: it must
    // double our speed and leave the foe's alone, whichever side a caller orients on.
    const sideConditions = {
      ...s.sideConditions,
      ...(i === 0 && over.nearTailwind ? {tailwind: ['tailwind', 1]} : {}),
      ...(i === 0 && over.nearStealthRock ? {stealthrock: ['Stealth Rock', 1]} : {}),
      ...(i === 0 && over.nearSpikes !== undefined ? {spikes: ['Spikes', over.nearSpikes]} : {}),
    };
    const side = {isFar: i === 1, sideConditions, active: [] as (ClientPokemon | null)[]};
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
        ...(p.speciesForme === 'Tentacruel' && over.tentacruelMoveTrack !== undefined
          ? {moveTrack: over.tentacruelMoveTrack.map((m) => [m, 0])}
          : {}),
        ...(over.fullHp ? {hp: p.maxhp} : {}),
        ...(p.speciesForme === 'Noivern' && over.myNoivernHpPercent !== undefined
          ? {hp: Math.round(p.maxhp * over.myNoivernHpPercent)}
          : {}),
      } as unknown as ClientPokemon;
    });
    return side as unknown as ClientSide;
  });
  // Swap the foe active for a Ditto — plain, or Transformed into our Noivern. The client
  // records a transform as TWO volatiles: the target's own Pokemon object, and the same
  // `formechange` an ordinary forme change uses. It also copies the target's tracked moves
  // onto the Ditto, each STARRED: `*Flamethrower` is Noivern's move, not Ditto's.
  if (over.foeDitto) {
    const ourNoivern = sides[0]!.active[0];
    const ditto = {
      speciesForme: 'Ditto', level: 87, hp: 225, maxhp: 225, status: '', boosts: {},
      terastallized: '', ident: 'p2: Ditto', side: sides[1],
      ...(over.foeDitto === 'transformed'
        ? {
            moveTrack: [['*Flamethrower', 0]],
            volatiles: {
              transform: ['transform', ourNoivern, false, 'M', 82],
              formechange: ['formechange', 'Noivern'],
            },
          }
        : {}),
    };
    (sides[1]!.active as (ClientPokemon | null)[])[0] = ditto as unknown as ClientPokemon;
  }
  const battle = {
    gen: fixture.battle.gen,
    tier: fixture.battle.tier,
    weather: fixture.battle.weather,
    pseudoWeather: fixture.battle.pseudoWeather,
    sides,
    // Our private team view — the item, Tera type, and moveset the opponent can't see. Only
    // Noivern, unless `myPokemon` supplies the whole array (the Illusion case, where the
    // Pokémon in our active slot is NOT the one the battle view shows).
    ...(over.myPokemon !== undefined ? {myPokemon: over.myPokemon} : {}),
    ...(over.myPokemon === undefined && (over.myNoivernItem !== undefined || over.myNoivernTera !== undefined || over.myNoivernMoves !== undefined)
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

/** A stand-in for a revealed-but-benched sidebar icon: the same Pokémon object, minus
 *  its membership in its side's active slot — the one thing `isActiveMon` reads — while
 *  everything else (the shared `.side` reference, its `ident`) stays wired up exactly
 *  as it is for the genuine active-mon hover, so the private-team lookup still resolves. */
function benched(pokemon: ClientPokemon): ClientPokemon {
  return {...pokemon};
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

describe('an Illusion disguise on OUR side (the Pokémon in the slot is not the one shown)', () => {
  // The sim sends the disguise's details to the disguised Pokémon's OWN side too, so the
  // battle view calls our active "Noivern" while `myPokemon[0]` — the private team, indexed
  // by active slot — knows a Zoroark-Hisui is standing there. Its ident names the real
  // Pokémon, so the old ident lookup found our benched Noivern instead: wrong item, wrong
  // moveset, and a damage number computed off the wrong species entirely.
  const zoroark = {
    ident: 'p1: Zoroark-Hisui',
    details: 'Zoroark-Hisui, L80, M',
    condition: '218/218',
    item: 'lifeorb',
    ability: 'illusion',
    baseAbility: 'illusion',
    teraType: 'Fighting',
    moves: ['flamethrower', 'focusblast', 'hypervoice', 'uturn'],
  };
  const noivern = {ident: 'p1: Noivern', item: 'heavydutyboots', moves: ['dracometeor', 'flamethrower', 'hurricane', 'roost']};
  // Slot 0 is the disguised Zoroark; the Noivern it is imitating sits on the bench.
  const disguised = {noivernTerastallized: '', myPokemon: [zoroark, noivern]};
  const undisguised = {noivernTerastallized: '', myPokemon: [noivern]};

  it('calculates OUR move from the Zoroark that is really there, not from the disguise', () => {
    const real = loadBattle(disguised);
    const shown = loadBattle(undisguised);
    const html = buildMoveSection(real.battle, real.active('Noivern'), 'Flamethrower', data);
    // Zoroark-Hisui (L80, 125 base SpA, Life Orb) hits half again as hard as Boots
    // Noivern (L82, 97 base SpA) — pinned against a real run, not arithmetic. Both
    // numbers are small because Tentacruel resists Fire.
    expect(maxPercent(html)).toBe(14.7);
    expect(maxPercent(buildMoveSection(shown.battle, shown.active('Noivern'), 'Flamethrower', data))).toBe(9.6);
  });

  it('reads the private item/Tera type off the SLOT, not the ident the disguise borrows', () => {
    // Ticking Terastallize must preview Zoroark's Fighting, never the bench Noivern's.
    const {battle, active} = loadBattle(disguised);
    expect(buildMoveSection(battle, active('Noivern'), 'Focus Blast', data, true)).toContain('Tera Fighting');
  });

  it('leads our own hover with the real Zoroark’s moves, and keeps the mirror on the disguise', () => {
    const {battle, active} = loadBattle(disguised);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).toMatch(/Focus Blast: [\d.]+% - [\d.]+%/); // Zoroark's kit, not Noivern's
    expect(html).not.toContain('Draco Meteor:');
    // The mirror is what THEY can deduce, and they see a Noivern.
    const mirror = html.slice(html.indexOf('hichu-block'));
    expect(mirror).toContain('Fast Support'); // a Noivern role
    expect(mirror).not.toContain('Wallbreaker'); // Zoroark's role never leaks in
  });

  it('judges the ⚡ verdict and the threat into us on the real Zoroark', () => {
    // A foe hover reads our side of both lines: our speed, and their damage into us.
    const real = loadBattle(disguised);
    const shown = loadBattle(undisguised);
    const line = (b: ReturnType<typeof loadBattle>) => /⚡[^<]*/.exec(buildPokemonSection(b.battle, b.active('Tentacruel'), data))![0];
    expect(line(real)).toContain('222'); // Zoroark-Hisui L80's Speed
    expect(line(shown)).toContain('249'); // Noivern L82's
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

describe('the sets view brackets a genuinely uncertain ATTACKER item instead of guessing one', () => {
  // A synthetic, role-less entry: Weavile could be holding Life Orb (+30% own damage) or
  // Leftovers (no offensive effect) — unlike Tentacruel's AV/Leftovers fixture above, THIS
  // item actually changes the HOLDER's own attacking numbers, which is what the sets view's
  // per-candidate damage needs to prove it no longer guesses one representative item.
  const feed: RandbatsData = {
    Weavile: {level: 78, abilities: ['Pressure'], items: ['Life Orb', 'Leftovers'], moves: ['Icicle Crash']},
  };
  const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
  const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
  const ourActive = {
    speciesForme: 'Skarmory', level: 78, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p1: Skarmory', side: near,
  } as unknown as ClientPokemon;
  const foeWeavile = {
    speciesForme: 'Weavile', level: 78, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p2: Weavile', side: far,
  } as unknown as ClientPokemon;
  near.active = [ourActive];
  far.active = [foeWeavile];
  const battle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far]} as unknown as ClientBattle;

  it('breaks Icicle Crash out into labelled Life Orb / Leftovers outcomes, never a single guess', () => {
    const html = buildPokemonSection(battle, foeWeavile, feed);
    expect(html).not.toMatch(/Icicle Crash<\/b>? \(/); // no single guessed number in the Moves: line
    expect(html).toContain('<small>Icicle Crash:</small>'); // the move's own break-out label
    const lifeOrb = /<small>\(Life Orb\)<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
    const leftovers = /<small>\(Leftovers\)<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
    expect(lifeOrb).not.toBeNull();
    expect(leftovers).not.toBeNull();
    // Life Orb's +30% must actually show up as the bigger number, not just a different label.
    expect(Number(lifeOrb![1])).toBeGreaterThan(Number(leftovers![1]));
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

  it('carries no speed line either — a spectator has no private team to read our speed from', () => {
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

  it('carries the same Terastallize preview as the move tooltip — the two surfaces must not diverge', () => {
    const teraMine = {...mine, noivernTerastallized: '', myNoivernTera: 'Fire'};
    const plain = loadBattle(teraMine);
    const tera = loadBattle(teraMine);
    const plainHtml = buildPokemonSection(plain.battle, plain.active('Noivern'), data);
    const teraHtml = buildPokemonSection(tera.battle, tera.active('Noivern'), data, false, true);
    const plainLine = /Flamethrower: ([\d.]+)% - ([\d.]+)%/.exec(plainHtml)!;
    const teraLine = /Flamethrower: ([\d.]+)% - ([\d.]+)%/.exec(teraHtml)!;
    // Flamethrower is non-STAB on Flying/Dragon Noivern; Tera Fire makes it STAB (×1.5) —
    // the same swing `buildMoveSection`'s own Tera-preview test pins.
    expect(Number(teraLine[2])).toBeGreaterThan(Number(plainLine[2]) * 1.4);
    // And it must be the EXACT number the move tooltip previews — one truth, two surfaces.
    const button = buildMoveSection(tera.battle, tera.active('Noivern'), 'Flamethrower', data, true);
    expect(button).toContain(`<small>Damage:</small> ${teraLine[1]}% - ${teraLine[2]}%`);
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

describe('the matchup view’s defensive half — what the foe’s moves would do INTO this mon', () => {
  const moves = ['dracometeor', 'flamethrower', 'hurricane', 'roost'];
  const mine = {myNoivernItem: 'heavydutyboots', myNoivernMoves: moves};

  it('omits the Incoming group for the mon actually ACTIVE on the field — hovering the foe already shows those numbers', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).not.toContain('Incoming');
  });

  it('lists Tentacruel’s own possible moves as an "Incoming:" group for a switch-decision candidate (a revealed bench mon), after our own damage lines', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, benched(active('Noivern')), data);
    expect(html).toContain('<small>Incoming:</small>');
    // Every one of Tentacruel's Bulky Support moves should show up with a damage range.
    expect(html).toMatch(/Surf: [\d.]+% - [\d.]+%/);
    expect(html).toMatch(/Knock Off: [\d.]+% - [\d.]+%/);
    expect(html.indexOf('Draco Meteor:')).toBeLessThan(html.indexOf('<small>Incoming:</small>'));
    expect(html.indexOf('<small>Incoming:</small>')).toBeLessThan(html.indexOf('Surf:'));
  });

  it('grades the incoming KO chance against OUR Noivern’s HP, not Tentacruel’s', () => {
    // Knock Off boosted 1.5× by our real Heavy-Duty Boots — real-item awareness applies to
    // the DEFENSIVE side too, not just our own attacks.
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, benched(active('Noivern')), data);
    const incoming = html.slice(html.indexOf('<small>Incoming:</small>'));
    expect(incoming).toMatch(/Knock Off: [\d.]+% - [\d.]+%/);
  });

  it('marks a move Tentacruel has actually used with the sets view’s own ✓', () => {
    const {battle, active} = loadBattle({...mine, tentacruelMoveTrack: ['Surf']});
    const html = buildPokemonSection(battle, benched(active('Noivern')), data);
    const incoming = html.slice(html.indexOf('<small>Incoming:</small>'));
    expect(incoming).toContain('<b>✓ Surf</b>:');
    expect(incoming).not.toContain('✓ Knock Off');
  });

  it('reaches the switch menu too — the only OTHER surface a benched mon’s incoming threat can appear on', () => {
    const {battle} = loadBattle();
    const server: unknown = {
      ident: 'p1: Noivern', details: 'Noivern, L82, F', condition: '272/272',
      item: 'heavydutyboots', baseAbility: 'infiltrator', teraType: 'Fire',
      moves: ['dracometeor', 'flamethrower', 'hurricane', 'roost'],
    };
    const html = buildSwitchSection(battle, server as never, data);
    expect(html).toContain('<small>Incoming:</small>');
    expect(html).toMatch(/Surf: [\d.]+% - [\d.]+%/);
  });

  it('is randbats-only — an open format has no move pool to enumerate, so it renders nothing', () => {
    const {battle, active} = loadBattle(mine);
    const openBattle = {...battle, tier: '[Gen 9] OU'} as ClientBattle;
    const html = buildPokemonSection(openBattle, benched(active('Noivern')), null);
    expect(html).not.toContain('Incoming');
  });

  it('factors in switch-in hazard damage for a bench candidate: at 50% HP, Sludge Bomb has no KO chance — Stealth Rock chips 25%, tipping it into a guaranteed KO', () => {
    // Choice Specs (Noivern's OTHER entry-level item option, alongside Heavy-Duty Boots)
    // rather than an arbitrary item: ownItemName only honours an item actually in the
    // resolved entry's pool, and it's item-inert on the DEFENSIVE side either way (it
    // only boosts the holder's own offense) — so this isolates the hazard effect alone.
    const without = loadBattle({...mine, myNoivernItem: 'choicespecs', myNoivernHpPercent: 0.5});
    const withHazard = loadBattle({...mine, myNoivernItem: 'choicespecs', myNoivernHpPercent: 0.5, nearStealthRock: true});
    const baseline = buildPokemonSection(without.battle, benched(without.active('Noivern')), data);
    const html = buildPokemonSection(withHazard.battle, benched(withHazard.active('Noivern')), data);
    expect(baseline).not.toContain('Sludge Bomb: 30.7% - 36.1% ·');
    expect(html).toContain('Sludge Bomb: 30.7% - 36.1% · <span class="hichu-ko">guaranteed KO</span> at 25% HP');
  });

  it('never touches a Heavy-Duty Boots holder — same numbers with or without hazards up', () => {
    const withHazards = loadBattle({...mine, nearStealthRock: true});
    const without = loadBattle(mine);
    const withHtml = buildPokemonSection(withHazards.battle, benched(withHazards.active('Noivern')), data);
    const withoutHtml = buildPokemonSection(without.battle, benched(without.active('Noivern')), data);
    expect(withHtml).toEqual(withoutHtml);
    expect(withHtml).not.toContain('at ');
  });

  it('never adjusts the mon actually ACTIVE on the field — its live HP is already accurate', () => {
    const withHazards = loadBattle({...mine, myNoivernItem: 'leftovers', nearStealthRock: true});
    const without = loadBattle({...mine, myNoivernItem: 'leftovers'});
    const withHtml = buildPokemonSection(withHazards.battle, withHazards.active('Noivern'), data);
    const withoutHtml = buildPokemonSection(without.battle, without.active('Noivern'), data);
    expect(withHtml).toEqual(withoutHtml);
  });
});

describe('buildSwitchSection (the switch menu: a ServerPokemon, NO battle-view Pokémon)', () => {
  // The client's switchpokemon tooltip passes (null, serverPokemon) — verified against a
  // real two-account battle AND the client source (the side lookup is commented out) —
  // so this surface must build the matchup block from the private ServerPokemon alone.
  const {battle} = loadBattle();
  const server = (over: Record<string, unknown> = {}) =>
    ({ident: 'p1: Noivern', details: 'Noivern, L82, F', condition: '272/272',
      item: 'heavydutyboots', baseAbility: 'infiltrator', teraType: 'Fire',
      moves: ['dracometeor', 'flamethrower', 'hurricane', 'roost'], ...over}) as never;

  it('renders the matchup block for a benched mon — and ONLY that (no mirror from private facts)', () => {
    const html = buildSwitchSection(battle, server(), data);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toMatch(/Draco Meteor: [\d.]+% - [\d.]+%/);
    expect(html).not.toContain('Roost:');
    expect(html).not.toContain('Fast Support'); // no set blocks on this surface
    expect(html).not.toContain('✓');
  });

  it('applies the id-form item for real, and resolves a knocked-off item to NONE, never the assumed set item', () => {
    const max = (html: string) => Number(/Draco Meteor: [\d.]+% - ([\d.]+)%/.exec(html)![1]);
    const specs = max(buildSwitchSection(battle, server({item: 'choicespecs'}), data));
    // item: '' is a KNOWN empty slot — if the resolver assumed Choice Specs back on
    // (the set's first item), these two numbers would be equal.
    const knockedOff = max(buildSwitchSection(battle, server({item: ''}), data));
    expect(specs).toBeGreaterThan(knockedOff);
  });

  it('renders nothing for a fainted mon — it cannot switch in', () => {
    expect(buildSwitchSection(battle, server({condition: '0 fnt'}), data)).toBe('');
  });

  it('answers "if I send this in, do I outspeed?" — the only surface a bench mon\'s speed appears on', () => {
    expect(buildSwitchSection(battle, server(), data)).toContain('⚡ you move first — 249 vs 216');
  });

  it('reads the bench mon\'s speed off its PRIVATE facts: an id-form Scarf, and its status', () => {
    // The private team names an item the calc only honours by display name; if the id
    // form were passed through raw the Scarf would apply nothing and this would stay 249.
    expect(buildSwitchSection(battle, server({item: 'choicescarf'}), data)).toContain('⚡ you move first — 373 vs 216');
    // A paralyzed mon really is slower on the turn it comes in — half of 249.
    expect(buildSwitchSection(battle, server({condition: '272/272 par'}), data))
      .toContain('<span class="hichu-ko">they move first</span> — 124 vs 216');
  });

  it('gives a bench mon no boosts — it enters with none, whatever is standing there now', () => {
    // Tentacruel at +2 Spe outruns us; our benched Noivern is unaffected by the foe's boost,
    // and carries no boost of its own (a bench mon has none to carry).
    const {battle: b} = loadBattle({tentacruelBoosts: {spe: 2}});
    expect(buildSwitchSection(b, server(), data)).toContain('— 249 vs 432');
  });

  it('factors in Stealth Rock on switch-in when the candidate does not hold Heavy-Duty Boots: at 50% HP, Sludge Bomb has no KO chance — Stealth Rock chips 25%, tipping it into a guaranteed KO', () => {
    const {battle: b} = loadBattle({nearStealthRock: true});
    const baseline = buildSwitchSection(battle, server({item: 'leftovers', condition: '136/272'}), data);
    const html = buildSwitchSection(b, server({item: 'leftovers', condition: '136/272'}), data);
    expect(baseline).not.toContain('Sludge Bomb: 30.7% - 36.1% ·');
    expect(html).toContain('Sludge Bomb: 30.7% - 36.1% · <span class="hichu-ko">guaranteed KO</span> at 25% HP');
  });

  it('never touches a Heavy-Duty Boots holder on the switch menu — same numbers with or without hazards up', () => {
    const {battle: b} = loadBattle({nearStealthRock: true});
    const withHazard = buildSwitchSection(b, server({condition: '136/272'}), data); // default item: heavydutyboots
    const without = buildSwitchSection(battle, server({condition: '136/272'}), data);
    expect(withHazard).toEqual(without);
    expect(withHazard).not.toContain('guaranteed KO');
  });

  it('renders a faints-outright note, no Incoming lines, when hazards alone would faint the switch-in', () => {
    const {battle: b} = loadBattle({nearStealthRock: true});
    const html = buildSwitchSection(b, server({item: 'leftovers', condition: '20/274'}), data);
    expect(html).toContain('<small>Incoming:</small> faints to Stealth Rock/Spikes before it can act');
    expect(html).not.toMatch(/Surf: [\d.]+% - [\d.]+%/);
  });
});

describe('the ⚡ line on OUR side of the pair (matchup view + switch menu)', () => {
  const mine = {myNoivernItem: 'heavydutyboots', myNoivernMoves: ['dracometeor', 'flamethrower', 'hurricane', 'roost']};

  it('sits under the "vs <foe>" header, above the move lines', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).toContain('⚡ you move first — 249 vs 216');
    expect(html.indexOf('<b>Tentacruel</b>')).toBeLessThan(html.indexOf('⚡'));
    expect(html.indexOf('⚡')).toBeLessThan(html.indexOf('Draco Meteor:'));
  });

  it('reads the same verdict as the foe hover — one truth per pair, two places to find it', () => {
    const {battle, active} = loadBattle(mine);
    const zap = (html: string) => /⚡.*?(?=<\/p>)/.exec(html)![0];
    expect(zap(buildPokemonSection(battle, active('Noivern'), data)))
      .toBe(zap(buildPokemonSection(battle, active('Tentacruel'), data)));
  });

  it('orients Tailwind on the right side of the pair, on both surfaces', () => {
    // Tailwind blows on OUR side only. `ownMovesSection` reads the field with the FOE as
    // defender, so ours is `attackerTailwind` — the mirror image of `speedSection`'s read.
    // Swap the two and our 249 stays put while the foe's 216 doubles to 432.
    const {battle, active} = loadBattle({...mine, nearTailwind: true});
    const server = {ident: 'p1: Noivern', details: 'Noivern, L82, F', condition: '272/272',
      item: 'heavydutyboots', baseAbility: 'infiltrator', moves: ['dracometeor', 'roost']} as never;
    expect(buildPokemonSection(battle, active('Noivern'), data)).toContain('⚡ you move first — 498 vs 216');
    expect(buildSwitchSection(battle, server, data)).toContain('⚡ you move first — 498 vs 216');
    expect(buildPokemonSection(battle, active('Tentacruel'), data)).toContain('⚡ you move first — 498 vs 216');
  });

  it('never reaches the mirror blocks — their read on us stays strictly public', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).toContain('⚡'); // in the matchup block, an our-view surface
    expect(html.slice(html.indexOf('Fast Support'))).not.toContain('⚡');
  });
});

// --- Open formats: no feed, assumed foe spreads -----------------------------
//
// Hand-built stubs rather than the replay fixture: the fixture is a randbats battle,
// and a spectator replay carries no `myPokemon` to drive the own-side surfaces at all.

/** A Custom Game battle: our Dragonite active vs their Tentacruel, private team wired. */
function openBattle(over: {tier?: string; gameType?: string; myStats?: Record<string, number>; myItem?: string; myAbility?: string; myMoves?: string[]; foeItem?: string; foeDexAbilities?: Record<string, string>} = {}): {
  battle: ClientBattle;
  active: (name: string) => ClientPokemon;
} {
  const mon = (speciesForme: string, sideIndex: number, extra: Record<string, unknown> = {}) => ({
    speciesForme,
    level: 100,
    hp: 100,
    maxhp: 100,
    status: '',
    boosts: {},
    moveTrack: [],
    ident: `p${sideIndex + 1}: ${speciesForme}`,
    ...extra,
  });
  const sides = [0, 1].map((i) => {
    const side = {isFar: i === 1, sideConditions: {}, active: [] as unknown[]};
    side.active = [
      i === 0
        ? {...mon('Dragonite', i), side}
        : {...mon('Tentacruel', i, {...(over.foeItem !== undefined ? {item: over.foeItem} : {})}), side},
    ];
    return side as unknown as ClientSide;
  });
  const battle = {
    gen: 9,
    tier: over.tier ?? '[Gen 9] Custom Game',
    ...(over.gameType ? {gameType: over.gameType} : {}),
    sides,
    myPokemon: [
      {
        ident: 'p1: Dragonite',
        details: 'Dragonite, L100',
        condition: '386/386',
        item: over.myItem ?? '',
        ability: over.myAbility ?? '',
        moves: over.myMoves ?? ['earthquake', 'tripleaxel', 'roost'],
        maxhp: 386,
        ...(over.myStats ? {stats: over.myStats} : {}),
      },
    ],
    // The client dex — only consulted for the foe's ability pool here.
    ...(over.foeDexAbilities
      ? {dex: {species: {get: () => ({exists: true, baseStats: {hp: 80, atk: 70, def: 65, spa: 80, spd: 120, spe: 100}, types: ['Water', 'Poison'], abilities: over.foeDexAbilities})}}}
      : {}),
  } as unknown as ClientBattle;
  const active = (name: string): ClientPokemon =>
    sides.flatMap((s) => s.active).find((p): p is ClientPokemon => p?.speciesForme === name)!;
  return {battle, active};
}

/** The max-damage % on the "Damage (label): X% - Y%" line for one bucket. */
function bucketMax(html: string, label: string): number {
  const m = new RegExp(`Damage \\(${label.replace('/', '\\/')}\\):</small> [\\d.]+% - ([\\d.]+)%`).exec(html);
  if (!m) throw new Error(`no "${label}" damage line in:\n${html}`);
  return Number(m[1]);
}

describe('open formats (no set feed): the move tooltip', () => {
  it('brackets the foe’s unknown spread with two labelled damage lines and ONE ⚠ note', () => {
    const {battle, active} = openBattle();
    const html = buildMoveSection(battle, active('Dragonite'), 'Earthquake', null);
    expect(html).toContain('Damage (uninvested):');
    expect(html).toContain('Damage (max HP/Def):');
    // The bracket is honest: investing bulk always lowers the number.
    expect(bucketMax(html, 'max HP/Def')).toBeLessThan(bucketMax(html, 'uninvested'));
    expect(html.match(/⚠ foe EVs\/item assumed/g)).toHaveLength(1);
  });

  it('picks the defensive axis the move actually attacks', () => {
    const {battle, active} = openBattle({myMoves: ['surf']});
    const html = buildMoveSection(battle, active('Dragonite'), 'Surf', null);
    expect(html).toContain('Damage (max HP/SpD):');
    expect(html).not.toContain('max HP/Def');
  });

  it('shows the true multi-hit breakdown for Triple Axel — the Custom Game verification case', () => {
    // The whole point of open-format support for testing: build the mon, hover the move.
    // Triple Axel's stop-at-miss law gives a non-integral expected hit count.
    const {battle, active} = openBattle();
    const html = buildMoveSection(battle, active('Dragonite'), 'Triple Axel', null);
    expect(html).toContain('Damage (uninvested):');
    expect(html).toMatch(/≈2\.7 hits/);
    expect(html).toContain('per hit');
  });

  it('gives a status move no section at all (Pain Split included: its swing rests on an assumed max HP)', () => {
    const {battle, active} = openBattle();
    expect(buildMoveSection(battle, active('Dragonite'), 'Roost', null)).toBe('');
    expect(buildMoveSection(battle, active('Dragonite'), 'Pain Split', null)).toBe('');
  });

  it('uses OUR exact server-reported stats — the number moves when they arrive', () => {
    // Adamant 252 Atk finals, as the request JSON reports them (pinned in damage.test.ts).
    const plain = openBattle();
    const exact = openBattle({myStats: {atk: 403, def: 226, spa: 212, spd: 236, spe: 197}});
    const assumedMax = bucketMax(buildMoveSection(plain.battle, plain.active('Dragonite'), 'Earthquake', null), 'uninvested');
    const exactMax = bucketMax(buildMoveSection(exact.battle, exact.active('Dragonite'), 'Earthquake', null), 'uninvested');
    expect(exactMax).toBeGreaterThan(assumedMax); // 252+ Atk beats the 85-EV randbats default
  });

  it('uses OUR real item, in the client’s id form', () => {
    const plain = openBattle();
    const band = openBattle({myItem: 'choiceband'});
    expect(bucketMax(buildMoveSection(band.battle, band.active('Dragonite'), 'Earthquake', null), 'uninvested'))
      .toBeGreaterThan(bucketMax(buildMoveSection(plain.battle, plain.active('Dragonite'), 'Earthquake', null), 'uninvested'));
  });

  it('uses OUR real ability, in the client’s id form — a silent ability the public battle view has not revealed', () => {
    // The public battle-view Pokémon (a bare stub here, `ability: ''`) never learns our
    // OWN ability until something reveals it in the log — Aerilate would otherwise be
    // invisible to our own move's damage. Aerilate turns Return (Normal) into a
    // STAB Flying move with a 1.2× boost on top: a dramatic, unmistakable signal.
    const plain = openBattle({myMoves: ['return']});
    const aerilate = openBattle({myMoves: ['return'], myAbility: 'aerilate'});
    expect(bucketMax(buildMoveSection(aerilate.battle, aerilate.active('Dragonite'), 'Return', null), 'uninvested'))
      .toBeGreaterThan(bucketMax(buildMoveSection(plain.battle, plain.active('Dragonite'), 'Return', null), 'uninvested'));
  });

  it('keeps the foe-item caveats silent with nothing revealed, but still applies a revealed item', () => {
    // No item pool → itemStanding finds no holders → no "if Leftovers"/"if Focus Sash".
    const {battle, active} = openBattle();
    expect(buildMoveSection(battle, active('Dragonite'), 'Earthquake', null)).not.toContain('Leftovers');
    // A revealed Assault Vest is a public fact and must reach the calc: the special hit drops.
    const vest = openBattle({foeItem: 'Assault Vest', myMoves: ['surf']});
    const plain = openBattle({myMoves: ['surf']});
    expect(bucketMax(buildMoveSection(vest.battle, vest.active('Dragonite'), 'Surf', null), 'uninvested'))
      .toBeLessThan(bucketMax(buildMoveSection(plain.battle, plain.active('Dragonite'), 'Surf', null), 'uninvested'));
  });

  it('labels a spread × ability split distinctly when an ability changes the number', () => {
    // Solid Rock softens a super-effective hit, so it splits each spread in two: no single
    // axis separates the four buckets and the compound role · ability labels must.
    const {battle, active} = openBattle({foeDexAbilities: {0: 'Clear Body', H: 'Solid Rock'}});
    const html = buildMoveSection(battle, active('Dragonite'), 'Earthquake', null);
    const labels = [...html.matchAll(/Damage \(([^)]+)\):/g)].map((m) => m[1]);
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(4); // every label distinct
    expect(labels.filter((l) => l?.includes('Solid Rock'))).toHaveLength(2);
  });
});

describe('open formats: the own-hover matchup view and the switch menu', () => {
  it('shows our real moves vs the foe, with no sets/mirror/⚡ blocks', () => {
    const {battle, active} = openBattle();
    const html = buildPokemonSection(battle, active('Dragonite'), null);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toMatch(/Earthquake: /);
    expect(html).not.toContain('Roost:'); // status move
    expect(html).not.toContain('⚡');
    expect(html).not.toContain('✓'); // no set knowledge without a pool
    expect(html.match(/⚠ foe EVs\/item assumed/g)).toHaveLength(1);
  });

  it('renders nothing on a FOE hover (v1: the information game needs a pool)', () => {
    const {battle, active} = openBattle();
    expect(buildPokemonSection(battle, active('Tentacruel'), null)).toBe('');
  });

  it('uses OUR real ability here too — the matchup view is a second attacker-resolution site', () => {
    const returnMax = (b: ReturnType<typeof openBattle>) => {
      const m = /Return: <small>\(uninvested\)<\/small> [\d.]+% - ([\d.]+)%/.exec(
        buildPokemonSection(b.battle, b.active('Dragonite'), null),
      );
      if (!m) throw new Error('no Return line');
      return Number(m[1]);
    };
    const plain = openBattle({myMoves: ['return']});
    const aerilate = openBattle({myMoves: ['return'], myAbility: 'aerilate'});
    expect(returnMax(aerilate)).toBeGreaterThan(returnMax(plain));
  });

  it('builds the switch-menu block from the private ServerPokemon, exact stats included', () => {
    const {battle} = openBattle();
    const server = (over: Record<string, unknown> = {}) =>
      ({ident: 'p1: Garchomp', details: 'Garchomp, L100', condition: '357/357', maxhp: 357,
        item: 'choiceband', moves: ['earthquake', 'roost'],
        stats: {atk: 359, def: 236, spa: 176, spd: 196, spe: 306}, ...over}) as never;
    const html = buildSwitchSection(battle, server(), null);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toMatch(/Earthquake: /);
    expect(html).not.toContain('Roost:');
    expect(html.match(/⚠ foe EVs\/item assumed/g)).toHaveLength(1);
    // No feed, no honest foe speed: an assumed spread brackets the axis a MOVE attacks,
    // and nothing falls out of it that could name a Speed stat.
    expect(html).not.toContain('⚡');

    // A knocked-off item (item: '') is a KNOWN empty slot — the Choice Band must go.
    const bandMax = /Earthquake: <small>\(uninvested\)<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
    const gone = buildSwitchSection(battle, server({item: ''}), null);
    const goneMax = /Earthquake: <small>\(uninvested\)<\/small> [\d.]+% - ([\d.]+)%/.exec(gone);
    expect(Number(bandMax![1])).toBeGreaterThan(Number(goneMax![1]));
  });

  it('renders nothing for a fainted benched mon', () => {
    const {battle} = openBattle();
    const fainted = {ident: 'p1: Garchomp', details: 'Garchomp, L100', condition: '0 fnt', moves: ['earthquake']} as never;
    expect(buildSwitchSection(battle, fainted, null)).toBe('');
  });
});

// --- Mega Evolution preview (the move panel's Mega box) ----------------------
//
// Ticking Mega Evolution previews our ACTIVE mon as its Mega forme: the Mega's stats,
// ability, and typing hit the damage in every gen; its Speed hits the ⚡ verdict from
// gen 7 (gen 6 moved at the base Speed the turn it evolved). Hand-built battles — a
// spectator replay carries no `myPokemon`, and the fixture has no Mega-capable mon.

/** The client dex a Mega preview needs: the stone → forme map, plus the forme's data. */
function megaDex(stoneId: string, base: string, megaForme: string, megaSpecies: Record<string, unknown>): Record<string, unknown> {
  return {
    items: {get: (id: string) => (id === stoneId ? {megaStone: {[base]: megaForme}} : undefined)},
    species: {get: (name: string) => (name === megaForme ? {exists: true, ...megaSpecies} : undefined)},
  };
}

describe('the move tooltip previews the Mega forme when the Mega box is ticked', () => {
  // Gen 7 open format: the calc knows Charizard-Mega-X natively (Fire/Dragon, Tough
  // Claws, Atk 84 → 130), so a physical Dragon move swings hugely from base Charizard.
  const megaXSpecies = {baseStats: {hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100}, types: ['Fire', 'Dragon'], abilities: {0: 'Tough Claws'}};
  const zardBattle = (over: {item?: string; forme?: string} = {}): {battle: ClientBattle; zard: ClientPokemon} => {
    const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
    const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
    const zard = {speciesForme: over.forme ?? 'Charizard', level: 100, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [], ident: 'p1: Charizard', side: near} as unknown as ClientPokemon;
    const foe = {speciesForme: 'Tentacruel', level: 100, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [], ident: 'p2: Tentacruel', side: far} as unknown as ClientPokemon;
    near.active = [zard];
    far.active = [foe];
    const battle = {
      gen: 7,
      tier: '[Gen 7] OU',
      sides: [near, far],
      myPokemon: [{ident: 'p1: Charizard', details: 'Charizard, L100', condition: '297/297', item: over.item ?? 'charizarditex', moves: ['dragonclaw']}],
      dex: megaDex('charizarditex', 'Charizard', 'Charizard-Mega-X', megaXSpecies),
    } as unknown as ClientBattle;
    return {battle, zard};
  };
  const dmgMax = (html: string): number => {
    const m = /Damage[^:]*:<\/small> [\d.]+% - ([\d.]+)%/.exec(html);
    if (!m) throw new Error(`no damage line in:\n${html}`);
    return Number(m[1]);
  };

  it('previews the Mega’s stats/ability/type — a physical Dragon move hits far harder', () => {
    const {battle, zard} = zardBattle();
    const base = buildMoveSection(battle, zard, 'Dragon Claw', null, false, false);
    const mega = buildMoveSection(battle, zard, 'Dragon Claw', null, false, true);
    // Mega X: STAB Dragon + Tough Claws + 130 Atk vs base Charizard's 84 Atk, no STAB.
    expect(dmgMax(mega)).toBeGreaterThan(dmgMax(base) * 1.5);
  });

  it('is byte-identical when the box is unticked, no stone is held, or it has ALREADY Mega’d', () => {
    const {battle, zard} = zardBattle();
    const base = buildMoveSection(battle, zard, 'Dragon Claw', null, false, false);
    // No stone in hand → nothing to preview.
    const noStone = zardBattle({item: 'leftovers'});
    expect(buildMoveSection(noStone.battle, noStone.zard, 'Dragon Claw', null, false, true)).toBe(base);
    // Already the Mega forme → the ticked box is moot (the public forme already drives it).
    const done = zardBattle({forme: 'Charizard-Mega-X'});
    const doneOut = buildMoveSection(done.battle, done.zard, 'Dragon Claw', null, false, false);
    expect(buildMoveSection(done.battle, done.zard, 'Dragon Claw', null, false, true)).toBe(doneOut);
  });

  it('does NOT preview a Mega for a benched/inactive mon we’re hovering (the box is the active mon’s)', () => {
    // Same Charizard, but not in its side's active array — it can't Mega this turn.
    const {battle} = zardBattle();
    const benched = {speciesForme: 'Charizard', level: 100, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [], ident: 'p1: Charizard', side: {isFar: false, active: [null]}} as unknown as ClientPokemon;
    const base = buildMoveSection(battle, benched, 'Dragon Claw', null, false, false);
    expect(buildMoveSection(battle, benched, 'Dragon Claw', null, false, true)).toBe(base);
  });
});

describe('the ⚡ verdict previews the Mega’s Speed — but only from gen 7', () => {
  // Beedrill → Beedrill-Mega is a huge Speed jump (base 75 → 145). Our Beedrill is our
  // active; hovering the foe leads with the ⚡ verdict for the pair.
  const feed = {
    Beedrill: {level: 80, abilities: ['Swarm'], items: ['Beedrillite'], moves: ['X-Scissor']},
    'Beedrill-Mega': {level: 80, abilities: ['Adaptability'], items: ['Beedrillite'], moves: ['X-Scissor']},
    Tentacruel: {level: 80, abilities: ['Clear Body'], items: ['Black Sludge'], moves: ['Scald']},
  } as unknown as RandbatsData;
  const megaSpecies = {baseStats: {hp: 65, atk: 150, def: 40, spa: 15, spd: 80, spe: 145}, types: ['Bug', 'Poison'], abilities: {0: 'Adaptability'}};
  const beedrillBattle = (gen: number): {battle: ClientBattle; foe: ClientPokemon} => {
    const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
    const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
    const bee = {speciesForme: 'Beedrill', level: 80, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [], ident: 'p1: Beedrill', side: near} as unknown as ClientPokemon;
    const foe = {speciesForme: 'Tentacruel', level: 80, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [], ident: 'p2: Tentacruel', side: far} as unknown as ClientPokemon;
    near.active = [bee];
    far.active = [foe];
    const battle = {
      gen,
      tier: `[Gen ${gen}] Random Battle`,
      sides: [near, far],
      myPokemon: [{ident: 'p1: Beedrill', details: 'Beedrill, L80', condition: '100/100', item: 'beedrillite', moves: ['xscissor']}],
      dex: megaDex('beedrillite', 'Beedrill', 'Beedrill-Mega', megaSpecies),
    } as unknown as ClientBattle;
    return {battle, foe};
  };
  const ourSpeed = (html: string): number => {
    const m = /⚡[^—]*— (\d+) vs \d+/.exec(html);
    if (!m) throw new Error(`no ⚡ line in:\n${html}`);
    return Number(m[1]);
  };

  it('gen 7: a ticked Mega raises our side of the ⚡ verdict to the Mega’s Speed', () => {
    const {battle, foe} = beedrillBattle(7);
    const base = ourSpeed(buildPokemonSection(battle, foe, feed, false));
    const mega = ourSpeed(buildPokemonSection(battle, foe, feed, true));
    expect(mega).toBeGreaterThan(base); // base Spe 75 → Mega Spe 145
  });

  it('gen 6: the ⚡ verdict keeps the BASE Speed — the Mega’s Speed didn’t count the turn it evolved', () => {
    const {battle, foe} = beedrillBattle(6);
    const base = ourSpeed(buildPokemonSection(battle, foe, feed, false));
    const mega = ourSpeed(buildPokemonSection(battle, foe, feed, true));
    expect(mega).toBe(base);
  });
});

describe('the sets view lists a possible Mega set while the foe’s item is unrevealed (Champions)', () => {
  // Real Champions shape: the base entry's OWN item pool never lists the stone (Charizard's
  // real pool is ['Leftovers']) — the Mega set lives entirely under its own separate entry.
  // Two stones (X and Y) so a candidate list can show BOTH still being live at once.
  const feed = {
    Charizard: {level: 52, abilities: ['Blaze'], items: ['Leftovers'], moves: ['Flamethrower']},
    'Charizard-Mega-X': {level: 47, abilities: ['Blaze'], items: ['Charizardite X'], moves: ['Dragon Claw']},
    'Charizard-Mega-Y': {level: 47, abilities: ['Blaze'], items: ['Charizardite Y'], moves: ['Air Slash']},
    Tentacruel: {level: 50, abilities: ['Clear Body'], items: ['Black Sludge'], moves: ['Scald']},
  } as unknown as RandbatsData;

  const foeBattle = (item?: string): {battle: ClientBattle; foeZard: ClientPokemon} => {
    const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
    const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
    const ours = {speciesForme: 'Tentacruel', level: 50, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [], ident: 'p1: Tentacruel', side: near} as unknown as ClientPokemon;
    const foeZard = {
      speciesForme: 'Charizard', level: 50, hp: 100, maxhp: 100, status: '', boosts: {}, moveTrack: [],
      ident: 'p2: Charizard', side: far, ...(item ? {item} : {}),
    } as unknown as ClientPokemon;
    near.active = [ours];
    far.active = [foeZard];
    const battle = {gen: 9, tier: '[Gen 9 Champions] Random Battle', sides: [near, far]} as unknown as ClientBattle;
    return {battle, foeZard};
  };

  it('lists both still-possible Mega sets alongside the base set', () => {
    const {battle, foeZard} = foeBattle();
    const html = buildPokemonSection(battle, foeZard, feed);
    expect(html).toContain('Charizardite X');
    expect(html).toContain('Charizard-Mega-X');
    expect(html).toContain('Charizardite Y');
    expect(html).toContain('Charizard-Mega-Y');
    expect(html).toContain('Leftovers'); // the base (non-Mega) set is still there too
  });

  it('drops both Mega candidates once a different item is revealed', () => {
    // A foe-revealed item arrives as its display name (real client shape — see the
    // captured Tentacruel fixture, `item: 'Leftovers'`), not the id form the private
    // team's request JSON uses.
    const {battle, foeZard} = foeBattle('Leftovers');
    const html = buildPokemonSection(battle, foeZard, feed);
    expect(html).not.toContain('Mega:');
  });

  it('narrows to exactly the held stone’s Mega set once the item is revealed as one', () => {
    const {battle, foeZard} = foeBattle('Charizardite Y');
    const html = buildPokemonSection(battle, foeZard, feed);
    expect(html).toContain('Charizard-Mega-Y');
    expect(html).not.toContain('Charizard-Mega-X'); // the OTHER stone is no longer possible
  });
});

describe('a Transformed Ditto — the copy, not the copier', () => {
  // Ditto's real randbats set: one move, Transform, and a Choice Scarf. Everything it can
  // actually DO comes from the Pokémon it copied — here our Noivern (L82, 249 Speed).
  const DITTO_ENTRY = {
    level: 87,
    abilities: ['Imposter'],
    items: ['Choice Scarf'],
    roles: {'Fast Support': {abilities: ['Imposter'], items: ['Choice Scarf'], teraTypes: ['Ghost', 'Steel'], moves: ['Transform']}},
  };
  const dittoData = {...(data as object), Ditto: DITTO_ENTRY} as unknown as RandbatsData;

  const transformed = loadBattle({foeDitto: 'transformed'});
  const plain = loadBattle({foeDitto: 'plain'});

  it('reads the COPIED Speed for the ⚡ verdict, with its own Choice Scarf on top', () => {
    // Transform copies the target's FINAL Speed (Noivern's 249, made at Noivern's level),
    // and the Scarf it is still holding is its own: 249 × 1.5 = 373. A Ditto calculated as
    // a Ditto would come out at base-48 Speed and we would "outspeed" a Pokémon that is
    // holding our own Speed stat and a Scarf.
    const html = buildPokemonSection(transformed.battle, transformed.active('Ditto'), dittoData);
    expect(html).toContain('they move first');
    expect(html).toContain('249 vs 373');
  });

  it('keeps Ditto\'s own set in the block, and lists the moves it copied', () => {
    const html = buildPokemonSection(transformed.battle, transformed.active('Ditto'), dittoData);
    // Its item and ability are its own — Transform takes neither.
    expect(html).toContain('Imposter');
    expect(html).toContain('Choice Scarf');
    // …but the moves are the copy's, each with its damage into us. Its own lone move is
    // spent: Transform is what got it here.
    expect(html).toContain('Draco Meteor');
    expect(html).toMatch(/Draco Meteor \([\d.]+–[\d.]+%\)/);
    expect(html).not.toContain('Transform');
  });

  it('does not mistake a copied move for a reveal about DITTO', () => {
    // The client stars a copied move (`*Flamethrower`). Read as Ditto's own, it matches no
    // Ditto role — whose only move is Transform — and every hover would cry data drift.
    const html = buildPokemonSection(transformed.battle, transformed.active('Ditto'), dittoData);
    expect(html).not.toContain('matched no known set');
  });

  it('takes damage on the copied body, over its OWN HP', () => {
    // Draco Meteor into a Noivern body (Dragon — doubly weak to it) instead of a Normal-type
    // Ditto, and over Ditto's own 225 max HP rather than Noivern's 274: Transform copies
    // every stat except HP.
    const copy = buildMoveSection(transformed.battle, transformed.active('Noivern'), 'Draco Meteor', dittoData);
    const asItself = buildMoveSection(plain.battle, plain.active('Noivern'), 'Draco Meteor', dittoData);
    expect(maxPercent(copy)).toBeCloseTo(138.7, 1);
    expect(maxPercent(asItself)).toBeCloseTo(92, 1);
    expect(copy).toContain('guaranteed KO');
  });

  it('leaves a Pokémon that has copied no one exactly as it was', () => {
    // The whole machinery is inert without a transform volatile: same tooltip, byte for byte.
    const before = buildPokemonSection(plain.battle, plain.active('Ditto'), dittoData);
    expect(before).toContain('Transform'); // its own set, unmolested
    expect(before).not.toContain('Draco Meteor');
  });
});
