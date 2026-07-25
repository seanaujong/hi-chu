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
this in?" before you commit. Hovering one of the **foe's roster icons** answers the
matchup view's mirror question for THEIR bench: our active's damage into that Pokémon as
though it switched in (entry hazards on their side included), withheld once it's actually
active, since the move tooltip already carries that number. In an **open format** (OU, VGC, Custom
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
**Shape of the suite, base to top.** Unit + integration tests (`npm run check`) are the
base and middle — colocated `*.test.ts` beside each module, two tests driven by real
captured data (`integration.test.ts`, `section.test.ts`), and one architecture-fitness
test (`dependency-boundaries.test.ts`) that fails the build if the import graph itself
drifts. All fast, deterministic, CI-gated on every push. `drift-check` and `player-check`
are a different KIND of check above that, not just a slower one: they defend against
Pokémon Showdown's own undocumented client changing shape, not against a regression in
our logic, so a real browser is load-bearing and neither can run in CI's fast path (each
👁 tag in Conventions & invariants below names exactly which invariant only a real
browser can catch). `release-visual-check` sits above even that — human/agent eyes are
the only check for whether a preview LOOKS right, not just computes right.

## Cutting a release
CI's `check` job (typecheck + Vitest) gates every push, but it can't reach the client-shape
drift and `myPokemon`-only invariants tagged 👁 below — those need a real browser and (for
the private-team reads) a real battle. That gap used to mean remembering to run a fuller
local gate before tagging; it no longer does — see below, everything past the version bump
is automatic. `npm run release-check` (build + check + drift-check + player-check, in order)
still exists and is worth running locally while iterating, since it's much faster to debug a
failure on your own machine than in a CI log; `player-check` battles against a throwaway,
self-hosted Showdown server it starts itself (`scripts/lib/local-server.mjs` — cloned +
`npm install`ed into the gitignored `.ps-server/` on first run, a one-time cost of about a
minute), not real play.pokemonshowdown.com accounts — see the invariants section's
`myPokemon` bullet. `.github/workflows/e2e.yml` still runs the same two live checks on
demand (`gh workflow run e2e.yml`) for probing a specific format outside the release flow.

Bump the version FIRST — `release.yml` releases whatever's already in the files, it doesn't
write them. `npm version --no-git-tag-version X.Y.Z` updates `package.json`/`package-
lock.json`; `public/manifest.json`'s `version` field needs the same bump by hand. That's a
normal change to a protected file, so it goes through the same branch + PR + merge as
anything else (see Contributing, below) — but **before merging that PR**, run the
**`release-visual-check`** skill for a human-eyes pass, through Claude-in-Chrome, over the
surfaces nothing scripted reaches at all: Tera/Mega preview toggling, doubles, hazards on
switch-in, Illusion, a foe's roster-icon hover. It drives the REAL loaded extension in an
actual Chrome session rather than injecting the bundle (a live `https://` Showdown page
mixed-content-blocks a locally-served script, and inlining the ~500KB bundle into a tool call
is impractical) — so it needs one manual step first: `npm run build`, then Load Unpacked (or
hit reload) on `dist/` at `chrome://extensions`. This is the one gate that stays manual on
principle: it needs an agent or a human actually judging what's on screen, which nothing
below can assert.

Everything else is automatic and runs on `main` once that PR merges — no pause anywhere in
it, on purpose: that merge is already the one conscious human checkpoint (it's what
`release-visual-check` gates), so nothing downstream stops to ask again. Chained through two
workflows so a release can never again depend on a human's local git or memory matching what
actually happened on GitHub:
1. **`.github/workflows/auto-tag.yml`** runs on every push to `main`, but is a no-op unless
   `package.json`'s version has no matching tag yet — i.e. unless this push WAS the
   version-bump merge. When it is: `verify` runs the exact `npm run release-check` a human
   used to run by hand, gating everything after it — nothing gets tagged, let alone
   released, unless build + typecheck/tests + drift-check + player-check are all green
   (drift-check hits the *live* replay site, so a flaky run here is retried by re-running
   the job, not by bumping the version again, since no tag was ever created). Only then does
   `tag` create+push `vX.Y.Z` at that exact merged commit — never a stale local `main` — and
   `release` hand off to `release.yml` (`workflow_call`, since a tag pushed by the default
   `GITHUB_TOKEN` doesn't cascade-trigger `release.yml`'s own `push: tags` event, so the
   chain has to be explicit). It also guards that `package.json` and `public/manifest.json`
   report the same version, failing loudly if the by-hand manifest bump was forgotten.
