// The set-shape law: a random-battle set running Rest without Sleep Talk holds Chesto
// Berry — nothing else — and that fact reads both ways, the same two directions
// `choiceitems.ts` reads its own law in. Rest revealed narrows the item down to Chesto
// Berry; an item confirmed to be something else rules Rest back out of the moves such a
// set could still be running.
//
// WHY IT HOLDS. `data/random-battles/gen9/teams.ts`'s `getPriorityItem` carries it almost
// verbatim:
//
//     if (moves.has('rest') && !moves.has('sleeptalk') &&
//         ability !== 'Natural Cure' && ability !== 'Shed Skin') {
//       return 'Chesto Berry';
//     }
//
// Sleep Talk is the one thing that keeps a Rest user out of this branch on purpose — a
// RestTalk set sleeps through the turn Rest cost it, so it never needed a berry to wake it
// up — and it is checked against the ROLE's own move pool, not the moves already revealed:
// a role whose pool has no Sleep Talk to offer can never take that escape, so seeing Rest
// used is enough on its own, with no need to wait for the fourth move slot to rule Sleep
// Talk out by exhaustion.
//
// TWO EXCEPTIONS ARE MEASURED AWAY, NOT HARDCODED. Two other things skip this branch
// entirely — a not-fully-evolved species (`species.nfe` returns Eviolite earlier in the
// same function) and Giratina by name (its own carve-out one line above, keeping
// Leftovers) — and this file encodes NEITHER of them. It doesn't need to: the feed a role's
// `items` pool describes is not a guess, it is a record of what the generator actually
// produced across many real sets, so an evolution-stage override or a species carve-out
// shows up as a pool that never contained Chesto Berry to begin with. Requiring Chesto
// Berry to already be a live possibility for a role — the `poolHasChestoBerry` guard below
// — makes both exceptions fall out for free, the same way `narrow.buildableAbilities`
// lets the feed itself say which abilities a set could ever have been built with instead
// of a hand-kept list.
//
// The one thing that guard can't see is a role whose ABILITY pool mixes an excused ability
// with a plain one — the pool could then hold Chesto Berry from the plain-ability sets and
// something else from the excused ones, and only the ability actually in play tells them
// apart. That is what `excusedByAbility` is for, judged against the known innate ability,
// else against everything the role could still be running ("never lie", the same guard
// every rule in `deductions.ts` takes).
//
// MEASURED, NOT REASONED. `npm run rest-item-exclusions` samples every gen9-family format
// `pkmn.github.io/randbats` publishes and reproduces this. The run of record:
//
//     2,639 Rest-without-Sleep-Talk sets. Every one that did NOT get Chesto Berry was
//     explained by an NFE species (Happiny, Phantump, Scraggy, Dratini, Silicobra),
//     Giratina, or an ability in RECOVERY_EXCUSES below. Nothing else ever showed up.
//
// Every OTHER generation is out of scope on purpose, not by oversight — and not because
// they lack `roles`: every generation but gen1 and Let's Go carries the same per-role feed
// shape (`types.ts`'s `RandbatsEntry`). What they don't share is this LAW: gen1-3 have no
// Chesto Berry branch at all, and gen4 (Shuckle) and gen6/7 (Hydration) hand-carve their
// own extra exceptions RECOVERY_EXCUSES does not enumerate. The `poolHasChestoBerry` guard
// below likely keeps this safe there anyway — a generation with no such branch, or a
// species carved out of it by name, simply never puts Chesto Berry in that role's declared
// pool for this file to narrow toward — but "likely keeps it safe" is exactly the kind of
// claim this file's own header insists on measuring rather than reasoning through, so the
// exception list and `npm run rest-item-exclusions` stay scoped to the formats it actually
// covers until someone does that measurement.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts} from './types.js';
import {toId, innateAbility} from './facts.js';

const CHESTO_BERRY_ID = 'chestoberry';
const REST_ID = 'rest';
const SLEEP_TALK_ID = 'sleeptalk';

/**
 * Abilities that cure a self-inflicted Rest sleep for free, so gen9's generator never
 * bothers arming Chesto Berry for them — read directly off `getPriorityItem`'s own guard
 * (see file header), not recalled.
 */
