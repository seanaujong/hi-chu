import {describe, it, expect} from 'vitest';
import {transformCopy, applyTransform} from './transform.js';
import type {FullStats, ResolvedMon, SpeciesData} from './types.js';

const DITTO_BASE: FullStats = {hp: 48, atk: 48, def: 48, spa: 48, spd: 48, spe: 48};
const DITTO_FINALS: FullStats = {hp: 225, atk: 128, def: 128, spa: 128, spd: 128, spe: 128};

const DRAGAPULT: SpeciesData = {
  baseStats: {hp: 88, atk: 120, def: 75, spa: 100, spd: 75, spe: 142},
  types: ['Dragon', 'Ghost'],
  weightkg: 50,
};
const DRAGAPULT_FINALS: FullStats = {hp: 260, atk: 268, def: 186, spa: 232, spd: 186, spe: 306};

const copier = {baseStats: DITTO_BASE, finalStats: DITTO_FINALS};
const target = {body: DRAGAPULT, finalStats: DRAGAPULT_FINALS, moves: ['Dragon Darts'], movesKnown: true, timesAttacked: 3};

describe('transformCopy', () => {
  it('copies every stat except HP, which stays the copier’s own', () => {
    const copy = transformCopy(copier, target);
    // The body is the target's, but HP is the one stat Transform never touches — so the
    // copy is a Dragapult that keeps Ditto's 48 base HP and its own 225 max.
    expect(copy.body.baseStats).toEqual({...DRAGAPULT.baseStats, hp: 48});
    expect(copy.body.types).toEqual(['Dragon', 'Ghost']);
    expect(copy.finalStats).toEqual({...DRAGAPULT_FINALS, hp: 225});
  });

  it('installs the copied NUMBERS only when both spreads are known', () => {
    // The copy is a relation between two Pokémon: the target's finals are what gets
    // installed and the copier's own HP is what survives, so half a pair would put a
    // guessed number where an exact one belongs. The body still applies either way.
    const {finalStats: _unknownSpread, ...targetNoFinals} = target;
    const targetUnknown = transformCopy(copier, targetNoFinals);
    expect(targetUnknown.finalStats).toBeUndefined();
    expect(targetUnknown.body.baseStats.hp).toBe(48);

    const copierUnknown = transformCopy({baseStats: DITTO_BASE}, target);
    expect(copierUnknown.finalStats).toBeUndefined();
    expect(copierUnknown.body.baseStats.hp).toBe(48);
  });

  it('carries the moves, and whether they are the target’s real four', () => {
    expect(transformCopy(copier, target).moves).toEqual(['Dragon Darts']);
    expect(transformCopy(copier, target).movesKnown).toBe(true);
    expect(transformCopy(copier, {...target, movesKnown: false}).movesKnown).toBe(false);
  });

  it('carries the TARGET’s own timesAttacked — the sim copies it onto the copier verbatim', () => {
    expect(transformCopy(copier, target).timesAttacked).toBe(3);
  });
});

describe('applyTransform', () => {
  const ditto: ResolvedMon = {
    speciesForme: 'Dragapult', // the live forme: buildResolved already read it off the volatile
    speciesData: {baseStats: DITTO_BASE, types: ['Normal']}, // Ditto's own — the body it has left
    level: 87,
    nature: 'Serious',
    evs: {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85},
    ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
    ability: 'Imposter',
    item: 'Choice Scarf',
    status: undefined,
    boosts: {},
    hpPercent: 1,
    teraType: undefined,
    terastallized: false,
    possibleMoves: ['Transform'],
    knownStats: DITTO_FINALS, // the request's stale figures — the sim never updates them
    timesAttacked: 5, // Ditto's OWN count — Transform overrides it with the target's
  };
  const copy = transformCopy(copier, target);

  it('hands the calc the copied body and the copied numbers', () => {
    const r = applyTransform(ditto, copy);
    expect(r.speciesOverride?.baseStats).toEqual({...DRAGAPULT.baseStats, hp: 48});
    expect(r.knownStats).toEqual({...DRAGAPULT_FINALS, hp: 225});
    expect(r.possibleMoves).toEqual(['Dragon Darts']);
    // Its own dex record describes a body it is no longer wearing; riding along, it would
    // hand the calc Ditto's base stats for a Pokémon that is currently a Dragapult.
    expect(r.speciesData).toBeUndefined();
  });

  it('keeps what Transform never takes: level, item, ability, boosts, HP', () => {
    const r = applyTransform({...ditto, boosts: {spe: 2}, hpPercent: 0.5}, copy);
    expect(r.level).toBe(87); // its own — and the damage formula reads the ATTACKER's level
    expect(r.item).toBe('Choice Scarf');
    expect(r.ability).toBe('Imposter');
    expect(r.boosts).toEqual({spe: 2});
    expect(r.hpPercent).toBe(0.5);
  });

  it('adopts the TARGET’s timesAttacked, not the copier’s own — Rage Fist reads the copy’s hits', () => {
    // Ditto's own count was 5 (see the fixture); the target it copied had taken 3 hits.
    // The sim's `transformInto` overwrites `timesAttacked` wholesale, so the copy must too.
    expect(applyTransform(ditto, copy).timesAttacked).toBe(3);
  });

  it('displaces the copier’s stale server stats rather than letting them win', () => {
    // The request JSON ships `baseStoredStats`, which transformInto deliberately never
    // updates — so a transformed Pokémon's reported finals are always the ones it had
    // BEFORE it copied anyone. Left in place they would out-rank the copy.
    expect(applyTransform(ditto, copy).knownStats).not.toEqual(DITTO_FINALS);
    // …and with no copied numbers to install, they still must not survive.
    const {finalStats: _none, ...bodyOnly} = copy;
    expect(applyTransform(ditto, bodyOnly).knownStats).toBeUndefined();
  });
});
