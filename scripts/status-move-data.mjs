// Re-derives the move-effect tables `src/core/movefails.ts` is built on: which Status-category
// moves inflict which major status, and which carry Showdown's `powder` flag. Also re-derives
// `src/core/movetargets.ts`'s `NON_OPPONENT_TARGET_MOVES` — every Status move whose real
// target is NOT opponent-directed, which @smogon/calc's own move data can't tell you (see that
// file's docblock).
//
// Unlike `choice-exclusions.mjs`'s law, this is not emergent generator behaviour — it's
// deterministic data sitting directly on each move's own dex record. So this script doesn't
// sample generated teams; it enumerates every Status-category move in the dex ONCE per gen and
// reads `.status`/`.flags.powder` straight off it. A rarity and a hand-recalled mistake still
// look identical from the outside (Spore inflicts sleep without the powder flag, which is
// exactly the kind of fact memory gets wrong), so the check is the same shape as
// `choice-exclusions.mjs`'s: read the source's own tables by regex, diff against the measured
// truth, fail loudly on disagreement.
//
// LOCAL, needs the `.ps-server` checkout (cloned on first use, as `player-check` does).
// Deliberately NOT part of `npm run check`: it needs a checkout CI has no reason to carry.
// Run it when Showdown's move data changes, or when a fail-reason line looks wrong in a
// real battle.
//
//   npm run status-move-data
//   node scripts/status-move-data.mjs 9        # one gen only

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ensureLocalCheckout} from './lib/local-server.mjs';

const GENS = [9, 8, 7, 6, 5, 4, 3, 2, 1];
const toId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The vocabulary for "reaches the opponent" — kept in sync by eye with `core/movefails.ts`'s
 *  own `OPPONENT_TARGETS`, which `movefails.test.ts`'s `targetsOpponent` suite already pins;
 *  Pokémon's own set of target strings has been stable for a decade. */
const OPPONENT_TARGETS = new Set(['normal', 'any', 'randomNormal', 'adjacentFoe', 'allAdjacentFoes']);

/** Pulls a `Map`/`Set` literal of quoted move ids out of `movefails.ts` by name, so the check
 *  compares the source against itself rather than a second copy of the same claim. */
function declaredTable(varName, src) {
  const block = new RegExp(`const ${varName}: Readonly(?:Map|Set)<[^=]*=\\s*(?:new (?:Map|Set)\\()?\\[([^\\]]*)\\]`, 's').exec(src);
  if (!block) throw new Error(`could not find ${varName} in src/core/movefails.ts`);
  return new Set([...block[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]));
}

