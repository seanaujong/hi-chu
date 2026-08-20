// The behavioural deduction layer: items deduced ABSENT from the public mark their presence
// would (or wouldn't) have left. Most are SILENT items, ones that never reveal themselves
// and so can only be read through a side effect (Life Orb's recoil, Heavy-Duty Boots'
// hazard immunity, a Choice lock). Air Balloon, the two status orbs and Leftovers are the
// opposite and the same rule reversed: they announce themselves — the balloon on every
// switch-in, an orb at every end of turn, Leftovers at every damaged end of turn — so their
// SILENCE is the mark. Each rule turns a LiveFacts observation into a "this item can't be here"
// constraint; the narrowing and resolution layers consume the union through
// `survivingItems`, so the matcher itself stays general (it filters a pool, it doesn't
// know Pokémon mechanics). Adding a deduction = one predicate + one line in `ruledOutItems`.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts} from './types.js';
import {toId, innateAbility} from './facts.js';
import {CHOICE_ITEMS, choiceRuledOutByStatusMoves} from './choiceitems.js';

// Abilities that mask Life Orb's recoil, so its ABSENCE proves nothing about the item.
const RECOIL_SUPPRESSORS = new Set(['sheerforce', 'magicguard']);

// Klutz ignores the holder's item outright, so a Klutz mon varies its moves freely even
// while holding a Choice item — the sim's `ignoringItem()` check inside the lock. Its two
// siblings there, Magic Room and Embargo, are time-scoped field/volatile facts and are
// handled in the reader; only the ability half can be judged against a role's pool here.
const ITEM_IGNORING_ABILITIES = new Set(['klutz']);

// The two items that status their own holder at every end of turn, so one quiet turn rules
// both out together — the same shape as the Choice trio above.
const STATUS_ORBS = ['flameorb', 'toxicorb'];

// Abilities that would have swallowed an orb's status, leaving a quiet turn that proves
// nothing: Klutz because the item is ignored outright, and the rest because the sim's own
// `onSetStatus` refuses a burn or a poison. Enumerated FROM `data/abilities.ts` rather than
// recalled — Pastel Veil is the one a memory sweep misses, and a missed excuse here is not
// a missed deduction but a false one.
const STATUS_ORB_SUPPRESSORS = new Set([
  'klutz',
  'comatose', 'purifyingsalt', 'shieldsdown', 'leafguard', // refuse every status
  'waterveil', 'waterbubble', 'thermalexchange', // refuse burn
  'immunity', 'pastelveil', // refuse poison
]);

/** A deduction only speaks while the item is still unknown — a revealed item (held or
 *  `prevItem`) is the stronger, positive evidence and the matcher already uses it. */
function itemStillHidden(facts: LiveFacts): boolean {
  return facts.item === undefined && facts.prevItem === undefined;
}

/**
 * Can no ability explain this evidence away? Every rule-out below is valid only while
 * nothing could have masked what we did (or didn't) see, and each judges that the same
 * way: against the INNATE ability once it is known, else against everything this role
 * could still be running. "Never lie" lives here — while the ability is hidden and the
 * role's pool CONTAINS an excuse, the deduction goes unmade rather than risk being wrong.
 */
function noExcuse(facts: LiveFacts, roleAbilities: readonly string[], excuses: ReadonlySet<string>): boolean {
  const known = innateAbility(facts);
  if (known !== undefined) return !excuses.has(toId(known));
  return !roleAbilities.some((a) => excuses.has(toId(a)));
}

/**
 * Life Orb takes 1/10 recoil when a damaging move lands and reveals itself doing so, so a
 * landed hit with no item revealed rules it out — UNLESS a Sheer Force / Magic Guard
 * ability that would have masked the recoil is (or could still be) in play. Judged against
 * the known innate ability, else against everything this role could run ("never lie": a
 * hidden-ability set that could be Sheer Force keeps Life Orb possible).
 */
function lifeOrbRuledOut(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  if (!facts.landedDamagingHit || !itemStillHidden(facts)) return false;
  return noExcuse(facts, roleAbilities, RECOIL_SUPPRESSORS);
}

