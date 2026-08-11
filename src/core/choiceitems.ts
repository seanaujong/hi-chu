// The set-shape law: a Choice item and a status move do not share a random-battle set.
// Read in two directions, because one law answers two questions — a status move seen
// rules the Choice items OUT, and a Choice item seen rules the status moves out of what
// the set could still be RUNNING.
//
// It is a claim about how the feed's sets were BUILT, which makes it a different kind of
// evidence from everything in `deductions.ts` next door. Those read a mark the item's own
// behaviour left: Life Orb's recoil fired or didn't, a balloon announced itself or stayed
// quiet. This one reads no behaviour at all. Nothing stops the sim locking a Choice Band
// holder into Swords Dance — it is a legal, merely terrible, sequence of events. What
// cannot happen is the TEAM GENERATOR handing that set out, and the tooltip's job is to
// say which sets a Pokémon can still be, not which move sequences are legal. The
// difference has a practical edge worth keeping in view: a behavioural deduction needs an
// ability guard (Klutz makes the item inert, Sheer Force eats the recoil), and this one
// needs none, because no ability changes what the generator built.
//
// WHY IT HOLDS. Showdown reaches a Choice Band or Specs down one branch of
// `getItem` — `counter.get('Physical') >= moves.size`, every move on the set a damaging
// move of one category (± a single pivot move) — which any status move breaks. The one
// path that grants a Choice item in spite of that is `getPriorityItem`'s: Trick,
// Switcheroo and Healing Wish get one on purpose, and Imposter gets a Scarf. Those are
// the exceptions below, and they are not a caveat to the law so much as the whole of it:
// take them away and the rule has no counterexample anywhere in the feed.
//
// MEASURED, NOT REASONED. The branch above is the mechanism, but the generator is a
// thousand lines of interacting special cases and reading it is not proof. So the
// exception list is enumerated from a run of Showdown's own team generator over every
// format `pkmn.github.io/randbats` publishes — `npm run choice-exclusions` reproduces it,
// and fails when a run disagrees with the list below. The run of record:
//
//     1,080,000 sets, 107,867 holding a Choice item, 150 distinct status moves seen.
//     Eight ever appeared beside one; the other 142 — Protect, Substitute, Roost, Toxic,
//     Swords Dance, Nasty Plot, Calm Mind, Dragon Dance and the rest — never did.
//
// That asymmetry is the reason the list is measured rather than recalled, and it is the
// same warning `deductions.ts` writes over its status-orb suppressors: a missing entry
// here is not a missed deduction but a FALSE one. Forget Parting Shot and we tell a player
// their Choice Scarf Incineroar cannot pivot.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {IsStatusMove} from './types.js';
import {toId} from './facts.js';

/** The three items the sim marks `isChoice` — the ones that lock their holder into a
 *  single move per stint, and so the ones every rule here rules out together. */
export const CHOICE_ITEMS: readonly string[] = ['choiceband', 'choicespecs', 'choicescarf'];

const CHOICE_ITEM_IDS: ReadonlySet<string> = new Set(CHOICE_ITEMS);

/**
 * The status moves the generator really does hand a Choice item to, measured rather than
 * recalled (see this file's header). Four of them are the generator's own doing and three
 * are passengers, and the distinction is worth keeping because only the first four would
 * survive someone rewriting the move pools:
 *
 *   - `trick`, `switcheroo`, `healingwish` — `getPriorityItem` gives these a Choice item
 *     BECAUSE they have one; a Trick set with nothing to Trick away is not a set. Trick
 *     held a Choice item in 100% of its sets, Switcheroo 89%, Healing Wish 78%.
 *   - `transform` — Ditto's Imposter takes a Choice Scarf by the same rule, in 40%.
 *   - `naturepower`, `batonpass`, `partingshot`, `auroraveil` — passengers, drawn into a
 *     set that got its Choice item for one of the reasons above (an Oranguru running Nature
 *     Power alongside Trick). Rare — around 4% of the sets each appears on, except Nature
 *     Power's 31% — which is exactly why they have to be measured: nothing about the move
 *     suggests them. Aurora Veil is the cautionary one, and the reason the SCRIPT rather
 *     than its output is what this file rests on: an early hand-rolled sweep of 2.7M sets
 *     reported a clean seven without it, because it cached one category per move name
 *     instead of asking each gen's own dex. A rarity and a measurement bug look identical
 *     from the outside. Only a measurement someone can re-run tells them apart.
 */
const PAIRS_WITH_CHOICE: ReadonlySet<string> = new Set([
  'trick', 'switcheroo', 'healingwish', 'transform',
  'naturepower', 'batonpass', 'partingshot', 'auroraveil',
]);

/** Is this one of the three Choice items? Names or ids, either way. */
export function isChoiceItem(item: string): boolean {
  return CHOICE_ITEM_IDS.has(toId(item));
}

/**
 * Direction one — the ITEM read off the moves. True when a status move this Pokémon has
 * been seen using rules the three Choice items out.
 *
 * Takes the revealed moves already filtered to STATUS ones, because what makes a move a
 * status move is the client dex's own `category` and the pure core carries no move data
 * (`readState.ts` does the filtering, where the dex is). Passing damaging moves in here
 * would quietly over-claim: Power-Up Punch and Torch Song boost their user and are
 * attacks, and no rule here covers them — see this file's tail note.
 */
export function choiceRuledOutByStatusMoves(revealedStatusMoves: readonly string[]): boolean {
  return revealedStatusMoves.some((m) => !PAIRS_WITH_CHOICE.has(toId(m)));
}

/**
 * Direction two — the MOVES read off the item. The moves in `pool` a Choice-item holder
 * could still be running, which is every damaging move plus the seven exceptions.
 *
 * Comes back unchanged when `isStatusMove` can't classify anything, which is the honest
 * answer rather than a silent full pool: not knowing a move's category is not evidence
 * that it is an attack.
 */
export function movesUnderChoiceItem(pool: readonly string[], isStatusMove: IsStatusMove): readonly string[] {
  return pool.filter((m) => !isStatusMove(m) || PAIRS_WITH_CHOICE.has(toId(m)));
}

// WHAT THIS DELIBERATELY DOES NOT COVER.
//
// The setup moves that are ATTACKS — Power-Up Punch, Charge Beam, Torch Song, Meteor
// Beam, Flame Charge, Trailblaze — also never appeared beside a Choice item, and the
// generator's own branch explains two of them (Flame Charge and Trailblaze are named in
// its exclusion list). They are left out anyway: each is rare enough that its zero rests
// on a few hundred sets rather than the hundreds of thousands behind the status-move
// half, and "prefer missing a rule-out to making a false one" decides a case like that.
//
// Nor is the POSITIVE reading made, though the data offers it plainly: Trick held a
// Choice item in 100% of the sets it appeared on, so seeing Trick very nearly confirms
// one, the way `deductions.ts` confirms Heavy-Duty Boots from a dodged Stealth Rock. It
// is a different law — one that would pin an item rather than release one — and it wants
// its own measurement of what the remaining 0% is, not a corner of this file.
