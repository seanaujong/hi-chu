// Re-derives what `src/core/moveitems.ts` is built on: for each of its six move/ability →
// item laws, that every (format, species, role) it can fire on is ALL-OR-NOTHING — never a
// genuine per-instance mix — and that its declared ability exceptions (and, where it
// allows one, a Mega stone already in the pool) are the full and only reason a role ever
// diverges from its forced item.
//
// Reading `getPriorityItem` is not proof, the same warning `choice-exclusions.mjs` and
// `rest-item-exclusions.mjs` both carry: a role can reach a DIFFERENT, earlier branch first
// (an evolution-stage override, a species carve-out, a Mega/Z-crystal requirement) and never
// arrive at the branch this file states at all. The property that makes narrowing on it
// safe anyway isn't a percentage, it's the same one `choiceitems.ts`'s confirmation rests
// on: sampled per role, the outcome is always one thing or always another, never a mix — so
// `itemsUnderRevealedMoveRules` narrowing toward what a role's OWN declared pool already
// offers can never contradict a role it doesn't actually apply to.
//
// LOCAL, needs the `.ps-server` checkout (cloned on first use, as `player-check` does).
// Deliberately NOT part of `npm run check`: it needs a checkout CI has no reason to carry,
// and several minutes to say anything trustworthy. Run it when Showdown's generator
// changes, or when one of these six deductions looks wrong in a real battle.
//
//   npm run move-item-exclusions              # every published feed, 6k teams each
//   node scripts/move-item-exclusions.mjs 20000

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ensureLocalCheckout} from './lib/local-server.mjs';

const FORMATS = [
  'gen9randombattle', 'gen9randomdoublesbattle', 'gen9babyrandombattle',
  'gen9championsrandombattle', 'gen9championsrandomdoublesbattle',
  'gen8randombattle', 'gen8bdsprandombattle',
  'gen7randombattle', 'gen7letsgorandombattle',
  'gen6randombattle', 'gen5randombattle', 'gen4randombattle',
  'gen3randombattle', 'gen2randombattle', 'gen1randombattle',
];

const toId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const isGimmickItem = (item) => (/ite( [XY])?$/.test(item) && item !== 'Eviolite') || item.endsWith(' Z');

const SRC_PATH = fileURLToPath(new URL('../src/core/moveitems.ts', import.meta.url));

/** `SIMPLE_RULES` as `moveitems.ts` currently declares it, read from the source so the two
 *  cannot drift apart silently — a check that compares a file against itself checks
 *  nothing. Each entry is one `{...}` object literal with no braces of its own inside it
 *  (only `new Set([...])` calls), so a brace-free match per object is exact. */
function declaredSimpleRules() {
  const src = readFileSync(SRC_PATH, 'utf8');
  const block = /const SIMPLE_RULES: readonly SimpleRule\[\] = \[([\s\S]*?)\n\];/.exec(src);
  if (!block) throw new Error('could not find SIMPLE_RULES in src/core/moveitems.ts');
  const ids = (text) => new Set([...text.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]));
  return [...block[1].matchAll(/\{[^{}]*\}/g)].map(([obj]) => {
    const moves = ids(/triggerMoves: new Set\(\[([^\]]*)\]\)/.exec(obj)?.[1] ?? '');
    const item = /item: '([a-z0-9]+)'/.exec(obj)?.[1];
    const excused = ids(/excusedAbilities: new Set\(\[([^\]]*)\]\)/.exec(obj)?.[1] ?? '');
    const allowGimmick = /allowGimmickItems: true/.test(obj);
    if (!item) throw new Error(`could not read an item out of one SIMPLE_RULES entry: ${obj}`);
    return {moves, item, excused, allowGimmick, label: `${[...moves].join('/')} -> ${item}`};
  });
}

const GUTS_FACADE_EXCUSES = new Set(['poisonheal', 'quickfeet']);

