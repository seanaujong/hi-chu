// Live drift check: does readState.ts still match the real Showdown client?
//
// The stubbed readState tests pin OUR parsing; they can't notice when a client
// release renames or reshapes the objects we read (the 👁 review-only invariant in
// CLAUDE.md). This script is the missing guard: it opens a real Random Battle
// replay in your installed Chrome, runs the *current* readState source against the
// live `window.battle`, and fails if any field we depend on is gone or malformed.
//
// It is a LOCAL/manual check, not a CI gate — it needs a browser and the live
// replay site. Run it after a Showdown client update, or whenever a calc looks off.
//
//   npm run drift-check                 # uses installed Chrome (channel: 'chrome')
//   CHROME_PATH=/path/to/chrome npm run drift-check
//   npm run drift-check gen9randomdoublesbattle   # a different format
//
// How it stays honest: the readState probe is esbuild-bundled from src on each run,
// so it always tests the code the extension actually ships — never a stale copy.

import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';

const FORMAT = process.argv[2] || 'gen9randombattle';
const MIN_TURNS = 6; // enough that mid-battle reliably has an active on both sides

/** A recent replay of this format with enough turns to be worth probing. */
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

/** Bundle the CURRENT readState.ts and expose its functions on window.__hichuRead. */
async function buildProbe() {
  const out = await esbuild.build({
    stdin: {
      contents: "import * as rs from './src/battle/readState.ts'; globalThis.__hichuRead = rs;",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
  });
  return out.outputFiles[0].text;
}

/** Runs in the page: exercise readState against the live battle, collect any drift. */
function probeLiveClient() {
  const R = globalThis.__hichuRead;
  const b = globalThis.battle;
  const problems = [];
  const facts = [];
  // Which of the rarer client shapes this replay actually exercised — a random replay
  // usually has no transformed or forme-changed Pokémon, and a probe that never fired is
  // not a probe that passed. Reported, not failed on.
  const seen = {formeChange: false, transform: false};

  const format = R.detectFormat(b);
  if (!format || format.kind !== 'randbats' || !/^gen\d+random/.test(format.formatId)) {
    problems.push(`detectFormat returned ${JSON.stringify(format)} (expected kind:"randbats" + a gen*random* id)`);
  }
  // `gameType` is what an OPEN format's doubles flag reads (a randbats id carries its
  // own). A replay is always one or the other, so only its presence/shape is provable.
  if (b.gameType !== undefined && typeof b.gameType !== 'string') {
    problems.push(`battle.gameType is ${typeof b.gameType}, expected a string ("singles"/"doubles") or absent`);
  }

  const actives = b.sides.flatMap((s) => (s.active || []).filter(Boolean));
  if (actives.length < 2) problems.push(`expected an active on both sides, saw ${actives.length}`);

  // The Life Orb recoil inference reads the protocol log; guard its shape too.
  if (!Array.isArray(b.stepQueue)) problems.push(`battle.stepQueue is ${typeof b.stepQueue}, expected an array`);

  // The Mega preview turns a held stone into a forme via `battle.dex.items.get(id).megaStone`
  // (a {base → Mega forme} map). A spectator replay has no move controls or private team, so
  // it can't drive `readMegaForme` end-to-end — but the dex item is battle-wide and readable.
  // A known stone must resolve to that map shape (client change here → readMegaForme goes blind).
  const stone = b.dex?.items?.get?.('charizarditex');
  if (!stone || typeof stone.megaStone !== 'object' || !stone.megaStone || typeof stone.megaStone.Charizard !== 'string') {
    problems.push(`battle.dex.items.get('charizarditex').megaStone = ${JSON.stringify(stone?.megaStone)} (expected {Charizard: "Charizard-Mega-X"})`);
  }

  for (const mon of actives) {
    const f = R.toLiveFacts(mon);
    if (typeof mon.ident !== 'string' || !mon.ident.includes(':')) {
      problems.push(`${mon.speciesForme || '?'}.ident = ${JSON.stringify(mon.ident)} (expected "pN: Name")`);
    }
    if (typeof R.hasLandedDamagingHit(b, mon) !== 'boolean') {
      problems.push(`hasLandedDamagingHit(${mon.speciesForme || '?'}) did not return a boolean`);
    }
    const ok = {
      speciesForme: typeof f.speciesForme === 'string' && f.speciesForme.length > 0,
      level: typeof f.level === 'number' && f.level > 0,
      hpPercent: typeof f.hpPercent === 'number' && !Number.isNaN(f.hpPercent) && f.hpPercent > 0 && f.hpPercent <= 1,
      boosts: !!f.boosts && typeof f.boosts === 'object',
      revealedMoves: Array.isArray(f.revealedMoves),
    };
    for (const [field, good] of Object.entries(ok)) {
      if (!good) problems.push(`toLiveFacts(${f.speciesForme || '?'}).${field} = ${JSON.stringify(f[field])}`);
    }
    if (!R.findOpposingActive(b, mon)) problems.push(`findOpposingActive(${f.speciesForme}) returned null`);
    // The calc's fallback for formes it doesn't know reads battle.dex — every species
    // (not just Champions Megas) is in the client dex, so this must always answer.
    const sd = R.readSpeciesData(b, mon);
    if (!sd || typeof sd.baseStats?.hp !== 'number' || !Array.isArray(sd.types) || sd.types.length === 0) {
      problems.push(`readSpeciesData(${f.speciesForme || '?'}) = ${JSON.stringify(sd)} (battle.dex.species.get drifted?)`);
    }
    // The open-format ability pool: every species has at least one dex ability slot. The
    // reading is tolerant (an absent slot table costs only the pool, never the record),
    // so a miss here is drift worth knowing about, not a crash.
    if (sd && (!Array.isArray(sd.abilities) || sd.abilities.length === 0)) {
      problems.push(`readSpeciesData(${f.speciesForme || '?'}).abilities = ${JSON.stringify(sd.abilities)} (dex species.abilities drifted?)`);
    }
    // The live forme rides on a VOLATILE, not on speciesForme: a reversible forme change
    // (Relic Song, Stance Change, Zen Mode) and Transform both leave the field alone and
    // record the forme in `volatiles.formechange`. The field's mere existence is the shape
    // contract; when a replay actually shows one, check what it carries.
    if (mon.volatiles !== undefined && (typeof mon.volatiles !== 'object' || mon.volatiles === null)) {
      problems.push(`${f.speciesForme || '?'}.volatiles = ${JSON.stringify(mon.volatiles)} (expected an object)`);
    }
    const formechange = mon.volatiles?.formechange;
    if (formechange !== undefined) {
      if (typeof formechange[1] !== 'string' || !formechange[1]) {
        problems.push(`${f.speciesForme || '?'}.volatiles.formechange = ${JSON.stringify(formechange)} (expected ['formechange', 'Some-Forme'])`);
      } else if (R.readLiveForme(mon) !== formechange[1] && formechange[1] !== mon.speciesForme) {
        problems.push(`readLiveForme(${f.speciesForme || '?'}) missed the formechange volatile ${JSON.stringify(formechange[1])}`);
      }
      seen.formeChange = true;
    }
    // The transform volatile holds the TARGET's own Pokemon object — that is what makes a
    // copy resolvable at all (we go and read the Pokémon it copied).
    if (mon.volatiles?.transform !== undefined) {
      const target = R.readTransformTarget(mon);
      if (!target || typeof target.speciesForme !== 'string' || !target.speciesForme) {
        problems.push(`readTransformTarget(${f.speciesForme || '?'}) = ${JSON.stringify(target)} (volatiles.transform[1] is no longer the target Pokemon)`);
      }
      seen.transform = true;
    }
    const fieldFacts = R.readFieldFacts(b, mon.side);
    const screens = fieldFacts?.defenderScreens;
    if (!screens || ['reflect', 'lightScreen', 'auroraVeil'].some((k) => typeof screens[k] !== 'boolean')) {
      problems.push(`readFieldFacts(${f.speciesForme}).defenderScreens is malformed`);
    }
    // The speed-order reads (Tailwind off sideConditions, Trick Room off pseudoWeather)
    // are true-or-absent flags. A replay without them active only proves the shape is
    // sane — a false "absent" from a renamed client id needs a replay where they're up.
    for (const k of ['trickRoom', 'attackerTailwind', 'defenderTailwind']) {
      if (fieldFacts?.[k] !== undefined && fieldFacts[k] !== true) {
        problems.push(`readFieldFacts(${f.speciesForme}).${k} = ${JSON.stringify(fieldFacts[k])}`);
      }
    }
    facts.push({
      species: f.speciesForme, level: f.level, hpPct: Math.round(f.hpPercent * 1000) / 10,
      tera: f.teraType || null, item: f.item || null, status: f.status || null, moves: f.revealedMoves,
    });
  }
  return {problems, facts, format, seen};
}

async function main() {
  const {id, turns} = await pickReplay();
  console.log(`▶ probing replay ${id} (${turns} turns), format ${FORMAT}`);

  const launch = process.env.CHROME_PATH
    ? {executablePath: process.env.CHROME_PATH}
    : {channel: 'chrome'};
  const browser = await puppeteer.launch({headless: true, ...launch});
  try {
    const page = await browser.newPage();
    await page.setBypassCSP(true); // lets us inject the readState probe regardless of page CSP
    await page.goto(`https://replay.pokemonshowdown.com/${id}`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => !!globalThis.battle, {timeout: 30000});

    // Seek to mid-battle so both sides have an active Pokémon on the field.
    await page.evaluate(async () => {
      const b = globalThis.battle;
      const total = (b.stepQueue || []).filter((l) => /^\|turn\|/.test(l)).length;
      const target = Math.max(1, Math.floor(total * 0.5));
      b.seekTurn(target);
      for (let i = 0; i < 80; i++) {
        if (b.turn === target && !b.seeking) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    });

    await page.addScriptTag({content: await buildProbe()});
    const {problems, facts, format, seen} = await page.evaluate(probeLiveClient);

    console.log(`  detectFormat → ${JSON.stringify(format)}`);
    for (const f of facts) {
      const tags = [f.tera && `Tera ${f.tera}`, f.item && `@${f.item}`, f.status && `[${f.status}]`].filter(Boolean).join(' ');
      console.log(`  read ${f.species} L${f.level} ${f.hpPct}% ${tags}  moves=[${f.moves.join(', ')}]`);
    }

    // A random replay rarely contains a Transform or a reversible forme change, so say
    // plainly whether those probes fired. "No drift" from a check that never ran is not a
    // clean bill of health — to exercise them, pick a replay that has a Ditto in it.
    console.log(`  volatiles: formechange ${seen.formeChange ? 'SEEN — checked' : 'absent (not exercised)'}, ` +
      `transform ${seen.transform ? 'SEEN — checked' : 'absent (not exercised)'}`);

    if (problems.length) {
      console.error('\n✗ DRIFT DETECTED — readState.ts no longer matches the live client:');
      for (const p of problems) console.error(`    - ${p}`);
      console.error('\n  Re-derive the changed fields from the PS client source and update readState.ts');
      console.error('  (and its tests) in lockstep. See CLAUDE.md → "Client field names are reverse-engineered".');
      process.exitCode = 1;
    } else {
      console.log('\n✓ no drift: every field readState reads is present and sane on the live client.');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('drift-check could not run:', e.message);
  console.error('(needs Google Chrome installed; set CHROME_PATH to point at a specific binary.)');
  process.exitCode = 2;
});
