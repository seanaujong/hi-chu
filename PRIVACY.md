# Privacy Policy — hi-chu

_Last updated: 2026-07-05_

**hi-chu does not collect, store, transmit, or sell any personal or user data.**

The extension runs entirely in your browser. Specifically:

- **What it reads.** On `play.pokemonshowdown.com` it reads the *already-visible*
  state of the battle you are watching (the same public information shown in
  Showdown's own tooltips) to compute the damage and set-possibility lines it adds
  to those tooltips. This never leaves your browser.
- **What it fetches.** It downloads the public Random Battle set data from
  `https://pkmn.github.io/randbats/` — a plain, anonymous `GET` for a JSON file.
  No information about you is included in that request.
- **What it stores.** It caches that public set data in your browser's
  `localStorage` so repeat visits are fast and work offline. You can clear it at
  any time via your browser's site-data controls. Nothing else is stored.
- **What it does *not* do.** No analytics, no tracking, no cookies, no accounts,
  no remote logging, no third-party services beyond the single public data feed
  above. No data is ever sold or shared.

hi-chu is open source — you can verify all of the above in the code at
<https://github.com/seanaujong/hi-chu>.

Questions? Open an issue at <https://github.com/seanaujong/hi-chu/issues>.
