// Live player-side check: the reads `drift-check` can NEVER reach, probed in a real
// battle. A spectator replay has no `battle.myPokemon` and no move controls, so the
// private-team fields (readOwnItem / readOwnTeraType / readOwnMoves /
// serverPokemonFacts) and the Terastallize checkbox are 👁 review-only there. This
// script closes that gap: it logs two throwaway accounts into play.pokemonshowdown.com,
// has one privately challenge the other, and — as an actual player — verifies:
//
//   1. every myPokemon entry carries ident / details / condition / item / teraType /
//      moves (id form) / maxhp / stats — the ServerPokemon contract serverPokemonFacts
//      and serverStats parse;
//   2. a REAL mouse hover on a benched mon in the switch menu renders our matchup
//      block through the shipped bundle (dist/content.js — build first);
//   3. the move panel's Terastallize checkbox still matches TERA_TOGGLE_SELECTOR.
//
// It forfeits and closes both browsers when done. LOCAL/manual, like drift-check —
// run it after a client update. Needs two registered throwaway accounts:
//
//   PS_ACCOUNT1="name:password" PS_ACCOUNT2="name:password" npm run player-check
//   (CHROME_PATH=/path/to/chrome to override the installed-Chrome default)
//
// A format id may follow, and it's worth running BOTH sides of the format split —
// `gen9randombattle` (the feed path) and `gen9hackmonscup` (an OPEN format that still
// needs no teambuilder, so the assumed-spread path gets a real request JSON):
//
//   node scripts/player-check.mjs gen9hackmonscup
//
// The two-account battle itself lives in `lib/showdown.mjs`, shared with `screenshots.mjs`.

import {startBattle, readBundle, sleep} from './lib/showdown.mjs';

const FORMAT = process.argv[2] || 'gen9randombattle';
const BUNDLE = readBundle();
const problems = [];

