// The feed, bound to the ports the core defines. No law lives here.
//
// `core/` owns what a still-possible set IS (`resolve.ts`), which ones an Illusion could be
// hiding (`illusion.ts`), and what a candidate's moves are (`knowledge.ts`). Each of those
// takes an already-chosen `RandbatsEntry`. Somebody has to find that entry — and finding it
// means reading the feed, which core may not do: `data/` is the shell side of that boundary,
// and `fitness/dependency-boundaries.test.ts` enforces the direction.
//
// So this is the adapter layer in the ports-and-adapters sense. It sits at the edge with the
// data source, hands core laws the entries they ask for, and exposes the results as the
// `DefenderVariantsFor` / `IncomingMovesFor` ports a surface consumes. The assumption-driven
// half of the same pair lives in `core/assume.ts`, which needs no feed to supply it.
//
// The tell that a function belongs here rather than in core is that it takes `RandbatsData`.
// The tell that it belongs in core instead is that it takes a `RandbatsEntry`.

import {resolveMon, resolveVariants} from '../core/resolve.js';
import {illusionSuspects, type IllusionSuspect} from '../core/illusion.js';
import {buildableAbilities} from '../core/narrow.js';
import {inferSets} from '../core/knowledge.js';
import {megaEntriesFor, megaEntryForItem, pickEntry} from './lookup.js';
import type {
  DefenderVariantsFor,
  IncomingMovesFor,
  IsStatusMove,
  LiveFacts,
  RandbatsData,
  RandbatsEntry,
  SetVariant,
} from '../core/types.js';

/**
 * The feed entry a Pokémon's set should be read from. A held Mega stone redirects to the
 * MEGA forme's entry — that Pokémon's real set is the Mega one, and reading the base
 * forme's would calculate the wrong stats for a Pokémon that is about to change shape.
 */
export function entryFor(data: RandbatsData, facts: LiveFacts): RandbatsEntry | undefined {
  return megaEntryForItem(data, facts.item) ?? pickEntry(data, facts.speciesForme);
}

/** A defender entry when the feed doesn't cover it: facts only, default spread. */
export function entryOrMinimal(entry: RandbatsEntry | undefined, facts: LiveFacts): RandbatsEntry {
  return entry ?? {level: facts.level, abilities: [], items: []};
}

/**
 * The Mega formes a Pokémon could still evolve into, or none once its item is settled: a
 * revealed item that is not a stone rules the evolution out, and so does a lost one.
 */
export function megaCandidatesFor(
  data: RandbatsData,
  facts: LiveFacts,
): readonly {forme: string; entry: RandbatsEntry}[] {
  if (facts.item !== undefined || facts.prevItem !== undefined) return [];
  return megaEntriesFor(data, facts.speciesForme);
}

/** Every species in the feed whose sets could be built with Illusion — the pool a disguise
 *  is drawn from. Scanned per hover; the feed is a few hundred entries. */
export function illusionHolders(data: RandbatsData): IllusionSuspect[] {
  return Object.keys(data)
    .map((species): IllusionSuspect | null => {
      const entry = pickEntry(data, species);
      return entry && buildableAbilities(entry).has('illusion') ? {species, entry} : null;
    })
    .filter((x): x is IllusionSuspect => x !== null);
}

/** Which of those the evidence actually implicates for this Pokémon. */
export function suspectsFor(
  facts: LiveFacts,
  entry: RandbatsEntry | undefined,
  data: RandbatsData,
): IllusionSuspect[] {
  return illusionSuspects(facts, entry, illusionHolders(data));
}

/**
 * Each implicated Zoroark as a defender variant of its own, resolved as ITSELF rather than
 * as a corrupted version of the species on screen.
 */
export function illusionVariants(
  defenderFacts: LiveFacts,
  defenderEntry: RandbatsEntry | undefined,
  data: RandbatsData,
): SetVariant[] {
  // The suspect is a DIFFERENT species than shown, so the shown forme's dex data
  // (facts.speciesData) must not ride along into the Zoroark's resolution.
  const {speciesData: _shownFormes, transformedInto: _notItsCopy, ...publicFacts} = defenderFacts;
  return suspectsFor(defenderFacts, defenderEntry, data).map(({species, entry}) => ({
    mon: resolveMon({...publicFacts, speciesForme: species, level: entry.level}, entry),
    role: species,
  }));
}

/** Every still-possible set for a foe: the hidden item/ability fan-out, plus any disguised
 *  Zoroark the reveals betray. Move-independent — the same pool answers "how hard does it
 *  get hit" and "how fast is it". */
export function randbatsFoeVariants(data: RandbatsData, facts: LiveFacts): readonly SetVariant[] {
  const entry = entryFor(data, facts);
  return [...resolveVariants(facts, entryOrMinimal(entry, facts)), ...illusionVariants(facts, entry, data)];
}

/** The feed-driven `DefenderVariantsFor`: every still-possible set, identical for every move. */
export function randbatsVariantsFor(data: RandbatsData): DefenderVariantsFor {
  return (facts) => {
    const variants = randbatsFoeVariants(data, facts);
    return () => variants;
  };
}

/**
 * The feed-driven `IncomingMovesFor`: the sets view's own per-role move knowledge, crossed
 * with `resolveVariants`' full item/ability fan-out — aligned by ROLE NAME, the same
 * alignment the sets view's per-candidate damage uses. Never a set's first-guessed item, so
 * a hidden Life Orb or Choice item splits an incoming line into labelled outcomes exactly
 * like the move tooltip's defender side.
 */
export function randbatsIncomingMovesFor(data: RandbatsData, isStatusMove: IsStatusMove): IncomingMovesFor {
  return (foeFacts) => {
    const entry = entryFor(data, foeFacts);
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
