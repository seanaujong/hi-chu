// Live player-side check: the reads `drift-check` can NEVER reach, probed in a real
// battle. A spectator replay has no `battle.myPokemon` and no move controls, so the
// private-team fields (readOwnItem / readOwnTeraType / readOwnMoves /
// serverPokemonFacts) and the Terastallize checkbox are 👁 review-only there. This
// script closes that gap: it logs two throwaway accounts into play.pokemonshowdown.com,
// has one privately challenge the other, and — as an actual player — verifies:
//
//   1. every myPokemon entry carries ident / details / condition / item / teraType /
//      moves (id form) — the ServerPokemon contract serverPokemonFacts parses;
//   2. a REAL mouse hover on a benched mon in the switch menu renders our matchup
//      block through the shipped bundle (dist/content.js — build first);
//   3. the move panel's Terastallize checkbox still matches TERA_TOGGLE_SELECTOR.
//
// It forfeits and closes both browsers when done. LOCAL/manual, like drift-check —
// run it after a client update. Needs two registered throwaway accounts:
//
//   PS_ACCOUNT1="name:password" PS_ACCOUNT2="name:password" npm run player-check
//   (CHROME_PATH=/path/to/chrome to override the installed-Chrome default)

import {readFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';

function account(envVar) {
  const raw = process.env[envVar];
  const [name, password] = (raw ?? '').split(':');
  if (!name || !password) {
    console.error(`player-check needs ${envVar}="name:password" (two registered throwaway accounts).`);
    process.exit(2);
  }
  return {name, password};
}
const ACC1 = account('PS_ACCOUNT1');
const ACC2 = account('PS_ACCOUNT2');
const FORMAT = process.argv[2] || 'gen9randombattle';

const BUNDLE = readFileSync(new URL('../dist/content.js', import.meta.url), 'utf8');
const launchOpts = process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {channel: 'chrome'};
const problems = [];

async function client({name, password}) {
  const browser = await puppeteer.launch({headless: true, ...launchOpts});
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 900});
  await page.setBypassCSP(true);
  await page.goto('https://play.pokemonshowdown.com/', {waitUntil: 'domcontentloaded'});
  // Handshake done once the server has assigned a Guest name (or restored a login).
  await page.waitForFunction(() => {
    const u = globalThis.app?.user;
    return !!u && (u.get('named') || /^guest/i.test(u.get('name') ?? ''));
  }, {timeout: 45000});
  // `rename` only fetches an assertion and pops the login form for a registered name;
  // `passwordRename` is the act=login path the popup's own Log in button calls.
  await page.evaluate((n, p) => globalThis.app.user.passwordRename(n, p), name, password);
  await page.waitForFunction((n) => {
    const toId = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return globalThis.app.user.get('named') && toId(globalThis.app.user.get('name')) === toId(n);
  }, {timeout: 20000}, name);
  console.log(`✓ logged in as ${name}`);
  return {browser, page};
}

const battleRoom = (page) =>
  page
    .waitForFunction(() => Object.keys(globalThis.app.rooms).find((k) => k.startsWith('battle-')) ?? false, {timeout: 45000})
    .then((h) => h.jsonValue());

const p1 = await client(ACC1);
let p2;
try {
  p2 = await client(ACC2);
  await p1.page.evaluate((who, fmt) => globalThis.app.send(`/challenge ${who}, ${fmt}`), ACC2.name, FORMAT);
  await new Promise((r) => setTimeout(r, 2000)); // let the challenge land
  await p2.page.evaluate((who) => globalThis.app.send(`/accept ${who}`), ACC1.name);
  const roomid = await battleRoom(p1.page);
  await battleRoom(p2.page);
  console.log(`✓ battle room: ${roomid}`);

  await p1.page.waitForFunction((id) => {
    const room = globalThis.app.rooms[id];
    return room?.battle?.myPokemon?.length > 0 && room.battle.turn >= 1;
  }, {timeout: 45000}, roomid);

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
  const isMatchup = (html) => /<small>vs<\/small> <b>/.test(html) && /: [\d.]+% - [\d.]+%/.test(html);
  const perButton = new Map(); // data-tooltip → latest tooltip html
  const capturePass = async () => {
    for (const h of await p1.page.$$(benchSel)) {
      await p1.page.mouse.move(0, 0); // leave, so re-hover re-renders
      await h.hover();
      await new Promise((r) => setTimeout(r, 350));
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

  // --- 3. the Terastallize checkbox selector --------------------------------
  const tera = await p1.page.evaluate((id) => {
    const room = document.getElementById(`room-${id}`);
    return !!(room ?? document).querySelector('input[name=terastallize], input[name=tera]');
  }, roomid);
  // Absent is only a soft signal (the active may simply be unable to Tera this game).
  console.log(tera ? '✓ Terastallize checkbox selector matches' : '· Terastallize checkbox absent this battle (soft signal — retry another game before calling drift)');

  await p1.page.evaluate((id) => globalThis.app.send('/forfeit', id), roomid);
  await new Promise((r) => setTimeout(r, 1500));
} finally {
  await p1.browser.close();
  if (p2) await p2.browser.close();
}

if (problems.length) {
  console.error('\n✗ PLAYER-SIDE DRIFT DETECTED:');
  for (const p of problems) console.error(`    - ${p}`);
  process.exitCode = 1;
} else {
  console.log('\n✓ all player-side reads hold on the live client.');
}
