// A family of set-shape laws, the same kind `restitem.ts` and `choiceitems.ts` state: a
// move forces a specific item, because `data/random-battles/gen9/teams.ts`'s
// `getPriorityItem` hands one out on sight of it, well before the generic item logic ever
// runs. Read both ways, like the two files next door — the move revealed narrows the item,
// and the item settled on something else rules the move back out.
//
// WHY EACH ONE HOLDS. Five moves get an item unconditionally or with one ability escape:
//
//     if (moves.has('courtchange') || …) return 'Heavy-Duty Boots';
//     if (… || moves.has('bellydrum') || moves.has('filletaway')) return 'Sitrus Berry';
//     if (moves.has('meteorbeam') || …) return 'Power Herb';
//     if (moves.has('shellsmash') && ability !== 'Weak Armor') return 'White Herb';
//     if (moves.has('auroraveil') || (lightscreen && reflect)) return 'Light Clay';
//
// (The Light Screen + Reflect half of the last branch is a conjunction of two moves rather
// than a single one, and this file does not state it — see WHAT THIS DELIBERATELY DOES NOT
// COVER.) A sixth, Guts/Facade → an orb, shares the shape but not a fixed target — see
// `possibleOrbs` below.
//
// MEASURED, NOT REASONED. Reading the branch is not proof any more than it was for
// `choiceitems.ts` — a role can reach a DIFFERENT, earlier branch first (an evolution-stage
// override, a species carve-out, a Mega/Z-crystal requirement) and never arrive at any of
// these at all. So every rule here is checked the same way `choiceitems.ts`'s confirmation
// is: sampled per (format, species, role) across every generation `pkmn.github.io/randbats`
// publishes, requiring an ALL-OR-NOTHING outcome — never a genuine per-instance mix — before
// trusting it to narrow. The measured exceptions (`EXCUSED_ABILITIES` below) are what came
// out of that: Ice Face keeps Salac Berry over Sitrus on a Belly Drum set, Weak Armor and
// Solid Rock both keep something else over White Herb on a Shell Smash set. Nothing else
// broke the all-or-nothing property in a run of 90,000 sets per format.
//
// THE GIMMICK-ITEM ESCAPE. Aurora Veil and Shell Smash showed one more real exception each,
// and it is not an ability at all: a Mega-capable role sometimes keeps its stone (Barbaracle
// holding Barbaracite over White Herb, Abomasnow holding Abomasite over Light Clay) because
// `species.requiredItems` short-circuits every branch below it, stone or not, the moment the
// role happens to build as the Mega. `allowGimmickItems` is the fix: it lets a Mega stone or
// Z-crystal already in the pool survive the narrowing alongside the forced item, rather than
// being hardcoded per species — the same reasoning that keeps `restitem.ts` from hardcoding
// Giratina or an evolution-stage override (require the ALTERNATIVE to already be a real,
// declared possibility, and it takes care of itself).
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts} from './types.js';
import {toId, innateAbility} from './facts.js';

/**
 * Is `item` a Mega stone or a Z-crystal — the two families of item the generator's own
 * `species.requiredItems` can force ahead of every rule in this file? Deliberately
 * reimplemented rather than imported from `knowledge.ts`'s identical check: `knowledge.ts`
 * imports `narrow.ts`, which will import this file, and importing the other way would be a
 * cycle over a two-line regex.
 */
function isGimmickItem(item: string): boolean {
  const isMegaStone = item !== 'Eviolite' && /ite( [XY])?$/.test(item);
  const isZCrystal = item.endsWith(' Z');
  return isMegaStone || isZCrystal;
}

/** Could an ability from `excuses` still be in play? Judged against the known innate
 *  ability, else against everything a role could still be running — the "never lie" guard
 *  every set-shape and behavioural ability check in this codebase takes. */
function excusedByAbility(facts: LiveFacts, roleAbilities: readonly string[], excuses: ReadonlySet<string>): boolean {
  const known = innateAbility(facts);
  if (known !== undefined) return excuses.has(toId(known));
  return roleAbilities.some((a) => excuses.has(toId(a)));
}

