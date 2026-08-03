import {describe, expect, it} from 'vitest';
import {bypassesSubstitute, hitsToBreak, substituteHP} from './substitute.js';

describe('substituteHP', () => {
  it('is a quarter of the maker’s max HP, rounded down', () => {
    expect(substituteHP(288)).toBe(72);
    expect(substituteHP(290)).toBe(72); // 72.5 floors, as the sim's own Math.floor does
    expect(substituteHP(291)).toBe(72);
    expect(substituteHP(292)).toBe(73);
  });

  it('sizes on whoever MADE it, which Shed Tail makes a different Pokémon', () => {
    // A Cyclizar (maxHP 300) hands its sub to a Gliscor (maxHP 260). The doll keeps the
    // 75 HP it was built with; sizing it on the Gliscor standing behind it would say 65.
    expect(substituteHP(300)).toBe(75);
    expect(substituteHP(260)).toBe(65);
  });
});

describe('hitsToBreak', () => {
  const uniform = (min: number, max: number) => [{min, max}];

  it('takes one hit when even the weakest roll overwhelms the sub', () => {
    expect(hitsToBreak(uniform(122, 145), 72)).toEqual({min: 1, max: 1});
  });

  it('reaches its two ends by the two extreme rolls', () => {
    // 72 HP against 25–30 per hit: three maximum rolls (90) break it, three minimum ones
    // (75) also do — but a sub of 76 would need four of the weak ones.
    expect(hitsToBreak(uniform(25, 30), 72)).toEqual({min: 3, max: 3});
    expect(hitsToBreak(uniform(25, 30), 76)).toEqual({min: 3, max: 4});
  });

  it('needs the cumulative total to REACH the sub’s HP, not exceed it', () => {
    expect(hitsToBreak(uniform(36, 36), 72)).toEqual({min: 2, max: 2});
    expect(hitsToBreak(uniform(36, 36), 73)).toEqual({min: 3, max: 3});
  });

  it('is not fooled by a hit bigger than the sub — damage never spills over', () => {
    // One Boomburst-sized roll into a 72 HP sub breaks it and stops; the 300 damage it
    // "would" have done reaches nobody, which is exactly why the count is 1 and not less.
    expect(hitsToBreak(uniform(300, 350), 72)).toEqual({min: 1, max: 1});
  });

  it('accumulates an ESCALATING move hit by hit, not by its biggest hit', () => {
    // Triple Axel: 20/40/60 base power, so its rolls climb. Against a 72 HP sub the true
    // answer is 3 (18+36+54 = 108 reaches it; 18+36 = 54 does not). Dividing 72 by the
    // strongest hit would have claimed 2, a break the move cannot actually deliver.
    const tripleAxel = [{min: 18, max: 20}, {min: 36, max: 40}, {min: 54, max: 60}];
    expect(hitsToBreak(tripleAxel, 72)).toEqual({min: 3, max: 3});
    expect(hitsToBreak(tripleAxel, 55)).toEqual({min: 2, max: 3});
  });

  it('repeats the last entry for a uniform move’s later hits', () => {
    expect(hitsToBreak(uniform(25, 30), 145)).toEqual({min: 5, max: 6});
  });

  it('says nothing at all when the move cannot dent it', () => {
    expect(hitsToBreak(uniform(0, 0), 72)).toBeUndefined(); // an immune defender rolls zero
    expect(hitsToBreak(uniform(20, 25), 0)).toBeUndefined();
    expect(hitsToBreak([], 72)).toBeUndefined();
  });
});

describe('bypassesSubstitute', () => {
  const sound = (name: string) => ({name, isSound: true});
  const plain = (name: string) => ({name, isSound: false});

  it('lets every sound move through', () => {
    expect(bypassesSubstitute(sound('Boomburst'), 'Frisk')).toBe(true);
    expect(bypassesSubstitute(sound('Hyper Voice'), undefined)).toBe(true);
  });

  it('stops an ordinary move at the sub', () => {
    expect(bypassesSubstitute(plain('Waterfall'), 'Torrent')).toBe(false);
    expect(bypassesSubstitute(plain('Tachyon Cutter'), undefined)).toBe(false);
  });

  it('lets the three non-sound bypassers through', () => {
    // The remainder of Showdown's `bypasssub` flag once `sound` has covered the rest.
    expect(bypassesSubstitute(plain('Spectral Thief'), undefined)).toBe(true);
    expect(bypassesSubstitute(plain('Hyperspace Fury'), undefined)).toBe(true);
    expect(bypassesSubstitute(plain('Hyperspace Hole'), undefined)).toBe(true);
  });

  it('lets INFILTRATOR carry any move through', () => {
    expect(bypassesSubstitute(plain('Waterfall'), 'Infiltrator')).toBe(true);
    // The own-side reads hand abilities over in id form, so both spellings must land.
    expect(bypassesSubstitute(plain('Waterfall'), 'infiltrator')).toBe(true);
  });

  it('matches move names by id, so an id-form move name still bypasses', () => {
    expect(bypassesSubstitute(plain('spectralthief'), undefined)).toBe(true);
  });
});
