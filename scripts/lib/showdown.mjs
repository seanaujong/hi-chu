// Driving a real two-account battle on play.pokemonshowdown.com, headlessly.
//
// A spectator replay (what `drift-check` uses) has no private team, no move buttons and
// no switch menu, so anything that depends on `battle.myPokemon` is invisible there. The
// only way to reach those surfaces is to BE a player — twice, since a battle needs an
// opponent. This module owns that: logging two throwaway accounts in, having one
// challenge the other, and handing back both pages plus the battle's room id.
//
// Consumers: `player-check.mjs` (asserts the private reads still hold) and
// `screenshots.mjs` (photographs the surfaces they unlock).
//
// Needs two registered throwaway accounts, passed as env vars:
//   PS_ACCOUNT1="name:password" PS_ACCOUNT2="name:password"
//   (CHROME_PATH=/path/to/chrome overrides the installed-Chrome default)

import {readFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';

export const launchOpts = process.env.CHROME_PATH
  ? {executablePath: process.env.CHROME_PATH}
  : {channel: 'chrome'};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `page.evaluate`, tolerant of the client reloading itself (a version bump, a hard
 * disconnect, or a throttled login retry all do it). The reload detaches the frame we were
 * talking to; the page comes back from its URL a moment later, so the read is worth
 * retrying rather than fatal.
 */
export async function evaluate(page, fn, ...args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (err) {
      const reloading = /detached|execution context|Target closed/i.test(err.message);
      if (!reloading || attempt >= 5) throw err;
      console.log('  · client reloaded; waiting for it to come back');
      await sleep(2000);
    }
  }
}

/** The shipped extension bundle, injected into the live page as `content.ts` would be. */
export const readBundle = () => readFileSync(new URL('../../dist/content.js', import.meta.url), 'utf8');

export function account(envVar) {
  const raw = process.env[envVar];
  const [name, password] = (raw ?? '').split(':');
  if (!name || !password) {
    console.error(`This script needs ${envVar}="name:password" (two registered throwaway accounts).`);
    process.exit(2);
  }
  return {name, password};
}

/**
 * Log in, tolerating a throttled `act=login`. Showdown rate-limits logins per IP, so the
 * first attempt of a run started soon after a previous one routinely goes nowhere: the
 * client's `passwordRename` resolves, the account silently stays a guest, and a lone wait
 * just times out. Retrying with backoff clears it.
 *
 * The two failures look identical from `user.get('named')`, so they're told apart at the
 * source: `action.php` answers a REFUSAL with `{"actionerror":"Wrong password."}` and a
 * throttle with nothing at all. A refusal fails fast — retrying a bad password only walks
 * into the same wall, and a "throttled, wait a minute" message would be a lie.
 */
export async function login(page, name, password) {
  const refusals = [];
  const listen = (res) => {
    if (!/action\.php/.test(res.url())) return;
    res
      .text()
      .then((body) => {
        const error = /"actionerror":"([^"]+)"/.exec(body);
        if (error) refusals.push(error[1]);
      })
      .catch(() => {}); // a body we can't read tells us nothing either way
  };
  page.on('response', listen);
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      // `rename` only fetches an assertion and pops the login form for a registered name;
      // `passwordRename` is the act=login path the popup's own Log in button calls.
      await evaluate(page, (n, p) => globalThis.app.user.passwordRename(n, p), name, password);
      try {
        // Poll on a timer, not rAF: we're waiting on a model field, not a paint.
        await page.waitForFunction(
          (id) => {
            const toId = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return globalThis.app.user.get('named') && toId(globalThis.app.user.get('name')) === id;
          },
          {timeout: 15000, polling: 500},
          name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        );
        if (attempt > 1) console.log(`  · login for ${name} took ${attempt} attempts (throttled)`);
        console.log(`✓ logged in as ${name}`);
        return;
      } catch (timeout) {
        await sleep(500); // let a refusal body finish arriving
        if (refusals.length) throw new Error(`login refused for ${name} — action.php said: ${refusals[0]}`);
        if (attempt === 4) {
          throw new Error(
            `login for ${name} never took after 4 attempts (~60s), and action.php never refused it. ` +
              `Showdown throttles act=login per IP — wait a minute and rerun.`,
          );
        }
        console.log(`  · login attempt ${attempt} for ${name} timed out; retrying`);
        await sleep(attempt * 3000); // back off: 3s, 6s, 9s
      }
    }
  } finally {
    page.off('response', listen);
  }
}