/**
 * Heavy-Duty Boots negates entry-hazard damage, so a mon that has TAKEN hazard damage
 * can't be holding it. The mirror image of the Life Orb rule — here the effect FIRING is
 * the proof, not its absence — and it needs no ability guard: taking the damage also rules
 * out Magic Guard, the only other thing that would have prevented it.
 */
function bootsRuledOut(facts: LiveFacts): boolean {
  return facts.tookEntryHazardDamage && itemStillHidden(facts);
}

/**
 * Heavy-Duty Boots' positive twin: switching into Stealth Rock and taking none CONFIRMS
 * Boots, since nothing but Boots or Magic Guard lets a switch-in dodge it. So we pin the
 * item — UNLESS Magic Guard is (or could still be) the ability. "Never lie": a hidden
 * ability that could be Magic Guard leaves it unconfirmed.
 */
function bootsRuledIn(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  if (!facts.switchedIntoStealthRockUnharmed || !itemStillHidden(facts)) return false;
  const known = facts.baseAbility ?? facts.ability;
  if (known !== undefined) return toId(known) !== 'magicguard';
  return !roleAbilities.some((a) => toId(a) === 'magicguard');
}

/**
 * A Choice item locks its holder into the first move it picks until it switches out, so
 * two freely-selected moves in ONE stint rule all three out. The reader
 * (`usedDifferentMovesSinceSwitchIn`) owns what counts as free and as one stint — including
 * Magic Room and Embargo, the time-scoped half of the sim's `ignoringItem()` escape. Klutz
 * is the half left to judge here, against the known innate ability or, while it is still
 * hidden, everything this role could run ("never lie", exactly as for Life Orb).
 *
 * The knock-on is larger than one item: a role whose ENTIRE item pool is Choice items is
 * itself ruled out by `narrow.roleMatches`, so this narrows candidate sets, not just the
 * item line — and, because Choice Scarf is a Speed multiplier, it collapses the ⚡ verdict's
 * "if it is Scarfed" aside into a definite answer.
 */
function choiceItemsRuledOut(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  if (!facts.usedDifferentMovesSinceSwitchIn || !itemStillHidden(facts)) return false;
  return noExcuse(facts, roleAbilities, ITEM_IGNORING_ABILITIES);
}

/**
 * Air Balloon is the one item that ANNOUNCES itself on the way in, so a switch-in it stayed
 * silent through rules it out. Every other rule here reads an item that never speaks and
 * infers from a side effect; this one needs no side effect at all, which is why a single
 * silent switch-in settles it — usually on turn one, before the mon has done anything.
 *
 * Klutz is the guard, and for a reason worth stating: it makes the holder ignore its item
 * outright, so a Klutz mon's balloon is both silent AND inert. Judged against the known
 * innate ability, else against the role's whole pool ("never lie", exactly as for Life Orb).
 * The reader owns Gravity and Magic Room, the two time-scoped suppressors.
 *
 * Worth more than one line of the item list: Air Balloon confers a flat Ground immunity, so
 * leaving it in the pool leaves a phantom 0-damage bucket on every Ground move aimed at a
 * mon that has visibly been on the field without one.
 */
function airBalloonRuledOut(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  if (!facts.switchedInWithoutAnnouncingBalloon || !itemStillHidden(facts)) return false;
  return noExcuse(facts, roleAbilities, ITEM_IGNORING_ABILITIES);
}

