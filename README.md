# hi-chu

*(hi-chew × pikachu)*

<p align="center">
  <img src="demo/03-own-hover.png" width="300"
       alt="Hovering your own Pokémon leads with its damage into the opposing active, a speed verdict, and the set the opponent could still deduce about it">
  <img src="demo/10-move-earthquake.png" width="300"
       alt="Hovering a move button shows its damage and KO turns into the current target, right beside the native tooltip">
</p>

Battle hints, one hover away. hi-chu is a small browser extension that enriches
[Pokémon Showdown][showdown]'s in-battle tooltips:

- How much damage will each move do?
- What Random Battles set is the opponent Pokémon running?
- Who's faster?

Grabs set data from [`pkmn.github.io/randbats`][feed] and calculates damage with
[`@smogon/calc`][calc].

## How it's built

The design is a small pure core behind a thin shell, and the shell itself splits in two:
`content.ts` is the only *impure* piece — it monkey-patches Showdown's tooltip and touches
the DOM/network directly — but it hands the actual work to `section.ts`, which is pure
(no DOM, no cache, no network of its own) and does the real folding. Below that, three
steps stay strictly separate — **fetch** (the live page, the network), **reason** (the
domain logic), **render** (model → HTML) — so a step never reaches into the DOM or the
network unless that IS its job. Dependencies only ever point downward:

```
┌───────────────────────────────────────────────────────────────┐
│ content.ts                           the shell (impure) · DOM │
│ monkey-patches Showdown's tooltip,                            │
│ triggers the fetch, hands the hover to section.ts             │
└───────────────────────────────────────────────────────────────┘
                                │ hover event
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ section.ts                                  pure orchestrator │
│ given the battle, the hover, and the data                     │
│ → folds FETCH → REASON → RENDER into one HTML string          │
└───────────────────────────────────────────────────────────────┘
──────────── the pipeline — FETCH → REASON → RENDER ─────────────
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ FETCH                            reads the page + the network │
│ ┌───────────────────────────┐   ┌───────────────────────────┐ │
│ │ battle/readState.ts       │   │ data/randbats.ts          │ │
│ │ client Pokemon objects    │   │ fetch + cache             │ │
│ │ → LiveFacts: only what    │   │ the sets feed             │ │
│ │ the battle has made public│   │                           │ │
│ └───────────────────────────┘   └───────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                                │ what we KNOW
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ REASON                                pure: given x, return y │
│ ──────── what the foe COULD be — exactly one source ───────── │
│ ┌───────────────────────────┐   ┌───────────────────────────┐ │
│ │ resolve.ts           feed │   │ assume.ts         no feed │ │
│ │ every set the species     │   │ the two spreads that      │ │
│ │ can run, narrowed by      │   │ BRACKET it: uninvested /  │ │
│ │ public reveals            │   │ max HP+Def                │ │
│ └───────────────────────────┘   └───────────────────────────┘ │
│               └───────────────┬───────────────┘               │
│                               │ what we ASSUME                │
│                               ▼                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ buildResolved                                 ResolvedMon │ │
│ │ known facts win; the source fills the gaps                │ │
│ │ → the concrete set(s) we calculate with                   │ │
│ └───────────────────────────────────────────────────────────┘ │
│                               │                               │
│                               ▼                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ damage.ts (calc)                             DamageReport │ │
│ │ wrap @smogon/calc; own the multi-hit law                  │ │
│ │ → one DamageReport per possible set                       │ │
│ └───────────────────────────────────────────────────────────┘ │
│                               │                               │
│                               ▼                               │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ variants.ts                                  DamageBucket │ │
│ │ collapse identical numbers, name what differs             │ │
│ │ → one line per DISTINCT outcome                           │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│ RENDER                                pure: given x, return y │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │ render.ts                                            HTML │ │
│ │ model → tooltip HTML string                               │ │
│ └───────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                                │ tooltip HTML
                                ▼
──────────── the pipeline — FETCH → REASON → RENDER ─────────────
┌───────────────────────────────────────────────────────────────┐
│ section.ts                                  pure orchestrator │
│ the folded pipeline result                                    │
│ → handed back to content.ts as one HTML string                │
└───────────────────────────────────────────────────────────────┘
```

