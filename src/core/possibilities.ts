// What a Pokémon could still BE, given a set feed — the laws, with the feed held at arm's
// length behind a port this module declares.
//
// Every law here needs an already-chosen `RandbatsEntry`, and choosing one means reading the
// feed: matching a species key, following a held Mega stone to the forme it becomes, fixing
// the shapes a real feed ships. None of that is domain reasoning and all of it is the data
// layer's business, which `core/` may not import. So the shape of the answer is declared
// here and the answering is somebody else's job (`data/suppliers.ts` is the one that reads
// the real feed; a test supplies a literal).
//
// The split between the two is not "pure vs impure" — `data/lookup.ts` is perfectly pure —
// but which side a change belongs to. A feed that starts keying Megas differently is a
// `SetSource` change. A change to which abilities can hide a Zoroark, or to what counts as
// a still-possible set, is a change here. That is why `SetSource` enumerates the feed rather
// than pre-filtering it: the enumeration is the feed's business, the filtering is this file's.

import {buildableAbilities} from './narrow.js';
import {illusionSuspects, type IllusionSuspect} from './illusion.js';
import {inferSets} from './knowledge.js';
import {resolveMon, resolveVariants} from './resolve.js';
import type {
  DefenderVariantsFor,
  IncomingMovesFor,
  IsStatusMove,
  LiveFacts,
  RandbatsEntry,
  SetVariant,
} from './types.js';

/** How a Pokémon's own feed entry is found — the one question core cannot answer itself. */
export type EntryFor = (facts: LiveFacts) => RandbatsEntry | undefined;

/**
 * Everything these laws need from a set feed, and nothing about where it came from.
 *
 * `allEntries` hands over the feed's whole roster rather than any particular subset, because
 * every use of it here is a FILTER whose rule belongs to this module. Handing back a
 * pre-filtered pool would move that rule to the adapter, where a change to it would be an
 * edit in `data/` — the wrong side of the line this port exists to draw.
 */
export interface SetSource {
  readonly entryFor: EntryFor;
  readonly allEntries: () => readonly {readonly species: string; readonly entry: RandbatsEntry}[];
}

/** A defender entry when the feed doesn't cover it: facts only, default spread. */
export function entryOrMinimal(entry: RandbatsEntry | undefined, facts: LiveFacts): RandbatsEntry {
  return entry ?? {level: facts.level, abilities: [], items: []};
}

/** The species a disguise could be drawn from: those whose sets could be BUILT with
 *  Illusion, which is not the same as those the dex allows it on. */
function illusionHolders(source: SetSource): IllusionSuspect[] {
  return source
    .allEntries()
    .filter(({entry}) => buildableAbilities(entry).has('illusion'))
    .map(({species, entry}) => ({species, entry}));
}

/** Which species the evidence actually implicates for this Pokémon — the candidate blocks
 *  need them as sources of their own, not only as defender variants. */
export function suspectsFor(
  facts: LiveFacts,
  entry: RandbatsEntry | undefined,
  source: SetSource,
): IllusionSuspect[] {
  return illusionSuspects(facts, entry, illusionHolders(source));
}

/**
 * Each Zoroark the evidence implicates, as a defender variant of its own — resolved as
 * ITSELF rather than as a corrupted version of the species on screen.
 */
export function illusionVariants(
  defenderFacts: LiveFacts,
  defenderEntry: RandbatsEntry | undefined,
  source: SetSource,
): SetVariant[] {
  // The suspect is a DIFFERENT species than shown, so the shown forme's dex data
  // (facts.speciesData) must not ride along into the Zoroark's resolution.
  const {speciesData: _shownFormes, transformedInto: _notItsCopy, ...publicFacts} = defenderFacts;
  return suspectsFor(defenderFacts, defenderEntry, source).map(({species, entry}) => ({
    mon: resolveMon({...publicFacts, speciesForme: species, level: entry.level}, entry),
    role: species,
  }));
}

/** Every still-possible set for a foe: the hidden item/ability fan-out, plus any disguised
 *  Zoroark the reveals betray. Move-independent — the same pool answers "how hard does it
 *  get hit" and "how fast is it". */
export function foeVariants(source: SetSource, facts: LiveFacts): readonly SetVariant[] {
  const entry = source.entryFor(facts);
  return [...resolveVariants(facts, entryOrMinimal(entry, facts)), ...illusionVariants(facts, entry, source)];
}

/** The feed-backed `DefenderVariantsFor`: every still-possible set, identical for every move
 *  — where the open-format adapter (`assume.openVariantsFor`) must vary with the move's
 *  category, because a bracketed spread is chosen per axis. */
export function variantsFor(source: SetSource): DefenderVariantsFor {
  return (facts) => {
    const variants = foeVariants(source, facts);
    return () => variants;
  };
}

/**
 * The feed-backed `IncomingMovesFor`: per-role move knowledge crossed with `resolveVariants`'
 * full item/ability fan-out, aligned by ROLE NAME — the same alignment the sets view's
 * per-candidate damage uses. Never a set's first-guessed item, so a hidden Life Orb or
 * Choice item splits an incoming line into labelled outcomes exactly like the move tooltip's
 * defender side.
 */
export function incomingMovesFor(source: SetSource, isStatusMove: IsStatusMove): IncomingMovesFor {
  return (foeFacts) => {
    const entry = source.entryFor(foeFacts);
    if (!entry) return [];
    const knowledge = inferSets(foeFacts, entry, isStatusMove);
    const variants = resolveVariants(foeFacts, entry);
    const seen = new Map<string, {known: boolean; roles: Set<string>}>();
    for (const c of knowledge.candidates) {
      for (const m of c.moves) {
        const cur = seen.get(m.name) ?? {known: false, roles: new Set<string>()};
        cur.known = cur.known || m.known;
        cur.roles.add(c.name);
        seen.set(m.name, cur);
      }
    }
    return [...seen.entries()].map(([move, {known, roles}]) => ({
      move,
      known,
      variants: variants.filter((v) => roles.has(v.role)),
    }));
  };
}