2. **`release.yml`** builds the zip, hashes it, attests build provenance (see README's
   "Verifying a release"), publishes the GitHub release, then pushes the SAME zip live to
   the **Chrome Web Store** via `chrome-webstore-upload-cli` — the one piece that used to
   stay manual (a dashboard upload at chrome.google.com/webstore/devconsole) no matter how
   automated the GitHub side got. Needs four repo secrets — `CHROME_CLIENT_ID`,
   `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`, `CHROME_PUBLISHER_ID` — from a one-time
   Google OAuth setup only the store account owner can do interactively; follow
   [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys)
   (its `npx chrome-webstore-upload-keys` generates the refresh token) rather than
   duplicating the click-by-click steps here, since Google's own console UI drifts. The
   extension id (`kjdnmonplcbfldefppjoohlleelfcmik`) is public — it's in the store URL — so
   it's a plain env var in the workflow, not a secret.

A manual escape hatch still works if the automation is ever down: `git tag vX.Y.Z
<merged-sha> && git push origin vX.Y.Z` triggers `release.yml` the same way, standalone.
Afterward, `gh release edit vX.Y.Z --notes '...'` to prepend a human-readable summary of
what's new before the provenance-verification boilerplate `release.yml` already writes —
see any past release for the shape.

## Agentic access to the `hi-chu` GCP project
The same `hi-chu` GCP project that holds the Chrome Web Store OAuth client above also
has a scoped identity for an agent (e.g. a Claude Code session) to run `gcloud` through,
instead of running as Sean's own Google account: the service account
`hichu-agent@hi-chu.iam.gserviceaccount.com`, holding `roles/viewer` (read-only) at the
project level. Widen its roles only when a concrete task needs more — start minimal, add
narrowly, the same default-first instinct as everywhere else in this repo.

Access is **impersonation, not a downloaded key**: `seanaujong@gmail.com` holds
`roles/iam.serviceAccountTokenCreator` on the service account, and a dev shell's
`gcloud config` sets `auth/impersonate_service_account` to `hichu-agent@...` as the
default, so every `gcloud` call runs as the service account using the existing personal
login session — no standing secret on disk to leak or rotate, and revoking access is
just removing that one IAM binding. This only works interactively, since impersonation
needs the underlying personal login already active — an unattended/CI use of this
identity would need a different approach (e.g. workload identity federation), not
covered here since nothing yet needs it. Every call the service account makes is
attributed to it, not to Sean's personal account, in GCP's own Cloud Audit Logs — the
audit trail is a built-in GCP feature, not anything hand-maintained in this repo.

One-time project prerequisite a fresh GCP project doesn't have by default: the Cloud
Resource Manager API. Even a read-only `gcloud projects describe` fails without it, and
enabling it needs project-owner privileges the service account doesn't have — so that
one step runs with `auth/impersonate_service_account` unset (as Sean's own account),
then the impersonation default is restored.

## Contributing — every change goes through a branch + PR
`main` is protected, locally and on GitHub. `npm install`'s `prepare` script points git at
`.githooks/` (`pre-commit` refuses a commit while on `main`; `pre-push` refuses a push to
`main` on any remote) — the local half of the same rule GitHub's branch protection enforces
server-side. A direct commit/push attempt fails with an explicit message, not silently.
So the default workflow for any change, including doc-only ones, is: branch
(`git checkout -b <name>`), commit at a green `npm run check` checkpoint (same
commit-on-your-own default as always — no need to ask before committing), push the branch,
then open the PR with `gh pr create`. Treat the PR as the normal way to finish a task, not
a separate ask each time — the hooks exist so this is the only path that works anyway. In a
Claude Code session, prefer opening that branch in a git worktree (`EnterWorktree`) over
switching branches in place — the main checkout's `dist/` build (loaded unpacked in Chrome
for manual verification) and any other in-progress branch stay undisturbed while the change
is in flight.