The only thing a battle's format changes is *where the foe's possibilities come
from* — a real set feed (`resolve.ts`) vs. two bracketing assumptions with none
(`assume.ts`) — everything below that fork in REASON is shared.

Full per-module detail — what each file in `src/core/`, `src/battle/`, and `src/data/`
owns and why — lives in `CLAUDE.md`'s Architecture section, kept current file-by-file as
the codebase grows. For exact shapes and signatures, read the source and the `*.test.ts`
next to each module — the tests double as worked examples, pinned against real Showdown
numbers.

## Develop

```sh
npm install
npm test              # the math, the merge, the render, field effects, the dependency boundary, and an end-to-end run on real data
npm run typecheck
npm run build         # bundles to dist/ (content.js + manifest.json) — Chrome
npm run build:safari  # bundles to dist-safari/ — Safari (see Install below)
npm run watch         # rebuild on save
```

`npm install` also points git at `.githooks/` (the `prepare` script), which refuses a commit
or push made directly against `main` — every change goes through a branch + PR instead,
matching `main`'s GitHub branch protection.

## Install

**From a release (no build needed):**

1. Download `hi-chu-<version>.zip` from the [latest release][releases] and unzip it.
2. Visit `chrome://extensions`, enable **Developer mode** (top-right).
3. **Load unpacked** → select the unzipped folder.
4. Open a battle on `play.pokemonshowdown.com` and hover a Pokémon or one of your
   move buttons — the extra lines appear at the bottom of the tooltip. (A Random Battle
   gets everything; any other format gets the damage lines.)

*(Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick the
`manifest.json` inside the unzipped folder.)*

**From source:** `npm install && npm run build`, then Load unpacked → `dist/`. Run
`npm run package` to produce the release zip yourself.

**Safari (macOS):** no packaged release yet — build from source. `npm install && npm run
build:safari`, then open `safari/hi-chu/hi-chu.xcodeproj` in Xcode:

1. Signing & Capabilities tab (both the App and Extension targets): enable automatic
   signing and pick a team — any free Apple ID **Personal Team** works, added via Xcode
   → Settings → Accounts.
2. Scheme selector: **hi-chu (macOS)** + **My Mac**, then press Run (▶) — the app must
   actually launch at least once; Safari won't list an extension that's only been built.
3. Safari → Settings → Extensions: enable **hi-chu**.
4. Open a battle on `play.pokemonshowdown.com` and hover a Pokémon.

Safari can't run the same static `content_scripts` declaration Chrome does (see
`CLAUDE.md`'s Architecture section for why), so `dist-safari/` is its own build with a
background service worker filling the gap — `content.ts` itself is unchanged.

## Verifying a release

Every tagged release ships with a Sigstore-signed [build-provenance attestation][slsa]
and a `SHA256SUMS` file:

```sh
gh attestation verify hi-chu-0.2.0.zip --repo seanaujong/hi-chu
```

A ✓ means GitHub verified the signature: this exact zip was produced by the Release
workflow, from a commit you can inspect. No keys to trust by hand.

**Prove the shipped code matches the source.** The bundled `content.js` is produced
deterministically by esbuild at the version pinned in `package-lock.json`, so you can
rebuild it and compare hashes:

```sh
git checkout v0.2.0
npm ci && npm run build
sha256sum dist/content.js          # compare to content.js in the release's SHA256SUMS
```

Identical hashes mean the code Chrome runs is exactly the open source in this repo.
(The Chrome Web Store repackages and re-signs uploads, so the *installed* extension is
additionally signed by Google — but these two checks are what tie it back to here.)

> **On the install warning.** hi-chu is new, so Chrome's *Enhanced Safe Browsing* may
> note it isn't "trusted" yet — a reputation signal Google grants new extensions over
> time, not a finding about the code. The checks above are the concrete answer to "is
> this safe?": verify the provenance and the source hash yourself.

## Disclaimer

hi-chu is an unofficial, fan-made tool. It is not affiliated with, endorsed by, or associated
with Nintendo, Game Freak, The Pokémon Company, or Pokémon Showdown. "Pokémon" and all related
names are trademarks of their respective owners.

[showdown]: https://pokemonshowdown.com/
[feed]: https://github.com/pkmn/randbats
[calc]: https://github.com/smogon/damage-calc
[releases]: https://github.com/seanaujong/hi-chu/releases/latest
[slsa]: https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
