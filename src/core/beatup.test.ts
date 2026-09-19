import {describe, it, expect} from 'vitest';
import {beatUpHitPowers} from './beatup.js';
import type {RosterMember} from './types.js';

const member = (over: Partial<RosterMember> & {speciesForme: string}): RosterMember => ({
  isSelf: false,
  fainted: false,
  hasStatus: false,
  ...over,
});

// Base Attack 95 → 5 + floor(95/10) = 14. Base Attack 65 → 5 + floor(65/10) = 11.
const baseAtkOf = (speciesForme: string): number | undefined =>
  ({Greninja: 95, Tentacruel: 65, Dragonite: 134}[speciesForme]);

describe('beatUpHitPowers', () => {
  it('hits once per eligible member, powered by that member\'s OWN base Attack', () => {
    const roster: RosterMember[] = [
      member({speciesForme: 'Greninja', isSelf: true}),
      member({speciesForme: 'Tentacruel'}),
    ];
    expect(beatUpHitPowers(roster, baseAtkOf)).toEqual([14, 11]);
  });

  it('excludes a fainted or statused TEAMMATE', () => {
    const roster: RosterMember[] = [
      member({speciesForme: 'Greninja', isSelf: true}),
      member({speciesForme: 'Tentacruel', fainted: true}),
      member({speciesForme: 'Dragonite', hasStatus: true}),
    ];
    expect(beatUpHitPowers(roster, baseAtkOf)).toEqual([14]);
  });

  it('counts the user itself regardless of its OWN fainted/status state', () => {
    // Can't really be fainted and still be attacking, but a paralyzed user that moved
    // anyway must still count — sim/data/moves.ts's onModifyMove exempts `ally === pokemon`
    // from both checks, unlike every other roster member.
    const roster: RosterMember[] = [member({speciesForme: 'Greninja', isSelf: true, hasStatus: true})];
    expect(beatUpHitPowers(roster, baseAtkOf)).toEqual([14]);
  });

  it('preserves roster order — hit 1 is the first eligible member, not sorted by power', () => {
    const roster: RosterMember[] = [
      member({speciesForme: 'Tentacruel'}),
      member({speciesForme: 'Dragonite', isSelf: true}),
    ];
    // Base Attack 134 → 5 + floor(134/10) = 18.
    expect(beatUpHitPowers(roster, baseAtkOf)).toEqual([11, 18]);
  });

  it('skips a member whose species the base-stat lookup does not know, rather than guessing', () => {
    const roster: RosterMember[] = [
      member({speciesForme: 'Greninja', isSelf: true}),
      member({speciesForme: 'Missingno'}),
    ];
    expect(beatUpHitPowers(roster, baseAtkOf)).toEqual([14]);
  });

  it('returns empty for an empty roster', () => {
    expect(beatUpHitPowers([], baseAtkOf)).toEqual([]);
  });
});
