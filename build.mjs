// Bundles the content script and copies static extension assets into dist/.
// Run `npm run build` for a one-shot build, `npm run watch` to rebuild on change.
import * as esbuild from 'esbuild';
import {cp, mkdir, rm} from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, {recursive: true, force: true});
await mkdir(outdir, {recursive: true});

// Static assets (manifest, icons) are copied verbatim; only TS is bundled.
await cp('public', outdir, {recursive: true});

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {content: 'src/content.ts'},
  bundle: true,
  outdir,
  format: 'iife', // a content script is a plain script, not a module
  target: 'chrome114',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching… (dist/ rebuilds on save; reload the unpacked extension to pick up changes)');
} else {
  await esbuild.build(options);
  console.log('built → dist/');
}
