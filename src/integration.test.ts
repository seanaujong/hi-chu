// End-to-end test of the value chain the content script folds together:
//   client Pokémon → toLiveFacts → resolveMon → calcDamage → rendered section
//
// It runs on REAL randbats set data (a small captured fixture) so it exercises the
// same path a live hover does, minus the DOM/monkey-patch. This is the "green
// signal" for the shell — the part that otherwise tempts you to just eyeball it.

import {describe, it, expect} from 'vitest';
import sample from './__fixtures__/gen9.sample.json';
import {toLiveFacts, type ClientBattle, type ClientPokemon, type ClientSide} from './battle/readState.js';
import {resolveMon} from './core/resolve.js';
import {calcDamage, type DamageReport} from './core/damage.js';
import {pickEntry} from './data/lookup.js';
import {buildMoveSection, buildPokemonSection} from './section.js';
import type {FieldFacts, RandbatsData} from './core/types.js';

const data = sample as unknown as RandbatsData;

function clientMon(over: Partial<ClientPokemon> & {speciesForme: string}): ClientPokemon {
  return {level: 100, hp: 100, maxhp: 100, status: '', boosts: {}, terastallized: '', ...over};
}

/** A minimal two-sided battle: `ours` on the near side, `theirs` on the far side. */
function makeBattle(ours: ClientPokemon, theirs: ClientPokemon): ClientBattle {
  const near = {isFar: false, active: [] as (ClientPokemon | null)[]};
  const far = {isFar: true, active: [] as (ClientPokemon | null)[]};
  near.active = [{...ours, side: near as unknown as ClientSide} as ClientPokemon];
  far.active = [{...theirs, side: far as unknown as ClientSide} as ClientPokemon];
  return {gen: 9, tier: '[Gen 9] Random Battle', sides: [near, far] as unknown as ClientSide[]};
}

const ourActive = (b: ClientBattle): ClientPokemon => b.sides[0]!.active[0]!;
const theirActive = (b: ClientBattle): ClientPokemon => b.sides[1]!.active[0]!;

/** The raw damage reports for every possible move of attacker into defender. */
function reportsFor(
  attackerC: ClientPokemon,
  defenderC: ClientPokemon,
  opts: {gen?: number; field?: FieldFacts} = {},
): DamageReport[] {
  const aFacts = toLiveFacts(attackerC);
  const dFacts = toLiveFacts(defenderC);
  const attacker = resolveMon(aFacts, pickEntry(data, aFacts.speciesForme)!);
  const defender = resolveMon(dFacts, pickEntry(data, dFacts.speciesForme)!);
  return attacker.possibleMoves.map((m) =>
    calcDamage(attacker, defender, m, {gen: opts.gen ?? 9, ...(opts.field ? {field: opts.field} : {})}),
  );
}

