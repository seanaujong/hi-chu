// End-to-end test of the value chain that the content script folds together:
//   client Pokémon → toLiveFacts → resolveMon → calcDamage → renderDamageSection
//
// It runs on REAL randbats set data (a small captured fixture) so it exercises the
// same path a live hover does, minus the DOM/monkey-patch. This is the "green
// signal" for the shell — the part that otherwise tempts you to just eyeball it.

import {describe, it, expect} from 'vitest';
import sample from './__fixtures__/gen9.sample.json';
import {toLiveFacts, type ClientPokemon} from './battle/readState.js';
import {resolveMon} from './core/resolve.js';
import {calcDamage, type DamageReport} from './core/damage.js';
import {renderDamageSection, type RenderModel} from './core/render.js';
import {pickEntry} from './data/randbats.js';
import type {RandbatsData} from './core/types.js';

const data = sample as unknown as RandbatsData;

function clientMon(over: Partial<ClientPokemon> & {speciesForme: string}): ClientPokemon {
  return {level: 100, hp: 100, maxhp: 100, status: '', boosts: {}, terastallized: '', ...over};
}

/** Run the full pipeline for attacker vs defender and return the rendered HTML. */
function pipeline(attackerC: ClientPokemon, defenderC: ClientPokemon, gen = 9): {html: string; reports: DamageReport[]} {
  const aFacts = toLiveFacts(attackerC);
  const dFacts = toLiveFacts(defenderC);
  const attacker = resolveMon(aFacts, pickEntry(data, aFacts.speciesForme)!);
  const defender = resolveMon(dFacts, pickEntry(data, dFacts.speciesForme)!);
  const reports = attacker.possibleMoves.map((m) => calcDamage(attacker, defender, m, {gen}));
  const model: RenderModel = {
    defenderName: defender.speciesForme,
    defenderHpPercent: dFacts.hpPercent,
    reports,
    extraNotes: ['weather, screens and hazards not yet included'],
    ...(attacker.teraType ? {attackerTera: attacker.teraType} : {}),
  };
  return {html: renderDamageSection(model), reports};
}

describe('Breloom vs Tyranitar (multi-hit + status moves)', () => {
  const {html, reports} = pipeline(
    clientMon({speciesForme: 'Breloom'}),
    clientMon({speciesForme: 'Tyranitar', hp: 100, maxhp: 100}),
  );

  it("renders Bullet Seed with a real hit-count estimate and per-hit damage", () => {
    expect(html).toContain('Bullet Seed');
    expect(html).toMatch(/≈\d(\.\d)? hits/);
    expect(html).toContain('per hit');
  });

  it('separates Breloom’s status moves out of the damage rows', () => {
    expect(html).toMatch(/Status:.*Spore/);
    expect(html).toMatch(/Status:.*Swords Dance/);
  });

  it('computes a sane Bullet Seed report (total spans 2..5 hits of the per-hit roll)', () => {
    const bs = reports.find((r) => r.move === 'Bullet Seed')!;
    expect(bs.multiHit).toBe(true);
    expect(bs.approximate).toBe(false);
    expect(bs.total.min).toBe(bs.perHit!.min * 2);
    expect(bs.total.max).toBe(bs.perHit!.max * 5);
    expect(bs.koChance).toBeGreaterThanOrEqual(0);
    expect(bs.koChance).toBeLessThanOrEqual(1);
  });

  it('surfaces the field-effects caveat', () => {
    expect(html).toContain('weather, screens and hazards not yet included');
  });
});

describe('active Tera shows in the header and changes damage', () => {
  it('a terastallized Dragonite is labelled and hits differently', () => {
    const plain = pipeline(clientMon({speciesForme: 'Dragonite'}), clientMon({speciesForme: 'Garchomp'}));
    const tera = pipeline(
      clientMon({speciesForme: 'Dragonite', terastallized: 'Flying'}),
      clientMon({speciesForme: 'Garchomp'}),
    );
    expect(tera.html).toContain('Tera Flying');
    expect(plain.html).not.toContain('Tera Flying');

    // Tera Blast is Normal (no STAB) normally; Tera Flying turns it Flying with 2× STAB,
    // so it should hit much harder — exactly the active-Tera effect we set out to model.
    const plainBlast = plain.reports.find((r) => r.move === 'Tera Blast')!;
    const teraBlast = tera.reports.find((r) => r.move === 'Tera Blast')!;
    expect(teraBlast.total.mean).toBeGreaterThan(plainBlast.total.mean * 1.5);
  });
});

describe('current HP changes the KO math (Multiscale)', () => {
  it('a hurt defender takes more damage than a full-HP one', () => {
    const full = pipeline(clientMon({speciesForme: 'Garchomp'}), clientMon({speciesForme: 'Dragonite', hp: 100, maxhp: 100}));
    const hurt = pipeline(clientMon({speciesForme: 'Garchomp'}), clientMon({speciesForme: 'Dragonite', hp: 30, maxhp: 100}));
    // Outrage (Garchomp uses Dragonite isn't immune to it, unlike Earthquake/Flying).
    // At full HP, Dragonite's Multiscale halves it (no KO); at 30% Multiscale is off
    // AND little HP remains — both effects raise the KO chance.
    const fullOutrage = full.reports.find((r) => r.move === 'Outrage')!;
    const hurtOutrage = hurt.reports.find((r) => r.move === 'Outrage')!;
    expect(hurtOutrage.koChance).toBeGreaterThan(fullOutrage.koChance);
  });
});
