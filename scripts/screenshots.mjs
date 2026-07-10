// Photograph every hi-chu tooltip surface from a real, played-out battle.
//
// The screenshots this replaces were all shot on a spectator REPLAY, which is why they all
// show the same thing: a foe hover. A spectator has no private team, no move buttons and no
// switch menu, so four surfaces are invisible there — the move tooltip, the own-hover
// matchup view, the switch menu (the only place a benched mon's ⚡ speed verdict appears),
// and the Terastallize preview. Being a player is the whole point of this script; it is
// `player-check`'s harness pointed at a camera instead of at assertions.
//
//   PS_ACCOUNT1="name:password" PS_ACCOUNT2="name:password" npm run screenshots
//   node scripts/screenshots.mjs gen9ou      # an open format: bracketed damage, no ⚡/sets
//   TURNS=8 npm run screenshots              # play deeper before shooting
//
// It plays both sides for a few turns first, so the tooltips have something to say: moves
// come back ✓ confirmed, HP bars are dented, and the foe's set pool has narrowed. Then it
// shoots each surface twice — a full shot framed to the battle (battle scene + log, with
// Showdown's top banner and the right-hand chat-rooms pane cropped out), and a 2× crop of
// the tooltip alone (the README's framing).
//
// Output is gitignored and nothing is placed for you: a random battle can deal a dull
// matchup, and which shot deserves to be the README hero is a judgement call. Read the
// printed index, pick the keepers, copy them into `demo/` and `store-screenshots/`.

import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {startBattle, readBundle, sleep, evaluate} from './lib/showdown.mjs';

const FORMAT = process.argv[2] || 'gen9randombattle';
const TURNS = Number(process.env.TURNS ?? 6);
const OUT = new URL('../screenshots/', import.meta.url);
const VIEWPORT = {width: 1280, height: 800}; // wide enough for Showdown's full desktop layout

/** hi-chu's own markup. Its absence means the native tooltip rendered alone. */
const isOurs = (html) => html.includes('hichu-block');

const roomEl = (page, roomid, sel) => page.$(`#room-${roomid} ${sel}`);
const roomEls = (page, roomid, sel) => page.$$(`#room-${roomid} ${sel}`);

/**
 * The choice this side still owes the server, or null. Keyed by `rqid` — a fresh id per
 * request — because that is the one field that says "this is a new decision", where the
 * turn counter lags behind a mid-turn faint and `room.choice` is reset by the UI, not us.
 */
const pendingChoice = (page, roomid) =>
  evaluate(page, (id) => {
    const request = globalThis.app?.rooms?.[id]?.request;
    if (!request || request.wait) return null;
    const moves = request.active?.[0]?.moves ?? [];
    const team = request.side?.pokemon ?? [];
    return {
      rqid: request.rqid,
      type: request.requestType, // 'move' | 'switch' | 'team'
      // Both 1-indexed, as `/choose` wants them, and both filtered to what the server will
      // actually accept — an illegal choice earns an error popup that would then sit in the
      // middle of every screenshot.
      legalMoves: moves.map((m, i) => (m.disabled ? null : i + 1)).filter((i) => i !== null),
      benched: team.map((p, i) => (!p.active && !/fnt/.test(p.condition) ? i + 1 : null)).filter((i) => i !== null),
    };
  }, roomid);

/** The current turn, or null while the client is between lives (mid-reload, room not rejoined). */
const turnOf = (page, roomid) => evaluate(page, (id) => globalThis.app?.rooms?.[id]?.battle?.turn ?? null, roomid);
const send = (page, roomid, cmd) => evaluate(page, (id, c) => globalThis.app.send(c, id), roomid, cmd);

/** The `/choose` command answering `request`, or null if there is no legal one (rare: Struggle). */
function command(request, nth) {
  if (request.type === 'move' && request.legalMoves.length) {
    // A different slot each time, so the battle reveals a spread of moves rather than
    // spamming slot 1 — a foe whose whole kit is ✓ confirmed is what makes the sets view
    // worth photographing.
    return `/choose move ${request.legalMoves[nth % request.legalMoves.length]}`;
  }
  // Something fainted. Which mon comes in next is not something this script has an opinion
  // about, but it must be a real one: `/choose default` is quietly refused here, and a
  // refused choice stalls the battle forever with only a switch menu on screen.
  if (request.type === 'switch' && request.benched.length) return `/choose switch ${request.benched[0]}`;
  if (request.type === 'team') return '/choose team 1';
  return null;
}

