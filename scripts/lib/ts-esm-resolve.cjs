// How to resolve THIS codebase's imports, for tools that don't already know.
//
// TypeScript's ESM output requires an import to name the file it will be at RUNTIME, so
// every internal import here reads `./narrow.js` while the file on disk is `narrow.ts`.
// TypeScript maps that itself; enhanced-resolve (what dependency-cruiser resolves with)
// needs telling, via `extensionAlias`.
//
// It has to live in a webpack-shaped file because dependency-cruiser's own
// `enhancedResolveOptions` schema has no `extensionAlias` key — it rejects the config
// outright — while its `webpackConfig` option passes `resolve` through untouched. That is
// the whole reason this file exists; it is a resolver shim, not a build config, and nothing
// bundles with it.
//
// Without it every internal edge silently fails to resolve and the graph inverts: modules
// with 19 dependents come back as orphans, because none of the edges pointing at them
// landed. A wrong graph that still reports "no violations" is worse than no graph, so if
// this file stops working the symptom to expect is a suspiciously empty result, not an error.

module.exports = {
  resolve: {
    extensionAlias: {'.js': ['.ts', '.js'], '.mjs': ['.mts', '.mjs']},
    extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
  },
};