async function main() {
  const gens = process.argv[2] ? [Number(process.argv[2])] : GENS;
  const simPath = ensureLocalCheckout();
  const {Dex} = (await import(simPath)).default ?? (await import(simPath));

  // moveId → {name, status per gen seen, powder}
  const measuredStatus = new Map(); // moveId -> {name, status}
  const measuredPowder = new Map(); // moveId -> name
  // Union across every gen scanned, not a per-gen agreement — "prefer missing a rule-out to
  // making a false one" cuts the same way here as it does in deductions.ts: a move that's
  // self-targeting in even ONE scanned gen goes in, so an old-gen hover goes quiet instead of
  // risking a false claim in whichever gen it's actually wrong for. Curse is excluded by name
  // — its own real target field reads as opponent-directed, and its true self-targeting is
  // conditional on the USER's type, which `movetargets.ts` deliberately leaves to
  // `damage.ts`'s `curseTarget` instead.
  const measuredNonOpponentTarget = new Map(); // moveId -> name

  for (const gen of gens) {
    const dex = Dex.forGen(gen);
    for (const move of dex.moves.all()) {
      if (move.category !== 'Status') continue;
      const id = toId(move.id ?? move.name);
      if (move.status) {
        const existing = measuredStatus.get(id);
        if (existing && existing.status !== move.status) {
          console.log(`  ${move.name}: status differs by gen (${existing.status} vs gen ${gen}'s ${move.status}) — kept the first seen`);
        } else {
          measuredStatus.set(id, {name: move.name, status: move.status});
        }
      }
      if (move.flags?.powder) measuredPowder.set(id, move.name);
      if (id !== 'curse' && !OPPONENT_TARGETS.has(move.target)) measuredNonOpponentTarget.set(id, move.name);
    }
  }

  console.log(`Status-category moves inflicting a major status (${measuredStatus.size}):`);
  for (const [id, {name, status}] of measuredStatus) console.log(`  ${name.padEnd(16)} → ${status}  [${id}]`);
  console.log(`\nPowder-flagged moves (${measuredPowder.size}):`);
  for (const [id, name] of measuredPowder) console.log(`  ${name}  [${id}]`);
  console.log(`\nStatus moves that do NOT target the opponent (${measuredNonOpponentTarget.size}):`);
  for (const [id, name] of measuredNonOpponentTarget) console.log(`  ${name}  [${id}]`);

  const src = readFileSync(fileURLToPath(new URL('../src/core/movefails.ts', import.meta.url)), 'utf8');
  const declaredStatusIds = new Set([...src.matchAll(/\['([a-z0-9]+)',\s*'(?:par|brn|psn|tox|slp|frz)'\]/g)].map((m) => m[1]));
  const declaredPowder = declaredTable('POWDER_MOVES', src);
  const targetsSrc = readFileSync(fileURLToPath(new URL('../src/core/movetargets.ts', import.meta.url)), 'utf8');
  const declaredNonOpponentTarget = declaredTable('NON_OPPONENT_TARGET_MOVES', targetsSrc);

  let failed = false;

  const missingStatus = [...measuredStatus.keys()].filter((id) => !declaredStatusIds.has(id));
  if (missingStatus.length > 0) {
    console.error(`\nFAIL: these Status moves inflict a major status per the dex and are NOT in ` +
      `INFLICTS_STATUS: ${missingStatus.join(', ')}. Add them to src/core/movefails.ts, or confirm ` +
      "they're a secondary effect on a damaging move (excluded on purpose) rather than a pure status move.");
    failed = true;
  }
  const staleStatus = [...declaredStatusIds].filter((id) => !measuredStatus.has(id));
  if (staleStatus.length > 0) {
    console.log(`\nDeclared in INFLICTS_STATUS but the dex no longer shows a status for them: ${staleStatus.join(', ')}`);
  }

  const missingPowder = [...measuredPowder.keys()].filter((id) => !declaredPowder.has(id));
  if (missingPowder.length > 0) {
    console.error(`\nFAIL: these moves carry Showdown's powder flag and are NOT in POWDER_MOVES: ` +
      `${missingPowder.join(', ')}. A Grass-type target is being told a powder move reaches it.`);
    failed = true;
  }
  const stalePowder = [...declaredPowder].filter((id) => !measuredPowder.has(id));
  if (stalePowder.length > 0) {
    console.log(`\nDeclared in POWDER_MOVES but the dex no longer flags them as powder: ${stalePowder.join(', ')}`);
  }

  const missingTarget = [...measuredNonOpponentTarget.keys()].filter((id) => !declaredNonOpponentTarget.has(id));
  if (missingTarget.length > 0) {
    console.error(`\nFAIL: these Status moves do NOT target the opponent per the dex and are NOT in ` +
      `NON_OPPONENT_TARGET_MOVES: ${missingTarget.join(', ')}. Add them to src/core/movetargets.ts — ` +
      'left out, the calc\'s Move.target reads \'any\' for them and a type-immune foe reports a false ' +
      '"no effect".');
    failed = true;
  }
  const staleTarget = [...declaredNonOpponentTarget].filter((id) => !measuredNonOpponentTarget.has(id));
  if (staleTarget.length > 0) {
    console.log(`\nDeclared in NON_OPPONENT_TARGET_MOVES but the dex now targets the opponent for them: ${staleTarget.join(', ')}`);
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log('\nOK: movefails.ts\'s and movetargets.ts\'s tables cover everything this run measured.');
}

await main();
