// Re-derives the move-effect tables `src/core/movefails.ts` is built on: which Status-category
// moves inflict which major status, and which carry Showdown's `powder` flag.
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
    }
  }

  console.log(`Status-category moves inflicting a major status (${measuredStatus.size}):`);
  for (const [id, {name, status}] of measuredStatus) console.log(`  ${name.padEnd(16)} → ${status}  [${id}]`);
  console.log(`\nPowder-flagged moves (${measuredPowder.size}):`);
  for (const [id, name] of measuredPowder) console.log(`  ${name}  [${id}]`);

  const src = readFileSync(fileURLToPath(new URL('../src/core/movefails.ts', import.meta.url)), 'utf8');
  const declaredStatusIds = new Set([...src.matchAll(/\['([a-z0-9]+)',\s*'(?:par|brn|psn|tox|slp|frz)'\]/g)].map((m) => m[1]));
  const declaredPowder = declaredTable('POWDER_MOVES', src);

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

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log('\nOK: movefails.ts\'s tables cover everything this run measured.');
}

await main();
