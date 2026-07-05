# hi-chu

*(hi-chew × pikachu; formerly "Randbats Tooltip but Better")*

Random Battle helpers, one hover away. hi-chu is a small browser extension that enriches
Pokémon Showdown's in-battle tooltips — hover a Pokémon or one of your move buttons and it
fills in what you'd otherwise tab out to a calculator or a set dump for:

- **Which sets are still possible.** Hovering a Pokémon narrows the randbats sets it could
  still be running, using *only* what the battle has made public — moves used, revealed item
  (held, consumed, or knocked off), ability, and any active Terastallization. On the opponent
  it answers "what could they still have?"; on your own it mirrors "what have they figured out
  about me?".
- **Granular multi-hit damage.** Some moves (Bullet Seed, Rock Blast) hit a *random* 2–5
  times, each hit rolling its own damage. The tooltip shows the per-hit damage range, the
  expected number of hits, and a *true* KO chance (probability of knocking the target out)
  that integrates over both the per-hit rolls and the random hit count.
- **Reality-aware calcs.** It reads the live battle, so an *active* Terastallization, the
  current status, stat boosts, revealed ability/item, current HP, **weather, terrain, and
  the defender's screens** all feed the calc. The math is delegated to `@smogon/calc`, so
  interactions resolve correctly — e.g. a *burn* normally halves a physical attacker's damage,
  but the ability **Guts** ignores that, and the calc gets it right.

It works across most Random Battle formats — standard Gen 9, older gens, and variants like
**[Gen 9] Champions** (with Mega / Z-Move sets surfaced where a format has them) — and it's
built to keep growing to cover more.

hi-chu grew out of the excellent, closed-source [Randbats Tooltip][orig] — a tool worth
leaning on that had gone a while without updates and tripped on a few formats. This is a
fresh, open take on the same convenience: same open data feed
([`pkmn.github.io/randbats`][feed]) and the same community damage library
([`@smogon/calc`][calc], maintained by Smogon), built to stay maintained. New to competitive
Pokémon / Showdown? See the [Glossary](#glossary) at the bottom.

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
  PMFs (probability mass functions) and *convolves* them (computes the distribution of a
  sum of independent random variables) — one per-hit roll summed over the hit-count distribution. This is the fix for `@smogon/calc`, which models *k* hits as
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
  typed `LiveFacts` and `FieldFacts` (weather, terrain, the defender's screens). The
  structural `ClientPokemon`/`ClientBattle`/`ClientSide` interfaces document exactly
  which client fields we depend on.
- **`src/content.ts`** — a *content script* (JS the extension injects into the page);
  `world: "MAIN"` runs it in the page's own JS context (Chrome Manifest V3, "MV3") so it
  can reach Showdown's objects. It *monkey-patches* (wraps at runtime)
  `BattleTooltips.prototype.showPokemonTooltip` and appends our section. Everything is
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
npm test          # the math, the merge, the render, field effects, and an end-to-end run on real data
npm run typecheck
npm run build     # bundles to dist/ (content.js + manifest.json)
npm run watch     # rebuild on save
```

## Install

**From a release (no build needed):**

1. Download `hi-chu-<version>.zip` from the [latest release][releases] and unzip it.
2. Visit `chrome://extensions`, enable **Developer mode** (top-right).
3. **Load unpacked** → select the unzipped folder.
4. Open a Random Battle on `play.pokemonshowdown.com` and hover a Pokémon or one of your
   move buttons — the extra lines appear at the bottom of the tooltip.

*(Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick the
`manifest.json` inside the unzipped folder.)*

**From source:** `npm install && npm run build`, then Load unpacked → `dist/`. Run
`npm run package` to produce the release zip yourself.

## Known limitations (v1)

- **Variable-power multi-hit** — Triple Axel and Triple Kick use `@smogon/calc`'s total
  (marked "approx."), since their base power changes per hit.
- **Population Bomb without Loaded Dice** assumes all 10 hits land (it skips the per-hit
  accuracy check); with Loaded Dice the 4–10 distribution is exact.
- **Hazards are intentionally not modelled** — Stealth Rock/Spikes change switch-in HP,
  not a move's damage, and we already read the defender's live HP. Only weather, terrain,
  and screens feed the calc.

## Glossary

For readers new to competitive Pokémon / Showdown:

- **Pokémon Showdown** — a browser-based battle simulator. A **Random Battle** ("randbats")
  gives each player an auto-generated team, but each species draws from a *fixed, published
  pool* of possible sets (moves / item / ability / Tera / level). So you don't know the
  opponent's exact build up front — but the possibilities are finite and known, which is what
  makes this extension possible: it shows them and narrows them as moves and items are revealed.
- **set** — a Pokémon's build: its moves, item, ability, and stat spread (EVs / IVs / nature).
- **rolls** — every damage calculation randomly picks one of **16** values, so a move's
  damage is a range, not a single number.
- **KO / KO%** — knock out (faint; bring to 0 HP) / the probability a move does so.
- **Terastallize / Tera type** — a Gen 9 mechanic that changes a Pokémon's type mid-battle.
- **screens** — Reflect / Light Screen / Aurora Veil, which halve incoming damage.
- **multi-hit move** — a move that strikes several times in one use (a random 2–5, or a fixed count).

[orig]: https://chromewebstore.google.com/detail/pok%C3%A9mon-showdown-randbats/ipfdjoljmkcfabfppnclebjgbehjemch
[feed]: https://github.com/pkmn/randbats
[calc]: https://github.com/smogon/damage-calc
[releases]: https://github.com/seanaujong/hi-chu/releases/latest
