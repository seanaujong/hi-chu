// The information game: what can be deduced about a Pokémon's set from public reveals,
// kept whole per candidate (which item goes with which moves is the information), reveals
// marked. This is the display side — `inferSets` narrows through narrow.ts, then renders
// each surviving role's options; the calc never sees these speculative values.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {Gimmick, KnownOption, LiveFacts, RandbatsEntry, RandbatsRole, SetKnowledge} from './types.js';
import {toId, innateAbility} from './facts.js';
import {selectRoles} from './narrow.js';
import {survivingItems} from './deductions.js';

/** Union a pool into options, confirmed names first; dedup by id, keep display names. */
function unionOptions(pool: readonly string[], confirmed: readonly string[]): KnownOption[] {
  const seen = new Map<string, KnownOption>();
  for (const name of confirmed) if (!seen.has(toId(name))) seen.set(toId(name), {name, known: true});
  for (const name of pool) if (!seen.has(toId(name))) seen.set(toId(name), {name, known: false});
  return [...seen.values()];
}

/**
 * An exclusive dimension (ability, item, Tera type): once one value is confirmed,
 * the alternatives are no longer possible — unlike moves, where a confirmed move
 * only fills one of four slots.
 */
function exclusiveOptions(pool: readonly string[], confirmed: readonly string[]): KnownOption[] {
  if (confirmed.length > 0) return unionOptions([], confirmed);
  return unionOptions(pool, []);
}

/**
 * A held item is a Mega stone if it ends in "-ite" (optionally with an " X"/" Y"
 * variant). Eviolite is the one -ite item that isn't a stone, so it's excluded.
 */
function isMegaStone(item: string): boolean {
  return item !== 'Eviolite' && /ite( [XY])?$/.test(item);
}

/** A held item is a Z-crystal (gen7) if it ends in " Z" — "Firium Z",
 *  "Ultranecrozium Z". No non-crystal item ends that way, so the rule is exact. */
function isZCrystal(item: string): boolean {
  return / Z$/.test(item);
}

/** "Charizard" + "Charizardite Y" → "Charizard-Mega-Y". Species names the base; the
 *  stone's X/Y suffix names the variant (stone→species is irregular, species→forme
 *  is not, so we key off the hovered species, not the stone's prefix). */
function megaForme(baseSpecies: string, stone: string): string {
  const variant = / X$/.test(stone) ? '-X' : / Y$/.test(stone) ? '-Y' : '';
  return `${baseSpecies}-Mega${variant}`;
}

/**
 * Derive the transformations a candidate can perform from its already-resolved
 * dimensions. Tera is a genuine feed dimension; Mega is read out of the item
 * options (a stone implies the Mega). Dynamax has no set-data trigger, so it never
 * appears here — honest silence beats an invented line.
 */
function deriveGimmicks(items: readonly KnownOption[], teraTypes: readonly KnownOption[], baseSpecies: string): Gimmick[] {
  const gimmicks: Gimmick[] = [];
  if (teraTypes.length > 0) gimmicks.push({kind: 'tera', types: teraTypes});
  for (const item of items) {
    if (isMegaStone(item.name)) gimmicks.push({kind: 'mega', stone: item, forme: megaForme(baseSpecies, item.name)});
    else if (isZCrystal(item.name)) gimmicks.push({kind: 'zmove', crystal: item});
  }
  return gimmicks;
}

/** The hovered species with any live Mega/Tera forme suffix stripped, so a set's
 *  DERIVED Mega forme reads from the base ("Charizard-Mega-Y" → base "Charizard"). */
function baseSpecies(speciesForme: string): string {
  return speciesForme.replace(/-Mega(-[XY])?$/, '');
}

/**
 * Everything deducible about a Pokémon's set from public reveals: narrow the roles
 * with the same evidence rule the calc uses, and keep each surviving candidate
 * WHOLE (which item goes with which moves is the information), reveals marked.
 * Role-less gen ≤ 8 entries become a single unnamed candidate from the entry pools.
 */
export function inferSets(facts: LiveFacts, entry: RandbatsEntry): SetKnowledge {
  const {candidates, names, uncertain} = selectRoles(entry, facts);
  const totalRoles = entry.roles ? Object.keys(entry.roles).length : 0;

  const revealedItem = facts.item ?? facts.prevItem;
  const revealedAbility = innateAbility(facts);
  const activeTera = facts.terastallized && facts.teraType ? [facts.teraType] : [];
  const species = baseSpecies(facts.speciesForme);
  // A Pokémon has exactly four move slots, so once four are revealed the moveset is fully
  // known — the rest of the role's pool is no longer possible, so we stop speculating.
  const fullMoveset = facts.revealedMoves.length >= 4;

  const toCandidate = (name: string, role: RandbatsRole): SetKnowledge['candidates'][number] => {
    const items = exclusiveOptions(survivingItems(role.abilities, role.items, facts), revealedItem ? [revealedItem] : []);
    const teraTypes = exclusiveOptions(role.teraTypes, activeTera);
    return {
      name,
      abilities: exclusiveOptions(role.abilities, revealedAbility ? [revealedAbility] : []),
      items,
      moves: unionOptions(fullMoveset ? [] : role.moves, facts.revealedMoves),
      gimmicks: deriveGimmicks(items, teraTypes, species),
    };
  };

  const sets =
    candidates.length > 0
      ? candidates.map((role, i) => toCandidate(names[i] ?? '', role))
      : [
          toCandidate('', {
            abilities: entry.abilities,
            items: entry.items,
            teraTypes: entry.teraTypes ?? [],
            moves: entry.moves ?? [],
          }),
        ];

  return {
    candidates: sets,
    totalRoles,
    ...(uncertain ? {uncertainReason: uncertain} : {}),
  };
}
