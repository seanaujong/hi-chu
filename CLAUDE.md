# CLAUDE.md — hi-chu

## At a glance
An MV3 browser extension that augments Pokémon Showdown **Random Battle** tooltips
on two surfaces: hovering one of **our move buttons** shows that move's damage into
the opposing active (with **granular multi-hit damage** — a true KO% that integrates
over the random 2–5 hit count, not `k × one roll`); hovering a **Pokémon** shows the
**information game** — which randbats sets are still possible given every public
reveal (moves used, item incl. consumed/knocked-off, ability), with damage vs our
active attached on the opponent's tooltip, and the mirror ("their read on you") on
our own. Calcs are **reality-aware** (active Tera, status, boosts, current HP,
weather/terrain/screens) and delegated to `@smogon/calc` so interactions resolve
correctly. This file is the orientation map; `README.md` has the full prose and
diagrams.

## Build, test, run
```sh
npm install
npm run check   # the gate: typecheck (strict TS) + Vitest. Run before every commit; CI runs it too.
npm test        # Vitest alone. The authority — assert against real runs, don't mental-math.
npm run build   # esbuild → dist/ (content.js + manifest.json)
```
In-browser check: `npm run build`, then `chrome://extensions` → Developer mode → **Load
unpacked** → pick `dist/`; open a Random Battle on play.pokemonshowdown.com and hover a
Pokémon. (The logic is covered end-to-end by tests; only this hover needs a human.)
```sh
npm run drift-check   # LOCAL, needs Chrome: runs readState against a live replay (see below)
```

## Architecture — where to make a change
A **pure core + thin browser shell**. Dependencies point one way: the shell uses the
core, never the reverse. (Layering, runtime-flow, and multi-hit diagrams are in `README.md`.)