describe('Breloom vs Tyranitar (multi-hit + status moves)', () => {
  const battle = makeBattle(clientMon({speciesForme: 'Breloom'}), clientMon({speciesForme: 'Tyranitar'}));

  it('renders Bullet Seed on the move button with a real hit-count estimate', () => {
    const html = buildMoveSection(battle, ourActive(battle), 'Bullet Seed', data);
    expect(html).toContain('<small>Damage:</small>');
    expect(html).toMatch(/≈\d(\.\d)? hits/);
    expect(html).toContain('per hit');
  });

  it('inserts nothing for a status move button (Spore → empty)', () => {
    expect(buildMoveSection(battle, ourActive(battle), 'Spore', data)).toBe('');
  });

  it('computes a sane Bullet Seed report (total spans 2..5 hits of the per-hit roll)', () => {
    const bs = reportsFor(ourActive(battle), theirActive(battle)).find((r) => r.move === 'Bullet Seed')!;
    expect(bs.multiHit).toBeDefined();
    expect(bs.total.min).toBe(bs.multiHit!.perHit.min * 2);
    expect(bs.total.max).toBe(bs.multiHit!.perHit.max * 5);
    expect(bs.koChance).toBeGreaterThanOrEqual(0);
    expect(bs.koChance).toBeLessThanOrEqual(1);
  });

  it('shows the foe’s status moves in the sets view without damage figures', () => {
    // Flip the seating: Breloom is THEIR active, hovered as the foe.
    const flipped = makeBattle(clientMon({speciesForme: 'Tyranitar'}), clientMon({speciesForme: 'Breloom'}));
    const html = buildPokemonSection(flipped, theirActive(flipped), data);
    expect(html).toContain('<div class="hichu-block">');
    expect(html).toContain('Spore');
    expect(html).not.toMatch(/Spore \(/);
    expect(html).toMatch(/Bullet Seed \(\d/);
  });
});

describe('field effects flow through the pipeline', () => {
  it('Rain boosts Cloyster’s Hydro Pump', () => {
    const noField: FieldFacts = {defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false}};
    const cloyster = clientMon({speciesForme: 'Cloyster'});
    const ttar = clientMon({speciesForme: 'Tyranitar'});
    const dry = reportsFor(cloyster, ttar, {field: noField}).find((r) => r.move === 'Hydro Pump')!;
    const rain = reportsFor(cloyster, ttar, {field: {...noField, weather: 'Rain'}}).find((r) => r.move === 'Hydro Pump')!;
    expect(rain.total.mean).toBeGreaterThan(dry.total.mean);
  });
});

describe('active Tera shows in the header and changes damage', () => {
  it('a terastallized Dragonite is labelled and hits differently', () => {
    const plainBattle = makeBattle(clientMon({speciesForme: 'Dragonite'}), clientMon({speciesForme: 'Garchomp'}));
    const teraBattle = makeBattle(
      clientMon({speciesForme: 'Dragonite', terastallized: 'Flying'}),
      clientMon({speciesForme: 'Garchomp'}),
    );
    expect(buildMoveSection(teraBattle, ourActive(teraBattle), 'Tera Blast', data)).toContain('Tera Flying');
    expect(buildMoveSection(plainBattle, ourActive(plainBattle), 'Tera Blast', data)).not.toContain('Tera Flying');

    // Tera Blast is Normal (no STAB) normally; Tera Flying turns it Flying with 2× STAB,
    // so it should hit much harder — exactly the active-Tera effect we set out to model.
    const plainBlast = reportsFor(ourActive(plainBattle), theirActive(plainBattle)).find((r) => r.move === 'Tera Blast')!;
    const teraBlast = reportsFor(ourActive(teraBattle), theirActive(teraBattle)).find((r) => r.move === 'Tera Blast')!;
    expect(teraBlast.total.mean).toBeGreaterThan(plainBlast.total.mean * 1.5);
  });
});

describe('current HP changes the KO math (Multiscale)', () => {
  it('a hurt defender takes more damage than a full-HP one', () => {
    const garchomp = clientMon({speciesForme: 'Garchomp'});
    const full = reportsFor(garchomp, clientMon({speciesForme: 'Dragonite', hp: 100, maxhp: 100}));
    const hurt = reportsFor(garchomp, clientMon({speciesForme: 'Dragonite', hp: 30, maxhp: 100}));
    // At full HP, Dragonite's Multiscale halves Outrage (no KO); at 30% Multiscale is
    // off AND little HP remains — both effects raise the KO chance.
    const fullOutrage = full.find((r) => r.move === 'Outrage')!;
    const hurtOutrage = hurt.find((r) => r.move === 'Outrage')!;
    expect(hurtOutrage.koChance).toBeGreaterThan(fullOutrage.koChance);
  });
});

// Illusion suspects (section.ts) are discovered by scanning the FEED for whichever species
// it lists with the Illusion ability, not by matching a hardcoded "Zoroark" name — so this
// feed deliberately hands the ability to a species that has never had it in reality. If
// discovery secretly still keyed on the literal name, this whole suspicion would never fire.
const illusionData = {
  Tyranitar: {level: 100, abilities: [], items: [], roles: {R: {abilities: ['Sand Stream'], items: ['Leftovers'], teraTypes: [], moves: ['Crunch']}}},
  Magikarp: {level: 100, abilities: [], items: [], roles: {R: {abilities: ['Swift Swim'], items: ['Leftovers'], teraTypes: [], moves: ['Splash', 'Tackle']}}},
  Pikachu: {level: 100, abilities: [], items: [], roles: {R: {abilities: ['Illusion'], items: ['Leftovers'], teraTypes: [], moves: ['Splash', 'Thunder Wave']}}},
} as unknown as RandbatsData;

describe('Illusion suspects are discovered from the feed, not a hardcoded species name', () => {
  it('flags a shown Magikarp as a possible disguised Pikachu once it reveals a move only Pikachu’s pool has', () => {
    const battle = makeBattle(
      clientMon({speciesForme: 'Tyranitar'}),
      clientMon({speciesForme: 'Magikarp', moveTrack: [['Thunder Wave', 32]]}),
    );
    const html = buildMoveSection(battle, ourActive(battle), 'Crunch', illusionData);
    expect(html).toContain('Pikachu');
  });

  it('stays silent when every revealed move already fits the shown species', () => {
    const battle = makeBattle(
      clientMon({speciesForme: 'Tyranitar'}),
      clientMon({speciesForme: 'Magikarp', moveTrack: [['Tackle', 32]]}),
    );
    const html = buildMoveSection(battle, ourActive(battle), 'Crunch', illusionData);
    expect(html).not.toContain('Pikachu');
  });
});
