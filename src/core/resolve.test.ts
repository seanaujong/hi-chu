import {describe, it, expect} from 'vitest';
import {resolveByRole, resolveMon, resolveVariants} from './resolve.js';
import {inferSets} from './knowledge.js';
import type {RandbatsEntry} from './types.js';
import {
  liveFacts,
  DRAGONITE, dragoniteFacts,
  NOIVERN, noivernFacts,
  GARDEVOIR, gardevoirFacts,
  ORB_MON, orbFacts, DUAL_ABILITY,
  MEGANIUM_MEGA, megaMeganiumFacts,
  CALYREX_SHADOW, calyrexShadowFacts,
  TERAPAGOS, terapagosFacts,
  TENTACRUEL, tentacruelFacts,
} from './sets.testfixtures.js';

describe('resolveMon', () => {
  it('defaults to gen9 randbats spread: 85 EVs, 31 IVs, Serious nature', () => {
    const r = resolveMon(dragoniteFacts(), DRAGONITE);
    expect(r.nature).toBe('Serious');
    expect(r.evs).toEqual({hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85});
    expect(r.ivs).toEqual({hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31});
  });

  it('applies per-set EV overrides on top of the 85 baseline', () => {
    // A roleless entry (older-gen shape) with an EV override on the 85 baseline.
    const entry: RandbatsEntry = {level: 74, abilities: ['Multiscale'], items: ['Heavy-Duty Boots'], evs: {hp: 77}};
    const r = resolveMon(dragoniteFacts(), entry);
    expect(r.evs).toEqual({hp: 77, atk: 85, def: 85, spa: 85, spd: 85, spe: 85});
  });

  it('narrows to the role consistent with revealed moves', () => {
    // Iron Head appears only in "Setup Sweeper".
    const r = resolveMon(dragoniteFacts({revealedMoves: ['Iron Head']}), DRAGONITE);
    expect(r.possibleMoves).toContain('Iron Head');
    expect(r.possibleMoves).not.toContain('Roost');
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('carries client-dex speciesData through to the resolved mon (calc fallback for unknown formes)', () => {
    // Champions invents Megas the calc's dex lacks; the client dex reading must survive
    // resolution untouched so the damage layer can fall back to it.
    const speciesData = {baseStats: {hp: 60, atk: 75, def: 110, spa: 175, spd: 110, spe: 90}, types: ['Ghost', 'Fire'], weightkg: 34.3};
    expect(resolveMon(dragoniteFacts({speciesData}), DRAGONITE).speciesData).toEqual(speciesData);
    expect(resolveMon(dragoniteFacts(), DRAGONITE).speciesData).toBeUndefined();
  });

  it('unions all roles when no moves are revealed yet', () => {
    const r = resolveMon(dragoniteFacts(), DRAGONITE);
    expect(r.possibleMoves).toEqual(expect.arrayContaining(['Roost', 'Iron Head']));
  });

  it('flags uncertainty when a revealed move matches no role', () => {
    const r = resolveMon(dragoniteFacts({revealedMoves: ['Hydro Pump']}), DRAGONITE);
    expect(r.assumptionsUncertainReason).toBeDefined();
    expect(r.possibleMoves).toContain('Hydro Pump'); // revealed certainties are always kept
  });

  it('lets revealed ability/item win over the assumed set', () => {
    const r = resolveMon(dragoniteFacts({ability: 'Inner Focus', item: 'Choice Band'}), DRAGONITE);
    expect(r.ability).toBe('Inner Focus');
    expect(r.item).toBe('Choice Band');
  });

  it('only applies a Tera type when the Pokémon has actually terastallized', () => {
    expect(resolveMon(dragoniteFacts(), DRAGONITE).teraType).toBeUndefined();
    expect(resolveMon(dragoniteFacts({terastallized: true, teraType: 'Flying'}), DRAGONITE).teraType).toBe('Flying');
  });

  it('resolves to NO item once it has been knocked off / consumed (prevItem set)', () => {
    // Otherwise the calc keeps the gone item — Knock Off would stay ×1.5-boosted, etc.
    expect(resolveMon(dragoniteFacts({prevItem: 'Heavy-Duty Boots'}), DRAGONITE).item).toBeUndefined();
    expect(resolveMon(dragoniteFacts(), DRAGONITE).item).toBe('Heavy-Duty Boots'); // still assumed when nothing's revealed
  });

  it('takes the nature from a role that carries one; feed roles without one stay Serious', () => {
    // The randbats feed never sets nature — only assumption/usage pools do. The Serious
    // default for natureless roles is the randbats byte-identity guard.
    const natured: RandbatsEntry = {
      level: 100, abilities: [], items: [],
      roles: {Bulky: {abilities: [], items: [], teraTypes: [], moves: [], nature: 'Bold'}},
    };
    expect(resolveMon(dragoniteFacts(), natured).nature).toBe('Bold');
    expect(resolveMon(dragoniteFacts(), DRAGONITE).nature).toBe('Serious');
  });

  it('threads knownStats (our own server-reported finals) through to the resolved mon', () => {
    const knownStats = {hp: 341, atk: 403, def: 226, spa: 212, spd: 236, spe: 196};
    expect(resolveMon(dragoniteFacts({knownStats}), DRAGONITE).knownStats).toEqual(knownStats);
    expect(resolveMon(dragoniteFacts(), DRAGONITE).knownStats).toBeUndefined();
  });

  it('arms Unburden (abilityOn) once the item is confirmed GONE, not merely absent', () => {
    // Knocked off / consumed mid-battle (prevItem set, nothing held) — Unburden fires.
    const lost = resolveMon(dragoniteFacts({ability: 'Unburden', prevItem: 'Heavy-Duty Boots'}), DRAGONITE);
    expect(lost.abilityOn).toBe(true);
    // Never revealed to have HAD an item at all — Unburden must not fire on a mere guess.
    const unrevealed = resolveMon(dragoniteFacts({ability: 'Unburden'}), DRAGONITE);
    expect(unrevealed.abilityOn).toBeUndefined();
    // Item lost, but the ability isn't Unburden — no reason to arm it.
    const otherAbility = resolveMon(dragoniteFacts({ability: 'Multiscale', prevItem: 'Heavy-Duty Boots'}), DRAGONITE);
    expect(otherAbility.abilityOn).toBeUndefined();
  });

  it('passes Quark Drive/Protosynthesis boostedStat straight through — a SEPARATE toggle from abilityOn', () => {
    const boosted = resolveMon(dragoniteFacts({ability: 'Quark Drive', boostedStat: 'spe'}), DRAGONITE);
    expect(boosted.boostedStat).toBe('spe');
    expect(boosted.abilityOn).toBeUndefined();
    const notActive = resolveMon(dragoniteFacts({ability: 'Quark Drive'}), DRAGONITE);
    expect(notActive.boostedStat).toBeUndefined();
  });

  it('passes Charge straight through — live state, not derived from the ability', () => {
    const charged = resolveMon(dragoniteFacts({ability: 'Electromorphosis', charged: true}), DRAGONITE);
    expect(charged.charged).toBe(true);
    const notCharged = resolveMon(dragoniteFacts({ability: 'Electromorphosis'}), DRAGONITE);
    expect(notCharged.charged).toBeUndefined();
  });
});

describe('resolveMon reflects the same narrowing/deductions the display does', () => {
  it('a revealed held item rules out roles that never run it', () => {
    const r = resolveMon(noivernFacts({item: 'Choice Specs'}), NOIVERN);
    expect(r.possibleMoves).toContain('Boomburst');
    expect(r.possibleMoves).not.toContain('Roost'); // Fast Support is ruled out
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('uses the LIVE ability but resolves a Traced set cleanly (no shaky flag)', () => {
    const r = resolveMon(gardevoirFacts({ability: 'Teravolt', baseAbility: 'Trace'}), GARDEVOIR);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.ability).toBe('Teravolt'); // the calc uses what's actually active
  });

  it('keeps the calc off a ruled-out Life Orb when picking the assumed item', () => {
    // Mixed Attacker lists Life Orb FIRST; without the recoil rule the calc would assume it.
    expect(resolveMon(orbFacts(), ORB_MON).item).toBe('Choice Band');
  });

  it('resolves a Mega forme cleanly despite the client/feed ability-name mismatch', () => {
    expect(resolveMon(megaMeganiumFacts(), MEGANIUM_MEGA).assumptionsUncertainReason).toBeUndefined();
  });

  it("an ability the species cannot have narrows nothing — the protocol's umbrella name", () => {
    // Calyrex-Shadow reaches us with baseAbility "As One" (see the fixture) while the feed
    // says "As One (Spectrier)". Keying on the name rejected the only role, so every hover
    // read "matched no known set" from the moment it switched in.
    const r = resolveMon(calyrexShadowFacts({revealedMoves: ['Astral Barrage']}), CALYREX_SHADOW);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.possibleMoves).toContain('Nasty Plot');
    expect(r.ability).toBe('Grim Neigh'); // the calc still uses the LIVE ability
  });

  it('a FORME-LOCKED ability narrows nothing — Terapagos after Tera Shift', () => {
    // Tera Shift fires on switch-in and makes it Terapagos-Terastal, whose own ability —
    // Tera Shell — the client stamps over the innate one. Tera Shell is a REAL ability of
    // the species it now is, so checking the dex can't catch this; what makes it useless as
    // evidence is that no SET could have been built with it. Keying on it rejected both
    // roles, so every Terapagos hover cried "matched no known set" from the turn it landed.
    const r = resolveMon(terapagosFacts({revealedMoves: ['Calm Mind']}), TERAPAGOS);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.possibleMoves).toContain('Tera Starstorm');
    expect(r.ability).toBe('Tera Shell'); // the calc still uses the ability that is really active
  });

  it('an ability the set pool CAN produce still narrows, as hard as ever', () => {
    // The positive control for the law above: it must ignore only names no set could have
    // been built with. ORB_MON's three roles split on ability — Sheer Force belongs to one
    // of them, so revealing it still cuts the other two.
    // (No landed hit: the Life Orb deduction would rule roles out by ITEM, and this case is
    // about the ability alone.)
    const seen = (ability: string) => orbFacts({ability, baseAbility: ability, landedDamagingHit: false});
    const narrowed = resolveByRole(seen('Sheer Force'), ORB_MON);
    expect(narrowed.map((v) => v.role)).toEqual(['Force Sweeper']);
    // …while a name the pool could never produce leaves every role standing.
    const unnarrowed = resolveByRole(seen('Mega Sol'), ORB_MON);
    expect(unnarrowed.map((v) => v.role)).toEqual(['Orb Sweeper', 'Mixed Attacker', 'Force Sweeper']);
  });

  it('an ability the species cannot have narrows nothing — a borrowed one', () => {
    // Skill Swap before the innate ability was ever revealed: the client leaves `baseAbility`
    // empty, so readState falls back to the live one. Noivern can't have Poison Heal, so the
    // name is not evidence about its set — it must not reject the roles the moves still allow.
    const dex = {baseStats: {hp: 85, atk: 70, def: 80, spa: 97, spd: 80, spe: 123},
      types: ['Flying', 'Dragon'], abilities: ['Frisk', 'Infiltrator']};
    const facts = noivernFacts({speciesData: dex, ability: 'Poison Heal', baseAbility: 'Poison Heal'});
    expect(resolveMon(facts, NOIVERN).assumptionsUncertainReason).toBeUndefined();
    // A real Noivern ability still narrows: Infiltrator alone rules out neither role, but
    // Frisk is Fast Support's alone — so the pool loses Fast Attacker's moves.
    const frisk = resolveMon(noivernFacts({speciesData: dex, baseAbility: 'Frisk'}), NOIVERN);
    expect(frisk.possibleMoves).not.toContain('Boomburst');
  });
});

describe('resolveVariants — the still-possible sets to calc over', () => {
  const items = (vs: ReturnType<typeof resolveVariants>): string[] => [...new Set(vs.map((v) => v.mon.item ?? 'none'))];

  it('enumerates one variant per hidden item when the item is unknown', () => {
    expect(items(resolveVariants(tentacruelFacts(), TENTACRUEL)).sort()).toEqual(['Assault Vest', 'Leftovers']);
  });

  it('collapses to a single variant once the item is revealed', () => {
    const vs = resolveVariants(tentacruelFacts({item: 'Leftovers'}), TENTACRUEL);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.mon.item).toBe('Leftovers');
  });

  it('drops the Life Orb variant once a landed hit has ruled it out', () => {
    // The seam between the two features: a landed hit with no item revealed removes Life Orb
    // from the enumerated variants, so no phantom Life Orb damage bucket is produced.
    expect(items(resolveVariants(orbFacts(), DUAL_ABILITY))).toContain('Life Orb'); // hidden ability could be Sheer Force
    expect(items(resolveVariants(orbFacts({baseAbility: 'Overgrow'}), DUAL_ABILITY))).toEqual(['Choice Band']);
  });

  it('drops the Choice variants once two moves in one stint have ruled them out', () => {
    // The same seam for the Choice rule: varying moves removes Choice Band from the
    // enumerated variants, so no phantom ×1.5 damage bucket is produced. No landed hit
    // here, so Life Orb — the other item in the pool — is left standing on purpose.
    const quiet = orbFacts({landedDamagingHit: false});
    expect(items(resolveVariants(quiet, DUAL_ABILITY)).sort()).toEqual(['Choice Band', 'Life Orb']);
    // Neither ability this role can run is Klutz, so the rule fires even unrevealed.
    expect(items(resolveVariants({...quiet, usedDifferentMovesSinceSwitchIn: true}, DUAL_ABILITY))).toEqual(['Life Orb']);
  });

  it('drops the Air Balloon variant once a silent switch-in has ruled it out', () => {
    // Heatran's real gen9randombattle role, item pool and all: two items, so the deduction
    // does not merely shorten the list, it PINS the item — and with it the damage number,
    // since the alternative is an Assault Vest. Left standing, the balloon would keep a
    // phantom "0 damage" bucket on every Ground move aimed at a Heatran that has visibly
    // been on the field without one.
    const heatran: RandbatsEntry = {
      level: 78,
      abilities: ['Flash Fire'],
      items: [],
      roles: {
        'Bulky Support': {
          abilities: ['Flash Fire'],
          items: ['Air Balloon', 'Assault Vest'],
          teraTypes: ['Grass'],
          moves: ['Magma Storm'],
        },
      },
    };
    const facts = liveFacts({speciesForme: 'Heatran', baseAbility: 'Flash Fire', revealedMoves: ['Magma Storm']});
    expect(items(resolveVariants(facts, heatran)).sort()).toEqual(['Air Balloon', 'Assault Vest']);
    expect(items(resolveVariants({...facts, switchedInWithoutAnnouncingBalloon: true}, heatran)))
      .toEqual(['Assault Vest']);
  });

  it('drops the Choice variants once a status move has ruled them out', () => {
    // The seam for the set-shape rule, on Gardevoir's real role: three items, two of them
    // Choice. A single Calm Mind is enough — where the LOCK rule next door would still be
    // waiting for a second freely-chosen move — and what it buys is concrete: the Choice
    // Specs bucket is a ×1.5 damage line, and the Scarf is the ⚡ verdict's "if it is
    // Scarfed" aside. Both are phantoms the moment the boost goes up.
    const base = gardevoirFacts({baseAbility: 'Trace', revealedMoves: ['Psychic']});
    expect(items(resolveVariants(base, GARDEVOIR)).sort()).toEqual(['Choice Scarf', 'Choice Specs', 'Life Orb']);
    const setup = gardevoirFacts({baseAbility: 'Trace', revealedMoves: ['Calm Mind'], revealedStatusMoves: ['Calm Mind']});
    expect(items(resolveVariants(setup, GARDEVOIR))).toEqual(['Life Orb']);
  });

  it('keeps them for the status move the generator pairs with a Choice item', () => {
    // Trick is in the same Gardevoir pool, and it is the counterexample the rule is built
    // around: a Trick set holds a Choice item BECAUSE it Tricks. Reading it as evidence
    // against one would rule out the very set most likely to be standing there.
    const trick = gardevoirFacts({baseAbility: 'Trace', revealedMoves: ['Trick'], revealedStatusMoves: ['Trick']});
    expect(items(resolveVariants(trick, GARDEVOIR)).sort()).toEqual(['Choice Scarf', 'Choice Specs', 'Life Orb']);
  });

  it('rules out a Choice-ONLY role outright, not just its item line', () => {
    // The knock-on through `narrow.roleMatches`: a role whose entire item pool is ruled out
    // can no longer be what this Pokémon is, so it leaves the candidate list altogether.
    const entry: RandbatsEntry = {
      level: 80,
      abilities: ['Overgrow'],
      items: [],
      roles: {
        'Choice Attacker': {abilities: ['Overgrow'], items: ['Choice Specs'], teraTypes: ['Grass'], moves: ['Leaf Storm']},
        'Bulky Setup': {abilities: ['Overgrow'], items: ['Leftovers'], teraTypes: ['Grass'], moves: ['Leaf Storm']},
      },
    };
    const facts = orbFacts({landedDamagingHit: false, baseAbility: 'Overgrow'});
    expect(resolveVariants(facts, entry).map((v) => v.role).sort()).toEqual(['Bulky Setup', 'Choice Attacker']);
    const varied = {...facts, usedDifferentMovesSinceSwitchIn: true};
    expect(resolveVariants(varied, entry).map((v) => v.role)).toEqual(['Bulky Setup']);
  });

  it('drops the orb-fed ROLE once a turn has ended un-statused', () => {
    // Ursaring's real gen9randombattle entry: two roles, one item each, and the orb role's
    // ability is the reason it matters — Quick Feet is ×1.5 Speed the moment the orb fires,
    // so leaving it standing keeps a phantom fast variant on a Pokémon that has visibly sat
    // through an end-of-turn without poisoning itself.
    const ursaring: RandbatsEntry = {
      level: 84,
      abilities: ['Guts', 'Quick Feet'],
      items: [],
      roles: {
        'Bulky Attacker': {abilities: ['Guts'], items: ['Eviolite'], teraTypes: ['Ghost'], moves: ['Facade']},
        'Setup Sweeper': {abilities: ['Quick Feet'], items: ['Toxic Orb'], teraTypes: ['Ghost'], moves: ['Facade']},
      },
    };
    const facts = liveFacts({speciesForme: 'Ursaring', revealedMoves: ['Facade']});
    expect(resolveVariants(facts, ursaring).map((v) => v.role).sort())
      .toEqual(['Bulky Attacker', 'Setup Sweeper']);
    const quiet = resolveVariants({...facts, endedTurnUnstatused: true}, ursaring);
    expect(quiet.map((v) => v.role)).toEqual(['Bulky Attacker']);
    expect(items(quiet)).toEqual(['Eviolite']);
  });

  it('lets a deduction NARROW the roles but never empty them', () => {
    // Gliscor's real entry: both roles are Toxic Orb, so the rule-out has nothing left to
    // leave standing. A deduction is an inference from something that did NOT happen, so
    // one that kills every role is likelier to be the inference failing than the species
    // being impossible — and it must not be reported as revealed evidence contradicting
    // the feed, which is what `assumptionsUncertainReason` says.
    const gliscor: RandbatsEntry = {
      level: 76,
      abilities: ['Poison Heal'],
      items: [],
      roles: {
        'Fast Support': {abilities: ['Poison Heal'], items: ['Toxic Orb'], teraTypes: ['Water'], moves: ['Protect']},
        'Bulky Support': {abilities: ['Poison Heal'], items: ['Toxic Orb'], teraTypes: ['Water'], moves: ['Earthquake']},
      },
    };
    const facts = liveFacts({speciesForme: 'Gliscor', revealedMoves: ['Protect'], endedTurnUnstatused: true});
    const r = resolveMon(facts, gliscor);
    expect(r.assumptionsUncertainReason).toBeUndefined();
    expect(r.item).toBe('Toxic Orb');
    // A revealed move still eliminates: that is positive evidence, and it keeps working.
    expect(resolveVariants(facts, gliscor).map((v) => v.role)).toEqual(['Fast Support']);
  });

  it('keeps roles that resolve to the SAME Pokémon as separate variants', () => {
    // Two roles the calc cannot tell apart are still two SETS, and the sets view indexes
    // this fan-out by role name to fill each candidate block. Collapsing them by their
    // calc-facing Pokémon dropped one role out of the map entirely, so its block rendered
    // every move with no damage beside it — see section.test.ts for that surface.
    const twin: RandbatsEntry = {
      level: 80,
      abilities: ['Levitate'],
      items: [],
      roles: {
        'Role A': {abilities: ['Levitate'], items: ['Leftovers'], teraTypes: ['Fire'], moves: ['Flamethrower']},
        'Role B': {abilities: ['Levitate'], items: ['Leftovers'], teraTypes: ['Fire'], moves: ['Hydro Pump']},
      },
    };
    expect(resolveVariants(noivernFacts({speciesForme: 'Rotom'}), twin).map((v) => v.role)).toEqual(['Role A', 'Role B']);
  });

  it('still collapses a pool that repeats itself — the same item listed twice is one variant', () => {
    const repeated: RandbatsEntry = {
      level: 80,
      abilities: ['Levitate'],
      items: [],
      roles: {'Role A': {abilities: ['Levitate'], items: ['Leftovers', 'Leftovers'], teraTypes: ['Fire'], moves: ['Flamethrower']}},
    };
    expect(resolveVariants(noivernFacts({speciesForme: 'Rotom'}), repeated)).toHaveLength(1);
  });
});