/**
 * Play `turns` turns of battle so the tooltips have something to say.
 *
 * Both traps here are the same trap: the SERVER's battle runs ahead of the one on screen.
 * `battle.turn` is the ANIMATED turn — it advances as the client plays the protocol log
 * back, not as the server resolves it. Answering each request the instant it lands let the
 * server reach turn 26 while the screen still showed turn 6.
 *
 * So p1 chooses at the pace a human does: only when its move menu is actually drawn. That
 * both keeps the client level with the server and leaves the menus up at the end, because
 * they exist only while p1 still owes the server a choice — the instant it answers, the
 * client swaps them for "Waiting for opponent" and there is nothing left to hover. We
 * deliberately leave the last request unanswered. That is the state a human hovers from.
 *
 * p2 is under no such constraint: nobody photographs its screen.
 */
async function playTo(players, roomid, turns) {
  const [p1] = players;
  const menuUp = () => p1.page.$(`#room-${roomid} .movemenu button[data-tooltip^="move|"]`).then(Boolean);
  // A request the server ACCEPTED disappears; one it refused stays pending under the same
  // rqid. So "we already sent for this rqid" is not "this side has chosen" — track the
  // send count per rqid and let a stuck choice be sent again rather than deadlocking.
  const sent = new Map(); // player name → {rqid, tries}
  const deadline = Date.now() + 300_000; // paced by the animation, so budget generously
  let made = 0; // p1's move choices — the clock the server and the screen agree on
  let onTheClock = false;

  while (Date.now() < deadline) {
    for (const player of players) {
      const pending = await pendingChoice(player.page, roomid);
      if (!pending) continue;

      if (player === p1 && pending.type === 'move') {
        // Once p1 has played its turns, it stops answering MOVE requests — leaving one
        // pending is what keeps the menus on screen. It must still answer a forced switch,
        // or it strands itself behind a switch menu with no active Pokémon to calc from.
        if (made >= turns) {
          onTheClock = true;
          continue;
        }
        if (!(await menuUp())) continue; // the screen hasn't caught up; wait, don't race ahead
      }
      const prior = sent.get(player.name);
      const tries = prior?.rqid === pending.rqid ? prior.tries : 0;
      if (tries >= 3) continue; // sent thrice and still pending; the deadline will end it
      if (tries > 0) await sleep(2000); // give the last send time to land before re-sending

      const cmd = command(pending, made);
      if (!cmd) continue;
      sent.set(player.name, {rqid: pending.rqid, tries: tries + 1});
      await send(player.page, roomid, cmd);
      if (player === p1 && pending.type === 'move' && tries === 0) console.log(`  · choice ${++made}`);
    }
    if (onTheClock) break;
    await sleep(700);
  }
  if (!onTheClock) console.log('  · never reached a move prompt — shooting whatever is on screen');

  // p1 owes the server a move; wait for the client to finish animating and draw the menus.
  await p1.page
    .waitForSelector(`#room-${roomid} .movemenu button[data-tooltip^="move|"]`, {timeout: 60000})
    .catch(() => console.log('  · move menu never appeared — shooting anyway'));
  await sleep(2500); // let the scene's animations settle
  return (await turnOf(p1.page, roomid)) ?? 0;
}

/**
 * Hover `handle` and, if hi-chu rendered into the tooltip, save the shot. A null `dir`
 * hovers without saving — how the feed gets warmed. With a `frame` rect the shot is clipped
 * to it (the full pass, framed to the battle); without one it crops to the tooltip (the
 * README pass). Returns the tooltip HTML (or null), so callers can report what it said.
 */
