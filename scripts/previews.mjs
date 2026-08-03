// Render every declared preview (src/previews.ts) into one page you can open and look at.
//
// The whole point is that this needs NOTHING: no browser, no battle, no server, no extension
// installed. `section.ts` and `render.ts` are pure — a battle state in, a string out — so a
// state that would take a real two-account game to reach (a Substitute, a Transform, hazards
// on one specific side) is here a line in a file and a page refresh.
//
//   npm run previews          # writes previews/index.html and prints its path
//
// Its output is generated and gitignored, like `screenshots/` and `.icon-proof/`. What IS
// committed is the declarations, which is the part worth reviewing.
//
// The chrome around each panel is an APPROXIMATION of Showdown's tooltip and the page says
// so, in the page. `render.ts` is deliberately almost CSS-free — it inherits the site's own
// fonts, sizes and colours (a 👁 invariant in CLAUDE.md) — so what this proves is the CONTENT
// and STRUCTURE of a section, not the last pixel of how it sits in the real panel. Painting
// these inside a genuine Showdown tooltip means driving a browser; that is a separate step.

import * as esbuild from 'esbuild';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Bundle the CURRENT previews.ts (and everything it pulls in) into something node can import,
 *  so the page always shows the code the extension actually ships — never a stale copy. */
async function loadPreviews() {
  mkdirSync('node_modules/.cache', {recursive: true});
  const out = join('node_modules/.cache', `hichu-previews-${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: ['src/previews.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    // @smogon/calc is bundled IN rather than left external, which is not the obvious choice for
    // a node script. It is CommonJS, and `speed.ts`/`hazards.ts` deep-import its internals
    // extensionless (`@smogon/calc/dist/mechanics/util`) exactly as the extension bundle does —
    // a specifier esbuild resolves happily and node's own ESM resolver refuses outright. Letting
    // esbuild resolve everything is what makes this the same graph the extension ships.
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(out, {force: true});
  }
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);

/**
 * Showdown's tooltip, approximated. Every value here is a value we do NOT control in the real
 * thing — the site supplies them and our markup inherits them — so this block is the one part
 * of the page that can quietly go out of date. Kept small and in one place for that reason,
 * and labelled on the page rather than presented as the real panel.
 */
const APPROXIMATE_TOOLTIP_CHROME = `
.tooltip {
  font-family: Verdana, Helvetica, Arial, sans-serif;
  font-size: 12px;
  line-height: 1.35;
  color: #000;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #6b6b6b;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .3);
  padding: 4px 6px;
  width: 340px;
}
.tooltip small { color: #555; }
.tooltip h2 { font-size: 13px; margin: 0 0 2px; }
.tooltip .native { color: #666; font-style: italic; margin: 0 0 4px; }
`;

const PAGE_CHROME = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: #f6f6f7; color: #1a1a1a;
}
@media (prefers-color-scheme: dark) { body { background: #17181a; color: #e6e6e6; } }
header { max-width: 62rem; margin: 0 auto 28px; }
h1 { font-size: 20px; margin: 0 0 6px; }
.sub { opacity: .75; margin: 0 0 14px; }
.caveat {
  border-left: 3px solid #b9770e; padding: 8px 12px; border-radius: 0 4px 4px 0;
  background: rgba(185, 119, 14, .08); margin: 0;
}
main { max-width: 62rem; margin: 0 auto; }
h2.surface {
  font-size: 12px; text-transform: uppercase; letter-spacing: .08em; opacity: .6;
  margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid currentColor;
}
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
.card { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.name { font-weight: 600; }
.note { font-size: 13px; opacity: .72; margin: 0; }
.stage { padding: 14px; border-radius: 6px; background: #9aa7b4; overflow-x: auto; }
@media (prefers-color-scheme: dark) { .stage { background: #3a4048; } }
.empty { font: italic 13px/1.4 sans-serif; color: #666; }
`;

function card(p) {
  const body = p.html
    ? `<div class="tooltip"><h2>${esc(p.name)}</h2><p class="native">…native tooltip content…</p>${p.html}</div>`
    : `<div class="empty">renders nothing — this surface deliberately shows no section in this state</div>`;
  return `<article class="card">
    <div class="name">${esc(p.name)}</div>
    <p class="note">${esc(p.note)}</p>
    <div class="stage">${body}</div>
  </article>`;
}

function page(previews, style) {
  const surfaces = [...new Set(previews.map((p) => p.surface))];
  const sections = surfaces
    .map((surface) => {
      const cards = previews.filter((p) => p.surface === surface).map(card).join('\n');
      return `<h2 class="surface">${esc(surface)}</h2><div class="grid">${cards}</div>`;
    })
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>hi-chu previews</title>
<style>${PAGE_CHROME}${APPROXIMATE_TOOLTIP_CHROME}</style>
${style}
<header>
  <h1>hi-chu previews</h1>
  <p class="sub">${previews.length} states, rendered by the same builders a live hover calls. Regenerate with <code>npm run previews</code>.</p>
  <p class="caveat">The panel chrome here is an <b>approximation</b> of Showdown's tooltip, not the real thing —
  <code>render.ts</code> is deliberately almost CSS-free and inherits the site's own fonts and colours. Trust these for
  what a section <i>says</i> and how it is <i>structured</i>; for how it sits in the real panel, look at a real tooltip.</p>
</header>
<main>${sections}</main>
`;
}

const {PREVIEWS, TOOLTIP_STYLE} = await loadPreviews();
mkdirSync('previews', {recursive: true});
const file = join('previews', 'index.html');
writeFileSync(file, page(PREVIEWS, TOOLTIP_STYLE));

const bySurface = new Map();
for (const p of PREVIEWS) bySurface.set(p.surface, (bySurface.get(p.surface) ?? 0) + 1);
for (const [surface, n] of bySurface) console.log(`  ${String(n).padStart(2)} ${surface}`);
const empty = PREVIEWS.filter((p) => !p.html);
if (empty.length) {
  // A preview that renders nothing is usually a scenario that stopped reaching the surface it
  // was written for — say so, rather than showing a silently blank card and moving on.
  console.log(`\n  ⚠ ${empty.length} render nothing: ${empty.map((p) => p.name).join(', ')}`);
}
console.log(`\n✓ ${PREVIEWS.length} previews → ${pathToFileURL(file).href}`);