## Surfaces — what appears where
The product is six hover targets crossed with a handful of sections, and most "should X
show Y?" questions — including most bug reports — are really about one cell of that grid.
This section IS the grid. `Architecture` below says which file owns each piece; `Conventions
& invariants` says why each rule holds. Read this first when the change is something a
player would SEE; go straight to Architecture when it's something we COMPUTE.

### The hover targets
`content.ts` patches only two client renderers; six distinct targets fall out of which
arguments the client passes them.

- **Our move button** — `showMoveTooltip` → `buildMoveSection`.
- **Our active Pokémon** — `showPokemonTooltip(pokemon)` → `buildPokemonSection`, own branch.
- **Our revealed benched Pokémon** — the sidebar roster icon, same dispatch, non-active.
- **Our switch-menu button** — `showPokemonTooltip(null, serverPokemon)` → `buildSwitchSection`.
  It needs its own builder because the client passes NO battle-view Pokémon here (its side
  lookup is commented out, and a never-revealed benched mon has no battle-view object at all),
  so this surface is built straight from the private `ServerPokemon`.
- **The foe's active Pokémon** — `showPokemonTooltip(pokemon)` → `buildPokemonSection`, foe branch.
- **The foe's roster icons** — same dispatch. `side.pokemon` is filled from the `|poke|` team-
  preview lines, so this fires even for a Pokémon that has never been sent out.

### The sections
- **Damage** (`renderMoveSection`) — the "Damage:" line for one move, plus KO chance, the
  nHKO ladder, the true multi-hit breakdown, and any Focus Sash / Leftovers caveat. One per
  foe active, so doubles renders two.
- **Pain Split** (`renderPainSplit`) — replaces Damage for that one move; it redistributes
  HP rather than dealing any, so the calc returns nothing to show.
- **⚡ speed verdict** (`renderSpeedSection`) — who moves first, as a fact about the (ours,
  theirs) PAIR. Appears standalone leading a foe hover, and again inside each matchup block.
