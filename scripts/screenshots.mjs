// Photograph every hi-chu tooltip surface from a real, played-out battle.
//
// The screenshots this replaces were all shot on a spectator REPLAY, which is why they all
// show the same thing: a foe hover. A spectator has no private team, no move buttons and no
// switch menu, so four surfaces are invisible there — the move tooltip, the own-hover
// matchup view, the switch menu (the only place a benched mon's ⚡ speed verdict appears),
// and the Terastallize preview. Being a player is the whole point of this script; it is
// `player-check`'s harness pointed at a camera instead of at assertions.
//
//   npm run screenshots
//   node scripts/screenshots.mjs gen9ou      # an open format: bracketed damage, no ⚡/sets
//   TURNS=8 npm run screenshots              # play deeper before shooting
//
// It plays both sides for a few turns first, so the tooltips have something to say: moves
// come back ✓ confirmed, HP bars are dented, and the foe's set pool has narrowed. Then it
// shoots each surface twice — a full shot framed to the battle (battle scene + log, with
// Showdown's top banner and the right-hand chat-rooms pane cropped out), and a 2× crop of
// the tooltip alone (the README's framing) — and finally composes the four Chrome Web Store
// screenshots, which have their own frame to fit (see `lib/store-canvas.mjs`).
//
// Output is gitignored and nothing is placed for you: a random battle can deal a dull
// matchup, and which shot deserves to be the README hero is a judgement call. Read the
// printed index, pick the keepers, copy them into `demo/` and `store-screenshots/`.

import {mkdirSync, rmSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startBattle, readBundle, sleep, evaluate} from './lib/showdown.mjs';
import {STORE_CANVAS, canvasHtml, pngSize} from './lib/store-canvas.mjs';

const FORMAT = process.argv[2] || 'gen9randombattle';
// REAL_EXTENSION=1 installs the built extension in the browser instead of injecting the
// bundle into the page — the difference between photographing what ships and photographing
// a close approximation. Needs `npm run build:visual-check` first (dist-visual/), and pins
// Chrome for Testing, since the branded build ignores --load-extension (lib/extension-chrome.mjs).
const REAL_EXTENSION = process.env.REAL_EXTENSION === '1';
const EXTENSION_DIR = fileURLToPath(new URL('../dist-visual/', import.meta.url));
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
 * Hover `handle` and hand back the tooltip's HTML, or null if hi-chu did not render into it
 * — either because nothing came up, or because what came up was the native tooltip alone (a
 * status move, or a foe hover in an open format, both of which we deliberately say nothing
 * about). Split out because the store pass hovers the same surfaces for its own framing.
 */
async function hoverForTooltip(page, handle, name) {
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
  return html;
}

/**
 * Hover `handle` and, if hi-chu rendered into the tooltip, save the shot. A null `dir`
 * hovers without saving — how the feed gets warmed. With a `frame` rect the shot is clipped
 * to it (the full pass, framed to the battle); without one it crops to the tooltip (the
 * README pass). Returns the tooltip HTML (or null), so callers can report what it said.
 */
async function shoot(page, handle, {name, dir, frame}) {
  const html = await hoverForTooltip(page, handle, name);
  if (!html) return null;
  if (!dir) return html;

  const path = new URL(`${dir}/${name}.png`, OUT).pathname;
  const box = await settledTooltipBox(page);
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
  //
  // Re-measured AFTER the capture and retaken if it moved: a settled read is still only a
  // prediction that the tooltip will hold still, and this is the only way to know the pixels
  // on disk are the tooltip rather than whatever the stale coordinates pointed at.
  const view = page.viewport();
  const pad = 6;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = attempt === 0 ? box : await settledTooltipBox(page);
    if (!before) return html;
    const x = Math.max(0, before.x - pad);
    const y = Math.max(0, before.y - pad);
    await page.screenshot({
      path,
      clip: {x, y, width: Math.min(view.width - x, before.width + pad * 2), height: Math.min(view.height - y, before.height + pad * 2)},
    });
    const after = await tooltipBox(page);
    if (sameBox(before, after)) return html;
    if (process.env.DEBUG) console.log(`    [debug] ${name} moved during capture; retaking`);
  }
  console.log(`  · ${name}: tooltip kept moving; crop may be off`);
  return html;
}

