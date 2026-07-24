// Builds the Safari-specific extension bundle into dist-safari/, kept entirely separate
// from `npm run build`'s dist/ (which the live, shipped Chrome extension's release
// pipeline reads) so nothing here can regress it.
//
// Safari doesn't support "world": "MAIN" declared statically in a manifest.json
// content_scripts entry (confirmed via `xcrun safari-web-extension-converter`'s own
// build warning), so the Safari manifest drops content_scripts entirely and instead
// ships a background service worker (src/background.ts) that registers it dynamically,
// which Safari 16.4+ does support for world: "MAIN". content.ts itself is unchanged and
// unforked — it has no Chrome-specific API calls, so the same bundle behavior applies.
//
// The manifest is derived from public/manifest.json, not hand-duplicated, so
// name/version/description/icons can never drift from the Chrome one; only the
// Safari-specific keys are layered on here.
import * as esbuild from 'esbuild';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';

const outdir = 'dist-safari';

await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});

await cp('public/icons', `${outdir}/icons`, {recursive: true});

const safariManifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
delete safariManifest.content_scripts;
safariManifest.host_permissions = [...safariManifest.host_permissions, 'https://play.pokemonshowdown.com/*'];
safariManifest.permissions = ['scripting'];
safariManifest.background = {service_worker: 'background.js'};
await writeFile(`${outdir}/manifest.json`, JSON.stringify(safariManifest, null, 2) + '\n');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {content: 'src/content.ts', background: 'src/background.ts'},
  bundle: true,
  outdir,
  format: 'iife', // both are plain scripts, not modules
  target: 'chrome114',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'info',
  minify: true,
};

await esbuild.build(options);
console.log(`built → ${outdir}/`);
