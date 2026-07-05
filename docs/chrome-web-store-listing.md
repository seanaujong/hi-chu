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

Source & issues: https://github.com/seanaujong/hi-chu
```

## Privacy

**Single purpose**

```
Augment Pokémon Showdown Random Battle tooltips with damage calculations and
possible-set information derived from the public battle state.
```

**Permission justifications**

- `host_permissions: https://pkmn.github.io/*`
  ```
  Used to download the public Random Battle set data (a JSON file) that the
  extension displays. The request is an anonymous GET; no user data is sent.
  ```
- Content script on `https://play.pokemonshowdown.com/*`
  ```
  Used to read the already-visible battle state on the Showdown battle page and
  inject the extra tooltip lines. Everything stays in the page; nothing is sent
  anywhere.
  ```
- Remote code: **No** — all code is bundled in the package; nothing is fetched
  and executed. Only static JSON data is fetched.

**Data usage** — check *No* for every category (name, location, financial,
health, authentication, personal communications, web history, user activity,
etc.). The extension collects none of it. Certify:
- Not being sold to third parties. ✅
- Not used/transferred for purposes unrelated to the item's core function. ✅
- Not used/transferred to determine creditworthiness / for lending. ✅

**Privacy policy URL**

```
https://github.com/seanaujong/hi-chu/blob/main/PRIVACY.md
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