/**
 * The tooltip's painted rect, or null if it isn't up. Measures the `.tooltip` elements, not
 * `#tooltipwrapper`: Showdown absolutely-positions the tooltip inside the wrapper, so the
 * wrapper (and `.tooltipinner`) collapse to a near-empty sliver while `.tooltip` carries the
 * real box. Unions them, since a Pokémon tooltip can stack two `.tooltip` panels.
 */
/**
 * `tooltipBox`, held still — the fix for an intermittently wrong crop.
 *
 * Showdown positions the tooltip AFTER its content lands, and clamps a tall one against the
 * viewport edge. The own-hover panel is the tallest we render (native block + matchup + every
 * mirror candidate, ~530px), so it is the one that moves late. Measuring once and clipping to
 * that rect is two CDP round-trips apart, and when the tooltip shifted in between, the crop
 * photographed whatever sat at the stale coordinates — usually the battle scene.
 *
 * Full shots never showed it: they clip to the stable battle-room box and only extend the TOP
 * edge, so a stale y moves an edge rather than the whole frame. Only crops ARE the box.
 *
 * Two guards, because "wait a bit" is not a fix: read until two consecutive reads agree, and
 * (at the call site) re-read after the capture to confirm it never moved during it.
 */
async function settledTooltipBox(page, {tries = 15, gap = 100} = {}) {
  let previous = await tooltipBox(page);
  for (let i = 0; i < tries; i++) {
    await sleep(gap);
    const current = await tooltipBox(page);
    if (!current) return null;
    if (previous && sameBox(previous, current)) return current;
    previous = current;
  }
  return previous; // never settled; no worse than the single read this replaced
}

const sameBox = (a, b) =>
  Boolean(a && b) && ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 1);

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

/**
 * The Chrome Web Store listing, which is a different job from the two passes above.
 *
 * Those sweep every surface and leave the choosing to a human. This one answers a fixed
 * question — what four pictures explain hi-chu to somebody who has never seen it? — with
 * the two hovers that ARE the product, each shown twice: once in the battle it was read
 * from, so the reader places it, and once close up, so they can read it.
 *
 * Order matters; the store shows them in it. Context first, then the detail it framed.
 */
const STORE_SHOTS = [
  {name: '01-move-full', surface: 'move', framing: 'full', caption: "Hover a move — its damage into the Pokémon you're facing"},
  {name: '02-move-tooltip', surface: 'move', framing: 'crop', caption: 'Damage and KO chance, read from the battle in front of you'},
  {name: '03-foe-full', surface: 'foe', framing: 'full', caption: 'Hover the opponent — every set it could still be running'},
  {name: '04-foe-tooltip', surface: 'foe', framing: 'crop', caption: "Each set's damage into you, and who moves first"},
];

// The full shots are framed wider than the passes above: at 1600 the battle room comes out
// roughly the store canvas's own proportions, so it lands there at nearly life size instead
// of being shrunk to fit. The crops go the other way — a small tooltip blown up — so they
// are taken at 3× and scaled DOWN, which is the only way to enlarge something and keep it sharp.
const STORE_FULL_VIEWPORT = {width: 1600, height: 800, deviceScaleFactor: 2};
const STORE_CROP_VIEWPORT = {width: 1280, height: 900, deviceScaleFactor: 3};