describe('a live forme change', () => {
  // Relic Song turns Meloetta into Meloetta-Pirouette for as long as it stays in. The calc
  // has to see the forme standing there; the SET is still the one the feed publishes under
  // "Meloetta" — there is no Pirouette entry to look up, and the moves it revealed as a
  // Meloetta still narrow its role. So the two species part ways at exactly one seam.
  const MELOETTA: RandbatsEntry = {
    level: 82,
    abilities: ['Serene Grace'],
    items: ['Leftovers'],
    roles: {
      Wallbreaker: {
        abilities: ['Serene Grace'],
        items: ['Leftovers'],
        teraTypes: ['Fighting'],
        moves: ['Relic Song', 'Close Combat', 'Knock Off'],
      },
    },
  };
  const facts = liveFacts({
    speciesForme: 'Meloetta',
    liveForme: 'Meloetta-Pirouette',
    level: 82,
    revealedMoves: ['Relic Song'],
  });

  it('is what the calc resolves to, while the set stays the base species\'', () => {
    const r = resolveMon(facts, MELOETTA);
    expect(r.speciesForme).toBe('Meloetta-Pirouette');
    // …and the Meloetta role still matched: the revealed move narrowed it as normal.
    expect(r.possibleMoves).toContain('Close Combat');
    expect(r.assumptionsUncertainReason).toBeUndefined();
  });

  it('reaches every variant, not just the single resolution', () => {
    for (const v of resolveVariants(facts, MELOETTA)) expect(v.mon.speciesForme).toBe('Meloetta-Pirouette');
    for (const v of resolveByRole(facts, MELOETTA)) expect(v.mon.speciesForme).toBe('Meloetta-Pirouette');
  });

  it('leaves a Pokémon that has not changed forme exactly as it was', () => {
    expect(resolveMon(dragoniteFacts(), DRAGONITE).speciesForme).toBe('Dragonite');
  });
});

