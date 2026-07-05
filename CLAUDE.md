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
  - `resolve.ts` — the evidence law: `resolveMon` merges live facts over randbats
    possibilities into the one set we calculate with; `inferSets` narrows the candidate
    roles by ALL public evidence (moves, item incl. `prevItem`, ability) into a
    `SetKnowledge` for display.
  - `render.ts` — model → tooltip HTML string: `renderMoveSection` (one move's damage)
    and `renderSetsSection` (the information game, both perspectives). `moves.ts` —
    multi-hit move table (data only; no colocated test — covered via `damage.test.ts`).
  - `types.ts` — shared vocabulary (`LiveFacts`, `RandbatsEntry`, `ResolvedMon`,
    `SetKnowledge`, `FieldFacts`).
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
  team lives in `battle.myPokemon`, which we never read).
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