/**
 * The move button worth photographing — the one whose tooltip is most OURS.
 *
 * Not a cosmetic preference. Which moves a random battle deals is luck, and slot 1 is
 * routinely a status move, or (as one run gave us) a Poltergeist reading `Damage: 0% - 0%`
 * against an item-less foe: a fair reading of the picture and a false one of the product.
 * Ranking by damage alone is not enough either — it once chose Hurricane, whose eight lines
 * of Showdown's own flavour text left hi-chu's two lines as a footnote, so the screenshot
 * advertised the client rather than the extension.
 *
 * So the metric is the share of the tooltip's height that `.hichu-block` occupies, which is
 * literally "how much of this picture is the thing being sold", with nonzero damage required
 * and the bigger hit breaking ties.
 */
async function bestMoveButton(page, roomid) {
  let best = null;
  for (const handle of await roomEls(page, roomid, '.movemenu button[data-tooltip^="move|"]:not(.disabled)')) {
    const move = await handle.evaluate((el) => el.getAttribute('data-tooltip').split('|')[1]);
    const html = await hoverForTooltip(page, handle, `store-pick-${slug(move)}`);
    if (!html) continue;
    const damage = html.replace(/<[^>]+>/g, ' ').match(/Damage:\s*[\d.]+%\s*[-–]\s*([\d.]+)%/);
    if (!damage || Number(damage[1]) === 0) continue;
    const share = await page.evaluate(() => {
      const total = document.querySelector('#tooltipwrapper .tooltip')?.getBoundingClientRect().height ?? 0;
      const ours = [...document.querySelectorAll('#tooltipwrapper .hichu-block')].reduce((h, el) => h + el.getBoundingClientRect().height, 0);
      return total ? ours / total : 0;
    });
    const score = share * 1000 + Number(damage[1]);
    if (!best || score > best.score) best = {handle, move, score, share};
  }
  return best;
}

/** The rectangle a store shot is cut from, in CSS pixels, or null if the tooltip isn't up. */
async function storeClip(page, framing, frame) {
  const box = await settledTooltipBox(page);
  if (!box) return null;
  if (framing === 'crop') {
    // A generous margin, where the README's crop takes 6px — because Showdown's tooltip is
    // `rgba(240,240,240,.9)`, deliberately 10% see-through, and a crop cut tight to its edge
    // strands that bleed with nothing to explain it. Blown up to fill a store screenshot it
    // then reads as a rendering fault rather than as a panel floating over a battle. Keeping
    // the surrounding UI in frame supplies the missing cue, and leaves the product's own
    // appearance alone — the alternative was overriding Showdown's CSS to fake an opaque
    // panel, which would make the picture prettier by making it untrue.
    const view = page.viewport();
    const pad = 48;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    return {x, y, width: Math.min(view.width - x, box.width + pad * 2), height: Math.min(view.height - y, box.height + pad * 2)};
  }
  // Framed to the battle room, with only the TOP edge extended to take in a tooltip that
  // clamped upward — the same rule the full pass uses, and for the same reason: left, right
  // and bottom stay on the room so the chat pane can't creep back into the frame.
  const top = Math.max(0, Math.min(frame.y, box.y - 6));
  return {x: frame.x, y: top, width: frame.width, height: frame.y + frame.height - top};
}

/**
 * Compose one shot onto the store canvas and write it.
 *
 * The composing is done by a browser page rather than an image library: we already have a
 * browser, and this way the layout is CSS anyone can read rather than pixel arithmetic
 * nobody can check. The written file is then measured back off disk, because "1280×800
 * exactly" is the one thing the store enforces and the one thing that would otherwise fail
 * silently here and loudly, days later, at upload.
 */
async function composeStoreShot(browser, {png, css, caption}, path) {
  const page = await browser.newPage();
  try {
    await page.setViewport({...STORE_CANVAS, deviceScaleFactor: 1});
    await page.setContent(canvasHtml({png, css, caption}), {waitUntil: 'load'});
    await page.evaluate(() => document.querySelector('img.shot').decode());
    await page.screenshot({path});
  } finally {
    await page.close();
  }
  const size = pngSize(readFileSync(path));
  if (size?.width !== STORE_CANVAS.width || size?.height !== STORE_CANVAS.height) {
    throw new Error(`${path}: composed ${size?.width}×${size?.height}, but the store takes only ${STORE_CANVAS.width}×${STORE_CANVAS.height}`);
  }
}

