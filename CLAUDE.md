# CLAUDE.md — hi-chu

## At a glance
An MV3 browser extension that augments Pokémon Showdown tooltips. **Damage works in
every format**; the **information game** needs a set feed, so it is Random-Battle-only.

Hovering one of **our move buttons** shows that move's damage into the opposing active
(with **granular multi-hit damage** — a true KO% that integrates over the random 2–5 hit
count, not `k × one roll`); hovering **our own Pokémon** (benched included) leads with
the **matchup view**: our real moves' damage into the foe active, read from the private
team, followed by its defensive mirror — an **`Incoming:`** group showing what the foe's
own moves would do INTO that mon, so a switch decision reads both "can it threaten?" and
"does it survive?" in one place (randbats-only, like the ⚡ verdict below). In a
**Random Battle** those surfaces sit atop the information game — hovering a
**Pokémon** shows which randbats sets are still possible given every public reveal (moves
used, item incl. consumed/knocked-off, ability), with damage vs our active attached on
the opponent's tooltip and the mirror ("their read on you") on our own; a **⚡ speed-order
verdict** (exact randbats speeds, a surviving Scarf set as an "if …" aside, Trick Room
flipping the verdict) leads a foe hover and heads each "vs \<foe\>" block of the matchup
view — including the **switch menu**, so a benched mon answers "do I outspeed if I send
this in?" before you commit. In an **open format** (OU, VGC, Custom
Game) there is no feed to enumerate, so the foe's spread is **bracketed, not guessed**
(`core/assume.ts`): two labelled damage lines, `uninvested` and `max HP/Def` (mirrored to
SpD for a special move), one ⚠ note naming the assumption — while OUR side stays exact,
built from the server's own final stats. Calcs are **reality-aware** (active Tera — incl.
a ticked-but-not-yet-used Terastallize box previewing YOUR move damage — status, boosts,
current HP, weather/terrain/screens/Tailwind) and delegated to `@smogon/calc` so
interactions resolve correctly. This file is the orientation map; `README.md` has the full
prose and diagrams.

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
  - `speed.ts` — the speed-order law: effective Speed per still-possible set (delegated
    to the calc's `getFinalSpeed`), distinct outcomes bucketed like damage, Trick Room
    flipping the who-moves-first verdict (an order inversion, never a stat change).
  - **The set-inference pipeline, split by concern** (was one `resolve.ts`):
    - `facts.ts` — tiny shared readings of `LiveFacts` (`toId`, `innateAbility`,
      `isMegaForme`); a leaf so the layers below needn't depend on each other for them.
      `innateAbility`'s dex check now serves `deductions.ts`; role narrowing is governed by
      `narrow.buildableAbilities` (see the invariant).
    - `deductions.ts` — the behavioural deduction layer: SILENT items (Life Orb, Heavy-Duty
      Boots) deduced ABSENT from public behaviour. `ruledOutItems`/`survivingItems`; adding
      a deduction = one predicate + one line. Keeps the matcher general (it filters a pool,
      it doesn't know mechanics).
    - `narrow.ts` — the evidence law: `roleMatches` + `selectRoles` narrow roles by ALL
      public evidence (moves, item incl. `prevItem`, innate ability, active Tera) plus the
      deduction rule-outs. The one place the "which roles survive" rule lives —
      `buildableAbilities` is the guard that an ability no SET could carry narrows nothing.
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
  - `transform.ts` — the Transform law (Ditto's Imposter): a Pokémon that has copied another
    one WHOLE. `transformCopy` builds the copy (the target's body and final numbers, wearing
    the copier's HP — the one stat Transform never takes); `applyTransform` overlays it on the
    copier's resolution, from the one place a ResolvedMon is made. Its sibling `illusion.ts` is
    the case we can only SUSPECT; this is the one the client tells us outright.
  - `assume.ts` — the OPEN-format assumption law (no feed): the foe's unknown spread
    bracketed by its two honest extremes on the axis the move attacks, crossed with the
    species' dex abilities. A second producer of `SetVariant`s, reusing `resolve`'s
    `buildResolved` writer but never `narrow` (see the invariant below).
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
  Each builder switches exhaustively on `detectFormat(battle).kind` — the randbats arm is
  the feed-driven code, the open arm the assumption-driven one — and takes `data:
  RandbatsData | null` (null in an open format; there is no feed). Two seams the arms plug
  into: `DefenderVariantsFor` (what the foe could still be, per move) and `FactsReader` (how
  a Pokémon is READ — beyond the snapshot it resolves a Transform, which means resolving the
  Pokémon that was copied, so only a format-aware reader can build it). No DOM/cache, so the
  real-battle fixture test (`section.test.ts`) drives the exact path a live hover runs.
- `src/content.ts` — thin shell; resolves the format, looks up/warms the cached feed (only
  for a randbats format — an open one never fetches), hands off to `section.ts`, and
  monkey-patches BOTH tooltip renderers, `showPokemonTooltip` and `showMoveTooltip` (runs
  in MAIN world).

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
- ✅ **`detectFormat` is a discriminated union; the surfaces split on `kind`, not on a
  feed's presence.** `{kind:'randbats', formatId, …} | {kind:'open', …} | null` (null only
  for an empty `tier`). The set-inference surfaces — sets view, mirror, ⚡ speed line,
  Illusion, Pain Split — are **randbats-only**: each needs a pool to infer over, and a foe
  hover in an open format renders NOTHING rather than a guess. The damage surfaces (move
  tooltip, own-hover matchup, switch menu) run in both. An open format's `doubles` reads
  the client's `gameType` (a randbats id carries its own); it never fetches a feed. Checked
  by `readState.test.ts` (the union, incl. `[Gen 9] OU` → open), `content.test.ts` (no
  fetch in an open format), and `section.test.ts` (the foe hover is silent). The exhaustive
  `switch (format.kind)` + `unreachable(never)` in `section.ts` is what fails the *build*
  when a third kind appears.
- ✅ **An unknown foe spread is BRACKETED, never guessed.** With no feed, `core/assume.ts`
  gives the defender its two honest extremes on the axis THIS move attacks — `uninvested`
  (0 EVs, Serious) and `max HP/Def` (252/252 Bold), mirrored to `max HP/SpD` (Calm) for a
  special move — crossed with the species' dex ability slots (`SpeciesData.abilities`,
  a tolerant new dex read). The real spread lies between the two lines. The same
  `bucketByDamage` machinery collapses and labels them, so a defensively-inert ability
  never splits the line. Item: nothing is ever assumed (a revealed one still applies);
  ONE ⚠ "foe EVs/item assumed" note per tooltip, appended after the per-foe sections via
  `renderNotes` — never per section, so doubles doesn't repeat it. Checked by
  `assume.test.ts`, `variants.test.ts` (the compound `role · ability` label axis, watched
  failing), and `section.test.ts` (two labelled lines, the axis follows the category, one
  note, Leftovers/Sash asides silent with no pool).
- ✅ **`assume.ts` reuses the `buildResolved` WRITER but never the `narrow` matcher.** The
  known-facts-win law lives in one place (`resolve.buildResolved`, now exported alongside
  `dedupeVariants`) — forking it would be the real cost. But `narrow.roleMatches` rejects
  any role whose move pool lacks a revealed move, and an assumed spread has NO move pool:
  running it would falsely report "matched no known set" the moment a foe reveals a move.
  Narrowing is an *evidence law over feed roles*; there is nothing to narrow here. `nature`
  is optional on `RandbatsRole` for the same reason the assumption pool needs it and the
  feed never sets one (`role?.nature ?? 'Serious'` keeps randbats byte-identical — checked
  by `resolve.test.ts`).
- ✅ **OUR OWN side is exact in open formats: the server's final stats, via a SOLVED
  equivalent spread.** The request JSON ships `myPokemon[i].stats` (the five finals;
  `maxhp` is HP) but no EVs/nature, so `readState.serverStats` reads them whole-or-nothing
  into `LiveFacts.knownStats` and `damage.spreadForFinalStats` solves the (nature, EVs,
  IVs) that reproduce them exactly, verified against the calc's own exported `calcStat`.
  **Not a `rawStats` mutation:** `calculate()` clones both mons (`calc.js`) and the clone
  re-derives stats from nature/EVs/IVs, so a mutation silently vanishes — a spread
  survives. Unsolvable finals fall back to the assumed spread rather than crash the hover.
  `knownStats` is populated ONLY by open-mode section paths (randbats spreads are public
  and already exact), which is what makes randbats byte-identity structural. Same
  `myPokemon` privacy principle as `readOwnItem`: our-view surfaces only. Checked by
  `damage.test.ts` (pinned numbers, the L50/VGC and minus-nature cases, the fallback) and
  `readState.test.ts`. 👁 for drift: `myPokemon` needs a player → `npm run player-check`.
- ◐ **Delegate damage interactions to `@smogon/calc`; never hand-apply status/ability
  modifiers.** Guarded for the known case by `damage.test.ts` ("Guts negates burn"), but
  nothing stops a new hand-rolled modifier — keep this on review.
- ✅ **`teraType` is set only when the Tera is ACTIVE for that calc** — actually terastallized
  (setting it activates Tera in the calc; never speculate a Tera type; checked by
  `resolve.test.ts` "only applies a Tera type when the Pokémon has actually terastallized"),
  with ONE sanctioned preview: OUR OWN attacker on the move tooltip when the move panel's
  Terastallize checkbox is ticked. That isn't speculation — the type is our own private truth
  (`readOwnTeraType` via `battle.myPokemon`; the client keeps `teraType` set whether or not the
  Tera has been used) and activating it is the user's declared intent for the pending move. The
  toggle lives ONLY in the DOM in both clients (`input[name=terastallize]` production,
  `input[name=tera]` preact), so `readTeraToggled` reads the checkbox, scoped to this battle's
  `#room-<roomid>` element so a second battle's box can't leak in; `content.ts` passes the flag
  and `buildMoveSection` applies it — it never touches the foe's variants, the sets/mirror
  views, or the ⚡ line, and is moot once actually terastallized. Checked by `section.test.ts`
  ("Terastallize ticked": STAB applies and the line says Tera; no private type or already
  Tera'd → byte-identical output) and `readState.test.ts` (`readOwnTeraType`, `readTeraToggled`
  incl. the no-cross-room-leak case). 👁 for drift: the checkbox selector can't be probed by
  `drift-check` (a spectator replay has no move controls) — `npm run player-check` (a real
  two-account battle) probes it after a client update. The sets view may LIST possible Tera
  types, but they are display-only `SetKnowledge` — they never reach the calc.
- ✅ **A ticked Mega Evolution box previews OUR active mon's Mega forme — same footing as the
  Tera preview, wider reach because Mega swaps the whole forme.** The move-panel Mega box is the
  user's declared intent, and the stone in hand is our private truth, so it's not speculation.
  The toggle lives ONLY in the DOM (`input[name=megaevo]` production, `input[name=mega]` preact);
  `readMegaToggled` reads it room-scoped exactly like `readTeraToggled` (both now share
  `readToggle`). The forme comes from the held stone through the client dex — `readMegaForme`
  mirrors the client's own tooltip (`battle.dex.items.get(stone).megaStone[species.name]` →
  `readSpeciesData` for that forme). `megaPreviewFor` overlays the Mega onto the resolved
  attacker: **stats and typing** (the forme's own dex record, or `speciesData` when the calc
  lacks it — a Champions-invented Mega — via the existing `unknownSpeciesOverrides` fallback) and
  the **forme-locked ability** (replaces the base one; cleared when the dex can't name it so the
  calc defaults to the Mega's own). The SET is unchanged — a stone-holder already resolves to its
  Mega SET via `megaEntryForItem`; only the calc-facing identity was still the base forme. **Two
  reaches, split by mechanic:** the Mega's OFFENSIVE stats hit **damage in every gen** (move
  tooltip + own-hover matchup), but its **Speed hits the ⚡ verdict only from gen 7** — in gen 6 a
  Pokémon moved at its BASE Speed the turn it evolved (Showdown defers the move's priority to
  post-Mega only when `gen === 7`; gen 8/9 keep the same-turn behaviour). `megaSpeedApplies(gen)`
  owns that split, which is why `ownMovesSection` takes a distinct `speedAttacker`. Applied ONLY
  to our-view surfaces for our ACTIVE mon (`mon.side.active` guard) — never the foe's variants,
  the opponent's-knowledge mirror, or a benched mon (the switch menu: it can't Mega the turn it
  switches in). `knownStats` (an open format's base-forme finals) is dropped under the swap — they
  don't describe the Mega. Checked by `section.test.ts` ("previews the Mega forme": damage swings,
  the gen-7-vs-gen-6 ⚡ split, and byte-identity for unticked / no-stone / already-Mega / benched —
  each guard watched failing) and `readState.test.ts` (`readMegaToggled`, `readMegaForme` incl. the
  already-Mega and no-stone guards). 👁 for drift like Tera, on a mega-capable format — gen 9
  randbats has no Megas, so use `node scripts/player-check.mjs gen9championsrandombattle`. It
  probes `readMegaForme`'s live source (the stone→forme dex map, plus any stone-holder in the
  private team — verified live: Gengar/Gengarite → Gengar-Mega, Dragonite/Dragoninite →
  Dragonite-Mega); `battle.dex.items` is also readable in a spectator replay, so `drift-check`
  guards the map shape too. The checkbox SELECTOR still needs the Mega mon ACTIVE with the move
  menu open (a random battle rarely obliges) — a team format that forces a Mega lead is the
  reliable way to exercise it end to end.