interface SimpleRule {
  readonly triggerMoves: ReadonlySet<string>;
  readonly item: string;
  readonly excusedAbilities?: ReadonlySet<string>;
  readonly allowGimmickItems?: boolean;
}

const SIMPLE_RULES: readonly SimpleRule[] = [
  {triggerMoves: new Set(['courtchange']), item: 'heavydutyboots'},
  {triggerMoves: new Set(['bellydrum', 'filletaway']), item: 'sitrusberry', excusedAbilities: new Set(['iceface'])},
  {triggerMoves: new Set(['meteorbeam']), item: 'powerherb'},
  {triggerMoves: new Set(['auroraveil']), item: 'lightclay', allowGimmickItems: true},
  {
    triggerMoves: new Set(['shellsmash']), item: 'whiteherb', allowGimmickItems: true,
    excusedAbilities: new Set(['weakarmor', 'solidrock']),
  },
];

function ruleTriggered(rule: SimpleRule, revealedMoves: readonly string[]): boolean {
  return revealedMoves.some((m) => rule.triggerMoves.has(toId(m)));
}

function ruleApplies(
  rule: SimpleRule,
  declaredItems: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): boolean {
  if (!declaredItems.some((i) => toId(i) === rule.item)) return false;
  if (rule.excusedAbilities && excusedByAbility(facts, roleAbilities, rule.excusedAbilities)) return false;
  return true;
}

/**
 * Direction one, over every `SIMPLE_RULES` entry at once: the item pool narrowed by
 * whichever of these moves has been revealed. Applied in sequence — in practice at most one
 * rule ever matters for a given role, since their trigger moves come from disjoint set
 * archetypes — and each narrowing keeps a gimmick item already in the pool alongside the
 * forced one where `allowGimmickItems` says to, never emptying either way.
 */
export function itemsUnderRevealedMoveRules(
  declaredItems: readonly string[],
  survivingItems: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): readonly string[] {
  let pool = survivingItems;
  for (const rule of SIMPLE_RULES) {
    if (!ruleTriggered(rule, facts.revealedMoves)) continue;
    if (!ruleApplies(rule, declaredItems, facts, roleAbilities)) continue;
    const keep = new Set([rule.item, ...(rule.allowGimmickItems ? pool.filter(isGimmickItem).map(toId) : [])]);
    const narrowed = pool.filter((i) => keep.has(toId(i)));
    if (narrowed.length > 0) pool = narrowed;
  }
  return pool;
}

/**
 * Direction two: the moves a role could still be running, with a `SIMPLE_RULES` trigger
 * move dropped once the surviving item pool has settled away from its forced item — and
 * away from any gimmick item it permits alongside it — for a role the rule genuinely
 * applies to. Never emptied.
 */
export function movesUnderSettledMoveRuleItem(
  movePool: readonly string[],
  declaredItems: readonly string[],
  survivingItems: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): readonly string[] {
  if (survivingItems.length === 0) return movePool;
  let pool = movePool;
  for (const rule of SIMPLE_RULES) {
    const settledOnItem = survivingItems.some((i) => toId(i) === rule.item);
    const settledOnGimmick = (rule.allowGimmickItems ?? false) && survivingItems.some(isGimmickItem);
    if (settledOnItem || settledOnGimmick) continue;
    if (!ruleApplies(rule, declaredItems, facts, roleAbilities)) continue;
    const narrowed = pool.filter((m) => !rule.triggerMoves.has(toId(m)));
    if (narrowed.length > 0) pool = narrowed;
  }
  return pool;
}

// --- Guts / Facade → an orb --------------------------------------------------------------
//
// The sixth rule shares the shape above but not a fixed target, so it lives on its own:
//
//     if ((ability === 'Guts' || moves.has('facade')) && !moves.has('sleeptalk')) {
//       return (types.has('Fire') || ability === 'Toxic Boost') ? 'Toxic Orb' : 'Flame Orb';
//     }
//
// Two things separate its trigger from `SIMPLE_RULES`': an ABILITY alone can fire it (Guts
// needs no move at all), and Sleep Talk excuses it the same way it excuses `restitem.ts`'s
// Rest — checked against the ROLE's own move pool, not what has been revealed, so a role
// with no Sleep Talk to offer never needs to wait for the fourth move slot. Poison Heal and
// Quick Feet are excused for a different reason than Weak Armor above: they don't escape
// this branch, they reach Toxic Orb through an EARLIER, unconditional one of their own
// (`ability === 'Poison Heal' || ability === 'Quick Feet') return 'Toxic Orb'`), so folding
// them into the type check here would occasionally compute the wrong orb for the right item.