/** The orb(s) `moveitems.ts`'s own `possibleOrbs` would consider possible, given the TRUE
 *  ability and type this run already knows (never hidden, since this is a measurement over
 *  concrete generated sets, not a live battle) — so the "should" answer is always a single
 *  orb here, unlike the source function's own three-way "never lie" branching. */
function trueOrb(set, dex) {
  const ability = toId(set.ability);
  if (ability === 'toxicboost') return 'toxicorb';
  const types = dex.species.get(set.species).types.map(toId);
  return types.includes('fire') ? 'toxicorb' : 'flameorb';
}

async function main() {
  const teamsPerFormat = Number(process.argv[2] || 6000);
  const simPath = ensureLocalCheckout();
  const {Teams, Dex} = (await import(simPath)).default ?? (await import(simPath));
  const rules = declaredSimpleRules();

  // Two parallel trackers, one per (format, species, role): "hit" (the forced item, or an
  // excused ability's alternative, or — where allowed — a Mega stone) vs "miss" (anything
  // else). Only a role that mixes hit and miss for the SAME rule is a problem; a role that
  // is consistently one or the other is safe to narrow on regardless of the overall rate.
  const byRule = rules.map(() => new Map());
  const guts = new Map();

  for (const format of FORMATS) {
    const gen = Number(/gen(\d)/.exec(format)?.[1] ?? 9);
    const dex = Dex.forGen(gen);
    let generated = 0;
    try {
      Teams.generate(format);
    } catch (e) {
      console.log(`  ${format}: not generated by this checkout — skipped (${e.message})`);
      continue;
    }
    for (let i = 0; i < teamsPerFormat; i++) {
      for (const set of Teams.generate(format)) {
        const moveIds = new Set(set.moves.map(toId));
        const abilityId = toId(set.ability);
        const itemId = toId(set.item);
        const key = `${format}|${set.species}|${set.role}`;

        rules.forEach((rule, idx) => {
          if (![...moveIds].some((m) => rule.moves.has(m))) return;
          const excused = rule.excused.has(abilityId);
          const hit = itemId === rule.item || excused || (rule.allowGimmick && isGimmickItem(set.item));
          const row = byRule[idx].get(key) ?? {hit: 0, miss: 0, sample: ''};
          if (hit) row.hit++;
          else {
            row.miss++;
            row.sample = `ability=${set.ability} item="${set.item}"`;
          }
          byRule[idx].set(key, row);
        });

        const movesFacadeOrGuts = moveIds.has('facade') || abilityId === 'guts';
        if (movesFacadeOrGuts && !moveIds.has('sleeptalk') && !GUTS_FACADE_EXCUSES.has(abilityId)) {
          const row = guts.get(key) ?? {hit: 0, miss: 0, sample: ''};
          if (itemId === trueOrb(set, dex)) row.hit++;
          else {
            row.miss++;
            row.sample = `ability=${set.ability} item="${set.item}"`;
          }
          guts.set(key, row);
        }
      }
      generated++;
    }
    process.stdout.write(`  ${format}: ${generated} teams done\n`);
  }

  let ok = true;
  const reportMixed = (label, byRole) => {
    const mixed = [...byRole.entries()].filter(([, r]) => r.hit > 0 && r.miss > 0);
    console.log(`\n${label}: ${byRole.size} (format,species,role) combos, ${mixed.length} MIXED`);
    for (const [key, r] of mixed.slice(0, 10)) console.log(`  MIXED  ${key}  hit=${r.hit} miss=${r.miss} e.g. ${r.sample}`);
    if (mixed.length > 0) {
      console.error(`FAIL: ${label} produced both the forced outcome and something else for the SAME role — ` +
        'narrowing on it would sometimes be wrong. Investigate and add an exception, or drop the rule.');
      ok = false;
    }
  };

  for (const [idx, rule] of rules.entries()) reportMixed(rule.label, byRule[idx]);
  reportMixed('Guts/Facade -> Flame/Toxic Orb', guts);

  if (!ok) {
    process.exitCode = 1;
    return;
  }
  console.log('\nOK: every rule in moveitems.ts is all-or-nothing per role across every format sampled.');
}

await main();
