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
verdict** (exact randbats speeds, a surviving Scarf set as an "if …" aside where it FLIPS
the verdict — a set that reaches the same answer earns no clause, Trick Room
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
npm run check   # the gate: typecheck (strict TS) + Vitest + the dependency cruise. CI runs it too.
npm test        # Vitest alone. The authority — assert against real runs, don't mental-math.
npm run build   # esbuild → dist/ (content.js + manifest.json)
```
In-browser check: `npm run build`, then `chrome://extensions` → Developer mode → **Load
unpacked** → pick `dist/`; open a Random Battle on play.pokemonshowdown.com and hover a
Pokémon. (The logic is covered end-to-end by tests; only this hover needs a human.)
```sh
npm run previews      # LOCAL, no browser: render every declared tooltip state to a page
npm run drift-check   # LOCAL, needs Chrome: runs readState against a live replay (see below)
npm run drift-check gen9randombattle-2659404198   # …or against ONE named replay
npm run icons         # LOCAL, needs Chrome: redraw EVERY icon from scripts/lib/logo.mjs
npm run deps          # LOCAL, no browser: cruise the import graph (part of `check`)
npm run graph         # LOCAL, no browser: redraw docs/architecture-graph.md from the source
```
**Three things describe the layering, and they are not interchangeable.** The README diagram is
the PIPELINE — what flows where, hand-drawn because it is an argument about design and doesn't
rot. `docs/architecture-graph.md` is the CURRENT SHAPE — which module imports which, generated
by `npm run graph` and never hand-edited, because a hand-drawn version of that is wrong the
first time anyone adds a file (CI regenerates and diffs it, so a stale one fails the build
rather than quietly misleading). The rules that FAIL are split by kind: the project's own named
invariants — calc confinement, core↛shell, `render.ts` type-only, every deduction through
`narrow.ts`, `facts.ts`/`types.ts` as leaves — live in `src/dependency-boundaries.test.ts`,
argued in prose beside each assertion; the generic structural ones — no cycles, no orphans —
in `.dependency-cruiser.cjs`, because they are about the graph as a whole rather than any edge
we could name ahead of time. **Neither restates the other**; duplicating a rule across the two
would recreate the exact drift that motivated them (see the `candidateItems` invariant).
`dependency-cruiser` cannot resolve this codebase unaided — TS ESM writes `./narrow.js` for
`narrow.ts` and its schema has no `extensionAlias` — so `scripts/lib/ts-esm-resolve.cjs` is a
load-bearing resolver shim, not a build config. Its failure mode is SILENT (every edge fails,
leaves look like orphans, the cruise still reports success), which is why `graph.mjs` refuses
to write a graph with fewer edges than modules.
**The icons are generated, never hand-edited.** `scripts/lib/logo.mjs` holds the mark as pure
SVG (no I/O), and `make-icons.mjs` renders it to all sixteen PNGs the repo ships — Chrome's
three, Safari's eleven-file app-icon catalogue, and the two loose Safari copies — plus the
README lockup. Editing one PNG by hand guarantees drift; edit the drawing and re-run. The mark
exists at three levels of detail and `OPTICAL` picks between them by **point** size, not pixel
size, because a retina asset is more pixels of a *small* icon and must stay simple (Safari's
`mac-icon-16@2x` is 32px shown at 16pt). There is deliberately **no tile behind the sweet** —
a frame would have to be wider than the twist ends and could only crop or shrink them, and the
scale that fits the mark to its box is COMPUTED from the geometry (`halfExtent`), never stored,
so moving a vertex can't leave a stale number overhanging the edge. iOS is the one opaque icon,
since it forbids an alpha channel. The README lockup is deliberately ONE file rather than a
light and a dark variant: the name is set in the wrapper's red, which clears the large-text
contrast bar on white (3.7:1) and on a near-black page (5.1:1) alike, and one file cannot be
paired with the wrong background. `node scripts/make-icons.mjs --proof` renders a sheet to
`.icon-proof/` — the thresholds were chosen by looking, so looking is how to re-check them.
**Previews are not a check — they are somewhere to LOOK.** `npm run previews` renders every
state named in `src/previews.ts` to `previews/index.html` and needs nothing at all: no
browser, no server, no extension, no network. It exists because a state that takes a real
two-account battle to roll — a Substitute, a Transform, hazards on one specific side, a
dented doll — could otherwise only be seen by playing until it happened, which is how the
Substitute work reached review with no picture of itself. The closest analog is a Jetpack
Compose `@Preview`, and the same caveat applies twice over: nothing here is a preview-only
render path (each entry calls the builder a live hover calls, over a battle `section.test.ts`
also asserts against), but the CHROME around each panel is an approximation, since `render.ts`
is deliberately almost CSS-free and inherits Showdown's own fonts and colours. Trust a preview
for what a section says and how it is structured, not for its last pixel.

**Scenarios mutate a captured battle; they are never authored from scratch.** `src/scenario.ts`
owns the one builder both the previews and `section.test.ts` use, and the direction is the
point: the client ships no types, so a hand-built `ClientBattle` would be OUR idea of what it
produces. A test or preview resting on one can pass beautifully while the live hover is broken.
Adding a knob there serves both consumers at once — which is why a preview that renders nothing
is reported loudly by the run rather than shown as a blank card.

**Shape of the suite, base to top.** Unit + integration tests (`npm run check`) are the
base and middle — colocated `*.test.ts` beside each module, two tests driven by real
captured data (`integration.test.ts`, `section.test.ts`), and three architecture-fitness
layers that fail the build when the SHAPE of the codebase drifts rather than its behaviour —
`dependency-boundaries.test.ts` for this project's named layering rules, the
`.dependency-cruiser.cjs` cruise (`npm run deps`) for cycles and orphans, and
`conventions.test.ts` for rules this file states in prose (a rationale beside every
typechecker-silencing cast in SHIPPED code, a colocated test for every core module).
`invariant-index.test.ts` is the fourth of the kind, pointed at this file rather than at the
source: every pointer in the table below has to land on a real file and symbol. The two that
read imports LEXICALLY do so through `importgraph.ts`, which parses whole statements rather
than lines — a wrapped import read line by line is an edge nobody can see, and an edge nobody
can see reads as a boundary held. (The cruise has no such problem: it resolves modules
properly, which is exactly why cycles and orphans are its job and not theirs.)
All fast, deterministic, CI-gated on every push. `drift-check` and `player-check`
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
write them. **`npm run release-bump <major|minor|patch|X.Y.Z>`** does the whole bump:
`npm version` still writes `package.json`/`package-lock.json`, and the script adds the
`public/manifest.json` write those two always needed alongside them, then re-checks that all
three agree and that the result is a legal Chrome Web Store version (integers only, each
≤ 65535 — a semver pre-release tag passes npm and is rejected at upload). It deliberately
does not commit, tag or push. That's a normal change to a protected file, so it goes through
the same branch + PR + merge as anything else (see Contributing, below) — but **before
merging that PR**, run
**`npm run visual-check`** for an eyes-on pass over the surfaces nothing else reaches: the
move tooltip, the own-hover matchup view, the switch menu, and the Tera preview. It plays a
real two-account battle on the self-hosted server and photographs every surface **through the
REAL installed extension**, not an injected bundle — `screenshots/full/` framed to the battle
and `screenshots/crop/` at 2×. Then read the crops and judge them.

The same run also composes `screenshots/store/` — the four Chrome Web Store screenshots, the
move hover and the foe hover each shown twice, in the battle and close up. They are the only
output here with a **shape imposed from outside**: the store takes 1280×800 exactly and
nothing else, which no tooltip or battle room ever is, so each is composed ONTO that canvas
(`scripts/lib/store-canvas.mjs`) rather than cropped to it, and the written file is measured
back off disk so a wrong size fails the run instead of the upload days later. Two framing
decisions are load-bearing and easy to undo by accident: the crops are shot at 3× and scaled
DOWN (the only way to enlarge something and keep it sharp), and they keep a wide margin of
surrounding UI, because Showdown's tooltip is deliberately 10% see-through and a tight crop
strands that bleed with nothing to explain it. The fix for that is framing, never a CSS
override faking an opaque panel — a store screenshot may not show a product we don't ship.
Which move gets photographed is picked by how much of the tooltip is `.hichu-block`, since
ranking by damage alone once chose a move whose flavour text left our two lines a footnote.

**Loading the real extension is no longer manual**, which reverses a long-standing assumption
here. The old belief was that "Load unpacked" can't be automated because nothing can drive
`chrome://extensions` plus the native file picker — but that was never the obstacle; you pass
`--load-extension` at launch and never open that UI. The real obstacle is that Chrome removed
that switch from the BRANDED build as an anti-malware measure and kept it in **Chrome for
Testing** (measured: Chrome 150 ignores it entirely, Chrome for Testing 151 honours it in both
headful and headless — see `scripts/lib/extension-chrome.mjs`, which also strips puppeteer's
own `--disable-extensions` default, a second thing that silently beats `--load-extension`).
`npm run build:visual-check` produces `dist-visual/`, identical to the shipped build except
that `matches` also covers the harness's `*.psim.us` origin — the shipped manifest matches
only `play.pokemonshowdown.com`, so a real extension would otherwise sit dormant there. The
run asserts `#hichu-style` actually appeared before shooting, so a green run can never mean
"photographed the native tooltip by mistake".

**What stays human is the JUDGEMENT, not the setup.** No assertion can say whether a preview
LOOKS right, so someone still has to read the crops — that is why this gate exists and why
merging the release PR is the one conscious checkpoint. The `release-visual-check` skill (a
Claude-in-Chrome pass over the user's own loaded extension) remains the fallback for anything
the harness can't stage, such as a Mega-capable format or doubles.

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
   `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`, `CHROME_PUBLISHER_ID`. Only the store
   account owner can create them, and how to do that (and to renew them, which is routine)
   is operator work rather than repo mechanics: it lives in `.release-keys/README.md`, which
   is local and gitignored because it sits beside a live credential. **Either those secrets
   are configured and this step publishes, or it fails and you upload the GitHub Release's
   zip by hand** — that is the whole contract, and no other part of this pipeline depends on
   which. The extension id (`kjdnmonplcbfldefppjoohlleelfcmik`) is public — it's in the store
   URL — so it's a plain env var in the workflow, not a secret.

**Knowing a release is DUE is its own problem, and nothing above solves it.** Every workflow
here acts only once a bump has landed, so "main has moved and nobody bumped" produces no
signal at all — which is how this repo reached 17 unreleased commits (the Safari port, the
CLAUDE.md restructure, itemreveal, drain/recoil) while the store still served v0.19.3.
**`npm run release-status`** is the read-only answer: it reports which of four states you're
in (`in-sync`, `unreleased`, `pending` — bumped but not yet tagged, so auto-tag is mid-flight
or its verify job failed — or `mismatch`), lists the unreleased commits, and names the next
patch/minor. `.github/workflows/release-drift.yml` runs it on every push to `main` as a job
summary and weekly with `--fail-after=14`, so ordinary between-release drift stays quiet and
a genuinely forgotten release goes red. It creates no tags and publishes nothing.

**It measures `main`, never your checkout** (`scripts/lib/release-range.mjs`, shared with
`release-notes` so the two can't describe different releases). A release only ships what main
has — `auto-tag.yml` tags a commit pushed to main — so the range is a fact about main, and
reading `HEAD` instead once had it count an unmerged branch's own commits while still printing
"commit(s) on main are NOT released". It resolves `origin/main` first and local `main` only as
a fallback: a local `main` nobody has pulled lags the remote, and it lags in the direction that
HIDES unreleased work. Both tools print the resolved SHA (`measured on origin/main @ 1592e0c`),
because on a busy repo a branch name alone doesn't say which tip you got, and they say so
explicitly when your checkout is a different commit.

**The declared version is read at that same commit**, not off disk, so the whole report
describes one state. Mixing the two made a bump sitting uncommitted in a working tree announce
`Release PENDING — auto-tag.yml is either mid-flight or its verify job failed`, advice for a
release that had not started, because the version came from the disk while the commits came
from main. Point the whole report at your own branch with `--ref=HEAD` to inspect a bump before
it lands.

Defaulting to main is not the same as requiring its tip, and **`--ref=<commitish>`** is the
difference: main moves while you bump, open the PR, run `visual-check` and merge, so name the
commit you actually mean to ship. It is refused unless it descends from the tag the range
starts at — a commit that doesn't contain the last release sits on a line of history where
that release never happened, so the range would silently omit whatever the two lines don't
share. That refusal is an error, not a warning, because a warning here gets read past.

**The store publish needs credentials this repo deliberately knows nothing about.** With the
four `CHROME_*` secrets present and valid, `release.yml` pushes the zip live and there is
nothing to do. Without them — absent, or expired, which is the common case — that step fails
and *everything else still succeeds*: the tag, the attestation and the GitHub Release with its
zip all exist, so the fallback is to upload that same zip by hand at
[the dashboard](https://chrome.google.com/webstore/devconsole). A failure there is never a
build failure and never needs a code change. Obtaining and renewing those credentials is
operator work for whoever holds the store account, and its runbook lives with them in
`.release-keys/README.md` — local and gitignored, since it sits next to a live credential.
Nothing in this file requires reading it: if you have no store access, the sentence above is
the whole contract.

**A TAG IS NOT A SHIPMENT**, and that gap has bitten twice: v0.20.1 tagged, published its
GitHub Release, then failed the Chrome Web Store upload — Google refuses to publish while the
previous version is still in review, and v0.20.0 had gone out 26 minutes earlier. v0.22.0
failed the same step for an unrelated credential reason. Tags were
all `release-status` read, so it reported `in-sync` while the store sat a version behind.
**`--check-publish`** closes that, and the hard part is that a release can finish by three
routes leaving three different traces. A `workflow_call` from `auto-tag.yml` is a JOB inside
the caller's run, so it never appears in `release.yml`'s own run list — its evidence is the
auto-tag run standing on the tag's commit. A pushed `v*` tag leaves a `release.yml` run on
that same commit. A recovery **dispatch** leaves neither: it runs against the default branch,
so its head commit is main's and nothing about the commit ties it to the tag — which is why
`release.yml` sets `run-name: Release <tag>` and `scripts/lib/publish-verdict.mjs` joins on
that title. Those two strings are one contract; changing either alone unjoins them silently.

The verdict is one of four and only ONE fails a build: `ok`; `failed`, with nothing later
fixing it; `unknown` (no `gh`, no auth, no network — never a silent all-clear); and `retried`
— the original failed and a LATER release run succeeded that cannot be tied to this tag,
because it predates run naming. `retried` is honest uncertainty rather than an alarm, and
v0.22.0 sits in it permanently: its recovery dispatch really did publish, but no join key for
it exists. Calling that `failed` is what turns a shipped release into a permanently red
`main`, which trains everyone to read past the one check that has caught real problems.
`release-drift.yml` passes `--check-publish` on every run.
Note the recovery is NOT a re-run of `auto-tag.yml` — the tag exists by then, so `detect`
no-ops and the whole thing goes green having published nothing. Re-run the failed `release`
job, whose steps are idempotent for exactly this reason: it publishes the GitHub release only
if one isn't there and refreshes its assets and body otherwise, so a retry reaches the store
step instead of aborting on "release already exists" before it. That recovery was documented
long before it was ever exercised, and v0.22.0 is the release that exercised it.

**Re-run it as a `workflow_dispatch`, not as a re-run of the failed job.** Both the failed run
and a re-pushed tag replay the workflow file *as it was at that commit*, so any repair that
landed on main afterwards isn't in either — a dispatch runs the definition on the default
branch, which is the only way a fixed workflow reaches a tag cut before the fix:
`gh workflow run release.yml -f tag=vX.Y.Z`.

**The workflow comes from the default branch; the SCRIPTS come from the tag.** A dispatch
checks out `ref: <the tag>`, so `release-notes.mjs` and everything else under `scripts/` run
as they were when that tag was cut — a fix to them never applies retroactively, and for a tag
older than the script itself there is nothing to run. That is why a re-run refreshes only the
release's ASSETS and never its body: composing notes from an old tag's tree yields worse notes
than whatever is already there, and v0.22.0 had a hand-written body silently replaced with
boilerplate before that was understood. Refine a body with `gh release edit` and a re-run will
now leave it alone.

**A credential failure there reads exactly like a code failure and is not one** — `Invalid
grant`, `invalid_client`, a refused upload. Nothing in the build is wrong, re-running changes
nothing until the secret is valid, and the recovery is a secret update followed by the dispatch
below. Why those secrets expire and how to renew them is in `.release-keys/README.md`; it is
deliberately not repeated here, because it is true of an account rather than of this codebase.

A manual escape hatch still works if the automation is ever down: `git tag vX.Y.Z
<merged-sha> && git push origin vX.Y.Z` triggers `release.yml` the same way, standalone.
The human-readable summary needs no manual step — `release.yml` composes it itself, below —
though `gh release edit vX.Y.Z --notes-file -` is still how you refine one afterwards.

**`npm run release-notes` drafts that summary instead of writing it from scratch**, and it
gathers nothing new to do it. Three existing things join: squash-merge puts `(#NN)` on every
commit subject, PR screenshots are release assets named `pr-<NN>-<what>.png` (Contributing,
below), and `release-status` already defines the unreleased range. So each user-visible change
arrives already illustrated by the before/after image its own PR produced, and the changelog is
DERIVED — there is no list to maintain and no step to forget. It prints markdown to stdout and
writes nothing:
```sh
npm run release-notes                              # the unreleased range
node scripts/release-notes.mjs --since=v0.20.0     # an explicit starting tag
node scripts/release-notes.mjs --ref=<commitish>   # end the range somewhere other than main
node scripts/release-notes.mjs | gh release edit vX.Y.Z --notes-file -
```
Each image stays under its own `#NN` heading, and that framing is load-bearing rather than
cosmetic: an image shows the UI as of ITS OWN PR, so when two PRs in one release touch the same
surface the earlier one depicts a state that never shipped. Under a per-PR heading that is an
honest claim about what one change did; gathered under "here is the new release" it would be a
picture of a product we do not ship. The `-before` half of a pair is dropped outright for the
same reason taken one step further — it depicts the state its own PR replaced, so it is not
merely stale but usually a photograph of the bug. A PR that uploaded ONLY a before shot counts
as un-illustrated and falls to the plain list, which is the honest outcome: there is no picture
of what shipped.

**`release.yml` runs it and publishes the result**, so the release body carries this summary
above the provenance boilerplate without anyone doing anything. That is a deliberate trade: a
body nobody wrote is the state this replaced, and "somebody remembers to run `gh release edit`"
is the same forgettable manual step the rest of this pipeline exists to delete. It composes with
`--ref=<the tag>`, which is why naming a release tag starts the range at the tag BEFORE it —
by then `auto-tag` has already created the tag, so the obvious default would ask for
`vX.Y.Z..vX.Y.Z` and publish empty notes for a full release. The step cannot sink a release
either: notes are cosmetic next to a published zip, so a failure downgrades to boilerplate and
annotates the run. The draft is still a starting point rather than a finished summary — read
the published body and refine it with `gh release edit` when it deserves more than its commit
subjects.

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

**PRs are SQUASH-merged, so merged work is not an ancestor of `main`.** The squash creates a
new commit with a new SHA, and the branch's original commits are never reachable from `main`
— which means every ancestry-based read of "is this already in?" answers NO for work that is
demonstrably in. `git log main..<branch>` still lists the whole branch, `git branch --merged`
never names it, and a local `main` that simply hasn't been pulled looks identical to a branch
with genuinely unmerged work. **Judge by CONTENT — are these added lines present in `main`? —
or by the PR's own state (`gh pr view --json state`), never by ancestry.** Two real incidents
came from trusting the ancestry read: a PR that had to be *closed* rather than merged, because
merging it would have reverted newer work that a stale branch appeared to be missing; and a
rebase that silently dropped two `package.json` script entries while CI stayed green, because
the workflows invoked those script files by path rather than through `npm run`, so nothing
exercised the entries that had gone.

**A PR that changes what the user sees needs a before/after image — hosted OUTSIDE the repo.**
A screenshot committed to a branch is a permanent, mandatory cost: an object reachable from any
ref ships in every clone forever, whether or not anyone ever opens the picture, and deleting the
branch later reclaims nothing from the clones that already have it. Release assets live outside
the git object store, so they cost the repository nothing and move bytes only when someone
actually views the image. Upload to the `pr-assets` tag, then link the download URL from the PR
body:
```sh
gh release upload pr-assets screenshots/crop/pr-<number>-<what-it-shows>.png
# → https://github.com/seanaujong/hi-chu/releases/download/pr-assets/pr-<number>-<what-it-shows>.png
```
**Name the old-state shot of a pair `…-before.png`**, and the new-state one anything else
(`…-after.png` reads best beside it). That suffix is the ONE part of the filename beyond the
number that carries meaning: `release-notes` drops a `-before` asset, because a changelog that
showed it would be publishing a picture of the very bug the release fixed. Misname it and the
old state ships to users as though it were the feature.
`pr-assets` is a **pre-release on a non-`v` tag**, and both halves carry weight: `release.yml`
triggers on `tags: ['v*']` and `release-status` reads only `git tag --list 'v*'`, so this tag
fires no workflow and is invisible to the release tooling, while the pre-release flag stops it
ever taking the "Latest" badge from a real version. Do not reuse the name for a branch as well —
a ref that is both `refs/heads/pr-assets` and `refs/tags/pr-assets` makes every bare `pr-assets`
ambiguous, and `git push origin --delete` refuses it until you spell out the full ref path.

GitHub serves the asset as `application/octet-stream` with `Content-Disposition: attachment` and
does **not** camo-proxy a `github.com` URL, so the rendered markdown points an `<img>` straight at
it; Chrome renders it anyway, since the response carries no `nosniff` and a subresource load
ignores the disposition header. That was measured, not assumed. The native `user-attachments` CDN
would be the one better host — same zero cost, no extra tag — but it has no API at all (GitHub
closed the request: its upload flow needs browser session cookies), so it is reachable only by
driving a real browser.

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
- **Sub** (`substituteLine`, `substituteAside`) — one count, "2-3 hits to break", when a
  Substitute stands in front of the defender. A line of its own on the move tooltip, an
  inline aside on the matchup view's compact rows, and nothing at all on the sets view,
  which has no room for it. A bypassing move (sound, Infiltrator) says "ignored" instead.
- **Notes** (`renderNotes`) — ⚠ caveats, attached once per tooltip after the per-foe
  sections so doubles can't repeat them.

### Which target gets which section
A **randbats** format, where everything is available:

| Hover target | Damage | ⚡ lead | Outgoing | ⚡ per block | `Incoming:` | Our dmg into them | Sets | Mirror |
|---|---|---|---|---|---|---|---|---|
| Our move button | ✓ | — | — | — | — | — | — | — |
| Our active | — | — | withheld | ✓ | withheld | — | — | ✓ |
| Our benched icon | — | — | ✓ +hazards | ✓ | ✓ | — | — | ✓ |
| Our switch menu | — | — | ✓ +hazards | ✓ | ✓ | — | — | never |
| Foe active | — | ✓ | — | — | — | withheld | ✓ | — |
| Foe roster icon | — | ✓ | — | — | — | ✓ +their hazards | ✓ | — |

An **open** format (OU, VGC, Custom Game) has no set feed, so every inference-dependent
cell empties out: the move tooltip and our own matchup blocks survive (the foe's spread
bracketed, ours exact), a **foe hover renders nothing at all**, and there is no ⚡ line,
no `Incoming:` group, and no sets/mirror anywhere.

Three cells say **withheld** rather than "—", and they are the same principle three times,
not three decisions: never show the same number on two surfaces. Our active's `Incoming:`
numbers are already on the foe's own hover; our damage into an ACTIVE foe is already on the
move tooltip; and our active's own OUTGOING lines are already on its move buttons, which sit
right under the tooltip and carry the number in more detail (the nHKO ladder, the
Sash/Leftovers caveats, the drain/recoil swing). A switch-decision candidate has no such
other source — its move buttons aren't hoverable at all — which is the whole reason that
half exists. So an ACTIVE mon's own hover keeps only its "vs \<foe\>" header and the ⚡
verdict, which appears on no other own-side surface. "never" is a different thing entirely — the switch menu's mirror is
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
  explain the evidence away (Sheer Force / Magic Guard / Klutz), and anything genuinely
  ambiguous — an unknown ident, an empty log — resolves to "no signal". Prefer MISSING a
  rule-out to making a false one. See the Life Orb, Heavy-Duty Boots, Choice, Air Balloon
  and status-orb rows — the last two invert the others (they are the items that ANNOUNCE
  themselves, so their silence is the evidence), but obey the same preference. Its strongest
  form is that **a deduction may NARROW the candidate roles but never empty them**: a
  rule-out is an inference from something that did not happen, so one that kills every role
  is likelier to be the inference failing than the species being impossible. See *A
  deduction narrows the candidate roles but never empties them*.

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
    - `deductions.ts` — the behavioural deduction layer: items deduced ABSENT from public
      behaviour — a rule-out can empty a role's whole item pool, which is how `narrow` drops
      the ROLE, not just the item line. Most are SILENT items read through a side effect
      (Life Orb, Heavy-Duty Boots, the three Choice items); Air Balloon and the two status
      orbs are the inversion, the items that announce themselves — the balloon on the way in,
      so a switch-in it stayed quiet through rules it out, and an orb at every end of turn,
      so a turn that ended with its holder un-statused rules both out.
      `ruledOutItems`/`survivingItems`; adding
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
      `buildableAbilities` is the guard that an ability no SET could carry narrows nothing,
      and `consistentRoles` the guard that a deduction may narrow the field but never empty
      it (`candidateItems` is its item-level twin, and the ONE place a candidate's item
      pool is decided — see the invariant).
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
  - `substitute.ts` — the Substitute law: a shield with its own HP bar. Sizes the doll (a
    quarter of its MAKER's max HP — Shed Tail makes that a different Pokémon), counts the
    hits that break it CUMULATIVELY per hit rather than by division (Triple Axel's hits
    escalate), and owns which moves walk through it (`sound`, which the calc does expose,
    plus the three non-sound bypassers and Infiltrator, which it doesn't). The calc models
    none of this, so the whole mechanic is ours — including the rule that no KO may be
    claimed through a standing doll, which `render.ts` enforces.
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
    the move tables (data only; no colocated test — covered via `damage.test.ts`): the
    multi-hit table, and the damage callbacks of moves that have no base power at all.
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

Tests come in three flavours: colocated `*.test.ts` with hand-built stubs; two driven by **real
captured data** — `integration.test.ts` (real feed, synthetic mons) and `section.test.ts` (a real
two-sided battle captured live from a replay; the fixture is `__fixtures__/replay-*.json`); and
the **architecture-fitness** trio, which asserts things about the codebase's SHAPE rather than
its behaviour (see "Shape of the suite" above). `importgraph.ts` is theirs — it reads this
tree's own imports and ships in nothing, which `conventions.test.ts` relies on to tell shipped
code from the fixture builders (`scenario.ts`, `previews.ts`, `*.testfixtures.ts`) beside it.

For exact shapes and signatures, read the source and the colocated `*.test.ts` — the
tests are the worked examples (and pin numbers against Showdown). Exception: `moves.ts` and
`types.ts` (pure data/types), and `facts.ts`/`narrow.ts` (covered by `resolve.test.ts`); the move tables are exercised
end-to-end in `damage.test.ts` (the `uniform-power multi-hit` and `damage-callback move`
cases) — add a case there when you add a move to either.

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
variable-power multi-hit, damage-callback moves, Substitute (its move table has one as a 0-BP
status move and stops there), and unknown species/items. A third kind hides between those two and
is the easiest to ship by accident: the calc answering EXACTLY what we asked, where the asking
itself was wrong. Requesting one hit of a multi-hit move is that — the calc then reads it as a
single-hit move and applies the Tera 60 BP floor. Our *product* is not a calc gap: the
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
| `teraType` is set only when Tera is ACTIVE — previewed on the move tooltip (attacker) and a foe hover's damage into us (defender) | ✅ | `section.ts` (`PreviewOverlay`, `teraPreviewFor`, `applyPreviews`), `core/resolve.ts` | `section.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| A ticked Mega box previews OUR active mon's Mega forme — offence, Speed from gen 7, and defence | ✅ | `section.ts` (`megaPreviewFor`, `megaSpeedApplies`), `battle/readState.ts` (`readMegaForme`) | `section.test.ts`, `readState.test.ts` |
| A pending Tera/Mega preview carries NO speed caveat — both resolve ahead of every move | ✅ | `section.ts` (`applyPreviews`) | `section.test.ts` |
| A move's own HP swing (drain, recoil, Liquid Ooze) is opt-in, move-tooltip only, and amber — never the KO red | ✅ | `core/damage.ts` (`SelfHpEffect`, `selfHpEffects`), `core/variants.ts` (`resultKey`), `core/render.ts` (`selfHpText`) | `damage.test.ts`, `section.test.ts` |
| Set narrowing uses every public reveal, nothing private | ✅ | `core/narrow.ts` | `resolve.test.ts` |
| `battle.myPokemon` feeds OUR-view surfaces only, never the opponent's-knowledge views | 👁 | `battle/readState.ts` (`readOwnServerPokemon`), `section.ts` | `section.test.ts`, `readState.test.ts` |
| Hovering our OWN Pokémon leads with the matchup view — outgoing lines withheld for the mon already on the field; the mirror below stays public | ✅ | `section.ts` (`ownMovesSection`, `ownHoverMatchup`, `buildSwitchSection`) | `section.test.ts`, `render.test.ts`, `readState.test.ts`, `content.test.ts` |
| The matchup view's defensive half — the `Incoming:` group | ✅ | `section.ts` (`randbatsIncomingMovesFor`, `ownMovesSection`) | `section.test.ts`, `render.test.ts` |
| Hovering a FOE's roster icon shows OUR active's damage into it | ✅ | `section.ts` (`foeSwitchInDamage`) | `section.test.ts` |
| A LANDED damaging hit with no item revealed rules Life Orb out | ✅ | `core/deductions.ts`, `battle/readState.ts` (`hasLandedDamagingHit`) | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| Taking entry-hazard damage rules Heavy-Duty Boots out; switching in unharmed confirms it | ✅ | `core/deductions.ts`, `battle/readState.ts` | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| Two freely-chosen moves in ONE stint rule out all three Choice items — scoped per stint, since the lock dies on switch-out | ✅ | `core/deductions.ts`, `battle/readState.ts` (`usedDifferentMovesSinceSwitchIn`) | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts` |
| A switch-in that announced nothing rules Air Balloon out — the one item that always reveals itself, so SILENCE is the evidence | ✅ | `core/deductions.ts`, `battle/readState.ts` (`switchedInWithoutAnnouncingBalloon`) | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts`, `section.test.ts` |
| A turn that ended with its holder un-statused rules out Flame Orb AND Toxic Orb — the same silence, at a moment that comes round every turn | ✅ | `core/deductions.ts`, `battle/readState.ts` (`endedTurnUnstatused`) | `deductions.test.ts`, `resolve.test.ts`, `readState.test.ts`, `section.test.ts` |
| A deduction narrows the candidate roles but never empties them — nor the item pool a chosen role calcs with | ✅ | `core/narrow.ts` (`consistentRoles`, `candidateItems`) | `resolve.test.ts` |
| ONE rule decides a candidate's item pool, so the block's Items line and its damage can't disagree | ✅ | `core/narrow.ts` (`candidateItems`) | `resolve.test.ts`, `section.test.ts` |
| The forme a Pokémon IS and the one it is WEARING differ — only the calc reads the second | ✅ | `battle/readState.ts` (`readLiveForme`), `core/resolve.ts` (`buildResolved`) | `readState.test.ts`, `resolve.test.ts` |
| A Transformed Pokémon is calculated as the one it COPIED, keeping only its own HP | ✅ | `core/transform.ts`, `section.ts` (`factsReader`) | `transform.test.ts`, `readState.test.ts`, `section.test.ts` |
| An ability narrows a role only if a SET could have been built with it | ✅ | `core/narrow.ts` (`buildableAbilities`) | `resolve.test.ts` |
| A disguised Zoroark surfaces as its own candidate, never a corrupted one | ✅ | `core/illusion.ts`, `section.ts` (`illusionVariants`) | `illusion.test.ts`, `variants.test.ts`, `render.test.ts` |
| Our OWN disguised Zoroark is seen through — the private team names it | ✅ | `section.ts` (`ownTruth`), `battle/readState.ts` (`readOwnServerPokemon`) | `section.test.ts`, `readState.test.ts` |
| Set inference keys on the INNATE ability (`baseAbility`), not the live one | ✅ | `core/facts.ts` (`innateAbility`) | `resolve.test.ts`, `readState.test.ts` |
| …and only when the species could actually HAVE that ability | ✅ | `core/facts.ts` (`innateAbility`) | `resolve.test.ts` |
| Damage under a hidden item/ability is split by DISTINCT outcome, not by set | ✅ | `core/variants.ts` (`bucketByDamage`) | `variants.test.ts`, `section.test.ts` |
| The sets view's per-candidate damage never guesses a representative attacker either | ✅ | `section.ts` (`candidateDamageByMove`), `core/render.ts` (`spanText`, `koTier`) | `render.test.ts`, `section.test.ts` |
| A candidate's hidden item/ability folds into ONE span; only the outcome deciding a KO is spelled out | ✅ | `core/render.ts` (`spanText`, `worstTier`, `koCondition`) | `render.test.ts`, `section.test.ts` |
| Bucket labels are always DISTINCT — one role's item × ability fan-out separates on the pair | ✅ | `core/variants.ts` (`labelBuckets`, `itemAbilityOf`) | `variants.test.ts` |
| Format ids are derived like PS's own `toID` | ✅ | `battle/readState.ts` | `readState.test.ts` |
| `render.ts` matches native tooltip styling and layout almost CSS-free | 👁 | `core/render.ts` (`TOOLTIP_STYLE`, `renderMoveSection`, `renderSetsSection`) | `render.test.ts`, `section.test.ts` |
| Foe-level item facts qualifying KO/nHKO read the RESOLVED variants, never raw facts | ✅ | `section.ts` (`itemStanding`) | `section.test.ts`, `render.test.ts` |
| Own the hit-count model — the calc's `k × one roll` multi-hit is wrong | ✅ | `core/multihit.ts` | `multihit.test.ts`, `damage.test.ts` |
| Variable-power multi-hit is computed per hit, through a stand-in move — which must match the real move on CONTACT and be genuinely multi-hit | ✅ | `core/damage.ts` | `damage.test.ts` |
| One hit of a multi-hit move is asked for as TWO — a single hit takes gen 9's Tera 60 BP floor, which no multi-hit move ever takes | ✅ | `core/damage.ts` (`TERA_FLOOR_SAFE_HITS`) | `damage.test.ts` |
| Rage Fist's power scales with the ATTACKER's own hits taken | ✅ | `core/damage.ts` (`rageFistPower`), `battle/readState.ts` (`timesAttacked`) | `damage.test.ts`, `readState.test.ts`, `transform.test.ts` |
| A move with NO base power takes its damage from a callback over current HP — one exact amount, no nHKO ladder, but still stopped by an immunity | ✅ | `core/moves.ts` (`damageCallback`), `core/damage.ts` (`connects`) | `damage.test.ts`, `section.test.ts` |
| A Substitute is a shield, and the tooltip says ONE thing about it: how many hits break the doll — cumulative per HIT, never spilled over | ✅ | `core/substitute.ts`, `core/damage.ts` (`substituteStanding`) | `substitute.test.ts`, `damage.test.ts`, `section.test.ts` |
| NO KO may be claimed while a Substitute stands — the KO text, the nHKO ladder, the Sash aside and the sets view's danger tiers go together | ✅ | `core/render.ts` (`blockedBySubstitute`, `koTier`) | `render.test.ts`, `section.test.ts` |
| A Shed Tail sub is sized on its MAKER's max HP, not the Pokémon wearing it; a dented one caps the count rather than bracketing it | ✅ | `core/substitute.ts` (`substituteHP`), `battle/readState.ts` (`readSubstitute`), `section.ts` (`shedTailMakerMaxHP`) | `substitute.test.ts`, `readState.test.ts`, `damage.test.ts` |
| Speed order: arithmetic delegated, ORDER owned, a fact about the PAIR | ✅ | `core/speed.ts`, `section.ts` (`speedSection`, `ownMovesSection`) | `speed.test.ts`, `render.test.ts`, `section.test.ts` |
| An "if …" aside exists to CONTRADICT the ⚡ verdict — a set reaching the same answer is dropped, so no asides means the verdict holds under EVERY still-possible set | ✅ | `core/render.ts` (`speedLine`) | `render.test.ts` |
| Unburden's ×2 Speed is armed via an explicit `abilityOn` flag, not inferred from `item` | ✅ | `core/resolve.ts` (`buildResolved`), `core/damage.ts` (`buildPokemon`) | `resolve.test.ts`, `speed.test.ts` |
| The fetch/reason/render split is a checked import graph, not just a description | ✅ | `src/dependency-boundaries.test.ts` | `dependency-boundaries.test.ts` |
| Every behavioural deduction is reached through `narrow.ts` — nothing else imports `deductions.ts` | ✅ | `src/dependency-boundaries.test.ts` | `dependency-boundaries.test.ts` |
| `facts.ts` stays a leaf (and `types.ts` a true one), so no layer depends on a sibling for shared vocabulary | ✅ | `src/dependency-boundaries.test.ts` | `dependency-boundaries.test.ts` |
| No cycles, no orphan modules | ✅ | `.dependency-cruiser.cjs` | `npm run deps` (inside `npm run check`) |
| The committed module graph is TRUE — regenerated and diffed, never hand-maintained | ✅ | `scripts/graph.mjs` | `.github/workflows/ci.yml` |
| A lexical boundary check reads whole import STATEMENTS, never lines — the rules above are defeated by a line wrap otherwise | ✅ | `src/importgraph.ts` (`importStatements`) | `importgraph.test.ts`, `dependency-boundaries.test.ts` |
| No barrel file — one directory-wide re-export makes "does the core import the shell?" and "who imports `deductions.ts`?" stop having per-module answers | ✅ | `src/dependency-boundaries.test.ts` | `dependency-boundaries.test.ts` |
| An escape hatch that switches the typechecker OFF carries a written rationale — in code that SHIPS, derived from the build's entry points rather than listed | ✅ | `src/conventions.test.ts` (`HATCH`, `shippedFiles`), `data/lookup.ts` (`rawEntries`) | `conventions.test.ts` |
| Every module in the pure core has a colocated test, or a listed reason it does not | ✅ | `src/conventions.test.ts` (`UNTESTED_BY_DESIGN`) | `conventions.test.ts` |
| "No DOM, no network" is typechecked everywhere but the two files whose job it is | ✅ | `src/tsconfig.pure.json` | `npm run typecheck` |
| The store's summary ships FROM the package — the listing doc, the manifest and `package.json` carry one sentence | ✅ | `docs/chrome-web-store-listing.md` (Summary) | `store-summary.test.ts` |
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
  Also the `|move|` line's own field layout, because the Choice rule-out reads a `[from]`
  attribute as "the player didn't choose this" — if that convention drifted, every called
  move would read as a second free selection and rule Choice items out FALSELY. And the
  `|-item|` line's layout, for the same reason one step further: the Air Balloon rule-out
  reads that line's ABSENCE as evidence, so a client that stopped emitting it would make
  every balloon holder look like it had none, and call a Ground move safe into a Pokémon
  immune to it. Both probes report whether they actually fired — a `[from]` move and an Air
  Balloon announcement are each rare enough that a random replay often has neither. The
  status-orb rule-out adds a pair with the same asymmetry: `|upkeep|` is its end-of-turn
  marker, and losing it would only take the deduction permanently (and silently) quiet, but
  the `|-status|` line's layout is read in the DANGEROUS direction — the rule turns on there
  being no status at that moment, so an ident or status id that moved would leave a visibly
  burned Pokémon looking clean and rule out the very orb that had just fired. And
  `volatiles.substitute` (presence only — the client never tracks the doll's HP, which is why
  we derive its size), `side.pokemon` (the roster, the only place a Shed Tail's maker can
  still be found once using it took them off the field), and the `|-start|…|Substitute` and
  `|-activate|…|move: Substitute|[damage]` layouts — the first tells a fresh doll from a
  battered one, the second's `[damage]` tag is all that separates an absorbed hit from a
  status move the sub merely blocked.
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
- `docs/architecture-graph.md` — the generated module graph: which file imports which, as of
  the last `npm run graph`. Read it to find your way around; read the Architecture section
  above to learn what the layers MEAN. Never edit it by hand — CI regenerates and diffs it.
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