- **Matchup blocks** (`renderOwnMovesSection`) — one "vs \<foe\>" block per foe active,
  carrying up to three things: our outgoing move damage, that pair's ⚡ line, and the
  `Incoming:` group (what the foe's own moves would do INTO the mon being hovered).
- **Sets / mirror** (`renderSetsSection`) — the information game. On a foe hover: still-
  possible sets with each move's damage into our active. On our own: the mirror, what the
  opponent can deduce about us — deliberately carrying NO damage at all.
- **Notes** (`renderNotes`) — ⚠ caveats, attached once per tooltip after the per-foe
  sections so doubles can't repeat them.

### Which target gets which section
A **randbats** format, where everything is available:

| Hover target | Damage | ⚡ lead | Outgoing | ⚡ per block | `Incoming:` | Our dmg into them | Sets | Mirror |
|---|---|---|---|---|---|---|---|---|
| Our move button | ✓ | — | — | — | — | — | — | — |
| Our active | — | — | ✓ | ✓ | withheld | — | — | ✓ |
| Our benched icon | — | — | ✓ +hazards | ✓ | ✓ | — | — | ✓ |
| Our switch menu | — | — | ✓ +hazards | ✓ | ✓ | — | — | never |
| Foe active | — | ✓ | — | — | — | withheld | ✓ | — |
| Foe roster icon | — | ✓ | — | — | — | ✓ +their hazards | ✓ | — |

An **open** format (OU, VGC, Custom Game) has no set feed, so every inference-dependent
cell empties out: the move tooltip and our own matchup blocks survive (the foe's spread
bracketed, ours exact), a **foe hover renders nothing at all**, and there is no ⚡ line,
no `Incoming:` group, and no sets/mirror anywhere.

Two cells say **withheld** rather than "—", and they are the same principle twice, not two
decisions: never show the same number on two surfaces. Our active's `Incoming:` numbers are
already on the foe's own hover, and our damage into an ACTIVE foe is already on the move
tooltip. A switch-decision candidate has no such other source, which is the whole reason
that half exists. "never" is a different thing entirely — the switch menu's mirror is
withheld for privacy, not redundancy (it would have to be derived from private facts).

**In doubles the redundancy argument is only partly true.** The sets view's threat calc
resolves a single defender (`findOpposingActive`), while the withholding applies to BOTH
our actives — so our SECOND active's incoming numbers appear on no surface at all. That's
a known gap in the doubles support (see "What the ◐ rows do NOT cover"), not a rendering
bug, but don't reason from "it's redundant here" without checking the doubles case.

### Rules that govern every surface
Cross-cutting, so they live here once rather than being restated per-cell. Each has a full
invariant bullet under `Conventions & invariants`, named below; this list is the map, not a
replacement for them.

- **Set inference needs a pool, damage doesn't.** The ⚡ verdict, `Incoming:`, sets/mirror,
  Illusion and Pain Split are randbats-only; the damage surfaces run in both formats. See
  *`detectFormat` is a discriminated union*.
- **Private facts flow one way.** `battle.myPokemon` feeds our-view surfaces only and never
  the opponent's-knowledge mirror — that separation is the only reason the mirror is honest.
  See *`battle.myPokemon` feeds OUR-view surfaces only*.
- **Field orientation follows whoever is DEFENDING.** A screen or Tailwind belongs to one
  side, so the same tooltip reads the field twice in opposite orientations when it shows
  both directions. This is the most repeated trap in the codebase. See the ⚡ and
  `Incoming:` bullets.
- **Never lie: bracket or bucket, never guess.** An unknown foe spread is bracketed by its
  extremes; a hidden item/ability splits into labelled outcomes only when the number really
  changes. See *An unknown foe spread is BRACKETED* and *Damage under a hidden item/ability
  is split by DISTINCT outcome*. It bites hardest in the **behavioural deductions**, where
  the rule is stated as a preference: a rule-out is suppressed whenever an ability could
  explain the evidence away (Sheer Force / Magic Guard), and anything genuinely ambiguous —
  an unknown ident, an empty log — resolves to "no signal". Prefer MISSING a rule-out to
  making a false one. See the Life Orb and Heavy-Duty Boots rows.

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
      a deduction = one predicate + one line in `ruledOutItems`, its unit test in the
      colocated `deductions.test.ts` (hand-built facts via `sets.testfixtures.ts`'s
      `liveFacts()`), plus a seam test in `resolve.test.ts` proving it actually reaches
      `resolveVariants` — a rule that filters the pool but never reaches the fan-out is a
      silent no-op. A new OBSERVATION it reads from the protocol log belongs in
      `readState.ts` as a `BehaviorSignals` field; the Life Orb and Boots rows in the
      invariant index name the pattern to copy. Keeps the matcher general (it filters a
      pool, it doesn't know mechanics).
    - `narrow.ts` — the evidence law: `roleMatches` + `selectRoles` narrow roles by ALL
      public evidence (moves, item incl. `prevItem`, innate ability, active Tera) plus the
      deduction rule-outs. The one place the "which roles survive" rule lives —
      `buildableAbilities` is the guard that an ability no SET could carry narrows nothing.
    - `resolve.ts` — the resolution law: `resolveMon` merges live facts over randbats into
      the one set we calculate with; `resolveVariants` enumerates EVERY still-possible set
      (hidden item/ability) for uncertainty-aware damage — grouped by role name
      (`section.groupByRole`) to give the sets view's per-block damage its own
      uncertainty-aware fan-out, the same machinery the Incoming section's attacker side
      already used; `resolveByRole` gives one representative resolution per surviving set
      for callers that want a single pick rather than the full fan-out. All funnel through
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
- `src/data/randbats.ts` — fetch + cache the set feed; the only file that touches the network.
- `src/data/lookup.ts` — pure reads over an already-fetched feed (`pickEntry`, the Mega
  lookups, the Champions stat-point conversion) — split out of `randbats.ts` so `section.ts`
  can depend on the lookups without also depending on a file that calls `fetch`.
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
- **Safari port** — a second, separate delivery mechanism for the SAME `content.ts`, not a
  fork of it (zero Chrome-specific API calls anywhere in `src/`, which is what makes this
  tractable). Safari doesn't support `"world": "MAIN"` declared statically in
  `manifest.json`'s `content_scripts` (confirmed directly from `xcrun
  safari-web-extension-converter`'s own build warning), so `content.ts` needs a different
  way to reach the page's own JS realm and patch its real `window.BattleTooltips`.
  - `src/background.ts` — a background service worker that dynamically registers
    `content.js` for the MAIN world via `scripting.registerContentScripts` (Safari 16.4+
    supports this API even though it doesn't support the static declaration), guarded
    against re-registering across MV3 service-worker restarts. Chrome doesn't need this —
    its static declarative entry already works — so this file is Safari-only.
  - `scripts/build-safari.mjs` (`npm run build:safari`) — builds `dist-safari/`, fully
    separate from `npm run build`'s `dist/` so nothing here can regress the shipped Chrome
    extension. Derives the Safari manifest from `public/manifest.json` (drops
    `content_scripts`, adds the `scripting` permission and the `background` key) rather
    than hand-duplicating it, so name/version/description/icons can never drift from the
    Chrome one.
  - `safari/hi-chu/` — the Xcode project: a thin native shell (`Shared (App)/
    ViewController.swift`) with no real logic, `Shared (Extension)/
    SafariWebExtensionHandler.swift` for native-message plumbing, and `dist-safari/`'s
    bundled output wired in as the extension's background service worker + content script.
    `DEVELOPMENT_TEAM` in `project.pbxproj` is deliberately left uncommitted — every
    contributor sets their own free Personal Team via Xcode's Signing & Capabilities tab.
  - Verification is manual only, on principle: Safari only registers a signed, launched
    extension, and WebDriver-based automation (`safaridriver`, and Apple's own Safari MCP
    server) is structurally blind to Safari extensions by design — confirmed directly, not
    assumed. See `README.md`'s Install section for the hover-and-look steps.

Tests come in two flavours: colocated `*.test.ts` with hand-built stubs, plus two driven by **real
captured data** — `integration.test.ts` (real feed, synthetic mons) and `section.test.ts` (a real
two-sided battle captured live from a replay; the fixture is `__fixtures__/replay-*.json`).

For exact shapes and signatures, read the source and the colocated `*.test.ts` — the
tests are the worked examples (and pin numbers against Showdown). Exception: `moves.ts` and
`types.ts` (pure data/types), and `facts.ts`/`narrow.ts` (covered by `resolve.test.ts`); the move table is exercised
end-to-end in `damage.test.ts` (the `uniform-power multi-hit` cases) — add a case there
when you add a move.

## Conventions & invariants — don't break these
An **index**, not the argument. Each rule is stated once with its enforcement level, the
file whose docblocks own the REASONING (why it exists, what it costs, what it deliberately
doesn't cover), and the tests that fail the build when it's violated. The argument lives
next to the code it governs — follow the "owned by" column to change one of these safely.
Run every machine check at once with `npm run check`; CI runs it on every push.

**Reading the tag.** ✅ machine-checked — a test or the typechecker fails the build.
◐ partially checked — a regression test guards the known cases, but the rule itself is on
review. 👁 review-only — no automatic check, so a human holds the line.

**The meta-rule: tests are the authority.** For any new invariant, add a falsifiable test
and *watch it fail* before trusting it. Every ✅ below was watched failing; an invariant
test you haven't seen fail isn't protecting anything yet.

**Where we correct `@smogon/calc`.** Keep the line clear. A calc *gap* — something it
should arguably handle and doesn't — is ours to own, and each one is a row below: the
multi-hit hit-count model, the item id→name quirk, the nHKO ladder, Pain Split, Rage Fist,
variable-power multi-hit, and unknown species/items. Our *product* is not a calc gap: the
variant/deduction information game and the Illusion species fix are cases where the calc
computed correctly and we chose what to ask it.

**Client field names are reverse-engineered.** The PS client ships no types, so the
structural interfaces in `battle/readState.ts` are the contract, and the stubbed tests
check OUR parsing rather than client drift. The live guards are `npm run drift-check` (a
real replay in headless Chrome) and `npm run player-check` (a real two-account battle on a
self-hosted server — the only way to reach anything behind `battle.myPokemon`). Neither
runs in CI, because both need a browser. If either flags drift, re-derive from the PS
source named in `Pointers` and update `readState.ts` and its tests in lockstep.

**Reading a client field `readState.ts` doesn't already read obliges you to add a probe** to
`scripts/drift-check.mjs` — or `scripts/player-check.mjs` if the field lives behind
`battle.myPokemon` — and to list it under *What only a real browser can guard* below. Those
probe lists are hand-maintained, not derived from the source, so a new read is invisible to
them until someone adds it.

| Invariant | | Reasoning owned by | Checked by |
|---|---|---|---|
| `detectFormat` is a discriminated union — surfaces split on `kind`, never on a feed's presence | ✅ | `battle/readState.ts` (`detectFormat`), `section.ts` | `readState.test.ts`, `content.test.ts`, `section.test.ts` |
| An unknown foe spread is BRACKETED, never guessed | ✅ | `core/assume.ts` | `assume.test.ts`, `variants.test.ts`, `section.test.ts` |
| `assume.ts` reuses the `buildResolved` WRITER but never the `narrow` matcher | ✅ | `core/assume.ts`, `core/resolve.ts` | `resolve.test.ts` |
| OUR OWN side is exact in open formats — server finals via a solved equivalent spread | ✅ | `core/damage.ts` (`spreadForFinalStats`), `battle/readState.ts` (`serverStats`) | `damage.test.ts`, `readState.test.ts` |
| Delegate damage interactions to the calc; never hand-apply status/ability modifiers | ◐ | `core/damage.ts` | `damage.test.ts` |
| `teraType` is set only when Tera is ACTIVE, with one sanctioned preview | ✅ | `section.ts` (`teraPreviewFor`), `core/resolve.ts` | `section.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| A ticked Mega box previews OUR active mon's Mega forme | ✅ | `section.ts` (`megaPreviewFor`), `battle/readState.ts` (`readMegaForme`) | `section.test.ts`, `readState.test.ts` |
| Set narrowing uses every public reveal, nothing private | ✅ | `core/narrow.ts` | `resolve.test.ts` |
| `battle.myPokemon` feeds OUR-view surfaces only, never the opponent's-knowledge views | 👁 | `battle/readState.ts` (`readOwnServerPokemon`), `section.ts` | `section.test.ts`, `readState.test.ts` |
| Hovering our OWN Pokémon leads with the matchup view; the mirror below stays public | ✅ | `section.ts` (`ownMovesSection`, `ownHoverMatchup`, `buildSwitchSection`) | `section.test.ts`, `render.test.ts`, `readState.test.ts`, `content.test.ts` |
| The matchup view's defensive half — the `Incoming:` group | ✅ | `section.ts` (`randbatsIncomingMovesFor`, `ownMovesSection`) | `section.test.ts`, `render.test.ts` |
| Hovering a FOE's roster icon shows OUR active's damage into it | ✅ | `section.ts` (`foeSwitchInDamage`) | `section.test.ts` |
| A LANDED damaging hit with no item revealed rules Life Orb out | ✅ | `core/deductions.ts`, `battle/readState.ts` (`hasLandedDamagingHit`) | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| Taking entry-hazard damage rules Heavy-Duty Boots out; switching in unharmed confirms it | ✅ | `core/deductions.ts`, `battle/readState.ts` | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| The forme a Pokémon IS and the one it is WEARING differ — only the calc reads the second | ✅ | `battle/readState.ts` (`readLiveForme`), `core/resolve.ts` (`buildResolved`) | `readState.test.ts`, `resolve.test.ts` |
| A Transformed Pokémon is calculated as the one it COPIED, keeping only its own HP | ✅ | `core/transform.ts`, `section.ts` (`factsReader`) | `transform.test.ts`, `readState.test.ts`, `section.test.ts` |
| An ability narrows a role only if a SET could have been built with it | ✅ | `core/narrow.ts` (`buildableAbilities`) | `resolve.test.ts` |
| A disguised Zoroark surfaces as its own candidate, never a corrupted one | ✅ | `core/illusion.ts`, `section.ts` (`illusionVariants`) | `illusion.test.ts`, `variants.test.ts`, `render.test.ts` |
| Our OWN disguised Zoroark is seen through — the private team names it | ✅ | `section.ts` (`ownTruth`), `battle/readState.ts` (`readOwnServerPokemon`) | `section.test.ts`, `readState.test.ts` |
| Set inference keys on the INNATE ability (`baseAbility`), not the live one | ✅ | `core/facts.ts` (`innateAbility`) | `resolve.test.ts`, `readState.test.ts` |
| …and only when the species could actually HAVE that ability | ✅ | `core/facts.ts` (`innateAbility`) | `resolve.test.ts` |
| Damage under a hidden item/ability is split by DISTINCT outcome, not by set | ✅ | `core/variants.ts` (`bucketByDamage`) | `variants.test.ts`, `section.test.ts` |
| The sets view's per-candidate damage never guesses a representative attacker either | ✅ | `section.ts` (`candidateDamageByMove`), `core/render.ts` (`moveBreakout`, `koTier`) | `render.test.ts`, `section.test.ts` |
| Format ids are derived like PS's own `toID` | ✅ | `battle/readState.ts` | `readState.test.ts` |
| `render.ts` matches native tooltip styling and layout almost CSS-free | 👁 | `core/render.ts` (`TOOLTIP_STYLE`, `renderMoveSection`, `renderSetsSection`) | `render.test.ts`, `section.test.ts` |
| Foe-level item facts qualifying KO/nHKO read the RESOLVED variants, never raw facts | ✅ | `section.ts` (`itemStanding`) | `section.test.ts`, `render.test.ts` |
| Own the hit-count model — the calc's `k × one roll` multi-hit is wrong | ✅ | `core/multihit.ts` | `multihit.test.ts`, `damage.test.ts` |
| Variable-power multi-hit is computed per hit, through a stand-in move | ✅ | `core/damage.ts` | `damage.test.ts` |
| Rage Fist's power scales with the ATTACKER's own hits taken | ✅ | `core/damage.ts` (`rageFistPower`), `battle/readState.ts` (`timesAttacked`) | `damage.test.ts`, `readState.test.ts`, `transform.test.ts` |
| Speed order: arithmetic delegated, ORDER owned, a fact about the PAIR | ✅ | `core/speed.ts`, `section.ts` (`speedSection`, `ownMovesSection`) | `speed.test.ts`, `render.test.ts`, `section.test.ts` |
| Unburden's ×2 Speed is armed via an explicit `abilityOn` flag, not inferred from `item` | ✅ | `core/resolve.ts` (`buildResolved`), `core/damage.ts` (`buildPokemon`) | `resolve.test.ts`, `speed.test.ts` |
| The fetch/reason/render split is a checked import graph, not just a description | ✅ | `src/dependency-boundaries.test.ts` | `dependency-boundaries.test.ts` |
| "No DOM, no network" is typechecked everywhere but the two files whose job it is | ✅ | `src/tsconfig.pure.json` | `npm run typecheck` |
| A knocked-off / consumed item resolves to NO item, not an assumed set item | ✅ | `core/resolve.ts` (`itemGone`) | `resolve.test.ts` |
| A held Mega stone resolves to the Mega set, not the base forme | ✅ | `data/lookup.ts` (`megaEntryForItem`) | `randbats.test.ts` |
| The Champions feed's `evs` are STAT POINTS, not EVs — converted at fetch | ✅ | `data/lookup.ts` (`championsStatPointsToEvs`), `data/randbats.ts` (`STORAGE_VERSION`) | `randbats.test.ts` |
| A species or item the calc's dex doesn't know must not break the hover | ✅ | `core/damage.ts` (`speciesOverrides`, `knownItem`), `battle/readState.ts` (`readSpeciesData`) | `damage.test.ts`, `readState.test.ts`, `resolve.test.ts` |
| A bug reaching either catch-all is logged, never fully silent — and never breaks the hover | ✅ | `src/content.ts` (`append`), `data/randbats.ts` | `content.test.ts`, `randbats.test.ts` |
| Four revealed moves = the full moveset; stop speculating | ✅ | `core/knowledge.ts` (`inferSets`) | `knowledge.test.ts` |
| Doubles: the calc's game type is set and both foes are shown | ◐ | `core/damage.ts` (`buildField`), `section.ts` (`buildMoveSection`) | `damage.test.ts`, `readState.test.ts`, `render.test.ts`, `section.test.ts` |
| Hazards are modelled ONLY for a switch-in preview — everywhere else, a deliberate no | ✅ | `core/hazards.ts` | `hazards.test.ts`, `readState.test.ts`, `section.test.ts` |
| Strict TS (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`) — conditional spreads, never `{k: x}` | ✅ | `tsconfig.json` | `npm run typecheck` |

### What the ◐ rows do NOT cover
A bare ◐ is unactionable — it says a rule is only partly guarded without saying where the
hole is. Both holes, named:

- **Delegate damage interactions to the calc.** `damage.test.ts` ("Guts negates burn")
  guards the one known case, but nothing stops a NEW hand-rolled modifier being added
  somewhere. This one stays on review; there is no predicate for "nobody hand-applied a
  multiplier."
- **Doubles.** The spread-move 0.75× and the per-foe damage sections are checked. What
  isn't: the sets-view **threat calc reads only our FIRST active** (`findOpposingActive`
  is singular), and doubles-only field effects (Friend Guard, Follow Me) aren't modelled
  at all. Set inference itself is format-agnostic and correct. The first of those
  interacts with the Surfaces grid above — see the note under "Which target gets which
  section".

### What only a real browser can guard
These rows have a 👁 component no CI run reaches, because the fact lives in the live client
rather than in our code. Run the named check by hand after a Showdown client update.

- **`npm run drift-check`** (a spectator replay) — every client field `readState.ts` reads:
  `stepQueue`/`ident`, `volatiles`, `sideConditions` (Tailwind, and the Spikes layer index),
  `pseudoWeather`, `battle.dex` (species `abilities`, and the stone→forme map), `gameType`.
- **`npm run player-check`** (a real two-account battle on a self-hosted server) — anything
  behind `battle.myPokemon`, which a replay has no access to at all: the
  `ClientServerPokemon` contract incl. `stats`, the switch-menu hover and its ⚡ bench
  verdict, and the Terastallize checkbox selector. Run it on BOTH sides of the format split
  — `npm run player-check` for randbats and `node scripts/player-check.mjs gen9hackmonscup`
  for an open format. A Mega-capable format needs
  `node scripts/player-check.mjs gen9championsrandombattle`.

## Pointers
- `README.md` — full architecture, diagrams, install steps. (Known limitations are the ◐
  rows in the invariant index, not a README section.)
- `docs/chrome-web-store-listing.md` — the store listing copy OF RECORD: description,
  privacy-practice answers, host-permission justification, reviewer test instructions,
  submission checklist. Edit it here and paste into the dashboard; don't rewrite it there
  from scratch. Nothing else in this file linked it, so it was easy to miss during a release.
- `PRIVACY.md` — the privacy policy the store listing's Privacy policy URL points at.
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
