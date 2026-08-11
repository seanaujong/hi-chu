import {describe, it, expect} from 'vitest';
import {sappedAttack, strengthSap} from './strengthsap.js';
import type {ResolvedMon, SetVariant} from './types.js';

// Every number below was read off Pokémon Showdown's own simulator, not computed here:
// a real `gen9customgame` battle with randbats-shaped sets (85 EVs / 31 IVs / Serious,
// the generator's atk=0 override where the feed carries one) at the feed's own levels,
// with the user dropped to 1 HP so the cap couldn't hide the amount.
//
//   Sinistcha lvl 83                          max HP 254
//   Great Tusk lvl 77       sapped for 246 · +2 492 · +1 369 · -1 164 · -2 123 · -6 fails
//   Amoonguss lvl 82        sapped for 187 as Bulky Attacker, 144 as Bulky Support
//   Tentacruel lvl 84       sapped for 166, and Liquid Ooze turns it round

/** A randbats-shaped ResolvedMon: the feed's flat spread, stating only what matters. */
function mon(over: Partial<ResolvedMon> & {speciesForme: string; level: number}): ResolvedMon {
  return {
    nature: 'Serious',
    evs: {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85},
    ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
    ability: undefined,
    item: undefined,
    status: undefined,
    boosts: {},
    hpPercent: 1,
    teraType: undefined,
    terastallized: false,
    possibleMoves: [],
    timesAttacked: 0,
    ...over,
  };
}

const variant = (m: ResolvedMon, role = ''): SetVariant => ({mon: m, role});

/** The generator zeroes both the EVs and the IVs of a set with no physical move. */
const noAttackInvestment = {
  evs: {hp: 85, atk: 0, def: 85, spa: 85, spd: 85, spe: 85},
  ivs: {hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31},
};

const sinistcha = mon({speciesForme: 'Sinistcha', level: 83, ...noAttackInvestment});
const greatTusk = mon({speciesForme: 'Great Tusk', level: 77});

describe('sappedAttack — the stat the move reads', () => {
  it('is the target’s raw final Attack', () => {
    expect(sappedAttack(greatTusk)).toBe(246);
  });

  it('follows the boost stage, multiplying up and DIVIDING down', () => {
    const at = (atk: number): number | undefined => sappedAttack({...greatTusk, boosts: {atk}});
    expect(at(2)).toBe(492);
    expect(at(1)).toBe(369);
    expect(at(-1)).toBe(164); // floor(246 / 1.5), not 246 × (2/3)
    expect(at(-2)).toBe(123);
  });

  it('ignores every OTHER modifier — the exact number a doubled Attack does NOT reach', () => {
    // Showdown reads this stat with `unmodified: true`, so the ModifyAtk event never runs.
    // The sim reports the same Azumarill at 132 here and 264 with Huge Power applied, so
    // the pinned figure is what separates reading the stat from reading the attack.
    expect(sappedAttack(mon({speciesForme: 'Azumarill', level: 84, ability: 'Huge Power'}))).toBe(132);
    expect(sappedAttack({...greatTusk, item: 'Choice Band'})).toBe(246);
  });

  it('keeps quiet about a species it cannot find base stats for', () => {
    expect(sappedAttack(mon({speciesForme: 'Not A Pokemon', level: 100}))).toBeUndefined();
  });
});

describe('strengthSap — where the siphon leaves us', () => {
  const hurt = {...sinistcha, hpPercent: 0.2}; // 51 of 254 HP

  it('reports our HP before and after, as a percent of our own max', () => {
    const r = strengthSap(hurt, [variant(greatTusk)]);
    expect(r.before).toBe(20.1); //  51 / 254
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toEqual({after: 100, label: '', weight: 1}); // 51 + 246 caps at full
  });

  it('caps at full HP — a siphon worth more than the room to gain it', () => {
    const nearlyFull = {...sinistcha, hpPercent: 0.95};
    const r = strengthSap(nearlyFull, [variant(greatTusk)]);
    expect(r.outcomes[0]?.after).toBe(100);
  });

  it('splits when the surviving roles disagree about Attack investment', () => {
    const attacker = variant(mon({speciesForme: 'Amoonguss', level: 82}), 'Bulky Attacker');
    const support = variant(mon({speciesForme: 'Amoonguss', level: 82, ...noAttackInvestment}), 'Bulky Support');
    const r = strengthSap(hurt, [attacker, support]);
    expect(r.outcomes.map((o) => [o.label, o.after])).toEqual([
      ['Bulky Attacker', 93.7], // (51 + 187) / 254
      ['Bulky Support', 76.8], //  (51 + 144) / 254
    ]);
  });

  it('collapses roles that reach the same HP into ONE outcome', () => {
    const same = mon({speciesForme: 'Amoonguss', level: 82});
    const r = strengthSap(hurt, [variant(same, 'Bulky Attacker'), variant(same, 'Bulky Support')]);
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toEqual({after: 93.7, label: '', weight: 2});
  });

  it('turns the siphon round under Liquid Ooze — the sap comes out of US', () => {
    const healthy = {...sinistcha, hpPercent: 0.9}; // 229 of 254 HP
    const tentacruel = variant(mon({speciesForme: 'Tentacruel', level: 84, ability: 'Liquid Ooze'}));
    const r = strengthSap(healthy, [tentacruel]);
    expect(r.before).toBe(90.2);
    expect(r.outcomes[0]?.after).toBe(24.8); // (229 - 166) / 254
  });

  it('cannot take us below zero', () => {
    const dying = {...sinistcha, hpPercent: 0.05};
    const tentacruel = variant(mon({speciesForme: 'Tentacruel', level: 84, ability: 'Liquid Ooze'}));
    expect(strengthSap(dying, [tentacruel]).outcomes[0]?.after).toBe(0);
  });

  it('reports the zero heal a target already at -6 Attack gives', () => {
    // The move fails outright there; what this surface answers is "how much HP", and
    // that answer is none.
    const r = strengthSap(hurt, [variant({...greatTusk, boosts: {atk: -6}})]);
    expect(r.outcomes[0]?.after).toBe(r.before);
  });

  it('says nothing at all about a user it cannot size', () => {
    const r = strengthSap(mon({speciesForme: 'Not A Pokemon', level: 100}), [variant(greatTusk)]);
    expect(r.outcomes).toEqual([]);
  });

  it('leads with the best-supported outcome, not the biggest', () => {
    const attacker = variant(mon({speciesForme: 'Amoonguss', level: 82}), 'Bulky Attacker');
    const support = variant(mon({speciesForme: 'Amoonguss', level: 82, ...noAttackInvestment}), 'Bulky Support');
    const r = strengthSap(hurt, [attacker, support, {...support, role: 'Bulky Support 2'}]);
    expect(r.outcomes[0]?.weight).toBe(2);
    expect(r.outcomes[0]?.after).toBe(76.8); // the smaller siphon, backed by two sets
  });
});
