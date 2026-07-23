// Pins for the switch-in hazard law. Rock's real gen-9 effectiveness chart (queried
// straight off @smogon/calc's own TYPE_CHART): Fire/Ice/Flying/Bug 2x, Ground/Fighting/
// Steel 0.5x, everything else neutral — so Stealth Rock's fraction (effectiveness / 8)
// is pinned against real species with well-known typings, not invented numbers.

import {describe, it, expect} from 'vitest';
import {computeHazardFraction, applySwitchInHazards, type OwnSideHazards} from './hazards.js';
import type {ResolvedMon} from './types.js';

const mon = (over: Partial<ResolvedMon> = {}): ResolvedMon => ({
  speciesForme: 'Snorlax',
  level: 100,
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
});

const noHazards: OwnSideHazards = {stealthRock: false, spikesLayers: 0};
const stealthRockOnly: OwnSideHazards = {stealthRock: true, spikesLayers: 0};

describe('computeHazardFraction', () => {
  it('is 0 with no hazards up', () => {
    expect(computeHazardFraction(mon(), noHazards, 9)).toBe(0);
  });

  it('Stealth Rock at neutral effectiveness: 1/8 (pure Normal)', () => {
    expect(computeHazardFraction(mon({speciesForme: 'Snorlax'}), stealthRockOnly, 9)).toBeCloseTo(1 / 8);
  });

  it('Stealth Rock at 4x (Fire/Flying, Charizard): 1/2', () => {
    expect(computeHazardFraction(mon({speciesForme: 'Charizard'}), stealthRockOnly, 9)).toBeCloseTo(1 / 2);
  });

  it('Stealth Rock at 2x (pure Flying, Tornadus): 1/4', () => {
    expect(computeHazardFraction(mon({speciesForme: 'Tornadus'}), stealthRockOnly, 9)).toBeCloseTo(1 / 4);
  });

  it('Stealth Rock at 0.5x (pure Fighting, Machamp): 1/16', () => {
    expect(computeHazardFraction(mon({speciesForme: 'Machamp'}), stealthRockOnly, 9)).toBeCloseTo(1 / 16);
  });

  it('Stealth Rock at 0.25x (Ground/Steel double resist, Excadrill): 1/32', () => {
    expect(computeHazardFraction(mon({speciesForme: 'Excadrill'}), stealthRockOnly, 9)).toBeCloseTo(1 / 32);
  });

  it('Spikes on a grounded mon: 1/8, 1/6, 1/4 for 1/2/3 layers', () => {
    expect(computeHazardFraction(mon(), {stealthRock: false, spikesLayers: 1}, 9)).toBeCloseTo(1 / 8);
    expect(computeHazardFraction(mon(), {stealthRock: false, spikesLayers: 2}, 9)).toBeCloseTo(1 / 6);
    expect(computeHazardFraction(mon(), {stealthRock: false, spikesLayers: 3}, 9)).toBeCloseTo(1 / 4);
  });

  it('Spikes never touches a Flying-type switch-in', () => {
    const m = mon({speciesForme: 'Tornadus'});
    expect(computeHazardFraction(m, {stealthRock: false, spikesLayers: 3}, 9)).toBe(0);
  });

  it('Spikes never touches a Levitate holder', () => {
    const m = mon({ability: 'Levitate'});
    expect(computeHazardFraction(m, {stealthRock: false, spikesLayers: 3}, 9)).toBe(0);
  });

  it('Spikes never touches an Air Balloon holder', () => {
    const m = mon({item: 'Air Balloon'});
    expect(computeHazardFraction(m, {stealthRock: false, spikesLayers: 3}, 9)).toBe(0);
  });

  it('Iron Ball grounds an otherwise-immune Flying-type for Spikes', () => {
    const m = mon({speciesForme: 'Tornadus', item: 'Iron Ball'});
    expect(computeHazardFraction(m, {stealthRock: false, spikesLayers: 2}, 9)).toBeCloseTo(1 / 6);
  });

  it('Heavy-Duty Boots blocks every hazard outright', () => {
    const m = mon({item: 'Heavy-Duty Boots'});
    expect(computeHazardFraction(m, {stealthRock: true, spikesLayers: 3}, 9)).toBe(0);
  });

  it('Magic Guard blocks every hazard outright', () => {
    const m = mon({ability: 'Magic Guard'});
    expect(computeHazardFraction(m, {stealthRock: true, spikesLayers: 3}, 9)).toBe(0);
  });

  it('Stealth Rock and Spikes sum', () => {
    const m = mon(); // pure Normal, grounded: SR 1/8 + 2 Spikes layers 1/6
    expect(computeHazardFraction(m, {stealthRock: true, spikesLayers: 2}, 9)).toBeCloseTo(1 / 8 + 1 / 6);
  });

  it('reads the ACTIVE Tera type, not the base species typing', () => {
    // Tornadus is pure Flying (2x, 1/4) — but Tera Fairy is neutral to Rock (1x, 1/8).
    // A mon that terastallized earlier and then switched out keeps that typing.
    const m = mon({speciesForme: 'Tornadus', teraType: 'Fairy', terastallized: true});
    expect(computeHazardFraction(m, stealthRockOnly, 9)).toBeCloseTo(1 / 8);
  });
});

describe('applySwitchInHazards', () => {
  it('leaves hpPercent untouched when nothing applies', () => {
    const m = mon({hpPercent: 0.6});
    expect(applySwitchInHazards(m, noHazards, 9).hpPercent).toBe(0.6);
  });

  it('subtracts the hazard fraction from hpPercent', () => {
    const m = mon({hpPercent: 0.6}); // pure Normal: SR fraction 1/8
    expect(applySwitchInHazards(m, stealthRockOnly, 9).hpPercent).toBeCloseTo(0.6 - 1 / 8);
  });

  it('floors at 0 rather than going negative', () => {
    const m = mon({hpPercent: 0.05}); // pure Normal: SR fraction 1/8 > 0.05
    expect(applySwitchInHazards(m, stealthRockOnly, 9).hpPercent).toBe(0);
  });

  it('leaves every other field untouched', () => {
    const m = mon({hpPercent: 0.6, item: 'Leftovers', ability: 'Thick Fat'});
    const adjusted = applySwitchInHazards(m, stealthRockOnly, 9);
    expect(adjusted.item).toBe('Leftovers');
    expect(adjusted.ability).toBe('Thick Fat');
    expect(adjusted.speciesForme).toBe('Snorlax');
  });
});