async function shoot(page, handle, {name, dir, frame}) {
  const readTooltip = () => page.evaluate(() => document.querySelector('#tooltipwrapper')?.innerHTML ?? '');
  let html = '';
  // The first hover after a relayout (a viewport change, a finished animation) is routinely
  // swallowed and leaves the tooltip empty, so give it a second go before believing it.
  for (let attempt = 0; attempt < 2 && !html.includes('tooltip-'); attempt++) {
    await page.mouse.move(0, 0); // leave first, so a re-hover re-renders rather than no-ops
    await sleep(150);
    try {
      await handle.hover();
    } catch {
      return null; // hidden or mid-animation; a later pass may catch it
    }
    await sleep(400);
    html = await readTooltip();
  }

  if (!isOurs(html)) {
    if (process.env.DEBUG) console.log(`    [debug] ${name}: tooltip = ${JSON.stringify(html.slice(0, 240))}`);
    return null;
  }
  if (!dir) return html;

  const path = new URL(`${dir}/${name}.png`, OUT).pathname;
  const box = await tooltipBox(page);
  if (!box) return html; // rendered, but gone before we could measure it — a later pass retries
  if (process.env.DEBUG) console.log(`    [debug] ${name} box: ${JSON.stringify(box)}`);

  if (frame) {
    // Full shot, framed to the battle: `frame` is the battle-room box (banner above and the
    // chat-rooms pane to the right both fall outside it). Extend only the TOP up to the
    // tooltip, so a tall tooltip that clamps toward the header is never sliced — left, right
    // and bottom stay on the room so the chat pane can't creep back in.
    const pad = 6;
    const top = Math.max(0, Math.min(frame.y, box.y - pad));
    await page.screenshot({path, clip: {x: frame.x, y: top, width: frame.width, height: frame.y + frame.height - top}});
    return html;
  }

  // Tooltip crop (README framing): a few px of margin so the border and drop shadow aren't
  // shaved off, clamped to the viewport — a `clip` past the edge shoots blank pixels.
  const view = page.viewport();
  const pad = 6;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  await page.screenshot({
    path,
    clip: {x, y, width: Math.min(view.width - x, box.width + pad * 2), height: Math.min(view.height - y, box.height + pad * 2)},
  });
  return html;
}

/**
 * The tooltip's painted rect, or null if it isn't up. Measures the `.tooltip` elements, not
 * `#tooltipwrapper`: Showdown absolutely-positions the tooltip inside the wrapper, so the
 * wrapper (and `.tooltipinner`) collapse to a near-empty sliver while `.tooltip` carries the
 * real box. Unions them, since a Pokémon tooltip can stack two `.tooltip` panels.
 */
const tooltipBox = (page) =>
  page.evaluate(() => {
    const rects = [...document.querySelectorAll('#tooltipwrapper .tooltip')].map((el) => el.getBoundingClientRect());
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    return {x: left, y: top, width: Math.max(...rects.map((r) => r.right)) - left, height: Math.max(...rects.map((r) => r.bottom)) - top};
  });

/** The battle-room box: battle + log, with the top banner and the right chat pane outside it. */
const battleFrame = (page, roomid) =>
  page.evaluate((id) => {
    const {x, y, width, height} = document.getElementById(`room-${id}`).getBoundingClientRect();
    return {x: Math.max(0, Math.round(x)), y: Math.round(y), width: Math.round(width + Math.min(0, x)), height: Math.round(height)};
  }, roomid);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every surface worth a photograph, in the order a reader meets them. */
async function surfaces(page, roomid) {
  const list = [];
  const add = async (name, sel) => {
    const handle = await roomEl(page, roomid, sel);
    if (handle) list.push({name, handle});
  };
  await add('01-move-hover', '.movemenu button[data-tooltip^="move|"]:not(.disabled)');
  await add('02-foe-hover', '[data-tooltip="activepokemon|1|0"]');
  await add('03-own-hover', '[data-tooltip="activepokemon|0|0"]');

  // Every move button, named — which one carries the multi-hit or KO line is luck of the draw.
  for (const handle of await roomEls(page, roomid, '.movemenu button[data-tooltip^="move|"]:not(.disabled)')) {
    const move = await handle.evaluate((el) => el.getAttribute('data-tooltip').split('|')[1]);
    list.push({name: `10-move-${slug(move)}`, handle});
  }
  // The switch menu: a benched mon's matchup block and its ⚡ verdict live nowhere else.
  for (const handle of await roomEls(page, roomid, '.switchmenu button[data-tooltip^="switchpokemon"]:not(.disabled)')) {
    const slot = await handle.evaluate((el) => el.getAttribute('data-tooltip').split('|')[1]);
    list.push({name: `20-switch-${slot}`, handle});
  }
  return list;
}

/**
 * The Tera preview: tick the move panel's Terastallize box and the move tooltip recomputes
 * OUR damage with the Tera active. The box lives only in the DOM, so this is the one
 * surface that has to be driven by a click.
 */