describe('resolveByRole — one resolution per surviving set, aligned with inferSets', () => {
  it('yields a resolution per candidate, in the same order as inferSets', () => {
    const byRole = resolveByRole(noivernFacts(), NOIVERN);
    expect(byRole.map((v) => v.role)).toEqual(inferSets(noivernFacts(), NOIVERN).candidates.map((c) => c.name));
  });

  it("uses each set's own representative item, not one set's shared across all", () => {
    const byName = new Map(resolveByRole(noivernFacts(), NOIVERN).map((v) => [v.role, v.mon.item]));
    expect(byName.get('Fast Attacker')).toBe('Choice Specs');
    expect(byName.get('Fast Support')).toBe('Heavy-Duty Boots');
  });
});

describe('candidateItems is the ONE rule deciding a candidate’s item pool', () => {
  // The feed omits an empty array rather than writing one, so a role can declare no items
  // at all while its ENTRY still names some — Thundurus' Wallbreaker is the live case, and
  // Jumpluff's two roles the case where nothing anywhere declares an item.
  const WALLBREAKER_STYLE: RandbatsEntry = {
    level: 78,
    abilities: ['Defiant', 'Prankster'],
    items: ['Choice Specs', 'Heavy-Duty Boots'],
    roles: {
      Wallbreaker: {abilities: ['Defiant', 'Prankster'], items: [], teraTypes: ['Electric'], moves: ['Thunderbolt']},
      'Fast Attacker': {
        abilities: ['Defiant', 'Prankster'],
        items: ['Choice Specs', 'Heavy-Duty Boots'],
        teraTypes: ['Electric'],
        moves: ['Thunderbolt'],
      },
    },
  };

  /** What each candidate block would LIST, per role name. */
  const listed = (entry: RandbatsEntry, facts = liveFacts({speciesForme: 'Thundurus'})) =>
    Object.fromEntries(inferSets(facts, entry).candidates.map((c) => [c.name, c.items.map((i) => i.name)]));

  /** The DISTINCT items each role is CALCULATED with, per role name. `resolveVariants`
   *  crosses items with abilities, so the same item comes back once per ability. */
  const calculated = (entry: RandbatsEntry, facts = liveFacts({speciesForme: 'Thundurus'})) => {
    const out: Record<string, string[]> = {};
    for (const v of resolveVariants(facts, entry)) {
      const seen = (out[v.role] ??= []);
      const item = v.mon.item ?? '(none)';
      if (!seen.includes(item)) seen.push(item);
    }
    return out;
  };

  it('falls back to the ENTRY’s items for a role that declares none', () => {
    // The divergence this rule exists to close: the calc already fanned Wallbreaker out over
    // both entry items while the block above listed nothing, so a span reaching Choice Specs
    // damage sat under a heading that never mentioned it.
    expect(listed(WALLBREAKER_STYLE)['Wallbreaker']).toEqual(['Choice Specs', 'Heavy-Duty Boots']);
    expect(calculated(WALLBREAKER_STYLE)['Wallbreaker']).toEqual(['Choice Specs', 'Heavy-Duty Boots']);
  });

  it('lists exactly what it calculates with, for every role', () => {
    // The invariant itself, stated over both roles at once rather than one example of it.
    expect(listed(WALLBREAKER_STYLE)).toEqual(calculated(WALLBREAKER_STYLE));
  });

  it('stays empty when a role AND its entry genuinely declare no items (Jumpluff)', () => {
    // Not everything empty is a bug: here both halves agree on "holds nothing", which is
    // the honest answer and the reason the guard can't just be "never return empty".
    const JUMPLUFF_STYLE: RandbatsEntry = {
      level: 88,
      abilities: ['Infiltrator'],
      items: [],
      roles: {'Bulky Support': {abilities: ['Infiltrator'], items: [], teraTypes: ['Steel'], moves: ['Acrobatics']}},
    };
    expect(listed(JUMPLUFF_STYLE)['Bulky Support']).toEqual([]);
    expect(calculated(JUMPLUFF_STYLE)['Bulky Support']).toEqual(['(none)']);
  });

  it('keeps the two halves agreeing when a deduction rules out every item', () => {
    // `consistentRoles` drops the rule-outs wholesale when they leave no role standing. That
    // verdict has to reach BOTH halves — the calc used to re-derive it privately and the
    // display used to ignore it, which is what emptied the Items line under a live span.
    const orbOnly: RandbatsEntry = {
      level: 80,
      abilities: ['Poison Heal'],
      items: ['Toxic Orb'],
      roles: {'Bulky Setup': {abilities: ['Poison Heal'], items: ['Toxic Orb'], teraTypes: ['Water'], moves: ['Protect']}},
    };
    const quiet = liveFacts({speciesForme: 'Gliscor', ability: 'Poison Heal', endedTurnUnstatused: true});
    expect(listed(orbOnly, quiet)['Bulky Setup']).toEqual(['Toxic Orb']);
    expect(listed(orbOnly, quiet)).toEqual(calculated(orbOnly, quiet));
  });
});