export async function client({name, password}, {viewport = {width: 1280, height: 900}} = {}) {
  const browser = await puppeteer.launch({headless: true, ...launchOpts});
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setBypassCSP(true);
  await page.goto('https://play.pokemonshowdown.com/', {waitUntil: 'domcontentloaded'});
  // Handshake done once the server has assigned a Guest name (or restored a login).
  await page.waitForFunction(() => {
    const u = globalThis.app?.user;
    return !!u && (u.get('named') || /^guest/i.test(u.get('name') ?? ''));
  }, {timeout: 45000});
  await login(page, name, password);
  // A previous run that crashed before forfeiting leaves its battle room attached to the
  // account. Forfeit and leave it, and remember every id that was already here — the room
  // lookup below waits for a room that ISN'T one of these, so a lingering finished battle
  // can never be mistaken for the one we're about to start.
  const stale = await page.evaluate(() => {
    const ids = Object.keys(globalThis.app.rooms).filter((k) => k.startsWith('battle-'));
    for (const id of ids) {
      globalThis.app.send('/forfeit', id);
      globalThis.app.leaveRoom(id);
    }
    return ids;
  });
  if (stale.length) console.log(`  · forfeited ${stale.length} stale battle room(s) from an earlier run`);
  return {browser, page, stale};
}

/** The id of a battle room that appeared AFTER login (ignoring any stale ones). */
export const battleRoom = ({page, stale}) =>
  page
    .waitForFunction(
      (old) => Object.keys(globalThis.app.rooms).find((k) => k.startsWith('battle-') && !old.includes(k)) ?? false,
      {timeout: 45000},
      stale,
    )
    .then((h) => h.jsonValue());

/**
 * Both accounts logged in and facing each other in a live battle, turn 1 dealt.
 *
 * `close()` forfeits from p1's side (ending the game for both) and closes both browsers;
 * it is safe to call after a failure part-way through, and callers should `finally` it.
 */
export async function startBattle({format = 'gen9randombattle', viewport} = {}) {
  const acc1 = account('PS_ACCOUNT1');
  const acc2 = account('PS_ACCOUNT2');
  const p1 = await client(acc1, {viewport});
  let p2;
  try {
    p2 = await client(acc2, {viewport});
    await p1.page.evaluate((who, fmt) => globalThis.app.send(`/challenge ${who}, ${fmt}`), acc2.name, format);
    await sleep(2000); // let the challenge land
    await p2.page.evaluate((who) => globalThis.app.send(`/accept ${who}`), acc1.name);
    const roomid = await battleRoom(p1);
    await battleRoom(p2);
    console.log(`✓ battle room: ${roomid}`);

    await p1.page.waitForFunction((id) => {
      const room = globalThis.app.rooms[id];
      return room?.battle?.myPokemon?.length > 0 && room.battle.turn >= 1;
    }, {timeout: 45000}, roomid);

    const close = async () => {
      try {
        await p1.page.evaluate((id) => globalThis.app.send('/forfeit', id), roomid);
        await sleep(1500);
      } catch {} // a dead page can't forfeit; closing the browser ends the battle anyway
      await p1.browser.close();
      await p2.browser.close();
    };
    return {p1, p2, roomid, format, close};
  } catch (err) {
    await p1.browser.close();
    if (p2) await p2.browser.close();
    throw err;
  }
}
