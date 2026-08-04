// The evidence law: which randbats roles are still consistent with everything the battle
// has made public. `roleMatches` is the single predicate — moves used, revealed item,
// innate ability, active Tera, plus the behavioural item rule-outs from deductions.ts —
// and `selectRoles` folds it over an entry's roles. The resolution (resolve.ts) and
// display (knowledge.ts) layers both narrow through here, so the rule lives in one place.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts, RandbatsEntry, RandbatsRole} from './types.js';
import {toId, innateAbility} from './facts.js';
import {survivingItems} from './deductions.js';

/**
 * Every ability the feed says this species can be BUILT with — the union over its roles.
 *
 * An innate ability outside this pool is not evidence about the set, because no set could
 * have produced it, so it must not narrow anything. The client hands us such names often
 * enough that this is the difference between a working tooltip and "⚠ matched no known
 * set" on every hover:
 *
 *   - A FORME-LOCKED ability, from a forme change the set never chose. Terapagos is built
 *     with Tera Shift — but Tera Shift turns it into Terapagos-Terastal on switch-in, and
 *     the client stamps that forme's own ability, Tera Shell, over the innate one. Same for
 *     every Mega (a Champions Meganium-Mega reports "Mega Sol" where the feed says "Leaf
 *     Guard"): the forme and the stone already pin the set, and the ability was never the
 *     set's to choose.
 *   - An UMBRELLA name the dex doesn't carry: Calyrex-Shadow's "As One (Spectrier)" is
 *     announced as plain "As One".
 *   - A BORROWED one, when nothing revealed the innate ability before a Skill Swap replaced
 *     it.
 *
 * All three can only ever REJECT every role, never select one. Narrowing on nothing is the
 * honest answer; rejecting everything is a lie about the set.
 *
 * Exported because it's also the general "which species could this format's feed build
 * with ability X" check — `section.ts` reuses it to discover Illusion holders from the
 * feed itself rather than a hardcoded species list.
 */
export function buildableAbilities(entry: RandbatsEntry): ReadonlySet<string> {
  const pool = [...entry.abilities, ...Object.values(entry.roles ?? {}).flatMap((r) => r.abilities)];
  return new Set(pool.map(toId));
}

/** True when every piece of revealed evidence is consistent with this role. `deductions`
 *  says whether the behavioural rule-outs get a vote — see `consistentRoles`. */
function roleMatches(
  role: RandbatsRole,
  facts: LiveFacts,
  buildable: ReadonlySet<string>,
  deductions: 'apply' | 'ignore' = 'apply',
): boolean {
  const have = new Set(role.moves.map(toId));
  for (const m of facts.revealedMoves) if (!have.has(toId(m))) return false;
  // An item revealed mid-battle (held, consumed, or knocked off) pins the set the
  // same way a used move does; likewise the innate ability or an active Tera type.
  const revealedItem = facts.item ?? facts.prevItem;
  if (revealedItem && role.items.length > 0 && !role.items.some((i) => toId(i) === toId(revealedItem))) {
    return false;
  }
  // A role whose only items are ones the mon has behaviourally shown it ISN'T holding
  // (see deductions.ts) can no longer be that role.
  if (deductions === 'apply' && role.items.length > 0 &&
      survivingItems(role.abilities, role.items, facts).length === 0) {
    return false;
  }
  // The ability narrows this role only if a set could have been BUILT with it (see
  // `buildableAbilities`) — otherwise it says nothing about which set we are looking at.
  const ability = innateAbility(facts);
  if (ability && buildable.has(toId(ability)) && role.abilities.length > 0 && !role.abilities.some((a) => toId(a) === toId(ability))) {
    return false;
  }
  const activeTera = facts.terastallized ? facts.teraType : undefined;
  if (activeTera && role.teraTypes.length > 0 && !role.teraTypes.some((t) => toId(t) === toId(activeTera))) {
    return false;
  }
  return true;
}

function anyEvidence(facts: LiveFacts): boolean {
  return facts.revealedMoves.length > 0 || facts.item !== undefined || facts.prevItem !== undefined ||
    innateAbility(facts) !== undefined || (facts.terastallized && facts.teraType !== undefined);
}

/**
 * The roles consistent with `facts` — letting the behavioural deductions NARROW the field
 * but never EMPTY it.
 *
 * The two kinds of evidence deserve different treatment when they leave nothing standing.
 * A positive reveal that fits no role is a genuine contradiction worth surfacing: we SAW
 * that move, and no set has it. A behavioural rule-out is an inference from something that
 * did not happen, so a rule-out that kills every role is far likelier to be the inference
 * failing than the whole species being impossible — and "prefer missing a rule-out to making
 * a false one" says to drop it.
 *
 * The orbs are what make this load-bearing rather than theoretical: six of the ten species
 * that can hold one hold it on EVERY role (Gliscor, Ursaluna, Conkeldurr, Zangoose, Flareon,
 * Squawkabilly), so a single missed suppressor would take a common Pokémon from "two
 * candidate sets" to "matched no known set" — a message that would also be lying about
 * which evidence did it.
 */
function consistentRoles(
  named: ReadonlyArray<readonly [string, RandbatsRole]>,
  facts: LiveFacts,
  buildable: ReadonlySet<string>,
): ReadonlyArray<readonly [string, RandbatsRole]> {
  const narrowed = named.filter(([, r]) => roleMatches(r, facts, buildable));
  if (narrowed.length > 0) return narrowed;
  return named.filter(([, r]) => roleMatches(r, facts, buildable, 'ignore'));
}

/**
 * Pick the role(s) consistent with everything the battle has revealed (moves used,
 * item, ability), and the single role we'll calculate with. If nothing is
 * consistent (or nothing has been revealed yet) we keep all roles and flag the
 * extra uncertainty.
 */
export function selectRoles(entry: RandbatsEntry, facts: LiveFacts): {
  chosen: RandbatsRole | undefined;
  candidates: readonly RandbatsRole[];
  names: readonly string[];
  uncertain: string | undefined;
} {
  const named = entry.roles ? Object.entries(entry.roles) : [];
  if (named.length === 0) return {chosen: undefined, candidates: [], names: [], uncertain: undefined};

  const buildable = buildableAbilities(entry);
  const consistent = consistentRoles(named, facts, buildable);

  if (anyEvidence(facts) && consistent.length === 0) {
    // Revealed evidence matched no role (form change, transform, data drift) — don't
    // pretend; calculate with the first role but mark the assumptions as shaky.
    return {
      chosen: named[0]![1],
      candidates: named.map(([, r]) => r),
      names: named.map(([n]) => n),
      uncertain: 'revealed moves/item/ability matched no known set',
    };
  }
  const kept = consistent.length > 0 ? consistent : named;
  return {
    chosen: kept[0]![1],
    candidates: kept.map(([, r]) => r),
    names: kept.map(([n]) => n),
    uncertain: undefined,
  };
}
