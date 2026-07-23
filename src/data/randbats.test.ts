import {describe, it, expect, vi, afterEach} from 'vitest';
import {fetchRandbats} from './randbats.js';
import {pickEntry} from './lookup.js';

describe('fetchRandbats keys the stat-point conversion on the format id', () => {
  afterEach(() => vi.unstubAllGlobals());

  const serve = (feed: unknown): void => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => feed})));
  };

  it('converts a champions feed but passes a mainline feed through untouched', async () => {
    // Same shape, two format ids: only the champions one is in stat points. A
    // mainline feed's evs ARE EVs (real gen9 sets override single stats), so a
    // blanket conversion would corrupt them — the format id is the discriminator.
    serve({Arbok: {level: 54, abilities: ['Intimidate'], items: ['Leftovers'], evs: {hp: 11}}});
    const champions = await fetchRandbats('gen9championsrandombattle');
    expect(pickEntry(champions!, 'Arbok')!.evs).toEqual({hp: 84});

    serve({Arbok: {level: 54, abilities: ['Intimidate'], items: ['Leftovers'], evs: {hp: 11}}});
    const mainline = await fetchRandbats('gen9randombattle');
    expect(pickEntry(mainline!, 'Arbok')!.evs).toEqual({hp: 11});
  });
});
