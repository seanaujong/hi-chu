import {describe, it, expect} from 'vitest';
import {pickEntry} from './randbats.js';
import type {RandbatsData, RandbatsEntry} from '../core/types.js';

const entry = (level: number): RandbatsEntry => ({level, abilities: [], items: []});

const data: RandbatsData = {
  Dragonite: entry(74),
  Greninja: entry(76),
  'Tauros-Paldea-Combat': entry(80),
};

describe('pickEntry', () => {
  it('matches an exact forme key', () => {
    expect(pickEntry(data, 'Tauros-Paldea-Combat')?.level).toBe(80);
  });

  it('falls back to a base species when the exact forme is absent', () => {
    expect(pickEntry(data, 'Greninja-Bond')?.level).toBe(76); // Greninja-Bond → Greninja
  });

  it('returns undefined when nothing matches', () => {
    expect(pickEntry(data, 'Missingno')).toBeUndefined();
  });
});
