import {describe, it, expect} from 'vitest';
import {illusionSuspects, type IllusionSuspect} from './illusion.js';
import {liveFacts} from './sets.testfixtures.js';
import type {RandbatsEntry} from './types.js';

const NOIVERN: RandbatsEntry = {
  level: 80,
  abilities: ['Frisk'],
  items: [],
  roles: {R: {abilities: ['Frisk'], items: ['Choice Specs'], teraTypes: [], moves: ['Boomburst', 'Draco Meteor', 'Flamethrower', 'Hurricane']}},
};
// Real Zoroark-Hisui moves from the Champions feed; Bitter Malice is one Noivern can't learn.
const ZOROARK_H: RandbatsEntry = {
  level: 49,
  abilities: ['Illusion'],
  items: ['Life Orb'],
  roles: {R: {abilities: ['Illusion'], items: ['Life Orb'], teraTypes: [], moves: ['Bitter Malice', 'Flamethrower', 'Focus Blast', 'Nasty Plot']}},
};
const impostors: IllusionSuspect[] = [{species: 'Zoroark-Hisui', entry: ZOROARK_H}];
const shownAs = (speciesForme: string, revealedMoves: string[]) => liveFacts({speciesForme, revealedMoves});

describe('illusionSuspects', () => {
  it('flags Zoroark when a revealed move fits it but not the shown species', () => {
    const s = illusionSuspects(shownAs('Noivern', ['Flamethrower', 'Bitter Malice']), NOIVERN, impostors);
    expect(s.map((x) => x.species)).toEqual(['Zoroark-Hisui']);
  });

  it('is silent when every revealed move fits the shown species', () => {
    expect(illusionSuspects(shownAs('Noivern', ['Flamethrower', 'Hurricane']), NOIVERN, impostors)).toEqual([]);
  });

  it('is silent for a foreign move that no impostor explains', () => {
    // Spacial Rend is neither a Noivern nor a Zoroark-Hisui move — no Illusion signal.
    expect(illusionSuspects(shownAs('Noivern', ['Spacial Rend']), NOIVERN, impostors)).toEqual([]);
  });

  it('does not flag a mon already revealed as the impostor', () => {
    expect(illusionSuspects(shownAs('Zoroark-Hisui', ['Bitter Malice']), ZOROARK_H, impostors)).toEqual([]);
  });

  it('is silent when the shown species is not in the feed (nothing to compare)', () => {
    expect(illusionSuspects(shownAs('Missingno', ['Bitter Malice']), undefined, impostors)).toEqual([]);
  });
});
