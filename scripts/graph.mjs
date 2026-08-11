// Draw the import graph. GENERATED — never hand-edit `docs/architecture-graph.md`.
//
// The same instinct as `make-icons.mjs`: a picture of the current shape is exactly the kind
// of thing that rots the moment someone adds a module, so it is derived rather than drawn.
// README's diagram stays hand-written and stays a PIPELINE view — what flows where, which is
// an argument about design and doesn't rot. This is the complementary fact: which module
// actually imports which, today, straight from the source.
//
// Resolution comes from the same `.dependency-cruiser.cjs` that `npm run deps` enforces with,
// so the drawing and the check can never disagree about what depends on what.
//
// EXTERNAL PACKAGES ARE NAMED, NOT DRAWN, and the reason is that a path is not a fact about
// this codebase. Our source knows `@smogon/calc` — a specifier — while dependency-cruiser
// resolves it to wherever npm put the file, which in a git worktree with no `node_modules`
// of its own is `../../../node_modules/@smogon/calc/dist/index.js`. Rendered as nested
// path boxes, that accident of layout lands in the committed drawing: identical modules,
// identical edges, three extra wrapper boxes, and a `graph:check` that passes locally and
// fails in CI. Naming the specifier instead makes this file a function of the source alone.
//
// The table below the diagram is not a lesser rendering of the same thing. The external
// surface is five edges across three files, which reads better as a list than as boxes, and
// it keeps the one distinction the boxes made fragile: `@smogon/calc` and
// `@smogon/calc/dist/mechanics/util` are different specifiers, and the second one is a
// deliberate reach past the package's public surface (see core/vendor.ts).
//
// Mermaid rather than SVG on purpose: GitHub renders it inline, it diffs as text (so a review
// SEES an edge appear), and it needs no Graphviz on anyone's machine.

// `--check` verifies the committed file is current without writing anything, which is what
// `npm run check` runs. Without it the graph gate lived only in CI, so adding a module left a
// developer fully green locally — typecheck, tests, cruise — and red on push, for a file they
// had no reason to know was generated. A gate you can only trip remotely is a gate that
// teaches the wrong lesson about which command means "done".

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';

const OUT = 'docs/architecture-graph.md';
const CHECK_ONLY = process.argv.includes('--check');

// Test files and their fixtures are real modules but not part of the design being drawn.
// `node_modules` joins them for a different reason: those modules are drawn by PATH, and a
// path is a fact about npm's disk layout rather than about our design (see above). Excluding
// them also drops a phantom the filter used to leave behind — a `.test.ts` was removed from
// the module list while whatever it resolved to stayed, so `vitest` appeared in the product
// graph as a node with no edges at all, reading as a dependency the product does not have.
const EXCLUDE = '\\.test\\.ts$|testfixtures|node_modules';
/** The same filter minus node_modules, for the one read that needs the external edges. */
const TESTS_ONLY = '\\.test\\.ts$|testfixtures';

function cruise(outputType, exclude) {
  return execFileSync(
    'npx',
    ['depcruise', 'src/**/*.ts', 'gallery/**/*.ts', '--config', '.dependency-cruiser.cjs', '--exclude', exclude, '--output-type', outputType],
    {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024},
  );
}

const isExternal = (path) => path.includes('node_modules');

const mermaid = cruise('mermaid', EXCLUDE).trim();
// The JSON keeps node_modules so the external edges can be NAMED below; the counts and the
// diagram both describe our own modules, so they filter it back out.
const {modules: all} = JSON.parse(cruise('json', TESTS_ONLY));
const modules = all.filter((m) => !isExternal(m.source));
const edges = modules.reduce((n, m) => n + m.dependencies.filter((d) => !isExternal(d.resolved)).length, 0);

/**
 * Every import of a third-party package, by the SPECIFIER the source writes rather than the
 * file npm resolved it to. One row per importing module, since the interesting fact is how
 * few modules reach outside at all.
 */
function externalsTable() {
  const rows = modules
    .map((m) => [m.source, [...new Set(m.dependencies.filter((d) => isExternal(d.resolved)).map((d) => d.module))].sort()])
    .filter(([, specifiers]) => specifiers.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (rows.length === 0) return 'Nothing here imports a third-party package.';
  const body = rows.map(([source, specifiers]) => `| \`${source}\` | ${specifiers.map((d) => `\`${d}\``).join(', ')} |`);
  return ['| Module | Imports |', '|---|---|', ...body].join('\n');
}

// A graph that resolved nothing still renders — it just comes back as a pile of unconnected
// boxes. That is the failure mode of the resolver shim (see scripts/lib/ts-esm-resolve.cjs),
// and it is silent, so refuse to write one rather than publish a lie about the architecture.
if (edges < modules.length) {
  console.error(`✗ only ${edges} edges across ${modules.length} modules — resolution is broken, not writing ${OUT}`);
  process.exit(1);
}

const contents = `# Module graph

<!-- GENERATED by \`npm run graph\` — do not edit. -->

Which module imports which, derived from the source. ${modules.length} modules, ${edges} edges.

This is the *current shape*. For what the layers MEAN — why \`facts.ts\` is a leaf, why every
deduction routes through \`narrow.ts\` — read the Architecture section of \`CLAUDE.md\`; for the
pipeline the data flows along, the diagram in \`README.md\`. Those are arguments and they don't
rot. This one does, which is why it is regenerated rather than maintained.

The rules that FAIL a build are elsewhere and are not restated here: the project's own layering
invariants live in \`fitness/dependency-boundaries.test.ts\` (run by \`npm run check\`), and the
structural ones — no cycles, no orphans — in \`.dependency-cruiser.cjs\` (run by \`npm run deps\`).

\`\`\`mermaid
${mermaid}
\`\`\`

## What we import from outside

Third-party packages are named rather than drawn — a specifier is a fact about this source,
where the path npm resolved it to is a fact about one machine's disk. Reaching past a
package's published surface (a \`dist/\` path) is a deliberate act and is argued for where it
happens.

${externalsTable()}
`;

if (CHECK_ONLY) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== contents) {
    console.error(`✗ ${OUT} is out of date — run \`npm run graph\` and commit the result`);
    process.exit(1);
  }
  console.log(`✓ ${OUT} matches the source (${modules.length} modules, ${edges} edges)`);
  process.exit(0);
}

mkdirSync('docs', {recursive: true});
writeFileSync(OUT, contents);

console.log(`✓ ${modules.length} modules, ${edges} edges → ${OUT}`);
