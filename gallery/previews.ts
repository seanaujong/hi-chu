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

import {buildMoveSection, buildPokemonSection, buildSwitchSection} from '../src/section.js';
import {loadBattle, scenarioData, scenarioDataItemAbilitySplit, scenarioDataWithAmoonguss,
  scenarioDataWithGardevoir, scenarioDataTwinRoles, scenarioDataWithCharizard, scenarioDataWithDitto, scenarioDataWithEmboar, scenarioDataWithGreninja} from '../src/scenario.js';

// Re-exported so the gallery can style its panels with the very stylesheet the extension
// injects, rather than a copy of it that could drift.
export {TOOLTIP_STYLE} from '../src/core/render.js';

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
function moveHover(name: string, note: string, over: Overrides, move: string, teraSelected = false, data = scenarioData): Preview {
  const {battle, active} = loadBattle(over);
  const us = active(over?.ourZoroark ? 'Zoroark-Hisui' : 'Noivern');
  return {surface: 'Our move button', name, note, html: buildMoveSection(battle, us, move, data, teraSelected)};
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
    'A multi-hit move, and the range it can’t escape',
    'Icicle Spear lands 2, 3, 4, or 5 times, never anything in between — so the Hits line states that whole-number range rather than an average across it, the same bracket-not-guess principle the per-hit percent already follows.',
    {},
    'Icicle Spear',
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
  moveHover(
    'Strength Sap, and the cap that decides it',
    'A move the calc computes as nothing: it siphons the target’s Attack as HP rather than dealing damage. What it is WORTH is not the question — a siphon bigger than the room to gain it is wasted, so the line states where the sap leaves us. Their Emboar is the target; ours is on 30%.',
    {foeEmboar: true, myNoivernHpPercent: 0.3},
    'Strength Sap',
    false,
    scenarioDataWithEmboar,
  ),
  moveHover(
    'The same sap, turned round by Liquid Ooze',
    'Tentacruel’s only randbats ability inverts a siphon into damage, so healing off it costs us instead. Amber, never the KO red — red on this tooltip means a hit KOes THEM, and wearing it on a cost to ourselves would read as exactly the opposite.',
    {myNoivernHpPercent: 0.3},
    'Strength Sap',
  ),
  moveHover(
    'A sap whose amount the set has not settled',
    'The randbats generator zeroes both the EVs and the IVs of a set with no physical move, so Amoonguss’s two surviving roles disagree about its Attack — and a move that heals by that stat turns the gap into two numbers. No damage surface can see it: neither role attacks with the stat.',
    {foeAmoonguss: true, myNoivernHpPercent: 0.3},
    'Strength Sap',
    false,
    scenarioDataWithAmoonguss,
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
    'One role, three items, and the line that matters',
    'The shape that decides how much screen a hover costs — a Porygon-Z can hold three items and two abilities across four attacks, and naming all six outcomes per move ran the tooltip off the screen. Each move folds into one span; only Surf earns a second line, because Choice Specs is what turns it from a near-miss into a kill.',
    {tentacruelItem: ''},
    'Tentacruel',
    scenarioDataItemAbilitySplit,
  ),
  pokemonHover(
    'Foe active',
    'Two roles the calc cannot tell apart',
    'A feed where two roles share an ability and an item and differ only in their moves — a Sandaconda’s "Bulky Attacker" and "Bulky Setup". A player reads them as different sets; the calc resolves them to one Pokémon. Each block still has to carry its own damage.',
    {},
    'Tentacruel',
    scenarioDataTwinRoles,
  ),
  pokemonHover(
    'Foe active',
    'Two foe speeds, one answer',
    'Emboar has shown Head Smash, which leaves only its Choice-locked role: a Band at 157 Spe or a Scarf at 235. Our Noivern is 249 and moves first against both, so the second speed gets no "if" clause — an aside is for the set that would change the verdict, and neither does.',
    {foeEmboar: true},
    'Emboar',
    scenarioDataWithEmboar,
  ),
  pokemonHover(
    'Foe active',
    'Scarf or Band — nothing has separated them yet',
    'Emboar’s one surviving role runs a Choice Band (157 Spe) or a Choice Scarf (235), and our Noivern sits between them at 166. A Scarf changes no damage number, so nothing computed from a past hit can tell the two apart — the verdict has to hedge, and the Items line lists both.',
    {foeEmboar: true, noivernBoosts: {spe: -1}},
    'Emboar',
    scenarioDataWithEmboar,
  ),
  pokemonHover(
    'Foe active',
    'It moved second, so it is not Scarfed',
    'One turn where both sides used an ordinary move, and Emboar went second. Only the Band set is slow enough for that — so the aside goes, the Items line drops the Scarf, the damage tightens to one item’s range, and the verdict FLIPS from "they move first" to "you do".',
    {foeEmboar: true, noivernBoosts: {spe: -1}, foeMovedFirst: false},
    'Emboar',
    scenarioDataWithEmboar,
  ),
  pokemonHover(
    'Foe active',
    'It set up, so it was never Choiced',
    'Gardevoir has clicked Calm Mind. Its one role pools Choice Scarf, Choice Specs and Life Orb, and the move narrows none of them away — but Showdown never BUILDS a Choice set around a status move, so the item is pinned to the Life Orb on the first click, where the Choice-lock rule would still be waiting for a second freely-chosen move.',
    {foeGardevoir: 'setup'},
    'Gardevoir',
    scenarioDataWithGardevoir,
  ),
  pokemonHover(
    'Foe active',
    'Trick is the status move that KEEPS the Choice item',
    'The same Gardevoir, one move over. A Trick set holds a Choice item because it has one to give away, so the rule that pinned the Life Orb above must stay silent here — all three items survive. Seven status moves behave this way, and they are measured from Showdown\u2019s own generator rather than recalled, because a missing one is a false deduction rather than a missed one.',
    {foeGardevoir: 'trick'},
    'Gardevoir',
    scenarioDataWithGardevoir,
  ),
  pokemonHover(
    'Foe active',
    'The same law backwards: a Choice item forbids the setup',
    'Here the item is what got revealed, so the reading runs the other way — a Choice Specs set is one no Calm Mind belongs to, and the Moves line drops it while keeping every attack and Trick. The Items line and the Moves line under it make a joint claim, so they are narrowed against each other rather than separately.',
    {foeGardevoir: 'banded'},
    'Gardevoir',
    scenarioDataWithGardevoir,
  ),
  pokemonHover(
    'Foe active',
    'Assault Vest or not — nothing has told us yet',
    'Tentacruel\u2019s one role holds either an Assault Vest or Leftovers, and no public fact separates them. A vest changes no damage Tentacruel DEALS, fires no side effect and bends no move order, so every other reveal in the codebase is blind to it: the Items line has to carry both.',
    {tentacruelItem: ''},
    'Tentacruel',
  ),
  pokemonHover(
    'Foe active',
    'Our own hit was too hard for a vest',
    'One Boomburst of ours took 27% off it. Behind an Assault Vest that move reads 16.5\u201319.9%; bare it reads 25\u201329.4%, and only the second contains what happened \u2014 so the vest goes. This is the mirror of every other reading here: the evidence is damage WE dealt, which is why it can see a defensive item at all, and it is the sharper direction because our own set is read exactly off the private team.',
    {tentacruelItem: '', myNoivernItem: 'heavydutyboots', tentacruelTookBoomburst: 0.27},
    'Tentacruel',
  ),
  pokemonHover(
    'Foe active',
    'Our own hit was too soft for anything else',
    'The same Boomburst, but it took only 18%. Now it is the bare set that is impossible and the vest that survives \u2014 the rule cuts whichever way the number points, and never picks the closest set when neither fits.',
    {tentacruelItem: '', myNoivernItem: 'heavydutyboots', tentacruelTookBoomburst: 0.18},
    'Tentacruel',
  ),
  pokemonHover(
    'Foe active',
    'Protean, still unspent',
    'Greninja has not moved yet, so whatever it throws will convert it and arrive with STAB — every line here is boosted, and correctly so. Read it against the preview below: same Pokémon, same turn, one log line apart.',
    {foeGreninja: 'unspent'},
    'Greninja',
    scenarioDataWithGreninja,
  ),
  pokemonHover(
    'Foe active',
    'Protean, already converted',
    'It used Ice Beam, so it IS Ice now and gen 9 will not let the ability fire again this stint. Ice Beam alone reads the same; everything else has lost its STAB, and Hydro Pump has gone from a stated KO to a hit our Noivern lives through. Nothing but the type bar says so on screen.',
    {foeGreninja: 'converted'},
    'Greninja',
    scenarioDataWithGreninja,
  ),
  pokemonHover(
    'Foe active',
    'Out of Blaze range',
    'The same Charizard on 40% of its HP, above the one-third line. Read this beside the preview below: it is the control, and the only thing that differs between the two is the number on the HP bar.',
    {foeCharizardHpPercent: 0.4},
    'Charizard',
    scenarioDataWithCharizard,
  ),
  pokemonHover(
    'Foe active',
    'In Blaze range',
    'The same Charizard on 20% of its HP. Blaze is its only ability, so nothing had to be revealed for this to be true — every Fire line above is worth half as much again, and a chip-damaged sweeper is exactly when a player stops expecting that.',
    {foeCharizardHpPercent: 0.2},
    'Charizard',
    scenarioDataWithCharizard,
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
