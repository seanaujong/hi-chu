// Has each fitness rule ever actually FIRED?
//
// Read-only, writes nothing, and deliberately not part of `npm run check` — this is a tool you
// reach for when deciding whether a rule earns its keep, not a gate.
//
// The question it answers is the one a green suite cannot: a rule that has never caught
// anything is indistinguishable, from inside, from a rule that is protecting you. Replaying
// the rules over real history separates them. When this was first run over 60 commits it
// reported that four of six rules had never fired once — and that the one with the highest
// yield (`deductions` routing through `narrow`) was red for 57 commits and went green at the
// exact commit that fixed the bug it was written for. That is the shape of evidence worth
// having before pruning anything.
//
//   node scripts/fitness-retro.mjs              # the last 60 commits of origin/main
//   node scripts/fitness-retro.mjs --commits=200
//   node scripts/fitness-retro.mjs --ref=HEAD   # measure your own branch instead
//
// It replays each commit's tree into a temp directory and applies the rules to it, rather
// than checking the rules out at that commit — so it reports what TODAY's rules would have
// said about older code, which is the question. A rule that did not exist yet still gets
// measured, which is exactly how you learn whether writing it was worth doing.

import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
// Imported with a `.ts` extension, unlike everything else in the repo: this file is plain JS
// outside tsconfig (the `scripts/` convention), and Node strips the types at load. Reaching
// for the REAL rules rather than reimplementing them is the whole point — a retrospective run
// against a copy of the rules would measure the copy.
import {importStatements} from '../fitness/importgraph.ts';
import {docCoverageGaps, importersOf, unexplainedHatchLines, unreadableModuleNames} from '../fitness/rules.ts';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const REF = arg('ref', 'origin/main');
const COMMITS = Number(arg('commits', '60'));

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 1 << 28});

const tsFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
        const p = join(dir, e.name);
        return e.isDirectory() ? tsFiles(p) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
      })
    : [];

const localImportsIn = (file) =>
  importStatements(readFileSync(file, 'utf8')).filter((s) => s.specifier.startsWith('.'));

/** Every rule, as a function from a checked-out tree to the violations it would report. */
const RULES = {
  'core module naming': (root) => unreadableModuleNames(existsSync(join(root, 'src/core')) ? readdirSync(join(root, 'src/core')) : []),

  'deductions route through narrow': (root) => {
    const core = join(root, 'src/core');
    if (!existsSync(core)) return [];
    const sibling = /^\.\/([a-z]+)\.js$/;
    const graph = Object.fromEntries(
      readdirSync(core)
        .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
        .map((n) => [
          n.replace(/\.ts$/, ''),
          localImportsIn(join(core, n))
            .map((s) => sibling.exec(s.specifier)?.[1])
            .filter(Boolean),
        ]),
    );
    if (!existsSync(join(core, 'deductions.ts'))) return [];
    const importers = importersOf('deductions', graph);
    return importers.length && importers.join() !== 'narrow' ? importers : [];
  },

  'no barrel file': (root) =>
    tsFiles(join(root, 'src'))
      .filter((p) => /(^|\/)index\.ts$/.test(p) || /^export\s+\*/m.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(root.length + 1)),

  'core module is in the map': (root) => {
    const core = join(root, 'src/core');
    const doc = join(root, 'CLAUDE.md');
    if (!existsSync(core) || !existsSync(doc)) return [];
    const text = readFileSync(doc, 'utf8');
    const start = text.indexOf('## Architecture');
    if (start === -1) return [];
    const section = text.slice(start, text.indexOf('\n## ', start + 1));
    const listed = [...section.matchAll(/^\s*-\s+`([a-z]+\.ts)`/gm)].map((m) => m[1]);
    if (listed.length < 5) return []; // section format predates this rule; don't invent violations
    const modules = readdirSync(core).filter(
      (n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && !n.includes('testfixtures'),
    );
    return docCoverageGaps(modules, listed).undocumented;
  },

  'escape hatch carries a rationale': (root) => {
    const reached = new Set();
    const visit = (f) => {
      if (reached.has(f) || !existsSync(f)) return;
      reached.add(f);
      for (const s of localImportsIn(f)) visit(join(dirname(f), s.specifier.replace(/\.js$/, '.ts')));
    };
    for (const entry of ['src/content.ts', 'src/background.ts']) visit(join(root, entry));
    return [...reached].flatMap((p) =>
      unexplainedHatchLines(readFileSync(p, 'utf8').split('\n')).map((n) => `${p.slice(root.length + 1)}:${n}`),
    );
  },
};

const commits = git('log', '--format=%h%x09%s', `-${COMMITS}`, REF)
  .trim()
  .split('\n')
  .map((line) => {
    const [sha, ...rest] = line.split('\t');
    return {sha, subject: rest.join('\t')};
  });

const tmp = mkdtempSync(join(tmpdir(), 'fitness-retro-'));
const tally = Object.fromEntries(Object.keys(RULES).map((name) => [name, []]));
let replayed = 0;

try {
  for (const {sha, subject} of commits) {
    const root = join(tmp, sha);
    execFileSync('sh', ['-c', `mkdir -p '${root}' && git archive ${sha} | tar -x -C '${root}'`]);
    if (!existsSync(join(root, 'src'))) continue;
    replayed++;
    for (const [name, rule] of Object.entries(RULES)) {
      let hits = [];
      try {
        hits = rule(root);
      } catch {
        continue; // a tree too old for this rule to read at all is not a violation
      }
      if (hits.length) tally[name].push({sha, subject: subject.slice(0, 48), hits});
    }
    rmSync(root, {recursive: true, force: true});
  }
} finally {
  rmSync(tmp, {recursive: true, force: true});
}

console.log(`\nreplayed ${replayed} commits of ${REF} — today's rules, applied to older trees\n`);
const width = Math.max(...Object.keys(RULES).map((n) => n.length));
for (const [name, fired] of Object.entries(tally)) {
  const rate = `${String(fired.length).padStart(3)}/${replayed}`;
  console.log(`${name.padEnd(width)}  fired on ${rate} ${fired.length === 0 ? ' — never fired' : ''}`);
  if (fired.length) {
    const oldest = fired[fired.length - 1];
    const newest = fired[0];
    console.log(`${' '.repeat(width)}    oldest ${oldest.sha} ${oldest.subject}`);
    console.log(`${' '.repeat(width)}    newest ${newest.sha} ${newest.subject}  (e.g. ${newest.hits[0]})`);
  }
}
console.log(
  '\nA rule that never fired is not proof of a clean codebase — it is a rule with no measured\n' +
    'yield. Keep it for cost (these run in milliseconds and need no maintenance) or delete it,\n' +
    'but decide on the evidence rather than on how good the rule sounds.\n',
);
