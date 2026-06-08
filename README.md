# Randbats Tooltip but Better

A browser extension that augments Pokémon Showdown's in-battle tooltips for Random
Battles. On top of the usual "what set could this Pokémon have", it adds a damage
section that does two things the existing tooltips get wrong:

- **Granular multi-hit damage.** For moves like Bullet Seed or Rock Blast it shows
  the per-hit damage range, the expected number of hits, and a *true* KO chance that
  integrates over both the per-hit damage rolls and the random 2–5 hit count.
- **Reality-aware calcs.** It reads the live battle, so an *active* Terastallization,
  the current status, stat boosts, revealed ability/item, and current HP all feed the
  calc. Because the math is delegated to `@smogon/calc`, interactions resolve
  correctly — e.g. a burned **Guts** attacker is not damage-halved.

It is inspired by the closed-source [Randbats Tooltip][orig] and uses the same open
data feed ([`pkmn.github.io/randbats`][feed]) and damage engine ([`@smogon/calc`][calc]).

## How it's built

The design is a small pure core with a thin browser shell. Each step is an ordinary
testable function; the content script only folds them together. Modules split into two
layers, and dependencies only ever point downward (the shell uses the core, never the
reverse):

```
──────────────────── shell — side effects (DOM, network), thin ─────────────────────
┌────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│ content.ts             │   │ battle/readState.ts    │   │ data/randbats.ts       │
│ hook PS tooltip,       │   │ PS client objects      │   │ fetch + cache          │
│ fold core → HTML       │   │ → typed LiveFacts      │   │ the sets feed          │
└────────────────────────┘   └────────────────────────┘   └────────────────────────┘
─────────────────── pure core — no DOM, no network, unit-tested ────────────────────
┌────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│ core/resolve.ts        │   │ core/damage.ts         │   │ core/render.ts         │
│ live facts over set    │   │ wrap @smogon/calc      │   │ model →                │
│ → one ResolvedMon      │   │ → DamageReport         │   │ tooltip HTML           │
└────────────────────────┘   └────────────────────────┘   └────────────────────────┘
┌────────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│ core/multihit.ts       │   │ core/moves.ts          │   │ core/types.ts          │
│ PMF convolution,       │   │ multi-hit table        │   │ shared vocabulary:     │
│ KO% & E[damage]        │   │ (from PS data)         │   │ Live/Randbats/Resolved │
└────────────────────────┘   └────────────────────────┘   └────────────────────────┘
```

At runtime those modules fold together left to right:

```
               ┌────────────┐     ┌────────────┐     ┌─────────────┐     ┌────────────────────┐
               │ toLiveFacts│     │ resolveMon │     │ calcDamage  │     │ renderDamageSection│
client Pokemon │ LiveFacts  │ ──▶ │ ResolvedMon│ ──▶ │ DamageReport│ ──▶ │ HTML string        │ ──▶ tooltip
               └────────────┘     └────────────┘     └─────────────┘     └────────────────────┘
                                         ▲
                                         │
                           ┌───────────────────────────┐
                           │ randbats set possibilities│
                           └───────────────────────────┘
```

### The pure core (`src/core`)

- **`multihit.ts`** — the probability law. It represents damage and hit counts as
  PMFs (probability mass functions) and convolves a single per-hit roll over the
  hit-count distribution. This is the fix for `@smogon/calc`, which models *k* hits as
  `k × one shared roll` (perfectly correlated) — both the variance and the hit-count
  randomness are wrong there. The exact hit-count distributions (35/35/15/15, Skill
  Link, Loaded Dice) are taken from Showdown's `sim/battle-actions.ts`.
- **`moves.ts`** — the multi-hit move table, derived from Showdown's `data/moves.ts`.
  Marks which moves have uniform per-hit power (so the convolution is exact) versus
  the two whose power varies per hit (Triple Axel/Kick, which fall back to the calc).
- **`resolve.ts`** — merges known live facts over assumed randbats possibilities into
  the one concrete set we calculate with. Revealed facts always win; a Tera type is
  only ever applied when the Pokémon has actually terastallized.
- **`damage.ts`** — wraps `@smogon/calc`. For uniform multi-hit moves it asks the calc
  for one hit and runs the convolution; otherwise it uses the calc's total directly.
- **`render.ts`** — turns reports into the tooltip HTML string (kept pure so it can be
  snapshot-tested rather than eyeballed in a browser).

### The shell

- **`src/data/randbats.ts`** — fetches and caches the set feed (memory + `localStorage`
  with a TTL).
- **`src/battle/readState.ts`** — reads Showdown's untyped client objects into our
  typed `LiveFacts` (the structural `ClientPokemon`/`ClientBattle` interfaces document
  exactly which fields we depend on).
- **`src/content.ts`** — runs in the page (manifest `world: "MAIN"`), monkey-patches
  `BattleTooltips.prototype.showPokemonTooltip`, and appends our section. Everything is
  wrapped so our code can never break Showdown's own tooltip.

### The multi-hit fix (the value-add)

`@smogon/calc` treats a *k*-hit move as `k × one shared roll`: every hit rolls the same,
and the hit count is fixed. Both are wrong. `core/multihit.ts` instead treats each hit as
an independent roll and the hit count as a random variable, and convolves them:

```
┌────────────────────────────────────────────────────────────────┐
│ inputs                                                         │
│ • 16 per-hit damage rolls  (each 1/16, uniform)                │
│ • hit-count PMF  —  2:35%  3:35%  4:15%  5:15%                 │
└────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│ core/multihit.ts                                               │
│ convolve one per-hit roll over the hit count,                  │
│ each hit rolling INDEPENDENTLY                                 │
└────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│ result                                                         │
│ total-damage PMF  →  KO%  ·  expected  ·  per-hit range        │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ what @smogon/calc does instead  (the bug)                      │
│ k × one SHARED roll  →  variance too wide,                     │
│ and the hit count is ignored entirely                          │
└────────────────────────────────────────────────────────────────┘
```

For exact shapes and signatures, read the source and the `*.test.ts` files next to each
module — the tests are the worked examples (and pin the numbers against Showdown).

## Develop

```sh
npm install
npm test          # 61 tests: the math, the merge, the render, and an end-to-end run on real data
npm run typecheck
npm run build     # bundles to dist/ (content.js + manifest.json)
npm run watch     # rebuild on save
```

## Install in Chrome

1. `npm run build`
2. Visit `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Open a Random Battle on `play.pokemonshowdown.com` and hover a Pokémon. Its possible
   moves' damage against the opposing active Pokémon appears at the bottom of the tooltip.
   (Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick
   `dist/manifest.json`.)

## Known limitations (v1)

- **Field effects** — weather, screens, terrain, and hazards are not yet folded into the
  calc; the tooltip says so. `calcDamage` already accepts a `field`, so this is the next
  step (read `battle.weather` and side conditions in `readState.ts`).
- **Variable-power multi-hit** — Triple Axel and Triple Kick use `@smogon/calc`'s total
  (marked "approx."), since their base power changes per hit.
- **Population Bomb without Loaded Dice** assumes all 10 hits land (it skips the per-hit
  accuracy check); with Loaded Dice the 4–10 distribution is exact.

[orig]: https://chromewebstore.google.com/detail/pok%C3%A9mon-showdown-randbats/ipfdjoljmkcfabfppnclebjgbehjemch
[feed]: https://github.com/pkmn/randbats
[calc]: https://github.com/smogon/damage-calc
