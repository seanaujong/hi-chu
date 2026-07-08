// The evidence law: which randbats roles are still consistent with everything the battle
// has made public. `roleMatches` is the single predicate — moves used, revealed item,
// innate ability, active Tera, plus the behavioural item rule-outs from deductions.ts —
// and `selectRoles` folds it over an entry's roles. The resolution (resolve.ts) and
// display (knowledge.ts) layers both narrow through here, so the rule lives in one place.
//
// Pure: no DOM, no network, no @smogon/calc.

import type {LiveFacts, RandbatsEntry, RandbatsRole} from './types.js';
import {toId, innateAbility, isMegaForme} from './facts.js';
import {survivingItems} from './deductions.js';

/** True when every piece of revealed evidence is consistent with this role. */
function roleMatches(role: RandbatsRole, facts: LiveFacts): boolean {
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
  if (role.items.length > 0 && survivingItems(role.abilities, role.items, facts).length === 0) return false;
  // A Mega forme's ability is forme-locked, not set-chosen, and client/feed names for it
  // can differ — so it never narrows the role (the -Mega forme + stone already do).
  const ability = innateAbility(facts);
  if (ability && !isMegaForme(facts.speciesForme) && role.abilities.length > 0 && !role.abilities.some((a) => toId(a) === toId(ability))) {
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

  const consistent = named.filter(([, r]) => roleMatches(r, facts));

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
