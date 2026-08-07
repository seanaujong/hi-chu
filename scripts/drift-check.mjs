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
//   npm run drift-check gen9randombattle-2659404198   # one NAMED replay
//
// That last form is how the rare-mechanic probes get exercised at all. Several checks here
// can only fire when the replay happens to contain the thing they guard — a Transform, an
// Air Balloon, a Substitute, a Shed Tail hand-off — and a random battle usually contains
// none of them, which the run reports as "absent (not exercised)". Searching the replay
// archive for one that already has the mechanic beats replaying battles hoping to roll it.
//
// How it stays honest: the readState probe is esbuild-bundled from src on each run,
// so it always tests the code the extension actually ships — never a stale copy.

import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';

// One argument, read as whichever of the two it looks like: a replay id carries the battle
// number after the format ("gen9randombattle-2659404198"), a bare format does not.
const ARG = process.argv[2] || 'gen9randombattle';
const NAMED_REPLAY = /-\d{4,}$/.test(ARG) ? ARG : undefined;
const FORMAT = NAMED_REPLAY ? NAMED_REPLAY.replace(/-\d+$/, '') : ARG;
const MIN_TURNS = 6; // enough that mid-battle reliably has an active on both sides

/** A recent replay of this format with enough turns to be worth probing. */
async function pickReplay() {
  if (NAMED_REPLAY) {
    const data = await (await fetch(`https://replay.pokemonshowdown.com/${NAMED_REPLAY}.json`)).json();
    return {id: NAMED_REPLAY, turns: (data.log.match(/\n\|turn\|/g) || []).length};
  }
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
  const seen = {formeChange: false, transform: false, calledMove: false, balloonAnnounce: false, statusLine: false, substitute: false, shedTail: false, typeChange: false, proteanLine: false, roost: false};

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

  // The Choice rule-out reads `|move|` lines and, crucially, treats a `[from]` attribute as
  // "the player did not choose this" (a called move). That convention is load-bearing in the
  // DANGEROUS direction: if `[from]` ever stopped marking called moves, every Sleep Talk or
  // Metronome call would read as a second free selection and we would rule Choice items out
  // FALSELY. So assert the line's field layout — actor at 2, move name at 3, attributes from
  // 4 on — over the whole replay, and report whether any `[from]` move line was actually
  // present (a random replay may have none; a probe that never fired is not one that passed).
  const moveLines = (b.stepQueue || []).filter((l) => typeof l === 'string' && l.startsWith('|move|'));
  for (const line of moveLines) {
    const parts = line.split('|');
    if (typeof parts[2] !== 'string' || !parts[2].includes(':') || !parts[3]) {
      problems.push(`|move| line not in "|move|<ident>|<name>" shape: ${JSON.stringify(line)}`);
      break;
    }
    if (parts.slice(4).some((p) => p.startsWith('[from]'))) seen.calledMove = true;
  }
  if (moveLines.length === 0) problems.push('no |move| lines in stepQueue — the Choice rule-out reads these');

  // The Air Balloon rule-out reads `|-item|<ident>|<name>`, and leans on it in the dangerous
  // direction: SILENCE is the evidence, so a client that stopped emitting this line (or moved
  // its fields) would make every balloon holder look like it had none, and we would call a
  // Ground move safe against a Pokémon that is immune to it. Assert the layout over the whole
  // replay, and report whether an actual Air Balloon announcement was among them — most
  // replays have none, and a probe that never fired is not a probe that passed.
  for (const line of (b.stepQueue || []).filter((l) => typeof l === 'string' && l.startsWith('|-item|'))) {
    const parts = line.split('|');
    if (typeof parts[2] !== 'string' || !parts[2].includes(':') || !parts[3]) {
      problems.push(`|-item| line not in "|-item|<ident>|<name>" shape: ${JSON.stringify(line)}`);
      break;
    }
    if (parts[3].replace(/[^a-z0-9]+/gi, '').toLowerCase() === 'airballoon') seen.balloonAnnounce = true;
  }

  // The status-orb rule-out reads TWO shapes, and leans on each in its own dangerous
  // direction. `|upkeep|` is the end-of-turn marker — the moment a held Flame Orb or Toxic
  // Orb was obliged to fire — so a client that stopped emitting it would take the deduction
  // permanently silent (the safe failure, but a silent one worth naming). `|-status|` is the
  // hazardous half: the rule reads the ABSENCE of a status at that moment, so a line whose
  // ident or status id moved would leave a visibly burned Pokémon looking clean, and we
  // would rule out the very orb that had just fired — dropping the Guts role, and with it
  // ×1.5 of the Attack every damage line then shows.
  if (!(b.stepQueue || []).some((l) => typeof l === 'string' && l.startsWith('|upkeep'))) {
    problems.push('no |upkeep| lines in stepQueue — the status-orb rule-out reads these as "a turn ended"');
  }
  for (const line of (b.stepQueue || []).filter((l) => typeof l === 'string' && l.startsWith('|-status|'))) {
    const parts = line.split('|');
    if (typeof parts[2] !== 'string' || !parts[2].includes(':') || !parts[3]) {
      problems.push(`|-status| line not in "|-status|<ident>|<status>" shape: ${JSON.stringify(line)}`);
      break;
    }
    seen.statusLine = true;
  }

  // A side's whole ROSTER, not just what is on the field. Only the Shed Tail sub reads it,
  // and it reads it for exactly the reason `active` won't do: using Shed Tail is what takes
  // the maker off the field, so the Pokémon whose HP sized the doll is never an active one.
  for (const side of b.sides || []) {
    if (side.pokemon !== undefined && !Array.isArray(side.pokemon)) {
      problems.push(`side.pokemon is ${typeof side.pokemon}, expected an array (the roster)`);
    }
  }
  if (!(b.sides || []).some((s) => Array.isArray(s.pokemon) && s.pokemon.length > 0)) {
    problems.push('no side.pokemon roster on either side — a Shed Tail sub could not be sized');
  }
  // …and the lookup that walks it must actually find someone, or the sizing silently falls
  // back to the wearer's own HP with no signal that it did.
  const anyActive = b.sides.flatMap((s) => (s.active || []).filter(Boolean))[0];
  if (anyActive && R.findByIdent(b, anyActive.ident) !== anyActive) {
    problems.push(`findByIdent(${JSON.stringify(anyActive.ident)}) did not find the Pokémon that ident names`);
  }

  // The Substitute reads lean on TWO protocol lines, and each in a direction that costs
  // something if it drifts. `|-start|<ident>|Substitute` is what tells a fresh doll from a
  // battered one — lose it and a chipped sub reports a full hit count, overstating what it
  // takes to break through. Its `[from] move: Shed Tail` variant names the Pokémon the doll
  // was cut from; lose that and we size it on the wrong mon. Both layouts are asserted over
  // the whole replay, and whether either actually appeared is reported rather than assumed.
  for (const line of (b.stepQueue || []).filter((l) => typeof l === 'string' && l.startsWith('|-start|'))) {
    const parts = line.split('|');
    if (typeof parts[2] !== 'string' || !parts[2].includes(':') || !parts[3]) {
      problems.push(`|-start| line not in "|-start|<ident>|<effect>" shape: ${JSON.stringify(line)}`);
      break;
    }
    if (parts[3] === 'Substitute') {
      seen.substitute = true;
      if (parts.some((p) => p === '[from] move: Shed Tail')) seen.shedTail = true;
    }
    // A retype's own line. Its payload is the Pokémon's real types, '/'-joined, and its
    // `[from]` is what tells a SPENT Protean from a Soak that merely moved the types — so
    // both halves are read, and both are read in the dangerous direction: a layout change
    // would leave a converted Greninja calculated as the species it stopped being.
    if (parts[3] === 'typechange') {
      seen.typeChange = true;
      if (typeof parts[4] !== 'string' || !parts[4] || !/^[A-Za-z?]+(\/[A-Za-z?]+)*$/.test(parts[4])) {
        problems.push(`|-start| typechange payload is not a '/'-joined type list: ${JSON.stringify(line)}`);
      }
      if (parts.some((p) => p === '[from] ability: Protean' || p === '[from] ability: Libero')) seen.proteanLine = true;
    }
  }
  // `|-singleturn|<ident>|move: Roost` is what sets the turnstatus the grounding is read
  // from. Probed for layout only: by the time a replay is parsed to its end the table has
  // been wiped, so the line is the only durable trace that the mechanic occurred at all.
  for (const line of (b.stepQueue || []).filter((l) => typeof l === 'string' && l.startsWith('|-singleturn|'))) {
    const parts = line.split('|');
    if (typeof parts[2] !== 'string' || !parts[2].includes(':') || !parts[3]) {
      problems.push(`|-singleturn| line not in "|-singleturn|<ident>|<effect>" shape: ${JSON.stringify(line)}`);
      break;
    }
    if (parts[3] === 'move: Roost') seen.roost = true;
  }
  // `|-activate|<ident>|move: Substitute|[damage]` is the other half: the `[damage]` tag is
  // the ONLY thing separating a hit the doll absorbed from a status move it merely blocked.
  for (const line of (b.stepQueue || []).filter((l) => typeof l === 'string' && l.startsWith('|-activate|'))) {
    const parts = line.split('|');
    if (typeof parts[2] !== 'string' || !parts[2].includes(':') || !parts[3]) {
      problems.push(`|-activate| line not in "|-activate|<ident>|<effect>" shape: ${JSON.stringify(line)}`);
      break;
    }
    if (parts[3] === 'move: Substitute') seen.substitute = true;
  }

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
    if (typeof R.usedDifferentMovesSinceSwitchIn(b, mon) !== 'boolean') {
      problems.push(`usedDifferentMovesSinceSwitchIn(${mon.speciesForme || '?'}) did not return a boolean`);
    }
    if (typeof R.switchedInWithoutAnnouncingBalloon(b, mon) !== 'boolean') {
      problems.push(`switchedInWithoutAnnouncingBalloon(${mon.speciesForme || '?'}) did not return a boolean`);
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
    // A retype rides on a volatile exactly as the live forme does, and carries the types
    // '/'-joined in the same slot. Checked against the reader so a payload shape change
    // cannot pass silently.
    const typechange = mon.volatiles?.typechange;
    if (typechange !== undefined) {
      if (typeof typechange[1] !== 'string' || !typechange[1]) {
        problems.push(`${f.speciesForme || '?'}.volatiles.typechange = ${JSON.stringify(typechange)} (expected ['typechange', 'Ice'])`);
      } else if (!mon.terastallized) {
        const read = R.readLiveTypes(mon);
        if (!read || read.join('/') !== typechange[1].split('/').concat(
          typeof mon.volatiles?.typeadd?.[1] === 'string' ? [mon.volatiles.typeadd[1]] : []).join('/')) {
          problems.push(`readLiveTypes(${f.speciesForme || '?'}) = ${JSON.stringify(read)} but the volatile says ${JSON.stringify(typechange[1])}`);
        }
      }
      seen.typeChange = true;
    }
    // Roost lives in `turnstatuses`, a table the client wipes at end of turn — so unlike every
    // other read here it is only ever visible mid-turn, and its absence proves nothing. The
    // shape contract is that the table exists and is an object; when a replay actually catches
    // one standing, check the reader agrees.
    if (mon.turnstatuses !== undefined && (typeof mon.turnstatuses !== 'object' || mon.turnstatuses === null)) {
      problems.push(`${f.speciesForme || '?'}.turnstatuses = ${JSON.stringify(mon.turnstatuses)} (expected an object)`);
    } else if (mon.turnstatuses?.roost !== undefined) {
      if (!R.readRoosting(mon)) {
        problems.push(`readRoosting(${f.speciesForme || '?'}) missed a roost the turnstatus plainly shows`);
      }
      seen.roost = true;
    }
    // A Substitute is PRESENCE only — the client adds a bare `['substitute']` tuple and never
    // tracks the doll's HP. That is why the size is derived rather than read, and why this
    // asserts nothing about a second element: if one ever appeared, the reading would still
    // be correct, but it would be worth knowing the client had started telling us more.
    const substitute = mon.volatiles?.substitute;
    if (substitute !== undefined) {
      if (!Array.isArray(substitute) || substitute[0] !== 'substitute') {
        problems.push(`${f.speciesForme || '?'}.volatiles.substitute = ${JSON.stringify(substitute)} (expected ['substitute'])`);
      }
      if (!R.readSubstitute(b, mon)) {
        problems.push(`readSubstitute(${f.speciesForme || '?'}) missed a sub the volatile plainly shows`);
      }
      seen.substitute = true;
    } else if (R.readSubstitute(b, mon) !== undefined) {
      problems.push(`readSubstitute(${f.speciesForme || '?'}) invented a sub with no volatile to justify it`);
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
      const total = (b.stepQueue || []).filter((l) => l.startsWith('|turn|')).length;
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
    // Same honesty for the `[from]` convention the Choice rule-out leans on: most replays
    // have no called move at all, and its absence means that half went unexercised.
    console.log(`  |move| lines: layout checked, [from] attribute ` +
      `${seen.calledMove ? 'SEEN — checked' : 'absent (not exercised)'}`);
    // And for the announcement the Air Balloon rule-out reads as present-or-absent. To
    // exercise it, pick a replay with a Glimmora, Heatran or Iron Thorns in it.
    console.log(`  |-item| lines: layout checked, Air Balloon announcement ` +
      `${seen.balloonAnnounce ? 'SEEN — checked' : 'absent (not exercised)'}`);
    // The status-orb rule-out's pair. |upkeep| is asserted present above (every completed
    // turn has one), so only the |-status| layout can go unexercised — a replay where nobody
    // was ever burned, poisoned or paralysed. To exercise it, pick one with a Gliscor or an
    // Ursaluna in it, which announces the orb on the same line.
    console.log(`  |upkeep| lines: present, |-status| layout ` +
      `${seen.statusLine ? 'SEEN — checked' : 'absent (not exercised)'}`);
    // The retype pair. A random replay often has neither — to exercise them, pick one with a
    // Greninja or a Cinderace in it, which converts on its very first move.
    console.log(`  typechange: volatile ${seen.typeChange ? 'SEEN — checked' : 'absent (not exercised)'}, ` +
      `Protean/Libero attribution ${seen.proteanLine ? 'SEEN — checked' : 'absent (not exercised)'}`);
    // Roost, whose turnstatus is wiped at end of turn — so a replay parsed to its end shows
    // the `|-singleturn|` line and rarely the table entry. Either half counts as exercised.
    console.log(`  Roost: ${seen.roost ? 'SEEN — checked' : 'absent (not exercised)'}`);
    // And for the Substitute, whose hit count depends on both the volatile and the log lines.
    // Shed Tail is the rarer half by far — to exercise it, pick a replay with a Cyclizar or
    // an Orthworm in it.
    console.log(`  Substitute: ${seen.substitute ? 'SEEN — checked' : 'absent (not exercised)'}, ` +
      `Shed Tail hand-off ${seen.shedTail ? 'SEEN — checked' : 'absent (not exercised)'}`);

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