- ✅ **Set narrowing uses every public reveal, nothing private.** Roles are filtered by moves
  used, revealed item (held or `prevItem`), and revealed ability — checked by
  `resolve.test.ts` ("evidence beyond moves narrows the role"). The own-side mirror view is
  honest only because client `Pokemon` objects carry public info exclusively (the private
  team lives in `battle.myPokemon`).
- 👁 **`battle.myPokemon` feeds OUR-view surfaces only — four reads (`readOwnItem`,
  `readOwnTeraType`, `readOwnMoves`, `readOwnStats`), all through `readOwnServerPokemon`
  (slot-keyed for an active mon — see the Illusion bullet below), never the set/mirror views.** The
  principle: private facts (you know your own item even when it's *silent* to the opponent —
  Heavy-Duty Boots never reveals itself) may inform what WE see, and must never leak into the
  opponent's-knowledge views, which stay strictly public — that separation is the whole
  reason the "their read on you" mirror is honest. `readOwnStats` (the exact finals, open
  formats only) is the newest member and obeys the same rule; see its own bullet above.
  Five consumers. Two go through
  `ownItemName` (which maps the client's id
  form `heavydutyboots` to the set's display name; `@smogon/calc` silently ignores the id
  form, so the id→name map is load-bearing): (1) your own attacker's item on the move tooltip,
  making YOUR damage exact without assuming the set's first item (e.g. an Iron Bundle read as
  Choice Specs, ~1.5× too high); (2) our side of the ⚡ speed line on a foe hover, so a Scarf
  we're holding judges the order correctly (showing US our own speed as uncertain would be
  absurd). The third is `readOwnTeraType`: your own Tera type for the selected-Tera preview
  (see the `teraType` bullet). The fourth is `readOwnMoves`: your full moveset for the
  own-hover matchup view (next bullet) — the battle view's `moveTrack` knows only REVEALED
  moves, so the private team is the one source that knows a benched mon's whole kit. Checked by
  `section.test.ts` ("uses YOUR real item…"; the mirror carries no ⚡ line) and
  `readState.test.ts` (`readOwnItem`, `readOwnMoves`). 👁 not ✅ for drift: `myPokemon` only
  exists for a player, so `drift-check` (a spectator replay) can't exercise it — probe it
  with `npm run player-check` (a real two-account battle) after a client update.
