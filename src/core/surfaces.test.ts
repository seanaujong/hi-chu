// The grid's own laws. These check the RULES the table obeys, never the table's
// contents — restating each cell here would only assert that a copy matches its
// original. What a change to `SURFACES` must not do is break one of these:
//
//   a `withheld` cell that isn't on the field claims a number is somewhere else when
//   nothing puts it there; a `private` cell outside the switch menu suppresses a section
//   for a privacy boundary that surface doesn't have; and hazards drifting away from
//   "not on the field" would preview chip damage on a Pokémon that has already taken it.
//
// `section.test.ts` covers the other half — that the rendered tooltips actually match
// the grid. This file is the grid's internal consistency; that one is its truthfulness.

import {describe, it, expect} from 'vitest';
import {
  HOVER_TARGETS,
  SECTION_NAMES,
  SURFACES,
  cell,
  hasMatchupBlock,
  onField,
  pokemonHoverTarget,
  previewsSwitchInHazards,
  shows,
  type HoverTarget,
  type SectionName,
} from './surfaces.js';

/** Every (target, section) pair the grid defines — the whole 6 × 8 crossing. */
const CELLS: readonly {target: HoverTarget; section: SectionName}[] = HOVER_TARGETS.flatMap((target) =>
  SECTION_NAMES.map((section) => ({target, section})),
);

describe('the withholding law: a suppressed number is one some other surface carries', () => {
  it('marks a cell `withheld` only where the Pokémon is already on the field', () => {
    const misplaced = CELLS.filter(({target, section}) => cell(target, section) === 'withheld' && !onField(target));
    expect(misplaced).toEqual([]);
  });

  it('names the three cells the law actually governs', () => {
    // The one place a cell list belongs: this is the claim CLAUDE.md's Surfaces grid
    // makes in prose — three cells, one principle — so a fourth appearing (or one of
    // these quietly becoming `absent`) is a change to the product's stated rule, not a
    // refactor. Redundancy is the ONLY reason any of them is empty.
    const withheld = CELLS.filter(({target, section}) => cell(target, section) === 'withheld');
    expect(withheld).toEqual([
      {target: 'own-active', section: 'outgoing'},
      {target: 'own-active', section: 'incoming'},
      {target: 'foe-active', section: 'ourDamageInto'},
    ]);
  });
});

describe('the privacy law: only a surface built from private facts suppresses for privacy', () => {
  it('marks a cell `private` only on the switch menu', () => {
    // The switch menu is the one surface the client hands no battle-view Pokémon at all,
    // so it is built straight from the private `ServerPokemon`. Deriving the
    // their-read-on-you mirror there would derive it from facts the opponent lacks.
    const elsewhere = CELLS.filter(({target, section}) => cell(target, section) === 'private' && target !== 'switch-menu');
    expect(elsewhere).toEqual([]);
  });

  it('suppresses the mirror there for privacy, never for redundancy', () => {
    expect(cell('switch-menu', 'mirror')).toBe('private');
    // The distinction is load-bearing: the other own-side surfaces DO show the mirror, so
    // "some other surface has it" — the withholding argument — is false here.
    expect(shows('own-active', 'mirror')).toBe(true);
    expect(shows('own-bench', 'mirror')).toBe(true);
  });
});

describe('entry hazards are previewed exactly for a switch-decision candidate', () => {
  it('previews them on exactly the three surfaces that answer a switch decision', () => {
    // Named rather than compared against `onField`: `previewsSwitchInHazards` is DEFINED
    // as its negation, so relating the two here would assert nothing a change could
    // break. What can break is `ON_FIELD` itself, and this is what catches it — a mon
    // already out has taken whatever it was going to take, and its current HP says so.
    expect(HOVER_TARGETS.filter(previewsSwitchInHazards)).toEqual(['own-bench', 'switch-menu', 'foe-bench']);
  });
});

describe('the grid is coherent as a product', () => {
  it('never shows the ⚡ verdict in both placements at once', () => {
    // One fact about the (ours, theirs) pair, placed either as the lead of a foe hover or
    // as the head of each matchup block — a target showing both would print it twice.
    const both = HOVER_TARGETS.filter((t) => shows(t, 'speedLead') && shows(t, 'speedPerBlock'));
    expect(both).toEqual([]);
  });

  it('never shows the sets view and its mirror together', () => {
    // A tooltip is about what we know of THEM or what they know of US. Both at once would
    // put our own private-team narrowing beside their public one and invite reading the
    // second as the first.
    const both = HOVER_TARGETS.filter((t) => shows(t, 'sets') && shows(t, 'mirror'));
    expect(both).toEqual([]);
  });

  it('gives every target something to render — no surface is dead', () => {
    const empty = HOVER_TARGETS.filter((t) => !SECTION_NAMES.some((s) => shows(t, s)));
    expect(empty).toEqual([]);
  });

  it('renders a matchup block for exactly the surfaces that have a row to put in it', () => {
    expect(HOVER_TARGETS.filter(hasMatchupBlock)).toEqual(['own-active', 'own-bench', 'switch-menu']);
  });

  it('keeps the block for our active, whose only row is the ⚡ verdict', () => {
    // The narrow case the container rule exists for: both damage halves are withheld, and
    // the verdict alone still earns the block.
    expect(hasMatchupBlock('own-active')).toBe(true);
    expect(shows('own-active', 'outgoing')).toBe(false);
    expect(shows('own-active', 'incoming')).toBe(false);
  });
});

describe('reading a hover target off the battle state', () => {
  it('crosses the two facts the client gives us', () => {
    expect(pokemonHoverTarget(true, true)).toBe('foe-active');
    expect(pokemonHoverTarget(true, false)).toBe('foe-bench');
    expect(pokemonHoverTarget(false, true)).toBe('own-active');
    expect(pokemonHoverTarget(false, false)).toBe('own-bench');
  });

  it('covers every Pokémon-hover target — only the two entry-point surfaces stay out', () => {
    const reachable = new Set([true, false].flatMap((far) => [true, false].map((out) => pokemonHoverTarget(far, out))));
    const unreachable = HOVER_TARGETS.filter((t) => !reachable.has(t));
    expect(unreachable).toEqual(['move-button', 'switch-menu']);
  });
});

describe('the grid is total', () => {
  it('decides all 48 cells', () => {
    // Exhaustiveness is really the typechecker's — `Record` over both unions won't compile
    // with a cell missing. This guards the shape the walking tests above assume.
    expect(CELLS).toHaveLength(48);
    expect(CELLS.every(({target, section}) => SURFACES[target][section] !== undefined)).toBe(true);
  });
});