async function teraSurfaces(page, roomid, on) {
  const box = await roomEl(page, roomid, 'input[name=terastallize], input[name=tera]');
  if (!box) return [];
  await box.evaluate((el, checked) => {
    if (el.checked !== checked) el.click();
  }, on);
  await sleep(200);
  if (!on) return [];
  const list = [];
  for (const handle of await roomEls(page, roomid, '.movemenu button[data-tooltip^="move|"]:not(.disabled)')) {
    const move = await handle.evaluate((el) => el.getAttribute('data-tooltip').split('|')[1]);
    list.push({name: `30-tera-${slug(move)}`, handle});
  }
  return list;
}

async function capturePass(page, roomid, {dir, frame}) {
  const shots = [];
  const run = async (list) => {
    for (const {name, handle} of list) {
      const html = await shoot(page, handle, {name, dir, frame});
      if (html) shots.push({name, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()});
      else console.log(`  · ${dir}/${name}: no hi-chu section (skipped)`);
    }
  };
  await run(await surfaces(page, roomid));
  await run(await teraSurfaces(page, roomid, true));
  await teraSurfaces(page, roomid, false); // leave the box as we found it
  return shots;
}

const battle = await startBattle({format: FORMAT, viewport: VIEWPORT});
try {
  const {p1, p2, roomid} = battle;
  const players = [
    {name: 'p1', page: p1.page},
    {name: 'p2', page: p2.page},
  ];

  console.log(`\nplaying ${TURNS} turns so the tooltips have something to say…`);
  const reached = await playTo(players, roomid, TURNS);

  rmSync(OUT, {recursive: true, force: true});
  for (const dir of ['full', 'crop']) mkdirSync(new URL(`${dir}/`, OUT), {recursive: true});

  // `content.ts` swallows its own throws so a bug can never break the native tooltip. That
  // is right in production and blinding here, so surface anything the page reports.
  p1.page.on('pageerror', (err) => console.log(`  · page error: ${err.message.split('\n')[0]}`));
  await p1.page.addScriptTag({content: readBundle()});
  // The first hovers race the randbats feed fetch and render native-only. Sweep until SOME
  // surface shows our markup — which surface is not knowable up front: a foe hover renders
  // nothing in an open format (no pool to infer over), and a status move renders nothing in
  // any format, so neither alone is a reliable canary.
  const canaries = [
    ...(await roomEls(p1.page, roomid, '.movemenu button[data-tooltip^="move|"]:not(.disabled)')),
    ...(await roomEls(p1.page, roomid, '[data-tooltip="activepokemon|1|0"]')),
  ];
  let warm = false;
  for (let attempt = 0; attempt < 12 && !warm; attempt++) {
    for (const canary of canaries) {
      if (await shoot(p1.page, canary, {name: 'warm', dir: null})) {
        warm = true;
        break;
      }
    }
    if (!warm) await sleep(500);
  }
  if (!warm) console.log('  · nothing rendered yet after warm-up; shooting anyway');

  // A little extra height so a tall tooltip opens downward instead of clamping up into the
  // header — then the frame clip below never has to reach into the banner to keep it whole.
  console.log('\nshooting full windows, framed to the battle (no banner, no chat pane)…');
  await p1.page.setViewport({...VIEWPORT, height: 900});
  await sleep(800); // the scene relays out on resize
  const frame = await battleFrame(p1.page, roomid);
  if (process.env.DEBUG) console.log(`  [debug] battle frame: ${JSON.stringify(frame)}`);
  const full = await capturePass(p1.page, roomid, {dir: 'full', frame});

  console.log('\nshooting 2× tooltip crops (README framing)…');
  await p1.page.setViewport({...VIEWPORT, deviceScaleFactor: 2});
  await sleep(800); // the battle scene relays out on resize
  const crop = await capturePass(p1.page, roomid, {dir: 'crop'});

  const index = {battle: roomid, format: FORMAT, turn: reached, full: full.map((s) => s.name), crop: crop.map((s) => s.name)};
  writeFileSync(new URL('index.json', OUT).pathname, JSON.stringify({...index, tooltips: crop}, null, 2));

  console.log(`\n✓ ${full.length} full + ${crop.length} crop shots → screenshots/  (battle ${roomid}, turn ${reached})`);
  for (const {name, text} of crop) console.log(`   ${name.padEnd(24)} ${text.slice(0, 90)}`);
  console.log('\nNothing was placed for you. Pick the keepers and copy them into demo/ and store-screenshots/.');
  if (!crop.length) {
    console.error('\n✗ no surface rendered a hi-chu section — is dist/content.js current? (npm run build)');
    process.exitCode = 1;
  }
} finally {
  await battle.close();
}
