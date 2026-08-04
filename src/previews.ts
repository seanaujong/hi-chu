// The preview declarations: named battle states, rendered.
//
// Closest industry analog is a Jetpack Compose `@Preview` — a scenario declared beside the
// code, painted without running the app or navigating to the screen. Two differences are
// worth knowing before trusting one.
//
// The GOOD one: nothing here is a special rendering path. Each preview calls the very
// `buildMoveSection` / `buildPokemonSection` / `buildSwitchSection` a live hover calls, over a
// battle built by the same `scenario.ts` builder `section.test.ts` asserts against. There is
// no preview-only code to drift from the real thing — which is possible only because those
// builders are pure, and is the whole return on keeping them that way.
//
// The LIMIT: Compose owns its entire rendering stack, so a preview is pixel-identical to the
// app. We render a STRING into a DOM we do not own, and `render.ts` is deliberately almost
// CSS-free — it inherits Showdown's own fonts, sizes and colours. So the gallery's chrome is
// an APPROXIMATION, and it says so on the page. What a preview is authoritative about is the
// content and structure of our section; what it only suggests is how that sits inside a real
// tooltip. Painting these inside a genuine Showdown tooltip is a separate, browser-driven
// step; this file needs no browser at all.
//
// Adding one is a single entry below. Prefer a state that is HARD TO REACH LIVE — that is
// where a preview earns its keep. A Substitute, a Transform, hazards on a specific side, a
// dented doll: each needs a real battle to roll the mechanic before anyone can look at it,
// which is exactly the wait this file exists to delete.

import {buildMoveSection, buildPokemonSection, buildSwitchSection} from './section.js';
import {loadBattle, scenarioData, scenarioDataWithDitto} from './scenario.js';

// Re-exported so the gallery can style its panels with the very stylesheet the extension
// injects, rather than a copy of it that could drift.
export {TOOLTIP_STYLE} from './core/render.js';

/** One rendered state, ready for the gallery. */
export interface Preview {
  /** The hover target this belongs to — the gallery groups by it. */
  readonly surface: string;
  readonly name: string;
  /** What this state demonstrates, and why it is worth a picture. One sentence. */
  readonly note: string;
  /** The section HTML, from the same builder a live hover calls. */
  readonly html: string;
}

type Overrides = Parameters<typeof loadBattle>[0];

/** Our move button, hovered: `move`'s damage into the foe active. */
function moveHover(name: string, note: string, over: Overrides, move: string, teraSelected = false): Preview {
  const {battle, active} = loadBattle(over);
  const us = active(over?.ourZoroark ? 'Zoroark-Hisui' : 'Noivern');
  return {surface: 'Our move button', name, note, html: buildMoveSection(battle, us, move, scenarioData, teraSelected)};
}

/** A Pokémon hovered — the foe's (sets + threat) or our own (the matchup view). */
function pokemonHover(surface: string, name: string, note: string, over: Overrides, target: string, data = scenarioData): Preview {
  const {battle, active} = loadBattle(over);
  return {surface, name, note, html: buildPokemonSection(battle, active(target), data)};
}

/** The switch menu, which the client drives from the PRIVATE team alone — no battle-view
 *  Pokémon exists for a mon that has never been sent out, so this surface is built from a
 *  `ServerPokemon` and cannot be reached by hovering anything on the field. */
function switchHover(name: string, note: string, over: Overrides, server: Record<string, unknown> = {}): Preview {
  const {battle} = loadBattle(over);
  const benched = {
    ident: 'p1: Noivern',
    details: 'Noivern, L82, F',
    condition: '272/272',
    item: 'heavydutyboots',
    baseAbility: 'infiltrator',
    teraType: 'Fire',
    moves: ['dracometeor', 'flamethrower', 'hurricane', 'roost'],
    ...server,
  };
  return {surface: 'Our switch menu', name, note, html: buildSwitchSection(battle, benched as never, scenarioData)};
}

/** A bench Pokémon this battle really had. Reached for whenever a preview needs an attacker
 *  a Substitute can actually stop — Noivern, our active, cannot be one. */
const ZOROARK_BENCH = {
  ident: 'p1: Zoroark-Hisui',
  details: 'Zoroark-Hisui, L80, M',
  condition: '100/100',
  item: 'lifeorb',
  baseAbility: 'illusion',
  teraType: 'Ghost',
  moves: ['focusblast', 'hypervoice', 'poltergeist', 'willowisp'],
};

