// Structural properties of the import graph that would be silly to hand-roll.
//
// This config deliberately does NOT restate the project's own layering rules. Those live in
// `fitness/dependency-boundaries.test.ts` — named, argued in prose beside the assertion, and run
// on every `npm run check` with no install. Duplicating them here would recreate exactly the
// failure mode that motivated this work: one rule, two homes, free to drift.
//
// What is here is the complement — the two generic properties a hand-written test would be a
// bad way to express, because they are about the graph as a whole rather than about any edge
// we could name in advance:
//
//   no-circular  a cycle means two modules are really one, and it can hide for a long time
//                behind type-only edges the typechecker is happy to resolve either way.
//   no-orphans   a module nothing imports and that imports nothing is dead code. Ours is a
//                pure core with a thin shell, so a file that has fallen out of the graph is
//                invisible in review — nothing fails, nothing renders differently.
//
// `npm run deps` checks both. `npm run graph` reuses the same resolution to DRAW the graph
// (see scripts/graph.mjs) rather than keeping a second idea of what depends on what.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Two modules in a cycle are one module with a seam drawn through it. Break it by moving ' +
        'the shared thing down into a leaf both can depend on — facts.ts and types.ts exist for ' +
        'exactly this, which is why the layering test pins them as leaves.',
      from: {},
      to: {circular: true},
    },
    {
      // The one rule here that is about a NAMED boundary rather than a generic graph
      // property, and it lives in this file because it is a question about REACHABILITY —
      // exactly what dependency-cruiser resolves and what a test would have to rebuild the
      // module graph to state.
      //
      // `fitness/` and `gallery/` read and exercise this codebase; `src/` is the codebase.
      // An import in that direction puts a check or a preview declaration inside the bundle
      // a user installs, which is both dead weight and a strange thing to have shipped.
      // Nothing else in the repo prevents it: the directory split alone is a filing
      // convention, and a filing convention holds exactly until someone needs a helper and
      // finds one next door.
      //
      // It is stated as REACHABILITY FROM AN ENTRY POINT rather than as `^src/` ↛ `^gallery/`,
      // because the path form states a proxy and this one states the harm. What is wrong with
      // the edge is that the module SHIPS — so the rule asks the question the bundler asks.
      // Two things follow that the proxy got wrong. A `*.test.ts` may import a fixture builder
      // out here, since no entry point reaches a test; and the diagnostic names the whole
      // chain (`content.ts → render.ts → gallery/labels.ts`) rather than only its last hop.
      //
      // The reverse — `fitness/` or `gallery/` importing `src/` — is deliberately still legal,
      // and `gallery/previews.ts` relies on it: a preview calls the very builders a live hover
      // calls, which is the whole reason it cannot drift from the product.
      name: 'tooling-stays-outside-the-product',
      severity: 'error',
      comment:
        'A module under fitness/ or gallery/ is reachable from a build entry point, so it ships to ' +
        'users inside content.js. They read and exercise the product; they are not part of it. Move ' +
        'whatever is shared into src/ and let the tool read it, rather than reaching sideways for it.',
      from: {path: '^src/(content|background)\\.ts$'},
      to: {path: '^(fitness|gallery)/', reachable: true},
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'A module with no dependents and no dependencies is dead. Delete it, or wire it up — a ' +
        'file that has silently fallen out of the graph still typechecks and still ships.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)tsconfig[^/]*\\.json$',
          '(^|/)\\.[^/]+\\.(cjs|mjs|js)$',
          // Entry points the MANIFEST declares, not code. `background.ts` is Safari's
          // service worker: the browser loads it, so nothing imports it and it imports
          // nothing. That is what an entry point looks like from inside the graph, and it
          // is the one shape "orphan" cannot tell apart from dead code.
          '^src/background\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {path: 'node_modules'},
    // Follow `import type` edges too: a type-only cycle is still a cycle in the design,
    // even though it erases at runtime.
    tsConfig: {fileName: 'tsconfig.json'},
    tsPreCompilationDeps: true,
    // Teaches the resolver that `./narrow.js` means `narrow.ts`. Non-optional: without it
    // every internal edge fails to resolve and the graph comes back inside out. See the file.
    webpackConfig: {fileName: 'scripts/lib/ts-esm-resolve.cjs'},
  },
};