- ✅ **Hovering our OWN Pokémon (benched included) leads with the matchup view — our real
  moves' damage into the foe active — and the mirror below stays strictly public.** The
  switch-decision answer: a benched mon's move buttons aren't hoverable, so this is where its
  numbers live (the exact mirror of why the foe view attaches threat damage to THEIR
  unhoverable moves). `section.ownMovesSection` takes the resolved attacker + the private
  moveset (id form — `calcDamage` resolves ids through the dex, so `report.move` is always
  the display name) and computes per-move damage against whatever the format's
  `DefenderVariantsFor` supplier believes the foe could be (randbats: `resolveVariants` +
  Illusion variants; open: `assume.ts`'s bracketing spreads), bucketed by distinct outcome
  exactly like the move tooltip — a hidden
  Assault Vest splits the line into labelled outcomes, never one confidently-wrong number
  (`renderOwnMovesSection`; no nHKO ladder — the compact view skips the survival sim). In a
  randbats format each "vs \<foe\>" block leads with the ⚡ speed verdict for that pair (see
  the speed-order bullet), so the switch menu answers "do I outspeed if I send this in?"
  **Two entry paths, split by what the client hands the tooltip.** (1) A battle-view Pokémon
  (your active's hover, a revealed mon's sidebar icon) → `ownHoverMatchup` inside
  `buildPokemonSection`: public facts + `readOwnMoves`/`ownItemName`, mirror blocks below.
  (2) The SWITCH MENU → `buildSwitchSection`: the client dispatches
  `showPokemonTooltip(null, serverPokemon)` there — its battle-view lookup is commented out
  in `battle-tooltips.ts`, and a never-revealed benched mon HAS no battle-view object — so
  the block is built straight from the private `ServerPokemon`
  (`readState.serverPokemonFacts` parses details/condition, preferring the client's parsed
  fields). No mirror on that surface: it would have to be derived from private facts, and
  the native switch tooltip already shows your full real set. `server.item === ''` is a
  KNOWN empty slot (knocked off/consumed) — the resolved item is forced to none, never the
  set's assumed item. Found by the two-account live battle (`npm run player-check`), not by
  the replay harness — a spectator replay has no switch menu. Status moves get no line; a
  fainted mon (can't switch in), a spectator (no private team), or an all-status kit gets no
  block — the mirror (where it exists) then renders alone. One "vs <foe>" block per foe
  active (two in doubles); the header always names the target, since this tooltip is about
  OUR mon. Checked by `section.test.ts` ("the matchup view" + "buildSwitchSection": leads
  before the mirror, same numbers as the move tooltip, AV split, no private leak into the
  mirror, knocked-off item resolves to none — guards watched failing with the section
  disabled, the id→name resolution reverted, and the gone-item strip removed),
  `render.test.ts` (`renderOwnMovesSection`), `readState.test.ts` (`readOwnMoves`,
  `serverPokemonFacts`), and `content.test.ts` (the null-clientPokemon routing).
- ✅ **The matchup view's defensive half: an `Incoming:` group showing what the FOE's own
  moves would do INTO the mon this tooltip is about — the mirror of the outgoing lines
  above it.** "Can it threaten?" (the outgoing lines) is only half the switch decision;
  "does it survive?" needs the reverse calc, and the switch menu is the only surface a
  benched mon's numbers can appear on at all — same reasoning as the outgoing half.
  `section.randbatsIncomingMovesFor` is the mirror of `DefenderVariantsFor`: there, a
  fixed move fans out over hidden DEFENDER sets; here, the fixed defender (this tooltip's
  mon) fans out over hidden ATTACKER sets, one entry per still-possible foe move. It reads
  the sets view's OWN per-role move knowledge (`knowledge.inferSets`) crossed with
  `resolve.resolveVariants`' full item/ability fan-out, aligned by ROLE NAME — the same
  alignment `resolveByRole` already relies on for the sets view's per-candidate damage —
  so a hidden Life Orb/Choice item splits an incoming line into labelled outcomes exactly
  like the move tooltip's defender side (never a set's first-guessed item). A move the foe
  has actually used is marked with the sets view's own ✓ (`OwnMoveLineModel.known`).
  `scoreVariants` is the shared core both directions now funnel through — `moveDamageBuckets`
  varies the DEFENDER, `incomingDamageBuckets` varies the ATTACKER — so "known wins, bucket
  by distinct outcome" can't fork between them. **The field orientation is the trap, same as
  the ⚡ verdict**: the outgoing lines' `field` reads the FOE as defender, but the incoming
  lines need `ourSide` as defender (a screen or Tailwind on OUR side applies here, the foe's
  does not) — computed as a second, oppositely-oriented `readFieldFacts` call inside the same
  `ownMovesSection`. **Randbats-only**, exactly like the ⚡ verdict and for the identical
  reason: an assumed open-format spread has no move pool to enumerate, so `ownMovesSection`'s
  `incomingMovesFor` param is supplied only by randbats callers and simply absent for open
  formats — no `if` inside the shared block builder. Illusion suspects are NOT folded into
  this (unlike the outgoing/sets-view directions) — a suspected Zoroark's moves don't share
  names with the shown species' pool, so they don't fit the per-move-name bucketing shape;
  a real gap, left for later rather than forced into this shape. Checked by `section.test.ts`
  ("the matchup view's defensive half…": the Incoming group on both entry paths, KO context
  against OUR OWN hp not the foe's, the ✓ mark, the item-hidden split, randbats-only — guards
  watched failing with the feature reverted) and `render.test.ts`
  (`renderOwnMovesSection`: the Incoming label, its own hp context, ✓, item split, and that a
  foe block with only incoming content still renders).
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
- ✅ **The forme a Pokémon IS and the forme it is WEARING are different facts, and only the
  calc reads the second.** A PERMANENT forme change (Mega, Palafin-Hero, Terapagos-Terastal,
  Mimikyu-Busted, Eiscue-Noice, Zygarde-Complete) arrives as `|detailschange|` and rewrites
  the client's `speciesForme`. A REVERSIBLE one — Relic Song's Meloetta-Pirouette, Stance
  Change, Zen Mode, Forecast, Shields Down, Hunger Switch, and **Transform** — leaves it
  untouched and records the live forme in the `formechange` VOLATILE, which the client's own
  tooltip reads back through `getSpeciesForme()`. Read the field alone and every reversible
  forme is invisible: a Meloetta mid-Relic-Song was calculated as plain Meloetta (90 Spe / 77
  Atk instead of Pirouette's 128 / 128). `readState.readLiveForme` is that law
  (`volatiles.formechange?.[1] ?? speciesForme`), and it lands on `LiveFacts.liveForme` —
  the same split `ability` (live) and `baseAbility` (innate) already draw. **Inference reads
  `speciesForme`, the calc reads `liveForme`**: a Pirouette still runs a Meloetta set, and
  the feed publishes no changed forme at all (of 509 gen9 species, not one). So the feed
  lookup, `narrow` and `knowledge` keep the built species, and exactly one calc-facing
  writer — `resolve.buildResolved` — prefers the live one. `pickEntry` already strips forme
  suffixes, which is why the PERMANENT formes still find their set. Checked by
  `readState.test.ts` (`readLiveForme`, incl. a permanent forme leaving no volatile) and
  `resolve.test.ts` ("a live forme change"). 👁 for drift: `volatiles` is a new client read —
  `npm run drift-check` guards its shape and says whether the replay actually contained one.
- ✅ **A Transformed Pokémon is calculated as the one it COPIED — body, numbers and moves —
  keeping only what Transform never takes.** Transform is not a forme change. A forme change
  swaps the body and keeps the Pokémon (Pirouette still has Meloetta's spread, and the calc
  derives its stats the ordinary way). Transform swaps the Pokémon: the sim copies the
  target's FINAL stat numbers verbatim (`transformInto`: `storedStats[stat] =
  pokemon.storedStats[stat]`), not the spread that made them — so a Ditto carries someone
  else's stats at its OWN level, and since the damage formula reads the attacker's level, the
  copy hits harder than the Pokémon it copied. `core/transform.ts` owns the law and writes
  the exception once: **HP is the one stat never copied**, so the copy is the target's body
  wearing the copier's HP (`speciesOverride`, an authoritative base-stat record no dex has —
  distinct from `speciesData`, which is only a fallback for a species the calc LACKS). Level,
  item, ability, status and boosts stay the copier's. The copied stats reach the calc as
  `knownStats`, the channel exact finals already travel down — which also DISPLACES the
  copier's own server stats, always stale under Transform (the request ships
  `baseStoredStats`, which `transformInto` deliberately never updates; the client's own
  tooltip distrusts them the same way). The copy is built by the SHELL, because only the
  shell can resolve the target — `section.factsReader`, a seam the format arms supply: a
  randbats target resolves exactly from the feed, and an open format's foe is bracketed
  rather than guessed, so it yields body-only (right species, right types, its own HP, the
  format's assumed spread). Two reveals follow the identity/live split: a starred `moveTrack`
  entry (`*Outrage`) is the COPIED Pokémon's move and must never narrow the copier's set (it
  used to, so a transformed Ditto "revealed" the moveset it was imitating and matched no
  Ditto role); and the sets view goes on naming the Ditto set — its Choice Scarf and Imposter
  are its own — while listing the copied moves under it, each with its damage, since its own
  lone move is spent. Checked by `transform.test.ts` (the law), `readState.test.ts`
  (`readTransformTarget`, the star filter) and `section.test.ts` (the real fixture, a Scarf
  Ditto that copied our Noivern: "⚡ they move first — 249 vs 373" — it holds OUR Speed stat
  and its own Scarf multiplies it — and Draco Meteor into it reads 138.7% not 92%, a Noivern
  body over Ditto's own 225 HP; the HP graft and the star filter each watched failing).
- ✅ **An ability narrows a role only if a SET could have been built with it.** The client
  hands us ability names no set can carry, and each could only ever REJECT every role, never
  select one — so `narrow.roleMatches` ignores any innate ability outside the entry's own
  ability pool (`buildableAbilities`, the union over its roles). Three kinds, one law:
  FORME-LOCKED (Terapagos is built with Tera Shift, which turns it into Terapagos-Terastal on
  switch-in — and the client stamps *that* forme's ability, Tera Shell, over the innate one,
  so every Terapagos hover read "⚠ matched no known set" from the turn it landed; likewise a
  Mega, where the client says "Mega Sol" and the feed says "Leaf Guard"); UMBRELLA
  (Calyrex-Shadow's `As One (Spectrier)` announced as plain `As One`); and BORROWED (a Skill
  Swap before the innate ability was ever revealed). This SUBSUMES the old `isMegaForme` skip
  — a Mega's ability is just another name no set was built with — so `roleMatches` no longer
  asks whether it is looking at a Mega, and the Mega test now fails when THIS law is reverted,
  which is the proof it carries it. Note the Terapagos case is exactly what the dex check
  below cannot catch: Tera Shell is a real ability *of the species it now is*. Checked by
  `resolve.test.ts` (the forme-locked, umbrella and borrowed cases, plus a positive control
  that a real pool ability still narrows as hard as ever — all watched failing).
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
  SPECIES first"), and `render.test.ts` ("flags an Illusion candidate"). That bullet is about
  THEIR Zoroark, which we can only suspect; ours we can simply look up — next bullet.
- ✅ **Our OWN disguised Zoroark is seen through, because the private team names it.** The sim
  sends the disguise's details to the disguised Pokémon's OWN side too (`Pokemon.getFullDetails`
  swaps `details` before splitting secret/shared), so the battle view calls our active a
  Noivern: wrong species, base stats, types, level. The one law: **whenever WE are the subject
  of a calc, our identity comes from the private team** — `section.ownTruth` overlays
  `serverPokemonFacts` on the public battle state, and the four our-view calc sites use it (the
  move tooltip's attacker, the own-hover matchup view, our side of the ⚡ verdict, and the foe's
  threat damage INTO us). The opponent's-knowledge views must NOT: the disguise is exactly what
  they see, so the mirror still shows Noivern's sets, and a foe hover still only *suspects* a
  Zoroark. The battle view wins whenever it agrees on the BASE species, so a forme change it
  learns first (Aegislash-Blade, Mimikyu-Busted, Terapagos-Terastal) is never overridden by a
  request that predates it — only a different Pokémon entirely, which nothing but Illusion
  produces, hands the decision to the private team. **The enabling fix is one layer down:**
  `readOwnServerPokemon` finds an ACTIVE Pokémon by its SLOT (`myPokemon[i]` is whoever really
  occupies active slot `i` — how the client's own tooltips index it), because `ident` names
  only what the battle view SHOWS there; matching a disguised Zoroark on ident returns the
  bench teammate it's imitating, and every private read (item, Tera type, moveset, stats) then
  answers for the wrong Pokémon. A benched mon has no slot and wears no disguise, so it still
  matches on ident. Checked by `section.test.ts` ("an Illusion disguise on OUR side": the
  attacker's damage, the Tera preview, the matchup view vs. the still-public mirror, the ⚡
  speed — guards watched failing with `ownTruth` neutered and with the slot lookup reverted to
  ident) and `readState.test.ts` (`readOwnServerPokemon`: slot, bench, no foe slot).
- ✅ **Set inference keys on the INNATE ability (`baseAbility`), not the live one.** Trace,
  Skill Swap, Worry Seed, Entrainment, Simple Beam, Gastro Acid, and Mummy/Wandering Spirit
  all change or suppress the current `ability`; the randbats set is keyed to what the mon was
  BUILT with. `innateAbility(facts) = facts.baseAbility ?? facts.ability` drives narrowing and
  the "✓ ability" display, while the calc still uses the live `ability` (a Traced Teravolt is
  really active). Checked by `resolve.test.ts` ("set inference uses the INNATE ability") and
  `readState.test.ts`. Without it, a Traced mon panics with "matched no known set".
- ✅ **…and only when the species could actually HAVE that ability — the client can hand us a
  name no set can carry.** A COMPOSITE ability is announced under an umbrella name the dex has
  never heard of: Calyrex-Shadow's `As One (Spectrier)` arrives as `|-ability| As One` followed
  by its components (`Unnerve`, then `Grim Neigh` on a KO), and the client's `rememberAbility`
  stamps that first line — `As One` — into `baseAbility`. The `?? facts.ability` fallback above
  can likewise land on a *borrowed* ability (a Skill Swap before the innate one was ever
  revealed). A feed role only ever lists a species' REAL abilities, so such a name can only
  ever REJECT every role, never select one — every Calyrex-Shadow hover read "⚠ matched no
  known set" from the moment it switched in (replay gen9randombattle-2648347259, reproduced
  live). So `innateAbility` verifies the reported name against the species' own dex ability
  slots (`speciesData.abilities`, the tolerant client-dex read `assume.ts` already relies on)
  and returns undefined when it isn't one of them: it tells us nothing, so it narrows nothing.
  Absent dex slots (older client, a fixture with no `battle.dex`) the name is taken as given,
  exactly as before — a pure false-rejection filter that can't cost real narrowing power.
  `deductions.ts` reads the same `innateAbility` (its inline copy was the second home for the
  law) — **and that is now what this check is FOR**: role narrowing is governed by the
  stronger pool law above (a name no set was built with narrows nothing), but `deductions.ts`
  has no pool to test against and must not trust a bogus name either, or a borrowed ability
  would let it conclude "not Sheer Force" and rule out a Life Orb the mon may really hold.
  Checked by `resolve.test.ts` ("an ability the species cannot have narrows nothing" —
  the umbrella and borrowed cases, both watched failing with the check reverted, and both
  reproduced/cured against the live replay with the shipped bundle).
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
- ✅ **Foe-level item facts qualifying the KO/nHKO lines read the RESOLVED variants,
  never raw facts.** `section.itemStanding` grades an item 'certain' (every surviving
  set holds it, incl. a revealed one) / 'possible' / absent from `resolveVariants`
  output — so a knocked-off/consumed item counts as nothing (a gone Leftovers heals no
  one; reading `facts.prevItem` here was a real never-lie bug). Two consumers: the
  Leftovers nHKO recovery, and the **Focus Sash caveat** on a KO claim ("(if Focus
  Sash: survives at 1 HP)"), which renders only when honest — single-hit move (a
  multi-hit move pops the Sash mid-sequence and the remaining hits still land), full-HP
  defender, real KO chance. Both attach only to a single-outcome line (a sole bucket);
  a Sash never splits buckets itself (it's damage-inert, and its usual pool-mates are
  attacker-side items), so this covers the real cases. Checked by `section.test.ts`
  ("foe-level item facts…") and `render.test.ts` (the caveat's three honesty gates;
  guards watched failing with each gate removed).
- ✅ **Own the hit-count model** in `multihit.ts` (`@smogon/calc` collapses multi-hit to
  `k × one shared roll` and ignores Skill Link / Loaded Dice). This includes the
  **multiaccuracy trio** (Population Bomb, Triple Axel, Triple Kick): each hit after the
  first passes its own 90% check or the move stops — the stop-at-miss law, conditioned on
  hit 1 landing (every damage calc assumes the shown move connects). Loaded Dice DELETES
  the checks (PS `data/items.ts`); Wide Lens lifts each to 99% with PS's own rounding
  (the real Maushold/Smeargle item — other accuracy modifiers are a scope decision, no
  randbats set pairs one with these moves). Checked by `multihit.test.ts` (distributions,
  stop-at-miss, `perHitChance`, the "independent rolls narrow the distribution" guard)
  and `damage.test.ts`.
- ✅ **Variable-power multi-hit is computed per hit, through a stand-in move.** Triple
  Axel (20/40/60) and Triple Kick (10/20/30) get one calc run per hit's true BP, convolved
  over the stop-at-miss counts — exact, not the calc's correlated estimate. The trap: the
  calc special-cases both moves BY NAME, recomputing BP from `move.hits` and **silently
  ignoring `overrides.basePower`** — so `damage.ts` runs each hit as Pound (plain physical
  contact, never special-cased) carrying the hit's BP and the real move's type/category.
  Probe-verified exact vs the real move's `hits: 1` rolls, Technician and Tough Claws
  included. If a future variable-power move is non-contact or carries a punch/slice/bite
  flag, Pound stops being a faithful stand-in — revisit. Checked by `damage.test.ts`
  ("variable-power multi-hit … is computed per hit"; guards watched failing with the law
  reverted).
- ✅ **Rage Fist's power scales with the ATTACKER's own hits taken — a mechanic
  `@smogon/calc`'s move data doesn't model at all** (its table lists a flat `bp: 50`; unlike
  Triple Axel/Kick, nothing in the calc's mechanics recomputes it by name, so
  `overrides.basePower` reaches it cleanly). `readState.timesAttacked` reads the sim's own
  signal off the protocol log — a bare `-damage` line landing on the mon while some OTHER
  Pokémon's move is resolving, one line per hit so a multi-hit move counts every hit it
  lands (mirrors `hasLandedDamagingHit`'s mover-tracking, in the opposite direction: "was I
  hit" instead of "did I hit"). A `[from]` tag (status, hazard, recoil, confusion) never
  counts, which for free excludes a Substitute-blocked hit too — the sub absorbs it as
  `-activate`, not `-damage`, on the real Pokémon. `LiveFacts.timesAttacked` flows through
  `resolve.buildResolved` onto `ResolvedMon`, and `damage.rageFistPower` computes
  `min(350, 50 + 50×timesAttacked)` (the sim's own `ragefist.basePowerCallback`) as an
  `overrides.basePower` when the move is Rage Fist. **Persists across switches** — the sim
  never resets `pokemon.timesAttacked`, so this is a running count over the WHOLE battle,
  matched by side+name the same way `hasLandedDamagingHit` is. **Transform adopts the
  TARGET's count, not the copier's own** — the sim's `transformInto` overwrites
  `timesAttacked` wholesale (`this.timesAttacked = pokemon.timesAttacked`), so
  `TransformCopy.timesAttacked` carries the target's, and `applyTransform` installs it —
  a transformed Ditto's Rage Fist reads the hits its COPY has taken. Checked by
  `readState.test.ts` (`timesAttacked`: direct hits, multi-hit summing, `[from]` exclusion,
  Substitute exclusion, cross-switch matching), `damage.test.ts` (pinned Runerigus-vs-
  Skarmory numbers at 0/1/3/6/10 hits taken, the 350 cap, defender-side hits not mattering),
  and `transform.test.ts` (the target's count survives the copy, watched failing with the
  law reverted). 👁 for drift: `stepQueue`/`ident` are already `drift-check`-guarded fields.
- ✅ **Speed order: arithmetic delegated, ORDER owned, a fact about the PAIR.** `core/speed.ts`
  computes each still-possible set's effective Speed with the calc's `getFinalSpeed` (Scarf,
  paralysis incl. Quick Feet, Tailwind, boosts, weather/terrain abilities, Protosynthesis) —
  never hand-applied, same rule as damage. That function is a **deep import**
  (`@smogon/calc/dist/mechanics/util`; implemented and typed but not re-exported from the
  index — no `exports` map blocks the path), so `speed.test.ts`'s exact pins (Dragapult L80:
  273 raw / 409 Scarf / 136 par / 546 Tailwind) double as the guard that a calc upgrade
  moving it fails the build, not the hover. Distinct speeds bucket like damage
  (`speedBuckets` reuses `labelBuckets`; a speed-inert item never splits the line) with the
  lead outcome the one most surviving sets share, Scarf/Zoroark as "if …" asides. **Trick
  Room is ours**: an order INVERSION — `compareSpeed` flips the verdict, ties stay ties,
  numbers never change (guard watched failing with the flip removed). The verdict describes
  an ordered (ours, theirs) PAIR, so it renders on **both halves**: leading a FOE hover (one
  ⚡ per our active in doubles), where the "if Choice Scarf" aside sits directly above the
  candidate sets that produce that Scarf; and inside each "vs \<foe\>" block of the matchup
  view — which is what puts it on the SWITCH MENU, the only surface a benched Pokémon's speed
  can appear on at all (`buildSwitchSection`, exactly the argument that justifies the matchup
  view's damage). Our side of the pair always uses our REAL item (the `myPokemon` principle
  above), so a bench mon's id-form Choice Scarf applies, its paralysis halves it, and it
  carries no boosts — it enters with none. **Never the own-side mirror**: that view's honesty
  rests on staying strictly public. **Randbats-only by construction**: `ownMovesSection`
  is shared with the open arm, so the pool is passed in as a `FoeSpeedVariantsFor` seam that
  only the randbats callers supply — an assumed spread (`assume.ts`) brackets the axis a MOVE
  attacks and yields no honest Speed, so the open arm structurally cannot render a ⚡ line.
  **Tailwind orientation is the trap**: `speedSection` reads the field with US as defender,
  `ownMovesSection` with the FOE as defender, so the two tailwind flags are swapped between
  the call sites (guard watched failing with the orientation flipped). Priority is deliberately
  out of scope: speed order, not turn order. New client reads (`tailwind` in
  `sideConditions`, `trickroom` in `pseudoWeather`) → probed by `npm run drift-check`. The
  BENCH ⚡ needs a private team, so a spectator replay can't reach it: `npm run player-check`
  probes it on both sides of the format split (randbats must render one per bench block, an
  open format none), verified live — five bench mons, each its own speed vs the foe active.
  Checked by `speed.test.ts`, `render.test.ts` (verdict/aside/Trick Room/tie lines; the ⚡
  between header and move lines), and `section.test.ts` (real fixture: "⚡ you move first —
  249 vs 216" leads the foe tooltip AND the matchup block, byte-identical; the switch menu's
  Scarf/paralysis/no-boosts reads; the mirror and the open format have no ⚡).
- ✅ **Unburden's ×2 Speed is armed via an explicit `abilityOn` flag, not inferred from
  `item` alone.** `@smogon/calc`'s `getFinalSpeed` reads Unburden off `pokemon.abilityOn` —
  the same generic toggle other gen-8/9 conditional abilities (Flash Fire, Slow Start,
  Stakeout, …) use — rather than deriving it from the held item itself, so a resolved item
  of `undefined` was silently NOT enough to double Speed; the calc has no way to infer it on
  its own. `resolve.buildResolved` computes it: the ability is Unburden AND the item is
  `itemGone(facts)` — the same "confirmed GONE, not merely absent" predicate the Knock-Off/
  consumed-item rule already uses — so a mon that merely started itemless never falsely
  doubles, only one whose item was actually LOST mid-battle (Knock Off, a consumed berry,
  Trick/Switcheroo). `damage.buildPokemon` threads `mon.abilityOn` onto the same calc
  `Pokemon` used for both damage and speed; Unburden itself never affects damage, so this is
  harmless there. Checked by `resolve.test.ts` ("arms Unburden…": armed on a confirmed loss,
  not a mere absence, not for a different ability) and `speed.test.ts` ("doubles Speed for
  Unburden once armed…", pinning the ×2 itself) — both watched failing with the flag never set.
- 👁 **Where we correct @smogon/calc** (things it should arguably handle but doesn't, that we
  own): `multihit.ts` (the multi-hit model above) and the **item id→name quirk** — the calc
  silently *ignores* an item passed in id form (`heavydutyboots`), applying nothing. Fixed at
  the layer that owns it: `damage.knownItem` resolves every item through the calc's own dex
  and hands the calc the DEX display name, so id-form items from any client read apply
  correctly (✅ `damage.test.ts` "a known item applies in id form too"). `section.ownItemName`
  still maps ids to the set pool's names where narrowing/display wants them. NOT in this bucket: `variants.ts`/deductions
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
- ✅ **The Champions feed's `evs` are STAT POINTS, not EVs — converted at fetch.** Champions
  has no EVs/IVs: Showdown's mod (`data/mods/champions/scripts.ts`, `statModify`) reads
  `set.evs` as per-stat points and puts `max(2·points − 1, 0)` where mainline puts
  `IV + ⌊EV/4⌋` (IVs hardcoded 31). Fed literally to `@smogon/calc`, the feed-wide `11`
  deflates every stat on BOTH mons — raw damage roughly cancels, but the shown PERCENT
  inflates because the defender's max HP is the denominator (replay
  gen9championsrandombattle-2646312545: Poltergeist into Arbok read "min 47%" for a true
  42.9%). `randbats.championsStatPointsToEvs` converts with `EV = 8·points − 4` (exact:
  `⌊(8p−4)/4⌋ = 2p−1`), keyed on the format id inside `fetchRandbats` — mainline feeds' `evs`
  ARE EVs and pass through untouched — and the localStorage cache is versioned
  (`STORAGE_VERSION`) so a stale unconverted copy can't outlive an update. Checked by
  `randbats.test.ts` ("champions stat points convert to mainline EVs" pins Arbok's real
  156 max HP at L54, plus the format-id keying through `fetchRandbats`).
- ✅ **A species or item the calc's dex doesn't know must not break the hover.** Champions
  invents Megas (Chandelure-Mega) and stones (Chandelurite) that never existed in a mainline
  game: the species crashes `new Pokemon` (no base stats to read) and the stone crashes gen-9
  Knock Off mechanics (`item.megaEvolves` read off a missing record) — so every hover facing
  one silently lost its section (`content.ts` swallows the throw). Two fallbacks in `damage.ts`:
  `unknownSpeciesOverrides` feeds the calc the CLIENT dex's base data — `readState.readSpeciesData`
  reads `battle.dex.species.get(...)`, the same read the client's own tooltip does, into
  `LiveFacts.speciesData`, validated whole-or-nothing ("never lie") — used ONLY when
  `gen.species.get` comes back empty, so a known species keeps the calc's canonical record;
  and `knownItem` resolves an item the calc's dex lacks to NO item (a stone is damage-inert;
  the itemless number is the correct one, and Knock Off's boost correctly stays off). The
  illusion path strips `speciesData` when it swaps species (`section.illusionVariants`) — the
  disguise's dex data must not tag along into the Zoroark's resolution. Checked by
  `damage.test.ts` ("a species the calc dex does not know…"), `readState.test.ts`
  (`readSpeciesData`), and `resolve.test.ts` (pass-through). `battle.dex` is a new client
  read → probed by `npm run drift-check` (verified against the live client).
- ✅ **Four revealed moves = the full moveset; stop speculating.** A Pokémon has four move
  slots, so once `revealedMoves.length >= 4`, `inferSets` drops the role's remaining pool from
  the display (every shown move is a confirmed ✓). Checked by `knowledge.test.ts` ("stops
  speculating once all four move slots are revealed").
- ◐ **Doubles: the calc's game type is set and both foes are shown.** `detectFormat.doubles`
  (a randbats feed id containing "doubles", else the client's `gameType`) flows to
  `damage.buildField` as `gameType: 'Doubles'` so
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
  exits non-zero if a field we read is gone or malformed (it now also probes `battle.gameType`
  and the dex's species `abilities`). Its player-side twin is
  `npm run player-check`: a replay is a spectator view, so `battle.myPokemon` (the
  `ClientServerPokemon` contract, `stats` included), the switch-menu hover (its matchup
  block and its ⚡ bench verdict — present in randbats, absent in an open format), and the
  Terastallize checkbox are
  invisible to drift-check. Run it on BOTH sides of the format split — `npm run
  player-check` (randbats) and `node scripts/player-check.mjs gen9hackmonscup` (an OPEN
  format that still needs no teambuilder, so the assumed-spread path gets a real request
  JSON; this is what caught the open-format switch menu). Player-check logs two throwaway
  accounts into the real site
  (`PS_ACCOUNT1="name:password" PS_ACCOUNT2=… npm run player-check`; credentials via env,
  never committed), has them battle each other, and probes exactly those reads with the
  shipped bundle, forfeiting when done. **Showdown throttles `act=login` per IP**, so a run
  started soon after another routinely has its first attempt silently go nowhere — `login()`
  retries with backoff and says so. A real refusal is told apart at the source (`action.php`
  answers `{"actionerror":"Wrong password."}`; a throttle answers nothing) and fails fast,
  so a bad password never hides behind the retry loop. Both are 👁 not ✅ because they need a browser + the
  live site, so they can't run in `npm run check`/CI — run them by hand after a client
  update. If either flags drift (or a calc looks wrong), re-derive from the PS source below
  and update `readState.ts` and its tests in lockstep.

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