// The captured position: our Noivern (terastallized Fire) against their Tentacruel. Every
// preview below is that battle with one thing changed.
export const PREVIEWS: readonly Preview[] = [
  moveHover(
    'Baseline',
    'The ordinary case every other preview is a departure from — one move, one target, item known.',
    {},
    'Draco Meteor',
  ),
  moveHover(
    'Item still unknown',
    'Tentacruel’s set can run Assault Vest or Leftovers, and the choice moves the number — so each distinct outcome gets its own labelled line instead of one averaged lie.',
    {tentacruelItem: ''},
    'Draco Meteor',
  ),
  moveHover(
    'Terastallize ticked',
    'The move panel’s checkbox previews OUR private Tera type as already active — a state that only exists between ticking the box and clicking the move.',
    {noivernTerastallized: '', myNoivernTera: 'Dragon'},
    'Draco Meteor',
    true,
  ),
  moveHover(
    'A sound move meets a Substitute',
    'Boomburst carries Showdown’s bypasssub flag, so the doll is not part of its story — the damage and its KO claim stand exactly as they would with no sub at all.',
    {tentacruelSubstitute: 'fresh'},
    'Boomburst',
  ),
  moveHover(
    'A Substitute that actually absorbs it',
    'The count is the whole of what this surface says about a doll — one number, in the same shape as the range above it, reading the same for a one-hit move and a five-hit one. It takes Zoroark-Hisui to show: Noivern, the mon this battle had out, has Infiltrator and walks through every sub in the format.',
    {tentacruelSubstitute: 'fresh', ourZoroark: true},
    'Focus Blast',
  ),
  moveHover(
    'The same doll, already dented',
    'A chipped sub can only break sooner, so the fresh figure becomes a cap rather than a bracket — the client tracks that a doll exists but never how much of it is left.',
    {tentacruelSubstitute: 'dented', ourZoroark: true},
    'Focus Blast',
  ),
  moveHover(
    'A KO the doll puts out of reach',
    'Tentacruel is on 15% HP and the hit would kill twice over. Red means a Pokémon faints, and behind a doll none does — so the KO claim and the ladder go, and the range stays exactly as computed.',
    {tentacruelSubstitute: 'fresh', tentacruelHpPercent: 0.15, ourZoroark: true},
    'Poltergeist',
  ),
  moveHover(
    'An INFILTRATOR attacker meets one',
    'Same verdict, different reason, and not a contrivance: gen9 randbats gives Noivern exactly one ability, so every Noivern in the format walks through a doll — which is why the absorbing previews above had to send out a different Pokémon.',
    {tentacruelSubstitute: 'fresh'},
    'Draco Meteor',
  ),
  pokemonHover(
    'Foe active',
    'The information game',
    'Every randbats set still consistent with what Tentacruel has revealed, each move carrying its damage into our active, under the ⚡ speed verdict for the pair.',
    {},
    'Tentacruel',
  ),
  pokemonHover(
    'Foe active',
    'Foe threats, blunted by OUR Substitute',
    'The same block with a doll in front of our Noivern: the numbers are still true about the Pokémon, so they stay — but nothing they throw is close to a KO, so the danger colouring goes.',
    {noivernSubstitute: 'fresh', myNoivernHpPercent: 0.2},
    'Tentacruel',
  ),
  pokemonHover(
    'Foe active',
    'A Ditto wearing our own Noivern',
    'Transform copies the target whole and keeps only its own HP, so the calc has to read a body no dex record describes.',
    {foeDitto: 'transformed'},
    'Ditto',
    scenarioDataWithDitto,
  ),
  pokemonHover(
    'Our active',
    'The matchup view',
    'Our own hover leads with the ⚡ verdict and withholds the outgoing lines — the move buttons right below already carry those numbers in more detail.',
    {},
    'Noivern',
  ),
  switchHover(
    'A doll the bench mon cannot ignore',
    'Zoroark-Hisui was on this team and does not have Infiltrator, so here a Substitute finally absorbs something. Its set carries both cases at once: Focus Blast and Poltergeist each report the hits they need, while Hyper Voice — a sound move — reports none, because the doll is not in its way.',
    {tentacruelSubstitute: 'fresh'},
    ZOROARK_BENCH,
  ),
  switchHover(
    'The same doll, already dented',
    'A chipped sub can only break sooner, so the count becomes a cap rather than a bracket — the client tracks that a doll exists but never how much of it is left.',
    {tentacruelSubstitute: 'dented'},
    ZOROARK_BENCH,
  ),
  switchHover(
    'Switch menu, with hazards down',
    'A switch-in candidate answers "can it threaten, does it survive, do I outspeed" before you commit — and its damage is read through the entry hazards it would land in.',
    {nearStealthRock: true, nearSpikes: 2},
  ),
  switchHover(
    'Switch menu, holding a Choice Scarf',
    'The same bench mon with a Scarf: the ⚡ verdict is the thing that flips, which is the whole question a switch asks.',
    {},
    {item: 'choicescarf'},
  ),
];
