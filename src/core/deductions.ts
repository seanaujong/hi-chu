// The behavioural deduction layer: SILENT items — ones that never reveal themselves
// directly — deduced ABSENT from the public mark their presence would (or wouldn't) have
// left. Each rule turns a LiveFacts observation into a "this item can't be here"
// constraint; the narrowing and resolution layers consume the union through
// `survivingItems`, so the matcher itself stays general (it filters a pool, it doesn't
// know Pokémon mechanics). Adding a deduction = one predicate + one line in `ruledOutItems`.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts} from './types.js';
import {toId, innateAbility} from './facts.js';

// Abilities that mask Life Orb's recoil, so its ABSENCE proves nothing about the item.
const RECOIL_SUPPRESSORS = new Set(['sheerforce', 'magicguard']);

// The three items the sim marks `isChoice` — the ones that lock their holder into a single
// move per stint, and so the ones varying moves rules out together.
const CHOICE_ITEMS = ['choiceband', 'choicespecs', 'choicescarf'];

// Klutz ignores the holder's item outright, so a Klutz mon varies its moves freely even
// while holding a Choice item — the sim's `ignoringItem()` check inside the lock. Its two
// siblings there, Magic Room and Embargo, are time-scoped field/volatile facts and are
// handled in the reader; only the ability half can be judged against a role's pool here.
const ITEM_IGNORING_ABILITIES = new Set(['klutz']);

/** A deduction only speaks while the item is still unknown — a revealed item (held or
 *  `prevItem`) is the stronger, positive evidence and the matcher already uses it. */
function itemStillHidden(facts: LiveFacts): boolean {
  return facts.item === undefined && facts.prevItem === undefined;
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
  const known = innateAbility(facts);
  if (known !== undefined) return !RECOIL_SUPPRESSORS.has(toId(known));
  return !roleAbilities.some((a) => RECOIL_SUPPRESSORS.has(toId(a)));
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
  const known = innateAbility(facts);
  if (known !== undefined) return !ITEM_IGNORING_ABILITIES.has(toId(known));
  return !roleAbilities.some((a) => ITEM_IGNORING_ABILITIES.has(toId(a)));
}

/** The items (id form) a role can no longer be holding, by behavioural deduction. */
export function ruledOutItems(facts: LiveFacts, roleAbilities: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  if (lifeOrbRuledOut(facts, roleAbilities)) out.add('lifeorb');
  if (bootsRuledOut(facts)) out.add('heavydutyboots');
  if (choiceItemsRuledOut(facts, roleAbilities)) for (const i of CHOICE_ITEMS) out.add(i);
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
