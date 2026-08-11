// The randbats feed, wired to the port `core/possibilities.ts` declares. Only wiring lives
// here: every question this answers is "where in the feed is that", never "what does it
// mean".
//
// The line is which side a change belongs to. A feed that starts keying Mega formes
// differently, or ships a shape that needs fixing on the way in, is an edit HERE. What
// counts as a still-possible set, or which abilities could be hiding a Zoroark, is an edit
// in core. `core/` may not import `data/` at all, which is what makes the port necessary
// rather than merely tidy.

import type {SetSource} from '../core/possibilities.js';
import {megaEntriesFor, megaEntryForItem, pickEntry} from './lookup.js';
import type {LiveFacts, RandbatsData, RandbatsEntry} from '../core/types.js';

/**
 * A `SetSource` backed by a real feed.
 *
 * `entryFor` is where the feed's two irregularities are absorbed: a held Mega stone means
 * the Pokémon's real set is the MEGA forme's, whose key does not always follow from the base
 * species' name, and everything else resolves by species key. Core sees neither.
 *
 * The roster is enumerated once per source rather than once per call. Core asks for it
 * inside a per-hover filter, and normalising a few hundred entries on every hover is a cost
 * with nothing to show for it — the feed does not change under a source's feet, because
 * `fetchRandbats` hands back a new object rather than mutating this one.
 */
export function feedSource(data: RandbatsData): SetSource {
  let roster: readonly {species: string; entry: RandbatsEntry}[] | undefined;
  return {
    entryFor: (facts) => megaEntryForItem(data, facts.item) ?? pickEntry(data, facts.speciesForme),
    allEntries: () => {
      roster ??= Object.keys(data)
        .map((species) => ({species, entry: pickEntry(data, species)}))
        .filter((e): e is {species: string; entry: RandbatsEntry} => e.entry !== undefined);
      return roster;
    },
  };
}

/**
 * The Mega formes a Pokémon could still evolve into, or none once its item is settled: a
 * revealed item that is not a stone rules the evolution out, and so does a lost one.
 *
 * Not part of `SetSource` — nothing in core asks this. It is read straight by the Mega
 * preview, which is a surface concern rather than a set-inference one.
 */
export function megaCandidatesFor(
  data: RandbatsData,
  facts: LiveFacts,
): readonly {forme: string; entry: RandbatsEntry}[] {
  if (facts.item !== undefined || facts.prevItem !== undefined) return [];
  return megaEntriesFor(data, facts.speciesForme);
}
