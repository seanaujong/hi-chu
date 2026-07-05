# Chrome Web Store submission — copy/paste fields

Everything the CWS Developer Dashboard asks for, ready to paste. Upload
`hi-chu-<version>.zip` (from `npm run package`) as the package.

## Store listing

**Product name**

```
hi-chu — Showdown Randbats helper
```

**Summary** (≤ 132 chars)

```
Random Battle helpers on hover for Pokémon Showdown: possible sets, live-aware damage, and true multi-hit KO%.
```

**Category:** `Tools`
**Language:** `English`

**Description**

```
hi-chu adds Random Battle helpers to Pokémon Showdown, one hover away. Hover a
Pokémon or one of your move buttons and it fills in what you'd otherwise tab out
to a calculator or a set dump for:

• Which sets are still possible. Hovering a Pokémon narrows the Random Battle
  sets it could still be running, using only what the battle has made public —
  moves used, revealed item (held, consumed, or knocked off), ability, and any
  active Terastallization. On the opponent it answers "what could they still
  have?"; on your own it mirrors "what have they figured out about me?".

• Live-aware damage. It reads the live battle, so active Terastallization, status,
  stat boosts, revealed ability/item, current HP, weather, terrain, and the
  defender's screens all feed the calc. The math is delegated to @smogon/calc, so
  interactions resolve correctly (for example, Guts ignoring a burn's damage cut).

• True multi-hit KO%. For moves that hit a random 2–5 times, each rolling its own
  damage, it shows the per-hit range, the expected hit count, and a real KO chance
  that integrates over both the rolls and the random hit count — not "k × one roll".

It works across most Random Battle formats — standard Gen 9, older gens, and
variants like [Gen 9] Champions (with Mega / Z-Move sets surfaced where a format
has them) — and it's built to keep growing to cover more.

hi-chu is free and open source (MIT). It collects no data. It was inspired by the
closed-source "Randbats Tooltip" — a fresh, open, maintained take on the same
convenience.

hi-chu is an unofficial fan-made tool. It is not affiliated with, endorsed by, or
associated with Nintendo, Game Freak, The Pokémon Company, or Pokémon Showdown.
"Pokémon" and all related names are trademarks of their respective owners.

Source & issues: https://github.com/seanaujong/hi-chu
```

## Privacy practices

These map 1:1 onto the **Privacy practices** tab in the Developer Dashboard. The
extension requests **no API permissions** (no `storage`, `tabs`, `scripting`,
`activeTab`) — it caches with the page's own `localStorage`, not `chrome.storage`
— so the only justification the dashboard asks for is the single host-permission
box. Fill the fields in order.

### Single purpose

```
hi-chu adds two informational lines to Pokémon Showdown's Random Battle tooltips:
a move's damage into the active Pokémon, and which Random Battle sets an opponent
could still be running. Both are computed in the browser from the battle's
already-public state — the same information Showdown itself displays.
```

### Host permission justification

The dashboard shows **one** box covering all host access — both the declared
`host_permissions` and the content-script `matches`. Paste this:

```
hi-chu needs two hosts, each required for its single purpose:

• play.pokemonshowdown.com — a content script reads the already-visible battle
  state on the page (the same public info shown in Showdown's own tooltips) and
  injects the extra damage / possible-set lines. This is the page the feature
  augments; without access there is nothing to read or enhance. All processing
  stays in the page and nothing is transmitted.

• pkmn.github.io — the extension downloads the public Random Battle set data (a
  static JSON file) that it displays and narrows against the battle. The request
  is an anonymous GET for a public file and includes no user information.

No other hosts are accessed, and no data leaves the browser.
```

If a future dashboard version splits this into per-host boxes, paste the matching
bullet into each.

### Remote code

Answer **No** — *"I am not using remote code."* Everything, including the
`@smogon/calc` engine, is bundled into `content.js` at build time (esbuild). The
content script runs in the MAIN world to wrap Showdown's own tooltip renderers,
but it executes only bundled code; the sole network fetch is the static JSON data
above, which is data, not code.

### Data usage

Disclose **no** data collection — leave every category unchecked (personally
identifiable info, health, financial, authentication, personal communications,
location, web history, user activity, website content). hi-chu collects, stores,
and transmits none of it; the `localStorage` cache holds only the public set-data
JSON, which is not user data. Then check all three certifications:

- I do not sell or transfer user data to third parties, outside the approved use cases. ✅
- I do not use or transfer user data for purposes unrelated to my item's single purpose. ✅
- I do not use or transfer user data to determine creditworthiness or for lending. ✅

…and the final *"I certify that the above disclosures are accurate"* box.

### Privacy policy URL

```
https://github.com/seanaujong/hi-chu/blob/main/PRIVACY.md
```

## Instructions for reviewers (test instructions)

hi-chu only shows anything once you are **inside a Random Battle and hovering** —
so give the reviewer the trigger explicitly. No account, login, or payment is
needed. Paste into the reviewer-notes / test-instructions field if the dashboard
offers one; otherwise keep it ready in case the review team asks.

```
hi-chu adds extra lines to Pokémon Showdown's Random Battle tooltips. It does
nothing outside a Random Battle, so to see it work:

1. Install the extension, then open https://play.pokemonshowdown.com
2. Click "Choose name" (top right) and pick any unclaimed name (max 20
   characters). If a name is already registered it will ask for a password, so
   just choose a different one — no account or password is required.
3. Start a Random Battle: pick format "[Gen 9] Random Battle" and click
   "Battle!". (Alternatively, no play needed: Menu > "Watch a battle" and open
   any live Random Battle to spectate.)
4. In the battle, HOVER over a Pokémon — hi-chu adds its still-possible sets and
   the damage it takes/deals versus the active Pokémon. HOVER one of your move
   buttons — it adds that move's damage and KO% into the opposing Pokémon.

Everything runs locally in the page. The only network request is an anonymous
download of public Random Battle set data from https://pkmn.github.io — no user
data is collected or sent anywhere.
```

## Assets checklist

- [x] Package zip — `npm run package` → `hi-chu-<version>.zip`
- [x] Store icon 128×128 — `public/icons/icon-128.png`
- [ ] Screenshots — 1280×800 (or 640×400), 1–5 of the tooltip in action (below)
- [ ] Small promo tile 440×280 — optional
- [ ] Privacy policy URL live — commit & push `PRIVACY.md` first

## After submission

Review typically takes a few business days for a new item. Bump `version` in both
`package.json` and `public/manifest.json` for each resubmission.
