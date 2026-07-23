// Zoroark's Illusion makes it appear as a teammate — the client shows the disguise's
// species, so every calc and set-lookup is silently for the WRONG Pokémon until the
// Illusion breaks. We can't see through it directly (the client is fooled too), but a
// disguised Zoroark attacks with ITS OWN moves under the disguise's name. So a revealed
// move the shown species can't learn, but an Illusion mon can, means the thing on the
// field might really be that Illusion mon — surfaced as an extra candidate set/variant.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts, RandbatsEntry} from './types.js';
import {toId} from './facts.js';

/** Every move an entry can run, across roles (gen9) or the flat pool (older gens). */
function movePool(entry: RandbatsEntry): Set<string> {
  const roleMoves = entry.roles ? Object.values(entry.roles).flatMap((r) => r.moves) : [];
  return new Set([...roleMoves, ...(entry.moves ?? [])].map(toId));
}

/** A species (+ its entry) the hovered Pokémon might secretly be, via Illusion. */
export interface IllusionSuspect {
  readonly species: string;
  readonly entry: RandbatsEntry;
}

/**
 * Which `impostors` — the format's Illusion holders, discovered from the feed rather than
 * named here — could the hovered mon secretly be? One qualifies when a revealed move is
 * absent from the SHOWN species' pool but present in the impostor's — the classic Illusion
 * tell. Silent otherwise: a disguise mimicking only moves its cover also has is genuinely
 * undetectable, so we don't guess. Returns [] if the shown species isn't in the feed
 * (nothing to compare against) or is itself the impostor.
 */
export function illusionSuspects(
  facts: LiveFacts,
  shownEntry: RandbatsEntry | undefined,
  impostors: readonly IllusionSuspect[],
): IllusionSuspect[] {
  if (!shownEntry) return [];
  const shown = movePool(shownEntry);
  const foreign = facts.revealedMoves.map(toId).filter((m) => !shown.has(m));
  if (foreign.length === 0) return [];
  return impostors.filter(({species, entry}) => {
    if (toId(species) === toId(facts.speciesForme)) return false; // already revealed as this
    const pool = movePool(entry);
    return foreign.some((m) => pool.has(m));
  });
}
