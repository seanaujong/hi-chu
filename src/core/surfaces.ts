// The Surfaces grid, as data. The product is six hover targets crossed with eight
// sections, and this file is that crossing: it decides which numbers a surface is
// allowed to carry, so `section.ts` can read a table instead of re-deriving the same
// two booleans — is this the foe's? is it on the field? — at every site that needs one.
// Nothing here computes a number; `render.ts` owns what a section LOOKS like, this owns
// which sections a target GETS.
//
// An empty cell records its REASON, not just its emptiness, and that is the whole point
// of four values where a boolean would render the same HTML. Three cells are empty for
// one law — never show the same number on two surfaces — and one is empty because
// showing it would leak private facts into a view whose honesty rests on being public.
// Keeping those apart is what lets `surfaces.test.ts` check the law rather than the
// layout: every `withheld` cell must sit on a target already ON the field (which is why
// its number is somewhere else), and every `private` cell on the one surface built from
// the private team.
//
// Pure: no DOM, no network, no @smogon/calc — and no imports at all, so the grid reads
// as the plain statement of policy it is.

/**
 * The six things a player can hover. `content.ts` patches only two client renderers;
 * these fall out of which arguments the client passes them, and naming them here is what
 * turns "foe and not active" from a condition re-derived at five call sites into one
 * value the surfaces agree on.
 */
export type HoverTarget =
  | 'move-button'
  | 'own-active'
  | 'own-bench'
  | 'switch-menu'
  | 'foe-active'
  | 'foe-bench';

/**
 * The eight sections a tooltip can carry. `speedLead` and `speedPerBlock` are the same
 * ⚡ fact in two PLACEMENTS — leading a foe hover, or heading each "vs <foe>" block of
 * the matchup view — which is why no target ever shows both.
 */
export type SectionName =
  | 'damage'
  | 'speedLead'
  | 'outgoing'
  | 'speedPerBlock'
  | 'incoming'
  | 'ourDamageInto'
  | 'sets'
  | 'mirror';

/**
 * Why a cell renders, or why it doesn't.
 *
 * - `shown` — rendered here.
 * - `absent` — this surface has nothing to say: the section's own inputs don't exist for
 *   it (a foe hover has no private moveset to show outgoing damage from).
 * - `withheld` — computable and true, suppressed because another surface already carries
 *   the same number. Always a mon already on the field; see `ON_FIELD`.
 * - `private` — computable, suppressed because rendering it would derive a public-
 *   knowledge view from private facts.
 */
export type Cell = 'shown' | 'absent' | 'withheld' | 'private';

/**
 * The grid. `Record` over both unions is doing real work: a new hover target or a new
 * section fails the typecheck here until every cell it introduces has been decided, so
 * the grid can never be silently partial.
 */
export const SURFACES: Readonly<Record<HoverTarget, Readonly<Record<SectionName, Cell>>>> = {
  // A move button belongs to our active, and carries exactly one thing: that move's
  // damage — in more detail than any other surface (the nHKO ladder, the Sash/Leftovers
  // caveats, the drain/recoil swing). That detail is what earns the three `withheld`
  // cells elsewhere.
  'move-button': {
    damage: 'shown', speedLead: 'absent', outgoing: 'absent', speedPerBlock: 'absent',
    incoming: 'absent', ourDamageInto: 'absent', sets: 'absent', mirror: 'absent',
  },
  // The mon already on the field keeps only what appears nowhere else. Its outgoing
  // numbers are on the move buttons sitting directly under this tooltip, and its incoming
  // numbers are on the foe's own hover — so the ⚡ verdict, which no other own-side
  // surface carries, is the whole reason the matchup block still renders at all.
  'own-active': {
    damage: 'absent', speedLead: 'absent', outgoing: 'withheld', speedPerBlock: 'shown',
    incoming: 'withheld', ourDamageInto: 'absent', sets: 'absent', mirror: 'shown',
  },
  // A revealed bench mon has no hoverable move buttons anywhere, so nothing is redundant
  // and it keeps both directions: "can it threaten?" and "does it survive?" — the switch
  // decision this half of the product exists for.
  'own-bench': {
    damage: 'absent', speedLead: 'absent', outgoing: 'shown', speedPerBlock: 'shown',
    incoming: 'shown', ourDamageInto: 'absent', sets: 'absent', mirror: 'shown',
  },
  // The same switch decision, reached from the menu instead of the sidebar. The mirror is
  // the one difference, and it is not redundancy: this surface is built straight from the
  // private `ServerPokemon`, so a their-read-on-you view derived here would be derived
  // from facts the opponent does not have.
  'switch-menu': {
    damage: 'absent', speedLead: 'absent', outgoing: 'shown', speedPerBlock: 'shown',
    incoming: 'shown', ourDamageInto: 'absent', sets: 'absent', mirror: 'private',
  },
  // Our damage into an active foe is already on the move tooltip, one hover away — the
  // same redundancy law as `own-active`, pointed the other way.
  'foe-active': {
    damage: 'absent', speedLead: 'shown', outgoing: 'absent', speedPerBlock: 'absent',
    incoming: 'absent', ourDamageInto: 'withheld', sets: 'shown', mirror: 'absent',
  },
  // Their bench answers the matchup view's mirror question: what our active does to that
  // Pokémon as though it switched in. No move tooltip covers a mon that isn't out yet.
  'foe-bench': {
    damage: 'absent', speedLead: 'shown', outgoing: 'absent', speedPerBlock: 'absent',
    incoming: 'absent', ourDamageInto: 'shown', sets: 'shown', mirror: 'absent',
  },
};