const RECOVERY_EXCUSES: ReadonlySet<string> = new Set(['naturalcure', 'shedskin']);

function poolHasSleepTalk(movePool: readonly string[]): boolean {
  return movePool.some((m) => toId(m) === SLEEP_TALK_ID);
}

function poolHasChestoBerry(itemPool: readonly string[]): boolean {
  return itemPool.some((i) => toId(i) === CHESTO_BERRY_ID);
}

/** Could an ability that excuses the forcing still be in play? Judged against the known
 *  innate ability, else against everything this role could still be running. */
function excusedByAbility(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  const known = innateAbility(facts);
  if (known !== undefined) return RECOVERY_EXCUSES.has(toId(known));
  return roleAbilities.some((a) => RECOVERY_EXCUSES.has(toId(a)));
}

/** The shared gate both directions need before either can speak: Sleep Talk must be off
 *  the table for this role, Chesto Berry must already be a live possibility for it (see
 *  file header — this is what stands in for the species/evolution-stage exceptions), and
 *  no still-possible ability may excuse the forcing. */
function ruleApplies(
  movePool: readonly string[],
  declaredItems: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): boolean {
  return !poolHasSleepTalk(movePool) && poolHasChestoBerry(declaredItems) && !excusedByAbility(facts, roleAbilities);
}

/**
 * Direction one — the ITEM pool narrowed by REST having been revealed. `survivingItems` is
 * whatever this role's item pool has narrowed to so far (through the behavioural
 * deductions); comes back filtered to Chesto Berry alone once Rest is confirmed and
 * nothing excuses the forcing, unchanged otherwise — and never emptied, the same "prefer
 * missing a rule-out to making a false one" every narrowing in `narrow.ts` follows.
 */
export function itemsUnderRevealedRest(
  declaredItems: readonly string[],
  survivingItems: readonly string[],
  movePool: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): readonly string[] {
  if (!facts.revealedMoves.some((m) => toId(m) === REST_ID)) return survivingItems;
  if (!ruleApplies(movePool, declaredItems, facts, roleAbilities)) return survivingItems;
  const narrowed = survivingItems.filter((i) => toId(i) === CHESTO_BERRY_ID);
  return narrowed.length > 0 ? narrowed : survivingItems;
}

/**
 * Direction two — the MOVES a role could still be running, with Rest dropped once its
 * surviving item pool has narrowed away from Chesto Berry entirely (a confirmed Leftovers,
 * say) and nothing excuses the forcing. `declaredItems` is the role's own pool before any
 * narrowing — needed to tell "Chesto Berry was never on the table for this role" (the
 * species/evolution-stage exceptions, which say nothing about Rest) apart from "Chesto
 * Berry was on the table and something else won" (which does). Unchanged otherwise, and
 * never emptied.
 */
export function movesUnderNonChestoItem(
  movePool: readonly string[],
  declaredItems: readonly string[],
  survivingItems: readonly string[],
  facts: LiveFacts,
  roleAbilities: readonly string[],
): readonly string[] {
  if (survivingItems.length === 0 || poolHasChestoBerry(survivingItems)) return movePool;
  if (!ruleApplies(movePool, declaredItems, facts, roleAbilities)) return movePool;
  const narrowed = movePool.filter((m) => toId(m) !== REST_ID);
  return narrowed.length > 0 ? narrowed : movePool;
}

// WHAT THIS DELIBERATELY DOES NOT COVER.
//
// It narrows a role's items and moves, but it never DROPS a role the way a behavioural
// deduction empties `survivingItems` and takes the whole role with it (see
// `narrow.roleMatches`). A role whose only declared item is Leftovers, say, while Rest sits
// revealed in its pool, is a genuine contradiction under this law — but wiring that into
// role elimination means threading a role's own item pool through `deductions.ruledOutItems`,
// which is shaped for a small fixed list of named items (Life Orb, the Choice trio, …), not
// "everything except Chesto Berry". Left as a narrower, safer claim: the display and the
// calc's assumed item both stay honest about what a SURVIVING role could hold, at the cost
// of not (yet) using this law to reject a role outright.