/** Every store shot, taken and composed. Returns the names that made it. */
async function storePass(browser, page, roomid) {
  mkdirSync(new URL('store/', OUT), {recursive: true});
  const done = [];
  // Grouped by framing, because each needs its own viewport and a resize costs a relayout.
  for (const framing of ['full', 'crop']) {
    await page.setViewport(framing === 'full' ? STORE_FULL_VIEWPORT : STORE_CROP_VIEWPORT);
    await sleep(900); // the battle scene relays out on resize
    const frame = framing === 'full' ? await battleFrame(page, roomid) : null;
    const move = await bestMoveButton(page, roomid);
    if (move) console.log(`  · ${framing}: showing ${move.move} (${Math.round(move.share * 100)}% of that tooltip is ours)`);
    const foe = await roomEl(page, roomid, '[data-tooltip="activepokemon|1|0"]');
    const handles = {move: move?.handle ?? null, foe};

    for (const shot of STORE_SHOTS.filter((s) => s.framing === framing)) {
      const handle = handles[shot.surface];
      if (!handle) {
        console.log(`  · store/${shot.name}: no ${shot.surface} surface (skipped)`);
        continue;
      }
      if (!(await hoverForTooltip(page, handle, shot.name))) {
        console.log(`  · store/${shot.name}: no hi-chu section (skipped)`);
        continue;
      }
      const clip = await storeClip(page, framing, frame);
      if (!clip) {
        console.log(`  · store/${shot.name}: tooltip vanished before it could be measured (skipped)`);
        continue;
      }
      const png = Buffer.from(await page.screenshot({clip}));
      await composeStoreShot(browser, {png, css: clip, caption: shot.caption}, new URL(`store/${shot.name}.png`, OUT).pathname);
      done.push(shot.name);
    }
  }
  return done;
}

if (REAL_EXTENSION && !existsSync(EXTENSION_DIR)) {
  console.error('✗ dist-visual/ is missing — run: npm run build:visual-check');
  process.exit(1);
}
const battle = await startBattle({
  format: FORMAT,
  viewport: VIEWPORT,
  ...(REAL_EXTENSION ? {extensionDir: EXTENSION_DIR} : {}),
});
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
  if (REAL_EXTENSION) {
    // Nothing to inject: the extension is installed. Prove it actually attached rather than
    // silently no-op'ing (a manifest whose `matches` misses this origin fails exactly that
    // way), so a green run can never mean "photographed the native tooltip by mistake".
    await p1.page.waitForFunction("!!document.getElementById('hichu-style')", {timeout: 30000})
      .then(() => console.log('✓ REAL extension attached (#hichu-style present)'))
      .catch(() => { throw new Error('extension did not attach — check dist-visual/ manifest `matches` covers this origin'); });
  } else {
    await p1.page.addScriptTag({content: readBundle()});
  }
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

  console.log('\ncomposing the four Chrome Web Store shots (1280×800 exactly)…');
  const store = await storePass(p1.browser, p1.page, roomid);

  const index = {battle: roomid, format: FORMAT, turn: reached, full: full.map((s) => s.name), crop: crop.map((s) => s.name), store};
  writeFileSync(new URL('index.json', OUT).pathname, JSON.stringify({...index, tooltips: crop}, null, 2));

  console.log(`\n✓ ${full.length} full + ${crop.length} crop + ${store.length} store shots → screenshots/  (battle ${roomid}, turn ${reached})`);
  for (const {name, text} of crop) console.log(`   ${name.padEnd(24)} ${text.slice(0, 90)}`);
  console.log('\nNothing was placed for you. Pick the keepers and copy them into demo/ and store-screenshots/.');
  if (!crop.length) {
    console.error('\n✗ no surface rendered a hi-chu section — is dist/content.js current? (npm run build)');
    process.exitCode = 1;
  }
} finally {
  await battle.close();
}
