// Driving a real two-account battle, headlessly, against a throwaway self-hosted Showdown
// server (see `local-server.mjs`) instead of the real play.pokemonshowdown.com.
//
// A spectator replay (what `drift-check` uses) has no private team, no move buttons and
// no switch menu, so anything that depends on `battle.myPokemon` is invisible there. The
// only way to reach those surfaces is to BE a player — twice, since a battle needs an
// opponent. This module owns that: starting a local server, joining two clients to it,
// having one challenge the other, and handing back both pages plus the battle's room id.
//
// The CLIENT is still the real, production one: a self-hosted server's `http://localhost`
// redirects to `https://<host>.psim.us` (server/README.md), which serves the actual
// play.pokemonshowdown.com client bundle wired to talk to our local server's websocket
// instead — so this drives real client code, just without touching Showdown's production
// login server, its per-IP login throttle, or real registered accounts.
//
// Consumers: `player-check.mjs` (asserts the private reads still hold) and
// `screenshots.mjs` (photographs the surfaces they unlock).
//
//   (CHROME_PATH=/path/to/chrome overrides the installed-Chrome default)

import {readFileSync} from 'node:fs';
import puppeteer from 'puppeteer-core';
import {startLocalServer} from './local-server.mjs';

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

/**
 * Claim a name with no password and no login server: our local server runs with
 * `noguestsecurity` (see `local-server.mjs`), which accepts a bare `/trn NAME` from anyone.
 */
async function rename(page, name) {
  await evaluate(page, (n) => globalThis.app.send('/trn ' + n), name);
  await page.waitForFunction(
    (id) => {
      const toId = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return globalThis.app.user.get('named') && toId(globalThis.app.user.get('name')) === id;
    },
    {timeout: 15000, polling: 500},
    name.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  console.log(`✓ joined as ${name}`);
}

export async function client(name, port, {viewport = {width: 1280, height: 900}} = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    ...launchOpts,
    // The client is served from a real https://*.psim.us origin (see module header), and
    // Chrome's Local Network Access check otherwise blocks a public page from opening a
    // websocket back to our own ws://localhost — exactly the case it exists to stop, except
    // here we control both ends on purpose.
    args: ['--disable-features=LocalNetworkAccessChecks'],
  });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setBypassCSP(true);
  await page.goto(`http://localhost:${port}/`, {waitUntil: 'domcontentloaded'});
  // The page's own script redirects to https://<host>.psim.us; wait for that to land and a
  // Guest name to be assigned before renaming.
  await page.waitForFunction(() => {
    const u = globalThis.app?.user;
    return !!u && (u.get('named') || /^guest/i.test(u.get('name') ?? ''));
  }, {timeout: 45000});
  await rename(page, name);
  return {browser, page};
}

/** The id of the battle room that appears once a challenge is accepted. */
export const battleRoom = (page) =>
  page
    .waitForFunction(() => Object.keys(globalThis.app.rooms).find((k) => k.startsWith('battle-')) ?? false, {
      timeout: 45000,
    })
    .then((h) => h.jsonValue());

/**
 * Both sides joined and facing each other in a live battle, turn 1 dealt.
 *
 * `close()` forfeits from p1's side (ending the game for both), closes both browsers, and
 * stops the local server; it is safe to call after a failure part-way through, and callers
 * should `finally` it.
 */
export async function startBattle({format = 'gen9randombattle', viewport} = {}) {
  const server = await startLocalServer();
  let p1, p2;
  try {
    p1 = await client('hichuone', server.port, {viewport});
    p2 = await client('hichutwo', server.port, {viewport});
    await p1.page.evaluate((who, fmt) => globalThis.app.send(`/challenge ${who}, ${fmt}`), 'hichutwo', format);
    await sleep(2000); // let the challenge land
    await p2.page.evaluate((who) => globalThis.app.send(`/accept ${who}`), 'hichuone');
    const roomid = await battleRoom(p1.page);
    await battleRoom(p2.page);
    console.log(`✓ battle room: ${roomid}`);

    await p1.page.waitForFunction((id) => {
      const room = globalThis.app.rooms[id];
      return room?.battle?.myPokemon?.length > 0 && room.battle.turn >= 1;
    }, {timeout: 45000}, roomid);

    // Every step below is independently guarded: closing the local server (a child process
    // holding a real port) must never be skipped just because a browser was already dead.
    const close = async () => {
      try {
        await p1.page.evaluate((id) => globalThis.app.send('/forfeit', id), roomid);
        await sleep(1500);
      } catch {} // a dead page can't forfeit; closing the browser ends the battle anyway
      try {
        await p1.browser.close();
      } catch {}
      try {
        await p2.browser.close();
      } catch {}
      server.stop();
    };
    return {p1, p2, roomid, format, close};
  } catch (err) {
    if (p1) await p1.browser.close().catch(() => {});
    if (p2) await p2.browser.close().catch(() => {});
    server.stop();
    throw err;
  }
}
