// A test-only build of the extension whose ONLY difference from the shipped one is where
// it is allowed to run.
//
// The shipped manifest matches `https://play.pokemonshowdown.com/*` and nothing else, which
// is correct — that is where users play. But the battle harness (`lib/showdown.mjs`) drives
// a self-hosted server whose client is served from `https://<host>.psim.us`, so a REAL
// installed extension sits dormant there and photographs nothing. Widening `matches` for the
// test build is what lets `visual-check` exercise the actual extension rather than a bundle
// injected into the page.
//
// Derived from `public/manifest.json` rather than hand-written — the same reason
// `build-safari.mjs` derives its own — so name/version/icons can never drift, and a reviewer
// diffing the two sees exactly one intentional difference.
//
// `dist-visual/` is gitignored and never shipped. The one rule: this must not become a place
// where the test build and the real build differ in BEHAVIOUR. Only `matches` may widen; if
// you find yourself changing anything else here, the check has stopped testing what ships.

import * as esbuild from 'esbuild';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';

const outdir = 'dist-visual';

// Every origin the local harness might serve the real client from. `psim.us` is Showdown's
// own domain for self-hosted servers; localhost is the redirect's first hop.
const TEST_ORIGINS = ['https://*.psim.us/*', 'http://localhost/*', 'http://localhost:*/*'];

await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});
await cp('public/icons', `${outdir}/icons`, {recursive: true});

const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
for (const entry of manifest.content_scripts ?? []) {
  entry.matches = [...entry.matches, ...TEST_ORIGINS];
}
manifest.host_permissions = [...(manifest.host_permissions ?? []), ...TEST_ORIGINS];
manifest.name = `${manifest.name} (visual-check)`;
await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

await esbuild.build({
  entryPoints: {content: 'src/content.ts'},
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  legalComments: 'none',
  logLevel: 'info',
});

console.log(`built → ${outdir}/ (shipped manifest + test origins only)`);