/**
 * Whether the hovered Pokémon is standing on the field right now — the one fact behind
 * two rules that were stated separately before they were known to be the same rule. A mon
 * already out is one whose numbers appear on some other surface, which is what every
 * `withheld` cell rests on; a mon NOT out is a switch-decision candidate, which is the
 * only case where entry hazards belong in the preview.
 */
const ON_FIELD: Readonly<Record<HoverTarget, boolean>> = {
  'move-button': true, // the move panel belongs to our active
  'own-active': true,
  'own-bench': false,
  'switch-menu': false,
  'foe-active': true,
  'foe-bench': false,
};

/** Why `section` renders — or why it doesn't — on `target`. */
export function cell(target: HoverTarget, section: SectionName): Cell {
  return SURFACES[target][section];
}

/** Whether `target` renders `section` at all. The three non-`shown` reasons differ in
 *  why, never in what the reader sees, so every call site asks this one question. */
export function shows(target: HoverTarget, section: SectionName): boolean {
  return cell(target, section) === 'shown';
}

/** Whether the hovered Pokémon is on the field. See `ON_FIELD`. */
export function onField(target: HoverTarget): boolean {
  return ON_FIELD[target];
}

/**
 * Whether this surface previews the entry hazards the Pokémon would take on the way in.
 * Exactly the targets that are not on the field: a mon already out has taken whatever it
 * was going to take, and its current HP says so. Derived rather than stored as a ninth
 * column, so hazards and withholding cannot drift apart — they are the same fact.
 */
export function previewsSwitchInHazards(target: HoverTarget): boolean {
  return !onField(target);
}

/**
 * Whether the matchup view renders at all. It is a container for three sections, and it
 * earns its place from ANY of them — which is how our ACTIVE mon keeps a block holding
 * nothing but the ⚡ verdict. Derived from the grid so a cell change carries here on its
 * own.
 */
export function hasMatchupBlock(target: HoverTarget): boolean {
  return shows(target, 'outgoing') || shows(target, 'speedPerBlock') || shows(target, 'incoming');
}

/**
 * Which of the four Pokémon-hover targets the client just handed us. The switch menu and
 * the move button are known from their own entry points — the client passes each to a
 * different renderer — so only these four need deciding from the battle state.
 */
export function pokemonHoverTarget(isFar: boolean, isOnField: boolean): HoverTarget {
  if (isFar) return isOnField ? 'foe-active' : 'foe-bench';
  return isOnField ? 'own-active' : 'own-bench';
}

/** Every hover target, for callers that walk the whole grid (the invariant tests). */
export const HOVER_TARGETS = Object.keys(SURFACES) as readonly HoverTarget[];

/** Every section name, in the order the Surfaces grid lists them. */
export const SECTION_NAMES = Object.keys(SURFACES['move-button']) as readonly SectionName[];