- `src/core/` — pure: no DOM, no network, unit-tested. All the interesting logic lives here.
  - `multihit.ts` — the probability law (hit-count PMFs + convolution → KO%/expected).
  - `damage.ts` — wraps `@smogon/calc`; builds the calc `Field` from `FieldFacts`.
  - **The set-inference pipeline, split by concern** (was one `resolve.ts`):
    - `facts.ts` — tiny shared readings of `LiveFacts` (`toId`, `innateAbility`,
      `isMegaForme`); a leaf so the layers below needn't depend on each other for them.
    - `deductions.ts` — the behavioural deduction layer: SILENT items (Life Orb, Heavy-Duty
      Boots) deduced ABSENT from public behaviour. `ruledOutItems`/`survivingItems`; adding
      a deduction = one predicate + one line. Keeps the matcher general (it filters a pool,
      it doesn't know mechanics).
    - `narrow.ts` — the evidence law: `roleMatches` + `selectRoles` narrow roles by ALL
      public evidence (moves, item incl. `prevItem`, innate ability, active Tera) plus the
      deduction rule-outs. The one place the "which roles survive" rule lives.
    - `resolve.ts` — the resolution law: `resolveMon` merges live facts over randbats into
      the one set we calculate with; `resolveVariants` enumerates EVERY still-possible set
      (hidden item/ability) for uncertainty-aware damage; `resolveByRole` gives one
      resolution per surviving set (the sets view's per-block numbers). All funnel through
      `buildResolved` so "known wins" is written once.
    - `knowledge.ts` — the information game: `inferSets` renders each surviving role's
      options into a `SetKnowledge` for display (speculative values never reach the calc).
    - `illusion.ts` — Zoroark detection: `illusionSuspects` flags when a revealed move fits
      a Zoroark set but not the shown species (the Illusion tell), so `section.ts` can add
      that Zoroark as an extra defender variant (move view) and candidate block (sets view).
  - `variants.ts` — the distinct-outcome law: run the calc per `resolveVariants` result,
    then `bucketByDamage` collapses identical rolls into the few DISTINCT outcomes and
    names each bucket by the axis that differs (an Assault Vest that changes the number).
  - `render.ts` — model → tooltip HTML string: `renderMoveSection` (one move's damage,
    or one labelled line per damage bucket when the target's item is unknown) and
    `renderSetsSection` (the information game, both perspectives). `moves.ts` —
    multi-hit move table (data only; no colocated test — covered via `damage.test.ts`).
  - `types.ts` — shared vocabulary (`LiveFacts`, `RandbatsEntry`, `ResolvedMon`,
    `SetVariant`, `SetKnowledge`, `FieldFacts`).
- `src/battle/readState.ts` — Showdown's untyped client objects → typed `LiveFacts`/`FieldFacts`.
- `src/data/randbats.ts` — fetch + cache the set feed.
- `src/section.ts` — pure shell orchestration, one builder per tooltip surface:
  `buildMoveSection(battle, pokemon, moveName, data)` for move-button hovers and
  `buildPokemonSection(battle, pokemon, data)` for Pokémon hovers (foe → possible sets
  + damage vs our active; own → what the opponent can deduce, decided by `side.isFar`).
  No DOM/cache, so the real-battle fixture test (`section.test.ts`) drives the exact
  path a live hover runs.
- `src/content.ts` — thin shell; resolves the format, looks up/warms the cached feed, hands off to
  `section.ts`, and monkey-patches BOTH tooltip renderers, `showPokemonTooltip` and
  `showMoveTooltip` (runs in MAIN world).

Tests come in two flavours: colocated `*.test.ts` with hand-built stubs, plus two driven by **real
captured data** — `integration.test.ts` (real feed, synthetic mons) and `section.test.ts` (a real
two-sided battle captured live from a replay; the fixture is `__fixtures__/replay-*.json`).

For exact shapes and signatures, read the source and the colocated `*.test.ts` — the
tests are the worked examples (and pin numbers against Showdown). Exception: `moves.ts`
and `types.ts` are pure data/types with no colocated test; the move table is exercised
end-to-end in `damage.test.ts` (the `uniform-power multi-hit` cases) — add a case there
when you add a move.

## Conventions & invariants — don't break these
Each is tagged by how it's enforced: **✅ machine-checked** (a test/type fails the build),
**◐ partially checked** (a regression test guards known cases, but the rule itself is on
review), **👁 review-only** (no automatic check — a human must hold the line). Run all the
machine checks at once with `npm run check` (typecheck + tests); CI runs it on push.

- 👁 **Tests are the authority.** For any new invariant, add a falsifiable test and watch it
  fail before trusting it. (This is the meta-rule the tags below grade against.)
- ◐ **Delegate damage interactions to `@smogon/calc`; never hand-apply status/ability
  modifiers.** Guarded for the known case by `damage.test.ts` ("Guts negates burn"), but
  nothing stops a new hand-rolled modifier — keep this on review.
- ✅ **`teraType` is set only when a Pokémon has actually terastallized** (setting it activates
  Tera in the calc; never speculate a Tera type). Checked by `resolve.test.ts` ("only applies
  a Tera type when the Pokémon has actually terastallized"). The sets view may LIST possible
  Tera types, but they are display-only `SetKnowledge` — they never reach the calc.
- ✅ **Set narrowing uses every public reveal, nothing private.** Roles are filtered by moves
  used, revealed item (held or `prevItem`), and revealed ability — checked by
  `resolve.test.ts` ("evidence beyond moves narrows the role"). The own-side mirror view is
  honest only because client `Pokemon` objects carry public info exclusively (the private
  team lives in `battle.myPokemon`).
- 👁 **`battle.myPokemon` is read in exactly ONE place: your own attacker's item on the move
  tooltip.** Move buttons only exist for your own active, and you know your own item even when
  it's *silent* to the opponent (Heavy-Duty Boots never reveals itself), so `buildMoveSection`
  reads `readOwnItem` and maps it to the set's display name (the client stores an id like
  `heavydutyboots`; `@smogon/calc` silently ignores the id form, so the id→name map is
  load-bearing). This makes YOUR damage exact without assuming the set's first item (e.g. an
  Iron Bundle read as Choice Specs, ~1.5× too high). It must never leak into the set/mirror
  views, which stay strictly public — that separation is the whole reason the "their read on
  you" mirror is honest. Checked by `section.test.ts` ("uses YOUR real item…") and
  `readState.test.ts` (`readOwnItem`). 👁 not ✅ for drift: `myPokemon` only exists for a
  player, so `drift-check` (a spectator replay) can't exercise it — verify by hand in a live
  game after a client update.
- ✅ **A LANDED damaging hit with no item revealed rules Life Orb out.** Life Orb takes 1/10
  recoil when a damaging move connects and REVEALS itself doing so — so if a mon has landed a
  hit and no item has surfaced, it isn't holding one. It must be a *landed* hit, not merely a
  move used: a miss or an immunity triggers no recoil and proves nothing. A snapshot can't tell
  the two apart (`moveTrack` records the attempt), so `readState.hasLandedDamagingHit` reads the
  protocol log (`battle.stepQueue`) and attributes a `-damage` on a foe to this mon's move —
  excluding anything `[from]` an item/hazard/status/recoil, and matching the mon by `ident`
  (side+name) so a mid-battle switch doesn't misattribute a slot. That yields
  `LiveFacts.landedDamagingHit`; the deduction layer (`deductions.ts`, via `survivingItems`)
  then filters Life Orb from a role's item pool, dropping a role whose only
  item it was. **Never lie:** the rule is suppressed for any role that could be running Sheer
  Force or Magic Guard (both cancel the recoil) unless the revealed innate ability rules that
  out — so a hidden-ability set keeps Life Orb possible. Checked by `resolve.test.ts` ("a landed
  damaging hit with no item revealed rules Life Orb out") and `readState.test.ts`
  (`hasLandedDamagingHit`: miss, immunity, indirect damage, cross-switch matching, substitutes).
  A substitute takes damage in the Pokémon's place — the foe's HP bar never moves — so the scan
  also counts a sub BREAKING (`-end … Substitute`) or being DENTED (`-activate … Substitute`
  with the `[damage]` tag, which separates a real hit from a status move the sub merely blocked);
  this counts only Gen 5+, since Gen 4 took no Life Orb recoil against a sub. Anything genuinely
  ambiguous (an unknown ident, empty log) resolves to "no hit seen" — we miss a rule-out rather
  than make a false one. `stepQueue`/`ident` are new client fields → covered by
  `npm run drift-check`.
- ✅ **Taking entry-hazard damage rules Heavy-Duty Boots out.** Boots negates Stealth
  Rock/Spikes damage, so a mon that took it can't be holding them — the mirror of the Life
  Orb rule (the effect FIRING is the proof, not its absence) and the second member of the
  deduction layer. `readState.tookEntryHazardDamage` scans `stepQueue` for a `-damage` on the
  mon tagged `[from] Stealth Rock` / `Spikes`; `deductions.ts` rules `heavydutyboots` out. No
  ability guard: taking the damage also rules out Magic Guard, the only other thing that
  blocks it. Checked by `resolve.test.ts` ("taking entry-hazard damage rules out the
  Heavy-Duty Boots set") and `readState.test.ts` (`tookEntryHazardDamage`). **The positive
  twin:** switching into Stealth Rock and taking NONE *confirms* Boots (`switchedIntoStealthRockUnharmed`
  → `deductions.bootsRuledIn` → `survivingItems` pins the pool to Boots). Keyed on Stealth
  Rock alone (nothing is type-immune to it; grounded hazards have airborne exceptions), and
  it DOES need the Magic Guard guard — Magic Guard dodges Stealth Rock too, so a hidden
  ability that could be Magic Guard leaves Boots unconfirmed ("never lie"). Checked by
  `resolve.test.ts` ("switching into Stealth Rock unharmed CONFIRMS…" / "never lies about a
  possible Magic Guard set") and `readState.test.ts` (`switchedIntoStealthRockUnharmed`).
- ✅ **A Mega forme matches on forme + stone, never its ability.** A Mega's ability is
  forme-locked (no set-discriminating value) and the live client and feed can name it
  differently (Champions Meganium-Mega: client "Mega Sol" vs feed "Leaf Guard"), so
  `narrow.roleMatches` skips the ability check when `isMegaForme(speciesForme)` — else every
  role is rejected ("matched no known set"). Checked by `resolve.test.ts` ("a Mega forme
  matches on forme + stone").
- ✅ **A disguised Zoroark surfaces as its own candidate, never a corrupted one.** Illusion
  makes the client show Zoroark as a teammate, so the calc/lookup are silently for the WRONG
  species until it breaks — we can't see through it (the client is fooled too). But a
  disguised Zoroark attacks with ITS moves under the disguise's name, so a revealed move the
  shown species can't learn but a Zoroark can (`illusion.illusionSuspects`) means it MIGHT be
  Zoroark. We don't overwrite the shown species — we ADD the Zoroark as an extra defender
  variant (a second "vs Zoroark-Hisui" damage line on the move tooltip, labelled by the
  species axis in `variants.ts`) and an extra candidate block ("⚠ … if Illusion") in the sets
  view. Silent when no move betrays it (a Zoroark mimicking only shared moves is genuinely
  undetectable — honest). Checked by `illusion.test.ts`, `variants.test.ts` ("labels by
  SPECIES first"), and `render.test.ts` ("flags an Illusion candidate").
- ✅ **Set inference keys on the INNATE ability (`baseAbility`), not the live one.** Trace,
  Skill Swap, Worry Seed, Entrainment, Simple Beam, Gastro Acid, and Mummy/Wandering Spirit
  all change or suppress the current `ability`; the randbats set is keyed to what the mon was
  BUILT with. `innateAbility(facts) = facts.baseAbility ?? facts.ability` drives narrowing and
  the "✓ ability" display, while the calc still uses the live `ability` (a Traced Teravolt is
  really active). Checked by `resolve.test.ts` ("set inference uses the INNATE ability") and
  `readState.test.ts`. Without it, a Traced mon panics with "matched no known set".
- ✅ **Damage under a hidden item/ability is split by DISTINCT outcome, not by set.**
  When the target's item is unknown, `resolveVariants` enumerates every still-possible
  set and the move tooltip shows one labelled line per *distinct* damage result — but
  `bucketByDamage` keys on the SHOWN numbers (`percent` + KO), so the many sets that
  deal the same (a defensively-inert item, a shared spread) collapse back to one plain
  line. Only a real swing (Assault Vest halving a special hit) ever splits. Checked by
  `variants.test.ts` ("collapses many sets with identical shown numbers into ONE bucket"
  and the AV split) and `section.test.ts` (the real fixture: special move splits AV vs
  Leftovers, physical move stays one line). A revealed item is just the one-set case.
- ✅ **Format ids are derived like PS's own `toID`** (digits kept, whole title), so bracket
  tags with extra words work — checked by `readState.test.ts` ("[Gen 9 Champions] Random
  Battle" → `gen9championsrandombattle`).
- 👁 **Match native tooltip styling; inject almost no CSS.** The original Randbats
  Tooltip looks crisp because it reuses Showdown's own markup — `<p>` at 12px black,
  `<small>` grey labels, set names as inline `<span style="text-decoration:underline">`,
  `<b>` for confirmed facts — and inherits every font/size/colour. `render.ts` does the
  same. `TOOLTIP_STYLE` has exactly one structural rule, `.hichu-block` (reproduces the
  native `.tooltip-section` divider `border-top:1px solid #888; padding:2px 4px` plus a
  slight grey panel `rgba(0,0,0,.045)`), and the two colour value-adds the original lacks
  (red KO, orange caveat). Each candidate set is one `.hichu-block`; the move tooltip is
  one. Don't reintroduce custom `font-size`/`opacity`/colour on the shell — that's exactly
  what read as muddy. (Verified live against the real old extension and under Showdown's
  own stylesheet via `room.tooltips.showPokemonTooltip`.)
- 👁 **No summary header on the sets view.** The per-set blocks speak for themselves;
  there is no "Possible sets (N of M) · dmg vs …" line (removed by request). Checked by
  `render.test.ts` ("omits the summary header entirely").
- 👁 **Move tooltip is at parity with the native `Damage: X% - Y%` line** — no "vs
  <target>" preamble (native already names the target), and a **non-damaging move gets
  no section at all** (`renderMoveSection` returns `''`). KO% and the multi-hit `Hits:`
  line ride along only when they apply. Checked by `render.test.ts` / `section.test.ts`.
- ✅ **Own the hit-count model** in `multihit.ts` (`@smogon/calc` collapses multi-hit to
  `k × one shared roll` and ignores Skill Link / Loaded Dice). Checked by `multihit.test.ts`
  (distributions + the "independent rolls narrow the distribution" guard) and `damage.test.ts`.
- 👁 **Where we correct @smogon/calc** (things it should arguably handle but doesn't, that we
  own): `multihit.ts` (the multi-hit model above) and the **item id→name quirk** — the calc
  silently *ignores* an item passed in id form (`heavydutyboots`), applying nothing, so
  anything feeding it an item maps to the display name first (`section.ownItemName`,
  `damage.test.ts`'s `isDamagingMove`-era note). NOT in this bucket: `variants.ts`/deductions
  (our information-game product — the calc computes each variant correctly) and the Illusion
  case (input correctness — the calc did its job; we fed it the wrong species). Keep the line
  clear: calc *gaps* here; our *product* elsewhere. Two more calc-gap readouts the calc can't
  do: the **nHKO ladder** (`multihit.koLadder` — a turn-by-turn survival sim, Leftovers
  recovery included; the move tooltip requests it via `CalcDamageOptions.nhkoTurns`, shows a
  2/3HKO line, and an "if Leftovers" aside when the foe *might* hold them) and **Pain Split**
  (`damage.painSplit` — averages both mons' raw HP, capped at each max; `buildMoveSection`
  branches to it before the damage path, since it's a status move the calc returns nothing for).
- ✅ **A knocked-off / consumed item resolves to NO item, not an assumed set item.** Once
  `prevItem` is set with nothing held, `resolve.itemGone` makes `resolveMon`/`resolveVariants`/
  `resolveByRole` drop the item — else the calc keeps applying a gone item (Knock Off stays
  ×1.5, Leftovers keeps "healing"). Checked by `resolve.test.ts` ("resolves to NO item once it
  has been knocked off / consumed"). Knock Off's own ×1.5-on-item boost is `@smogon/calc`'s job
  and works once the resolved item is right.
- ✅ **A held Mega stone resolves to the Mega set, not the base forme.** A mon holding a stone
  is running the Mega set even pre-evolution, but its live forme is still the base one, so
  `entryFor` (via `data.megaEntryForItem`) redirects the lookup to the Mega entry — found by
  the STONE in its item pool, because Champions keys Mega sets irregularly ("Floette-Mega" for
  a Floette-Eternal holding Floettite). Checked by `randbats.test.ts` ("finds the Mega set by
  its stone").
- ✅ **Four revealed moves = the full moveset; stop speculating.** A Pokémon has four move
  slots, so once `revealedMoves.length >= 4`, `inferSets` drops the role's remaining pool from
  the display (every shown move is a confirmed ✓). Checked by `knowledge.test.ts` ("stops
  speculating once all four move slots are revealed").
- ◐ **Doubles: the calc's game type is set and both foes are shown.** `detectFormat.doubles`
  (feed id contains "doubles") flows to `damage.buildField` as `gameType: 'Doubles'` so
  `@smogon/calc` applies the spread-move 0.75× (single-target moves unchanged); and
  `buildMoveSection` folds over `findOpposingActives` (both foes), a `renderMoveSection` per
  target with a "vs <name>" header. Checked by `damage.test.ts` ("spread moves take their
  0.75×"), `readState.test.ts` (the `doubles` flag), `render.test.ts` (the target header), and
  `section.test.ts` ("a labelled damage section for EACH foe"). Still ◐ — the sets-view *threat*
  calc uses only our first active (`findOpposingActive`), and doubles-only field effects (Friend
  Guard, Follow Me) aren't modelled; set inference itself is format-agnostic and correct.
- 👁 **Hazards are deliberately not modelled** — they change switch-in HP, not a move's
  damage, and live HP is already read. Only weather/terrain/screens feed the calc. (Scope
  decision; no check — don't "add" hazards to the damage Field.)
- ✅ **Strict TS** (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`): pass optional
  fields with conditional spreads `...(x !== undefined ? {k: x} : {})`, never `{k: x}`.
  Checked by `npm run typecheck`.
- 👁 **Client field names are reverse-engineered** (the client ships no types). The structural
  interfaces in `readState.ts` are the contract; the stubbed `readState` tests check *our*
  parsing, not client drift. `npm run drift-check` is the live guard — it bundles the current
  `readState` source, runs it against a real replay's `window.battle` in headless Chrome, and
  exits non-zero if a field we read is gone or malformed. It's 👁 not ✅ because it needs a
  browser + the live site, so it can't run in `npm run check`/CI — run it by hand after a client
  update. If it flags drift (or a calc looks wrong), re-derive from the PS source below and update
  `readState.ts` and its tests in lockstep.

## Pointers
- `README.md` — full architecture, diagrams, install steps, known limitations.
- **Before starting, run `git status` and check `.claude/handoffs/` for a local handoff** —
  if present it carries live status, next steps, and landmines (it may reflect on-disk work
  the committed docs lag). It is local and gitignored, so on a fresh clone it won't exist;
  don't rely on it.
- Mechanics of record: `github.com/smogon/pokemon-showdown` — `sim/battle-actions.ts`
  (hit-count & Loaded Dice), `data/moves.ts` (multihit table), `data/random-battles/gen9/teams.ts`
  (85 EV / 31 IV / Serious baseline).
- Client field names: `github.com/smogon/pokemon-showdown-client` —
  `play.pokemonshowdown.com/src/{battle.ts,battle-tooltips.ts}`.
- Set data feed: `https://pkmn.github.io/randbats/data/<formatId>.json`.