const battle = await startBattle({format: FORMAT, viewport: {width: 1280, height: 900}});
try {
  const {p1, roomid} = battle;

  // --- 1. the ServerPokemon contract ---------------------------------------
  const team = await p1.page.evaluate((id) =>
    globalThis.app.rooms[id].battle.myPokemon.map((p) => ({
      ident: p.ident, details: p.details, condition: p.condition,
      item: p.item, teraType: p.teraType, moves: p.moves,
      maxhp: p.maxhp, stats: p.stats,
    })), roomid);
  for (const p of team) {
    if (typeof p.ident !== 'string' || !p.ident.includes(':')) problems.push(`myPokemon ident = ${JSON.stringify(p.ident)}`);
    if (typeof p.details !== 'string' || !p.details) problems.push(`${p.ident}.details = ${JSON.stringify(p.details)}`);
    if (typeof p.condition !== 'string' || !p.condition) problems.push(`${p.ident}.condition = ${JSON.stringify(p.condition)}`);
    if (typeof p.item !== 'string') problems.push(`${p.ident}.item = ${JSON.stringify(p.item)}`);
    if (typeof p.teraType !== 'string' || !p.teraType) problems.push(`${p.ident}.teraType = ${JSON.stringify(p.teraType)}`);
    if (!Array.isArray(p.moves) || p.moves.length === 0 || !p.moves.every((m) => /^[a-z0-9]+$/.test(m))) {
      problems.push(`${p.ident}.moves = ${JSON.stringify(p.moves)} (expected non-empty id-form list)`);
    }
    // The request's exact finals — how an OPEN format's own-side damage stops assuming a
    // spread (readState.serverStats). `maxhp` is the HP total; `stats` carries the other five.
    if (typeof p.maxhp !== 'number' || p.maxhp <= 0) problems.push(`${p.ident}.maxhp = ${JSON.stringify(p.maxhp)}`);
    const five = ['atk', 'def', 'spa', 'spd', 'spe'];
    if (!p.stats || five.some((s) => typeof p.stats[s] !== 'number' || p.stats[s] <= 0)) {
      problems.push(`${p.ident}.stats = ${JSON.stringify(p.stats)} (expected the five final stats)`);
    }
  }
  console.log(problems.length ? '✗ myPokemon contract drifted' : `✓ myPokemon contract holds (${team.length} mons)`);

  // --- 2. the switch-menu hover through the shipped bundle ------------------
  // Hover EVERY enabled switch button: a mon whose kit is all status moves (Ditto's
  // lone Transform) correctly gets no block, so the check is that at least one bench
  // mon renders one — zero across the whole bench is the failure that shipped in
  // v0.11's first cut. The first hovers also warm the randbats feed, hence the retries.
  await p1.page.addScriptTag({content: BUNDLE});
  const benchSel = '.switchmenu button[data-tooltip^="switchpokemon"]:not(.disabled)';
  await p1.page.waitForSelector(benchSel, {timeout: 30000});
  // A damage line reads "Draco Meteor: 41% - 49%" in a randbats battle, where the foe's
  // set pins one outcome — and "Burn Up: (uninvested) 55.4% - 65.2% · (max HP/SpD) …"
  // in an open format, where the assumed spreads label each bucket. Match the number,
  // not what precedes it, so this check works in both.
  const isMatchup = (html) => /<small>vs<\/small> <b>/.test(html) && /[\d.]+% - [\d.]+%/.test(html);
  const perButton = new Map(); // data-tooltip → latest tooltip html
  const capturePass = async () => {
    for (const h of await p1.page.$$(benchSel)) {
      await p1.page.mouse.move(0, 0); // leave, so re-hover re-renders
      // The switch menu is hidden while the move menu is up (and mid-animation), so a
      // button can exist yet not be hoverable. Skip it; a later pass will catch it.
      try {
        await h.hover();
      } catch {
        continue;
      }
      await sleep(350);
      const key = await h.evaluate((el) => el.getAttribute('data-tooltip'));
      perButton.set(key, await p1.page.evaluate(() => document.querySelector('#tooltipwrapper')?.innerHTML ?? ''));
    }
  };
  // Warm-up passes: hovers made while the feed is still fetching render native-only,
  // so keep sweeping until some block appears (or the timeout budget runs out)…
  for (let attempt = 0; attempt < 20 && ![...perButton.values()].some(isMatchup); attempt++) {
    await capturePass();
  }
  // …then one clean pass, so a button first hovered pre-warm isn't judged on its
  // stale cold capture (the race that mislabelled a damaging kit as blockless).
  await capturePass();
  let withBlock = 0;
  for (const [key, html] of perButton) {
    const slot = Number(/\d+/.exec(key ?? '')?.[0] ?? -1);
    const who = team[slot] ? `${team[slot].ident} moves=[${team[slot].moves.join(', ')}]` : key;
    if (isMatchup(html)) {
      withBlock++;
      console.log(`  ✓ matchup block: ${who}`);
    } else {
      console.log(`  · no block:      ${who}`);
    }
  }
  if (withBlock === 0) {
    problems.push(`no switch-menu hover rendered a matchup block (checked ${perButton.size} bench buttons):\n${[...perButton.values()][0]?.slice(0, 800)}`);
  }
  console.log(withBlock > 0
    ? `✓ switch-menu hover renders the matchup block (${withBlock}/${perButton.size} bench mons; all-status kits correctly get none)`
    : '✗ no matchup block on any switch-menu hover');

  // --- 2b. the ⚡ speed verdict on a BENCHED mon -----------------------------
  // A bench mon's speed appears on no other surface, and its inputs (the private
  // team's item/status, its own base stats) are exactly what a spectator replay
  // cannot supply — so this is the only place the line can be checked for real.
  // Randbats enumerates the foe's sets and must produce it; an open format has no
  // pool to read a foe speed from and must produce none.
  const feedFormat = /random/.test(FORMAT);
  const zapLines = [...perButton.values()]
    .filter(isMatchup)
    .flatMap((html) => [...html.matchAll(/⚡.*?(?=<\/p>)/g)].map((m) => m[0].replace(/<[^>]+>/g, '')));
  for (const line of zapLines.slice(0, 3)) console.log(`  ⚡ ${line.replace('⚡ ', '')}`);
  if (feedFormat && withBlock > 0 && zapLines.length === 0) {
    problems.push('no ⚡ speed verdict on any switch-menu matchup block (randbats: the foe pool should always yield one)');
  }
  if (!feedFormat && zapLines.length > 0) {
    problems.push(`⚡ speed verdict rendered in an OPEN format, where no honest foe speed exists: ${zapLines[0]}`);
  }
  console.log(feedFormat
    ? (zapLines.length > 0 ? `✓ ⚡ speed verdict on the switch menu (${zapLines.length} bench blocks)` : '✗ no ⚡ on any bench block')
    : (zapLines.length === 0 ? '✓ no ⚡ in an open format (no foe pool to read a speed from)' : '✗ ⚡ leaked into an open format'));

  // --- 3. the Terastallize checkbox selector --------------------------------
  const tera = await p1.page.evaluate((id) => {
    const room = document.getElementById(`room-${id}`);
    return !!(room ?? document).querySelector('input[name=terastallize], input[name=tera]');
  }, roomid);
  // Absent is only a soft signal (the active may simply be unable to Tera this game).
  console.log(tera ? '✓ Terastallize checkbox selector matches' : '· Terastallize checkbox absent this battle (soft signal — retry another game before calling drift)');
} finally {
  await battle.close();
}

if (problems.length) {
  console.error('\n✗ PLAYER-SIDE DRIFT DETECTED:');
  for (const p of problems) console.error(`    - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n✓ all player-side reads hold on the live client.');
}