/**
 * Flame Orb and Toxic Orb burn or badly-poison their own holder at the end of every turn and
 * announce themselves doing it, so a turn that ended with the holder un-statused rules both
 * out. Air Balloon's rule read silence at ONE moment, the switch-in; this reads it at a
 * moment that comes round again every turn, so it usually settles on the holder's first.
 *
 * The reader owns everything time-scoped that would have muffled the orb (a status already
 * in place, Misty Terrain, Magic Room, Embargo, an active Tera). Left here is the ability
 * half — Klutz, and every ability that simply refuses the status — judged against the known
 * innate ability, else against the role's whole pool ("never lie", exactly as for Life Orb).
 *
 * It reaches further than one item line, and further than the Choice rule that shares its
 * shape: every orb role in the feed carries the orb as its ONLY item, so the rule-out empties
 * the pool and `narrow.roleMatches` drops the ROLE. That is the point — an orb role's ability
 * is always a status-fed one (Guts, Quick Feet, Toxic Boost, Poison Heal), so dropping it is
 * worth a ×1.5 of Attack or Speed on every line we then show.
 */
function statusOrbsRuledOut(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  if (!facts.endedTurnUnstatused || !itemStillHidden(facts)) return false;
  return noExcuse(facts, roleAbilities, STATUS_ORB_SUPPRESSORS);
}

/**
 * Leftovers restores its own holder 1/16 max HP at the end of every damaged turn and
 * announces itself doing it, so a damaged turn that ended in silence rules it out — the
 * same silence-is-evidence shape as the rule above, just keyed to HP instead of status.
 *
 * The reader owns everything time-scoped that would have muffled it (Heal Block, Magic
 * Room, Embargo). Left here is the ability half — Klutz, the only ability that suppresses a
 * held item's effect outright — judged against the known innate ability, else against the
 * role's whole pool ("never lie", exactly as for the rules above).
 */
function leftoversRuledOut(facts: LiveFacts, roleAbilities: readonly string[]): boolean {
  if (!facts.endedTurnDamagedWithoutLeftoversHeal || !itemStillHidden(facts)) return false;
  return noExcuse(facts, roleAbilities, ITEM_IGNORING_ABILITIES);
}

/**
 * A status move rules the three Choice items out, because the team generator never builds
 * a set holding both — the law, its measurement and its seven exceptions all live in
 * `choiceitems.ts`. Two things separate it from the Choice rule directly above, which
 * reaches the same three items by a different road:
 *
 *   - It settles on the FIRST status move, where the lock rule needs two freely-chosen
 *     moves in one stint. A Calm Mind on turn one is enough, and most defensive sets show
 *     a status move long before they show two attacks.
 *   - It needs no ability guard. Klutz excuses the lock rule because an ignored item locks
 *     nothing; it excuses nothing here, since no ability changes which set was built.
 */
function choiceRuledOutBySetShape(facts: LiveFacts): boolean {
  return itemStillHidden(facts) && choiceRuledOutByStatusMoves(facts.revealedStatusMoves);
}

/** The items (id form) a role can no longer be holding, by behavioural deduction. */
export function ruledOutItems(facts: LiveFacts, roleAbilities: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  if (lifeOrbRuledOut(facts, roleAbilities)) out.add('lifeorb');
  if (bootsRuledOut(facts)) out.add('heavydutyboots');
  if (choiceItemsRuledOut(facts, roleAbilities) || choiceRuledOutBySetShape(facts)) {
    for (const i of CHOICE_ITEMS) out.add(i);
  }
  if (airBalloonRuledOut(facts, roleAbilities)) out.add('airballoon');
  if (statusOrbsRuledOut(facts, roleAbilities)) for (const i of STATUS_ORBS) out.add(i);
  if (leftoversRuledOut(facts, roleAbilities)) out.add('leftovers');
  return out;
}

/**
 * An item pool narrowed by the behavioural deductions for this role (its `abilities` are the
 * pool the still-hidden ability could be drawn from). A confirmed item (Boots ruled IN) pins
 * the pool to just that; otherwise ruled-OUT items are removed. Unchanged when nothing fires
 * — the common case.
 */
export function survivingItems(
  abilities: readonly string[],
  items: readonly string[],
  facts: LiveFacts,
): readonly string[] {
  if (bootsRuledIn(facts, abilities)) return items.filter((i) => toId(i) === 'heavydutyboots');
  const ruled = ruledOutItems(facts, abilities);
  return ruled.size === 0 ? items : items.filter((i) => !ruled.has(toId(i)));
}