const FACADE_ID = 'facade';
const SLEEP_TALK_ID = 'sleeptalk';
const GUTS_ID = 'guts';
const TOXIC_BOOST_ID = 'toxicboost';
const GUTS_FACADE_EXCUSES: ReadonlySet<string> = new Set(['poisonheal', 'quickfeet']);

/** Every orb this Pokémon's Guts/Facade set could still resolve to. Fire typing is read off
 *  the species (always known, never speculative), so it settles the answer outright; an
 *  unknown ability defers to whether Toxic Boost is even a possibility for this role
 *  ("never lie") rather than guessing Flame Orb. */
function possibleOrbs(facts: LiveFacts, roleAbilities: readonly string[]): ReadonlySet<string> {
  const known = innateAbility(facts);
  if (known !== undefined && toId(known) === TOXIC_BOOST_ID) return new Set(['toxicorb']);
  const types = facts.speciesData?.types;
  if (types === undefined) return new Set(['toxicorb', 'flameorb']);
  if (types.some((t) => toId(t) === 'fire')) return new Set(['toxicorb']);
  if (known !== undefined) return new Set(['flameorb']);
  return roleAbilities.some((a) => toId(a) === TOXIC_BOOST_ID) ? new Set(['toxicorb', 'flameorb']) : new Set(['flameorb']);
}

function gutsFacadeTriggered(facts: LiveFacts): boolean {
  const known = innateAbility(facts);
  return facts.revealedMoves.some((m) => toId(m) === FACADE_ID) || (known !== undefined && toId(known) === GUTS_ID);
}

/**
 * The item pool narrowed to whichever orb(s) a triggered Guts/Facade set could still hold
 * — never emptied. Forward direction only: unlike the moves above, Facade sits beside a
 * dozen ordinary attacks on most of these roles, so ruling it out from a settled non-orb
 * item buys little, and Guts is an ABILITY, which this file's item-pool narrowing has no
 * business pinning or releasing (`narrow.buildableAbilities` already owns that).
 */
export function itemsUnderGutsOrFacade(
  declaredItems: readonly string[],
  survivingItems: readonly string[],
  movePool: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): readonly string[] {
  if (movePool.some((m) => toId(m) === SLEEP_TALK_ID)) return survivingItems;
  if (!gutsFacadeTriggered(facts)) return survivingItems;
  if (excusedByAbility(facts, roleAbilities, GUTS_FACADE_EXCUSES)) return survivingItems;
  const targets = possibleOrbs(facts, roleAbilities);
  if (!declaredItems.some((i) => targets.has(toId(i)))) return survivingItems;
  const narrowed = survivingItems.filter((i) => targets.has(toId(i)));
  return narrowed.length > 0 ? narrowed : survivingItems;
}

// WHAT THIS DELIBERATELY DOES NOT COVER.
//
// Light Screen AND Reflect together also force Light Clay, but as a CONJUNCTION of two
// moves rather than one — the shape every rule above assumes. Ruling either move out once
// the item settles away from Light Clay would be a real claim ("not both together"), but
// dropping either individually would be a false one (each is still fine alone), and this
// file's narrowing has no way to state "not both" over a move pool built for "any of
// these". Left uncovered rather than force-fit into the wrong shape.
//
// Acrobatics forcing NO item (`moves.has('acrobatics') && ability !== 'Protosynthesis'`) is
// measured and clean, but every current gen9-family role that carries it already resolves
// to a single-item pool for an unrelated reason (Unburden and Shields Down both reach an
// earlier branch of their own, Protosynthesis IS the exception) — so `candidateItems`
// already shows the right answer with nothing left for this file to narrow. Revisit if the
// feed ever adds a role where Acrobatics sits in a genuinely multi-item pool.
