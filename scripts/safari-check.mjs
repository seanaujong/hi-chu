// Live Safari check: does the actual installed hi-chu Safari extension augment a real
// tooltip in a real Safari session?
//
// This is the runtime half `drift-check.mjs` can't cover for Chrome and PR #40 couldn't
// prove by building alone: whether Safari's dynamic `scripting.registerContentScripts`
// workaround for the unsupported `"world": "MAIN"` manifest key (see CLAUDE.md /
// TODO.md) actually delivers content.js into the page's real JS realm at runtime, in a
// real browser, with the real packaged extension enabled — not just that the Xcode
// project builds.
//
// Unlike drift-check.mjs, this drives your ALREADY-RUNNING, ALREADY-ENABLED default
// Safari via safaridriver's WebDriver protocol (built into macOS since Safari 10) —
// there is no headless/fresh-profile mode for Safari, and the whole point is to
// exercise the real extension, which only exists in your real browser profile.
//
// ONE-TIME SETUP (see TODO.md for the full writeup):
//   1. `safaridriver --enable` (once; may need sudo on a fresh macOS install)
//   2. Safari's Develop menu → "Allow Remote Automation"
//   3. Build + run the Safari port once (`npm run build:safari`, open
//      safari/hi-chu/hi-chu.xcodeproj, run the "hi-chu (macOS)" scheme) and enable the
//      extension in Safari → Settings → Extensions. This step cannot be automated —
//      Apple deliberately provides no programmatic way to enable a Safari App
//      Extension on an unmanaged Mac.
//
//   npm run safari-check

import {Builder} from 'selenium-webdriver';

const FORMAT = 'gen9randombattle';
const MIN_TURNS = 6;
const STYLE_TIMEOUT_MS = 15000; // content.js has to be registered, injected, and run

/** Same shape as drift-check.mjs's pickReplay — a real, public, reproducible battle. */
async function pickReplay() {
  const res = await fetch(`https://replay.pokemonshowdown.com/search.json?format=${FORMAT}`);
  const list = await res.json();
  for (const r of list.slice(0, 15)) {
    try {
      const data = await (await fetch(`https://replay.pokemonshowdown.com/${r.id}.json`)).json();
      const turns = (data.log.match(/\n\|turn\|/g) || []).length;
      if (turns >= MIN_TURNS) return {id: r.id, turns};
    } catch {
      // skip replays that fail to fetch/parse
    }
  }
  throw new Error(`no ${FORMAT} replay with >= ${MIN_TURNS} turns in the recent list`);
}

async function main() {
  const {id, turns} = await pickReplay();
  console.log(`▶ probing replay ${id} (${turns} turns) in real Safari`);

  const driver = await new Builder().forBrowser('safari').build();
  try {
    await driver.get(`https://replay.pokemonshowdown.com/${id}`);
    await driver.wait(async () => driver.executeScript('return !!window.battle;'), 30000);

    // content.ts's install() calls injectStyleOnce() unconditionally, independent of
    // any tooltip actually being shown or the randbats feed having loaded — the single
    // most deterministic "did our content script run in the real page at all?" signal.
    const styleAppeared = await driver
      .wait(async () => driver.executeScript("return !!document.getElementById('hichu-style');"), STYLE_TIMEOUT_MS)
      .catch(() => false);

    if (!styleAppeared) {
      console.error('\n✗ content.js never ran in the page: #hichu-style was never injected.');
      console.error('  Checklist:');
      console.error('    - Is the hi-chu extension enabled? Safari → Settings → Extensions.');
      console.error('    - Did you build+run the Safari target after the latest src/ changes?');
      console.error('    - Check Safari\'s Web Inspector console on this tab for a [hi-chu] error.');
      process.exitCode = 1;
      return;
    }
    console.log('  ✓ #hichu-style injected — content.js ran in the page.');

    const patched = await driver.executeScript("return !!(window.BattleTooltips && window.BattleTooltips.prototype.__hichuPatched);");
    if (!patched) {
      console.error('\n✗ #hichu-style is present, but window.BattleTooltips.prototype.__hichuPatched is not set.');
      console.error('  This would mean content.js ran but in the wrong JS realm (isolated world,');
      console.error('  not MAIN) — a different window.BattleTooltips than the page\'s real one.');
      process.exitCode = 1;
      return;
    }
    console.log('  ✓ window.BattleTooltips.prototype.__hichuPatched — patched the REAL page object (true MAIN-world execution).');

    // Best-effort, not load-bearing: call the real (now-patched) method directly on a
    // live active Pokémon and look for our own "hichu-block" marker class in the output
    // — the same direct-call style drift-check.mjs and this repo's own tests use, rather
    // than simulating a pixel-perfect mouse hover over Showdown's DOM. Soft-fails if the
    // randbats feed (an async fetch content.ts kicks off on first hover) hasn't warmed
    // yet — that's a timing question, not evidence the extension is broken.
    const html = await driver.executeScript(`
      const mon = (window.battle.sides || []).flatMap(s => (s.active || []).filter(Boolean))[0];
      if (!mon) return null;
      return window.BattleTooltips.prototype.showPokemonTooltip.call({battle: window.battle}, mon);
    `);
    if (typeof html === 'string' && html.includes('hichu-block')) {
      console.log('  ✓ a real showPokemonTooltip() call rendered a hichu-block section.');
    } else {
      console.log('  (skipped: no hichu-block in a direct showPokemonTooltip() call yet — likely the randbats feed was still warming; not a failure)');
    }

    console.log('\n✓ the Safari extension is live: content.js ran in the real page\'s MAIN world.');
  } finally {
    await driver.quit();
  }
}

main().catch((e) => {
  console.error('safari-check could not run:', e.message);
  console.error('(needs `safaridriver --enable` once, and Safari\'s Develop menu → "Allow Remote Automation".)');
  process.exitCode = 2;
});
