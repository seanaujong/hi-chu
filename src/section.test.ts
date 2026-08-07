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
import {buildMoveSection, buildPokemonSection, buildSwitchSection} from './section.js';
import type {ClientBattle, ClientPokemon, ClientSide} from './battle/readState.js';
import {loadBattle, scenarioData as data, scenarioDataWithDitto, scenarioDataWithEmboar as dataWithEmboar, scenarioDataWithGreninja as dataWithGreninja, scenarioDataTwinRoles} from './scenario.js';
import type {RandbatsData} from './core/types.js';
import {HOVER_TARGETS, SECTION_NAMES, shows, type HoverTarget, type SectionName} from './core/surfaces.js';

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

  it('shows the real number for a damage-callback move (Super Fang, which the calc computes as nothing)', () => {
    // @smogon/calc has no formula for Super Fang, so this whole surface used to render
    // "Damage: 0% - 0%" — a move that takes half your HP, reported as doing nothing. The
    // capture has Tentacruel on 256 of 272 HP, and half of what is LEFT is 47.1% of its max,
    // which is also why this is not the flat 50% a full-HP target would show.
    const html = buildMoveSection(battle, active('Noivern'), 'Super Fang', data);
    expect(html).toContain('<small>Damage:</small> 47.1% - 47.1%');
    expect(html).not.toContain('0% - 0%');
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

  it('judges our own hover from the real Zoroark, and keeps the mirror on the disguise', () => {
    const {battle, active} = loadBattle(disguised);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    // The outgoing damage lines are withheld for an ACTIVE mon (its move buttons carry
    // them — and `buildMoveSection` above already pins that they use Zoroark's numbers).
    // What still proves the see-through on THIS surface is the ⚡ verdict: it is computed
    // from the Pokémon really standing there, via the same slot lookup.
    expect(html).not.toContain('Focus Blast:');
    expect(html).not.toContain('Draco Meteor:');
    expect(html).toContain('⚡');
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

describe('buildPokemonSection with Terastallize ticked (the DEFENSIVE half of the preview)', () => {
  // A ticked Tera changes what the foe's moves do INTO us, not only what ours do out of us,
  // and with no speed caveat: `sim/battle-queue.ts` resolves `terastallize` as its own
  // action at order 106 against a move's 200, so our new typing is already in place whoever
  // moves first. Un-terastallize Noivern (Flying/Dragon) and give the private team a Fire
  // Tera to preview, so the toggle is the only thing that differs between the two renders.
  const base = {noivernTerastallized: '', myNoivernTera: 'Fire'};
  const foeHover = (over: object, teraSelected: boolean): string => {
    const b = loadBattle(over);
    return buildPokemonSection(b.battle, b.active('Tentacruel'), data, false, teraSelected);
  };
  /** The max % of the sets view's inline damage for one of the foe's moves. */
  const into = (html: string, move: string): number =>
    Number(new RegExp(`${move} \\([\\d.]+–([\\d.]+)%\\)`).exec(html)![1]);

  it("recomputes the FOE's damage into us — Tera Fire turns Surf super-effective", () => {
    // Water is RESISTED by Flying/Dragon (Dragon halves it) and 2× into Fire, so the
    // swing is ×4, not ×2 — verified on a live replay page: Surf 15.3–17.9% → 61.3–72.3%.
    expect(into(foeHover(base, true), 'Surf')).toBeGreaterThan(into(foeHover(base, false), 'Surf') * 3.5);
  });

  it('leaves a move the new typing does not change alone — Poison is neutral either way', () => {
    expect(into(foeHover(base, true), 'Sludge Bomb')).toBe(into(foeHover(base, false), 'Sludge Bomb'));
  });

  it('changes nothing when the private team carries no Tera type to preview', () => {
    const noTera = {noivernTerastallized: ''};
    expect(foeHover(noTera, true)).toBe(foeHover(noTera, false));
  });

  it('changes nothing once we have actually terastallized (public facts already drive it)', () => {
    const already = {myNoivernTera: 'Fire'}; // fixture Noivern IS already Tera Fire
    expect(foeHover(already, true)).toBe(foeHover(already, false));
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
    const clone = JSON.parse(JSON.stringify(data)) as {Noivern: {roles: {'Fast Support': {items: string[]}}}};
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

describe('two roles that resolve to the SAME Pokémon each keep their own damage', () => {
  // Real feeds do this constantly: a Sandaconda's "Bulky Attacker" and "Bulky Setup" are
  // both Shed Skin + Leftovers, differing only in the moves they carry. Deduping variants
  // by their calc-facing Pokémon ALONE dropped the second role from the fan-out entirely,
  // so its block rendered every move bare — a `Surf` sitting beside another block's
  // `Surf (24–28%)`, which reads as "this set's Surf does nothing".
  const {battle, active} = loadBattle();
  const html = buildPokemonSection(battle, active('Tentacruel'), scenarioDataTwinRoles);

  /** The slice of the tooltip belonging to one role's block — up to the next block. */
  const blockFor = (role: string): string => {
    const start = html.indexOf(`>${role}</span>`);
    if (start < 0) throw new Error(`no block for ${role} in:\n${html}`);
    const next = html.indexOf('<div class="hichu-block">', start);
    return next < 0 ? html.slice(start) : html.slice(start, next);
  };

  it('renders a block for each role', () => {
    expect(html).toContain('>Bulky Support</span>');
    expect(html).toContain('>Bulky Attacker</span>');
  });

  it('attaches damage inside EVERY block, not only the first', () => {
    const damaged = /Surf \(\d+(\.\d+)?–\d+(\.\d+)?%\)/;
    expect(blockFor('Bulky Support')).toMatch(damaged);
    expect(blockFor('Bulky Attacker')).toMatch(damaged);
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

  /** Icicle Crash's rendered span, as [low, high]. */
  function span(items: readonly string[]): [number, number] {
    const oneItem: RandbatsData = {Weavile: {...feed['Weavile']!, items}};
    const html = buildPokemonSection(battle, foeWeavile, oneItem);
    const m = /Icicle Crash \(([\d.]+)–([\d.]+)%\)/.exec(html);
    if (!m) throw new Error(`no Icicle Crash span in:\n${html}`);
    return [Number(m[1]), Number(m[2])];
  }

  it('spans BOTH still-possible items, never a single guessed representative', () => {
    // The span has to reach from the weaker item's floor to the stronger item's ceiling.
    // Landing on either item's own range alone would mean a representative was picked —
    // the exact guess this surface exists to avoid. Derived from the calc rather than
    // hardcoded, so the assertion is about the bracketing, not about today's numbers.
    const [orbLow, orbHigh] = span(['Life Orb']);
    const [leftLow, leftHigh] = span(['Leftovers']);
    expect(orbHigh).toBeGreaterThan(leftHigh); // Life Orb's +30% is the bigger number
    expect(span(['Life Orb', 'Leftovers'])).toEqual([leftLow, orbHigh]);
    expect(orbLow).toBeGreaterThan(leftLow); // …and the floor really is the OTHER item's
  });
});

describe('the sets view narrows a foe’s item pool by an OBSERVED hit’s MAGNITUDE (core/itemreveal.ts)', () => {
  // A Choice Band (×1.5 physical) vs Heavy-Duty Boots (no offensive effect) split —
  // NOT Life Orb, deliberately: any landed hit with no item revealed already rules Life
  // Orb out via the EXISTING recoil-absence deduction (deductions.ts), which would
  // confound what this test is isolating. Choice Band/Boots never touch that rule, so a
  // clean hit here tests the magnitude reveal alone. Choice Band rolls 41.9–49.8%,
  // Heavy-Duty Boots 27.9–33.2% (verified against the real calc) — the two ranges don't
  // overlap, so a hit landing inside one but not the other is real evidence.
  const feed: RandbatsData = {
    Weavile: {level: 78, abilities: ['Pressure'], items: ['Choice Band', 'Heavy-Duty Boots'], moves: ['Icicle Crash']},
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

  // Bracketed, both items still possible: the span runs from Boots' floor to Band's ceiling.
  const BRACKETED = /Icicle Crash \(27\.9[–-]49\.8%\)/;
  // Narrowed to Choice Band alone: the span is that item's range and nothing wider.
  const BAND_ONLY = /Icicle Crash \(41\.9[–-]49\.8%\)/;

  it('keeps both outcomes with no observed hit in the log (the baseline, unchanged)', () => {
    const battle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far]} as unknown as ClientBattle;
    expect(buildPokemonSection(battle, foeWeavile, feed)).toMatch(BRACKETED);
  });

  it('collapses to a single inline line (Choice Band’s range) once the log shows a hit only its range could have dealt', () => {
    // Skarmory switches in at full HP, then Weavile's Icicle Crash takes it to 55% — a
    // clean 45% hit: too big for Boots' 27.9–33.2%, squarely inside Band's 41.9–49.8%.
    const stepQueue = [
      '|switch|p1a: Skarmory|Skarmory, L78|100/100',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|55/100',
    ];
    const battle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far], stepQueue} as unknown as ClientBattle;
    const html = buildPokemonSection(battle, foeWeavile, feed);
    // Only one item survives, so the span tightens onto its range — Boots' floor is gone.
    expect(html).toMatch(BAND_ONLY);
    expect(html).not.toMatch(BRACKETED);
  });

  it('goes back to bracketing both once the hit is stale (a boost happened since)', () => {
    // The same 45% hit as above, but Weavile got a Swords Dance boost afterward — CURRENT
    // facts no longer describe the state that hit happened under, so the reading must be
    // withdrawn rather than compared against stale numbers.
    const stepQueue = [
      '|switch|p1a: Skarmory|Skarmory, L78|100/100',
      '|move|p2a: Weavile|Icicle Crash|p1a: Skarmory',
      '|-damage|p1a: Skarmory|55/100',
      '|-boost|p2a: Weavile|atk|2',
    ];
    const battle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far], stepQueue} as unknown as ClientBattle;
    expect(buildPokemonSection(battle, foeWeavile, feed)).toMatch(BRACKETED);
  });
});

describe('a silent switch-in drops the Air Balloon bucket (core/deductions.ts)', () => {
  // Heatran's real gen9randombattle role, item pool and all. The balloon is the one item
  // that announces itself on the way in, so the tooltip should stop hedging about it the
  // moment the battle shows Heatran arrive without a word — and what it stops showing is
  // not a cosmetic label but a "0% damage" line on a move that in fact KOs.
  const feed: RandbatsData = {
    Heatran: {level: 79, abilities: ['Flash Fire'], items: ['Air Balloon', 'Assault Vest'], moves: ['Magma Storm']},
    'Landorus-Therian': {level: 76, abilities: ['Intimidate'], items: ['Leftovers'], moves: ['Earthquake']},
  };
  const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
  const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
  const ourLando = {
    speciesForme: 'Landorus-Therian', level: 76, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p1: Landorus', side: near,
  } as unknown as ClientPokemon;
  const foeHeatran = {
    speciesForme: 'Heatran', level: 79, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p2: Heatran', side: far,
  } as unknown as ClientPokemon;
  near.active = [ourLando];
  far.active = [foeHeatran];

  const battleWith = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far], stepQueue} as unknown as ClientBattle);
  const SWITCH_IN = '|switch|p2a: Heatran|Heatran, M|100/100';

  it('brackets both items while no switch-in has been seen — the honest baseline', () => {
    const html = buildMoveSection(battleWith(['|turn|5']), ourLando, 'Earthquake', feed);
    expect(html).toContain('(Air Balloon)');
    expect(html).toContain('(Assault Vest)');
  });

  it('collapses to the one real number once Heatran arrives without announcing one', () => {
    const html = buildMoveSection(battleWith(['|turn|4', SWITCH_IN, '|turn|5']), ourLando, 'Earthquake', feed);
    expect(html).not.toContain('(Air Balloon)');
    expect(html).not.toContain('(Assault Vest)'); // one item left ⇒ no per-item labels at all
    expect(html).toContain('guaranteed KO');
  });

  it('keeps the balloon when the switch-in DID announce it, even across the foe’s switch line', () => {
    // The lead-shaped ordering: the announcement lands after BOTH sides' |switch| lines.
    const html = buildMoveSection(battleWith([
      '|start', '|switch|p1a: Landorus|Landorus-Therian, M|100/100', SWITCH_IN,
      '|-item|p2a: Heatran|Air Balloon', '|turn|1',
    ]), ourLando, 'Earthquake', feed);
    expect(html).toContain('(Air Balloon)');
    expect(html).toContain('(Assault Vest)');
  });

  it('drops it from the sets view too, not just the damage line', () => {
    const before = buildPokemonSection(battleWith(['|turn|5']), foeHeatran, feed);
    expect(before).toContain('Air Balloon');
    const after = buildPokemonSection(battleWith(['|turn|4', SWITCH_IN, '|turn|5']), foeHeatran, feed);
    expect(after).not.toContain('Air Balloon');
    expect(after).toContain('Assault Vest');
  });
});

describe('a turn ended un-statused drops the status-orb role (core/deductions.ts)', () => {
  // Hariyama's real gen9randombattle entry: two roles, one item each, and they are not
  // equally harmless to guess between — an Assault Vest is ×1.5 SpD, so while both stand the
  // tooltip must hedge every special move with two labelled numbers. A Flame Orb holder,
  // though, burns itself at the end of the first turn it is out. One quiet turn is therefore
  // enough to drop the Wallbreaker role outright and answer with a single number.
  const feed: RandbatsData = {
    Hariyama: {
      level: 87,
      abilities: ['Thick Fat', 'Guts'],
      items: [],
      roles: {
        'AV Pivot': {abilities: ['Thick Fat'], items: ['Assault Vest'], teraTypes: ['Water'], moves: ['Close Combat']},
        Wallbreaker: {abilities: ['Guts'], items: ['Flame Orb'], teraTypes: ['Water'], moves: ['Facade']},
      },
    },
    Gholdengo: {level: 76, abilities: ['Good as Gold'], items: ['Leftovers'], moves: ['Make It Rain']},
  };
  const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
  const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
  const ourGholdengo = {
    speciesForme: 'Gholdengo', level: 76, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p1: Gholdengo', side: near,
  } as unknown as ClientPokemon;
  const foeHariyama = {
    speciesForme: 'Hariyama', level: 87, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p2: Hariyama', side: far,
  } as unknown as ClientPokemon;
  near.active = [ourGholdengo];
  far.active = [foeHariyama];

  const battleWith = (stepQueue: string[]): ClientBattle =>
    ({gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far], stepQueue} as unknown as ClientBattle);
  const IN = '|switch|p2a: Hariyama|Hariyama, M|100/100';
  const OURS_IN = '|switch|p1a: Gholdengo|Gholdengo|100/100';
  const QUIET_TURN = ['|start', OURS_IN, IN, '|turn|1', '|', '|upkeep', '|turn|2'];

  it('brackets both items until a turn has ended — the honest baseline', () => {
    const html = buildMoveSection(battleWith(['|start', OURS_IN, IN, '|turn|1']), ourGholdengo, 'Make It Rain', feed);
    expect(html).toContain('(Assault Vest)');
    expect(html).toContain('(Flame Orb)');
  });

  it('collapses to the one real number once a turn ends with Hariyama un-statused', () => {
    const html = buildMoveSection(battleWith(QUIET_TURN), ourGholdengo, 'Make It Rain', feed);
    expect(html).not.toContain('(Flame Orb)');
    expect(html).not.toContain('(Assault Vest)'); // one item left ⇒ no per-item labels at all
  });

  it('keeps both when the orb actually fired — the status reveals it on the same line', () => {
    const html = buildMoveSection(battleWith([
      '|start', OURS_IN, IN, '|turn|1', '|',
      '|-status|p2a: Hariyama|brn|[from] item: Flame Orb', '|upkeep', '|turn|2',
    ]), ourGholdengo, 'Make It Rain', feed);
    expect(html).toContain('(Assault Vest)');
    expect(html).toContain('(Flame Orb)');
  });

  it('drops the whole ROLE from the sets view, not just the item line', () => {
    const before = buildPokemonSection(battleWith(['|start', OURS_IN, IN, '|turn|1']), foeHariyama, feed);
    expect(before).toContain('Wallbreaker');
    expect(before).toContain('AV Pivot');
    const after = buildPokemonSection(battleWith(QUIET_TURN), foeHariyama, feed);
    expect(after).not.toContain('Wallbreaker');
    expect(after).toContain('AV Pivot');
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

  it('drops a speed aside that reaches the same verdict, through the whole live pipeline', () => {
    // Emboar with Head Smash shown: only its "Fast Attacker" role survives, and that role
    // runs a Choice Band (157 Spe) or a Choice Scarf (235). Two real, distinct speeds — and
    // our Noivern at 249 moves first against both, so neither is worth a clause. This is the
    // seam test for the render-layer filter: a rule that trims the model but never reaches a
    // hover would be a silent no-op, and the speeds here come from the real narrowing, not
    // from a hand-built SpeedOrder.
    const {battle: b, active: a} = loadBattle({foeEmboar: true});
    const html = buildPokemonSection(b, a('Emboar'), dataWithEmboar);
    expect(html).toContain('⚡ you move first — 249 vs 235'); // the faster bucket leads
    expect(html).not.toContain('157'); // the slower one says the same thing, so it is gone
    expect(html).not.toContain('<small>if ');
  });
});

describe('move order rules out a Choice Scarf, through the whole live pipeline', () => {
  // Emboar's one surviving role runs a Choice Band (157 Spe) or a Choice Scarf (235), and a
  // -1 Speed drop puts our Noivern at 166 — between them. That is the only arrangement in
  // which who-moved-first can tell the two apart, and it is exactly the read a player makes
  // by eye. A Scarf changes no damage number, so `itemreveal.ts` is blind to it: this is the
  // seam test for the axis nothing else in the codebase can reach.
  const emboarSets = (over: Record<string, unknown>): string => {
    const {battle: b, active: a} = loadBattle({foeEmboar: true, noivernBoosts: {spe: -1}, ...over});
    return buildPokemonSection(b, a('Emboar'), dataWithEmboar);
  };
  const unread = emboarSets({});
  const theyFirst = emboarSets({foeMovedFirst: true});
  const theySecond = emboarSets({foeMovedFirst: false});

  it('leaves both items standing when no turn is safe to read', () => {
    expect(unread).toContain('Choice Band, Choice Scarf');
    expect(unread).toContain('>they move first</span> — 166 vs 235');
    expect(unread).toContain('if Choice Band'); // the aside the reveals below delete
  });

  it('rules the Band out when they moved FIRST', () => {
    expect(theyFirst).toContain('>they move first</span> — 166 vs 235');
    expect(theyFirst).not.toContain('<small>if '); // one speed left, so nothing to qualify
  });

  it('rules the Scarf out when they moved SECOND — and FLIPS the verdict', () => {
    // The whole point, in one line: without the reading the tooltip leads with "they move
    // first"; with it, we do. A player switches on that sentence.
    expect(unread).toContain('>they move first</span>');
    expect(theySecond).toContain('⚡ you move first — 166 vs 157');
    expect(theySecond).not.toContain('<small>if ');
  });

  it('carries the rule-out to the Items line, not only to the verdict', () => {
    // The choke point. A block still advertising a Choice Scarf above a ⚡ line that has just
    // declared it impossible is worse than no rule-out at all — and it is what the previous
    // shape did, since `inferSets` never saw `itemreveal.ts`'s narrowing either.
    expect(theyFirst).toContain('<small>Items:</small> Choice Scarf');
    expect(theyFirst).not.toContain('Choice Band');
    expect(theySecond).toContain('<small>Items:</small> Choice Band');
    expect(theySecond).not.toContain('Choice Scarf');
  });

  it('reaches the OWN-hover matchup block’s ⚡ line, not only the foe’s own hover', () => {
    // The gap this nearly shipped with: the observation is about our ACTIVE against their
    // active, but the rule-out it produces is a fact about the FOE's set — so it has to
    // reach every surface that shows that foe, including a ⚡ line inside one of OUR blocks.
    // Without it, hovering Emboar says "not Scarfed" while hovering our own Noivern still
    // offers "if Choice Scarf" about the same Pokémon on the same turn.
    const ownHover = (over: Record<string, unknown>): string => {
      const {battle: b, active: a} = loadBattle({
        foeEmboar: true,
        noivernBoosts: {spe: -1},
        myNoivernItem: 'heavydutyboots',
        myNoivernMoves: ['dracometeor', 'flamethrower', 'hurricane', 'roost'],
        ...over,
      });
      return buildPokemonSection(b, a('Noivern'), dataWithEmboar);
    };
    expect(ownHover({})).toContain('if Choice Band');
    expect(ownHover({foeMovedFirst: false})).not.toContain('<small>if ');
    expect(ownHover({foeMovedFirst: false})).toContain('166 vs 157');
  });

  it('tightens the DAMAGE by the same rule-out, so no surface disagrees', () => {
    expect(unread).toContain('Head Smash</b> (112.4–198.5%)'); // both items, one wide range
    expect(theyFirst).toContain('Head Smash</b> (112.4–132.8%)'); // Scarf only
    expect(theySecond).toContain('Head Smash</b> (168.6–198.5%)'); // Band only
  });
});

describe('a Protean foe, either side of the moment it converts', () => {
  // The seam test for a live retype: client volatile → readState → resolve → calcDamage,
  // over the exact two states a player has to tell apart. Both are the same Greninja on the
  // same turn; the only difference is whether the log carries its conversion.
  const setsFor = (state: 'unspent' | 'converted'): string => {
    const {battle: b, active: a} = loadBattle({foeGreninja: state});
    return buildPokemonSection(b, a('Greninja'), dataWithGreninja);
  };
  const unspent = setsFor('unspent');
  const converted = setsFor('converted');

  it('keeps every move boosted while the ability is UNSPENT — the next one converts it', () => {
    // Gen 9 fires Protean on the first move of the stint whatever that move is, so until it
    // does, every option really would arrive with STAB. @smogon/calc's own model agrees here.
    expect(unspent).toContain('Hydro Pump (108–128.1%)');
    expect(unspent).toContain('Dark Pulse (39.8–53.6%)');
    expect(unspent).toContain('Ice Beam (21.9–25.9%)');
  });

  it('once it has converted, only the matching move keeps STAB', () => {
    // Ice Beam is what fired it, so Ice Beam alone reads identically across the two — it is
    // marked revealed here, which is why the name and its range are not adjacent.
    expect(converted).toContain('Ice Beam</b> (21.9–25.9%)');
    expect(converted).toContain('Hydro Pump (72.3–85.4%)');
    expect(converted).toContain('Dark Pulse (26.6–35.8%)');
  });

  it('turns a claimed guaranteed KO back into a survivable hit', () => {
    // The reason this is worth a test rather than a percentage: over 100% is a KO the
    // tooltip states outright, and a player switches on it. The converted Greninja's Hydro
    // Pump leaves our Noivern alive with room to spare.
    expect(unspent).toContain('108–128.1%');
    expect(converted).not.toContain('108–128.1%');
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
    const html = buildPokemonSection(battle, benched(active('Noivern')), data);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toMatch(/Draco Meteor: [\d.]+% - [\d.]+%/); // id form displayed as the real name
    expect(html.indexOf('<b>Tentacruel</b>')).toBeLessThan(html.indexOf('Fast Support'));
  });

  it('WITHHOLDS the outgoing damage lines for the mon already on the field', () => {
    // Its move buttons are right there and each one's own tooltip carries that damage in
    // more detail (nHKO ladder, Sash/Leftovers caveats, drain/recoil) — the same
    // never-show-the-same-number-twice rule that withholds the Incoming group here.
    const {battle, active} = loadBattle(mine);
    const onField = buildPokemonSection(battle, active('Noivern'), data);
    expect(onField).not.toMatch(/Draco Meteor: [\d.]+%/);
    expect(onField).not.toMatch(/Hurricane: [\d.]+%/);
    // ...but the header and the ⚡ verdict stay: speed appears on no other own-side surface.
    expect(onField).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(onField).toContain('⚡ you move first — 249 vs 216');
  });

  it('KEEPS them for a benched mon — its move buttons are not hoverable at all', () => {
    const {battle, active} = loadBattle(mine);
    const bench = buildPokemonSection(battle, benched(active('Noivern')), data);
    expect(bench).toMatch(/Draco Meteor: [\d.]+% - [\d.]+%/);
  });

  it('gives status moves no line — damage is the question here', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Noivern'), data);
    expect(html).not.toContain('Roost:');
  });

  it('shows the same numbers the move tooltip would — one truth per move', () => {
    const {battle, active} = loadBattle(mine);
    const hover = buildPokemonSection(battle, benched(active('Noivern')), data);
    const line = /Draco Meteor: ([\d.]+)% - ([\d.]+)%/.exec(hover)!;
    const button = buildMoveSection(battle, active('Noivern'), 'Draco Meteor', data);
    expect(button).toContain(`<small>Damage:</small> ${line[1]}% - ${line[2]}%`);
  });

  it("splits a move into labelled outcomes when the foe's item is still unknown", () => {
    // Tentacruel's Bulky Support can hold Assault Vest or Leftovers; Draco Meteor is
    // special, so the hidden Vest changes the number — never one confidently-wrong line.
    const {battle, active} = loadBattle({...mine, tentacruelItem: ''});
    const html = buildPokemonSection(battle, benched(active('Noivern')), data);
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

describe('hovering a FOE’s roster icon: OUR damage into them if they switch in', () => {
  const moves = ['dracometeor', 'flamethrower', 'hurricane', 'roost'];
  const mine = {myNoivernItem: 'heavydutyboots', myNoivernMoves: moves};

  it('omits the block for the foe actually ACTIVE on the field — the move tooltip already has this number', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, active('Tentacruel'), data);
    expect(html).not.toContain('<small>vs</small> <b>Tentacruel</b>');
  });

  it('adds our moves’ damage into a revealed-but-benched foe icon, before the sets view', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, benched(active('Tentacruel')), data);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toMatch(/Draco Meteor: [\d.]+% - [\d.]+%/);
    expect(html.indexOf('<small>vs</small> <b>Tentacruel</b>'))
      .toBeLessThan(html.indexOf('<span style="text-decoration: underline;">Bulky Support</span>'));
  });

  it('gives status moves no line — damage is the question here', () => {
    const {battle, active} = loadBattle(mine);
    const html = buildPokemonSection(battle, benched(active('Tentacruel')), data);
    const ourBlock = html.slice(0, html.indexOf('<span style="text-decoration: underline;">'));
    expect(ourBlock).not.toContain('Roost:');
  });

  it('shows the same numbers the move tooltip would — one truth per move', () => {
    const {battle, active} = loadBattle(mine);
    const hover = buildPokemonSection(battle, benched(active('Tentacruel')), data);
    const line = /Draco Meteor: ([\d.]+)% - ([\d.]+)%/.exec(hover)!;
    const button = buildMoveSection(battle, active('Noivern'), 'Draco Meteor', data);
    expect(button).toContain(`<small>Damage:</small> ${line[1]}% - ${line[2]}%`);
  });

  it('factors in switch-in hazard damage on THEIR side: at 45% HP neither move has a KO chance — Stealth Rock chips Tentacruel, tipping Draco Meteor into a guaranteed KO', () => {
    const without = loadBattle({...mine, tentacruelHpPercent: 0.45});
    const withHazard = loadBattle({...mine, tentacruelHpPercent: 0.45, farStealthRock: true});
    const baseline = buildPokemonSection(without.battle, benched(without.active('Tentacruel')), data);
    const html = buildPokemonSection(withHazard.battle, benched(withHazard.active('Tentacruel')), data);
    expect(baseline).not.toContain('to KO');
    expect(html).toContain('Draco Meteor: 34.2% - 40.8% · <span class="hichu-ko">guaranteed KO</span> at 32.4% HP');
    expect(html).toContain('Hurricane: 29% - 34.6% · <span class="hichu-ko">44% to KO</span> at 32.4% HP');
  });

  it('is randbats-only — an open format has no move pool to enumerate, so it renders nothing', () => {
    const {battle, active} = loadBattle(mine);
    const openBattle = {...battle, tier: '[Gen 9] OU'} as ClientBattle;
    const html = buildPokemonSection(openBattle, benched(active('Tentacruel')), null);
    expect(html).toBe('');
  });

  it('omits the block for a fainted foe — it cannot switch in', () => {
    const {battle, active} = loadBattle(mine);
    const fainted = {...benched(active('Tentacruel')), hp: 0};
    const html = buildPokemonSection(battle, fainted, data);
    expect(html).not.toContain('<small>vs</small> <b>Tentacruel</b>');
  });

  it('previews our own pending Tera the same way every other our-view attacker site does', () => {
    const teraMine = {...mine, noivernTerastallized: '', myNoivernTera: 'Fire'};
    const plain = loadBattle(teraMine);
    const tera = loadBattle(teraMine);
    const plainHtml = buildPokemonSection(plain.battle, benched(plain.active('Tentacruel')), data);
    const teraHtml = buildPokemonSection(tera.battle, benched(tera.active('Tentacruel')), data, false, true);
    const plainLine = /Flamethrower: ([\d.]+)% - ([\d.]+)%/.exec(plainHtml)!;
    const teraLine = /Flamethrower: ([\d.]+)% - ([\d.]+)%/.exec(teraHtml)!;
    // Same Tera-Fire STAB swing pinned everywhere else this preview applies.
    expect(Number(teraLine[2])).toBeGreaterThan(Number(plainLine[2]) * 1.4);
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
      .toContain('<span class="hichu-note">they move first</span> — 124 vs 216');
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
    const html = buildPokemonSection(battle, benched(active('Noivern')), data);
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
        : {...mon('Tentacruel', i, over.foeItem !== undefined ? {item: over.foeItem} : {}), side},
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
  // Ditto's real randbats set (one move, Transform, and a Choice Scarf) rides on the shared
  // scenario feed. Everything it can actually DO comes from the Pokémon it copied — here our
  // Noivern (L82, 249 Speed).
  const dittoData = scenarioDataWithDitto;

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

describe("the move tooltip's own-HP swing (drain, recoil, Life Orb, Liquid Ooze)", () => {
  const {battle, active} = loadBattle();
  const noivern = () => active('Noivern');

  it('shows what a recoil move costs US, alongside what it does to them', () => {
    const html = buildMoveSection(battle, noivern(), 'Double-Edge', data);
    expect(html).toContain('<small>Damage:</small>'); // the ordinary line is still there
    expect(html).toContain('Recoil:');
  });

  it("inverts a drain into a LOSS against the fixture's real Liquid Ooze Tentacruel", () => {
    // The captured feed gives Tentacruel exactly one ability, so this is certain, not a
    // hedge: Giga Drain into it costs us the siphon instead of healing it back.
    const html = buildMoveSection(battle, noivern(), 'Giga Drain', data);
    expect(html).toContain('Liquid Ooze:');
    expect(html).not.toContain('Drains:');
  });

  it('says nothing at all for an ordinary move — no empty label on the common hover', () => {
    const html = buildMoveSection(battle, noivern(), 'Draco Meteor', data);
    expect(html).not.toContain('Drains:');
    expect(html).not.toContain('Recoil:');
    expect(html).not.toContain('Life Orb:');
  });

  it('stays OFF the compact matchup view — the move tooltip is the one surface that shows it', () => {
    const b = loadBattle({myNoivernItem: 'heavydutyboots', myNoivernMoves: ['doubleedge', 'roost']});
    const html = buildPokemonSection(b.battle, benched(b.active('Noivern')), data);
    expect(html).toContain('Double-Edge'); // the move is listed there...
    expect(html).not.toContain('Recoil:'); // ...but without the swing line
  });
});

describe('a Substitute on the real captured battle', () => {
  // Which direction each case is tested from is decided by the feed, not by convenience:
  // gen9 randbats gives Noivern exactly one ability, INFILTRATOR, so our own attacker in this
  // battle walks through a doll no matter what. That makes this fixture the natural home for
  // the bypass arm, and sends the absorbing arm to the other direction — Tentacruel's own
  // moves into a Noivern standing behind one.
  const subbedFoe = loadBattle({tentacruelSubstitute: 'fresh'});

  /** Our Noivern, wearing a Substitute of its own. */
  const ourSubbedNoivern = (over: Parameters<typeof loadBattle>[0] = {}) =>
    loadBattle({...over, noivernSubstitute: 'fresh'});

  it('lets Noivern\u2019s INFILTRATOR through a foe\u2019s doll — every randbats Noivern has it', () => {
    const html = buildMoveSection(subbedFoe.battle, subbedFoe.active('Noivern'), 'Draco Meteor', data);
    expect(html).toContain('<small>Sub:</small> ignored');
    expect(html).not.toContain('to break');
  });

  it('says nothing about a sub when there is none — the ordinary hover is untouched', () => {
    const plain = loadBattle();
    expect(buildMoveSection(plain.battle, plain.active('Noivern'), 'Draco Meteor', data)).not.toContain('Sub:');
  });

  it('keeps the foe hover\u2019s threat numbers but strips their danger colour', () => {
    // The sets view grades each move by how close to a KO it is. Behind our doll none of them
    // is close to anything, so the numbers stay (they are true about the Pok\u00e9mon) and the
    // grading goes. Suppression alone keeps it honest; the count lives on the surfaces that
    // have room for it.
    const ours = ourSubbedNoivern();
    const html = buildPokemonSection(ours.battle, ours.active('Tentacruel'), data);
    expect(html).toContain('Surf'); //  the threat lines are all still there…
    expect(html).toMatch(/Surf \([\d.]+\u2013[\d.]+%\)/); // …damage and all
    expect(html).not.toContain('hichu-ko');
  });

  it('withdraws every KO claim their moves make while our doll stands', () => {
    // Without the sub these same lines carry the sets view's red danger tier; with it,
    // nothing they throw reaches the Pok\u00e9mon at all, so none of them may claim one.
    const exposed = loadBattle({myNoivernHpPercent: 0.2});
    const hidden = ourSubbedNoivern({myNoivernHpPercent: 0.2});
    expect(buildPokemonSection(exposed.battle, exposed.active('Tentacruel'), data)).toContain('hichu-ko');
    expect(buildPokemonSection(hidden.battle, hidden.active('Tentacruel'), data)).not.toContain('hichu-ko');
  });
});

describe('a candidate block lists the items its own damage was computed from', () => {
  // Thundurus is the live shape: its "Wallbreaker" role declares no `items` at all while
  // the ENTRY names two, and the feed omits empty arrays rather than writing them. The calc
  // has always fallen back to the entry's pool for such a role; the display read the role's
  // empty list literally, so the block showed a Choice Specs-wide damage span under a
  // heading that listed no item — directly above a second block that did list it.
  const feed: RandbatsData = {
    Thundurus: {
      level: 78,
      abilities: ['Prankster'],
      items: ['Choice Specs', 'Heavy-Duty Boots'],
      roles: {
        Wallbreaker: {abilities: ['Prankster'], items: [], teraTypes: ['Electric'], moves: ['Thunderbolt']},
        'Tera Blast user': {
          abilities: ['Prankster'],
          items: ['Heavy-Duty Boots'],
          teraTypes: ['Flying'],
          moves: ['Thunderbolt'],
        },
      },
    },
  };
  const near = {isFar: false, sideConditions: {}, active: [] as unknown[]};
  const far = {isFar: true, sideConditions: {}, active: [] as unknown[]};
  const ourActive = {
    speciesForme: 'Skarmory', level: 78, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p1: Skarmory', side: near,
  } as unknown as ClientPokemon;
  const foe = {
    speciesForme: 'Thundurus', level: 78, hp: 100, maxhp: 100, status: '', boosts: {},
    terastallized: '', moveTrack: [], ident: 'p2: Thundurus', side: far,
  } as unknown as ClientPokemon;
  near.active = [ourActive];
  far.active = [foe];
  const battle = {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far]} as unknown as ClientBattle;

  /** Each candidate block's Items line and its Thunderbolt span, in render order. */
  function blocks(): {items: string; span: string}[] {
    const html = buildPokemonSection(battle, foe, feed);
    return [...html.matchAll(/<span style="text-decoration: underline;">[^<]*<\/span>(.*?)(?=<span style="text-dec|$)/gs)].map((m) => ({
      items: /<small>Items:<\/small> ([^<]*)/.exec(m[1]!)?.[1]?.trim() ?? '(no Items line)',
      span: /Thunderbolt \(([^)]*)\)/.exec(m[1]!.replace(/<[^>]+>/g, ''))?.[1] ?? '(none)',
    }));
  }

  it('names the entry’s items for a role that declares none, rather than showing no line', () => {
    expect(blocks()[0]!.items).toBe('Choice Specs, Heavy-Duty Boots');
  });

  it('gives that role a WIDER span than the one-item role — the two items really do differ', () => {
    // Without this the first assertion could pass while the block still calculated from
    // something else: the span is what proves the listed pool is the pool that was used.
    const [wallbreaker, teraBlast] = blocks();
    expect(teraBlast!.items).toBe('Heavy-Duty Boots');
    expect(wallbreaker!.span).not.toBe(teraBlast!.span);
    const high = (s: string) => Number(/[\d.]+–([\d.]+)%/.exec(s)![1]);
    expect(high(wallbreaker!.span)).toBeGreaterThan(high(teraBlast!.span));
  });
});

describe('the Surfaces grid describes what the six surfaces actually render', () => {
  // `core/surfaces.ts` states which sections each hover target carries, and
  // `surfaces.test.ts` checks that table against its own laws. This checks it against
  // REALITY — the rendered HTML of all six surfaces on the captured battle — so the grid
  // can never quietly become a description of a product we no longer ship. Between them
  // the five markers below cover all eight sections, so every one of the 48 cells is
  // asserted rather than only the ones that happen to have a test elsewhere.
  const moves = ['dracometeor', 'flamethrower', 'hurricane', 'roost'];
  const {battle, active} = loadBattle({myNoivernItem: 'heavydutyboots', myNoivernMoves: moves});
  const server = {
    ident: 'p1: Noivern', details: 'Noivern, L82, F', condition: '272/272',
    item: 'heavydutyboots', baseAbility: 'infiltrator', teraType: 'Fire', moves,
  } as never;

  const RENDERED: Readonly<Record<HoverTarget, string>> = {
    'move-button': buildMoveSection(battle, active('Noivern'), 'Draco Meteor', data),
    'own-active': buildPokemonSection(battle, active('Noivern'), data),
    'own-bench': buildPokemonSection(battle, benched(active('Noivern')), data),
    'switch-menu': buildSwitchSection(battle, server, data),
    'foe-active': buildPokemonSection(battle, active('Tentacruel'), data),
    'foe-bench': buildPokemonSection(battle, benched(active('Tentacruel')), data),
  };

  /** The block `render.ts` heads with "vs <foe>": the matchup view's outgoing half, and
   *  the same renderer a foe roster hover uses for our damage into that Pokémon. It holds
   *  a `%` only when it actually carries move lines — the header and the ⚡ verdict never
   *  do, which is what lets one predicate tell a block with damage from one without. */
  function vsBlockHasDamage(html: string): boolean {
    const vs = html.split('<div class="hichu-block">').slice(1).find((b) => b.includes('<small>vs</small>'));
    return vs !== undefined && vs.includes('%');
  }

  const MARKERS: readonly {what: string; sections: readonly SectionName[]; present: (html: string) => boolean}[] = [
    {what: 'the Damage line', sections: ['damage'], present: (h) => h.includes('<small>Damage:</small>')},
    {what: 'the ⚡ verdict (either placement)', sections: ['speedLead', 'speedPerBlock'], present: (h) => h.includes('⚡')},
    {what: 'our damage under a "vs <foe>" header', sections: ['outgoing', 'ourDamageInto'], present: vsBlockHasDamage},
    {what: 'the Incoming group', sections: ['incoming'], present: (h) => h.includes('<small>Incoming:</small>')},
    {what: 'the candidate set blocks', sections: ['sets', 'mirror'], present: (h) => h.includes('<small>Moves:</small>')},
  ];

  it('checks every section the grid defines — no cell goes uncovered', () => {
    expect(MARKERS.flatMap((m) => m.sections).sort()).toEqual([...SECTION_NAMES].sort());
  });

  for (const target of HOVER_TARGETS) {
    for (const {what, sections, present} of MARKERS) {
      const expected = sections.some((s) => shows(target, s));
      it(`${target} ${expected ? 'renders' : 'does not render'} ${what}`, () => {
        expect(present(RENDERED[target])).toBe(expected);
      });
    }
  }
});
