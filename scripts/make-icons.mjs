// Render every icon in the repo from the one drawing in `scripts/lib/logo.mjs`, via the
// Chrome we already drive for drift-check (puppeteer-core) — no image toolchain needed.
//
// "Every icon" is the point: the Chrome extension's three PNGs, the eleven in Safari's app
// icon catalogue, the two loose Safari copies, and the README lockup all come from here, so
// none of them can drift from the others the way hand-made copies eventually always do.
// dist/, dist-safari/ and dist-visual/ copy public/icons at build time, so they follow along.
//
//   node scripts/make-icons.mjs            rewrite every icon
//   node scripts/make-icons.mjs --proof    render a sheet to look at, write nothing else
//
// `--proof` exists because the optical-size thresholds in logo.mjs were chosen by rendering
// and looking, and looking is the only way to re-check them.
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import puppeteer from 'puppeteer-core';
import {ALL_DRAWINGS, LOCKUP_FONT, OPTICAL, PALETTE, markSvg, wordmarkSvg} from './lib/logo.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SAFARI_APP = 'safari/hi-chu/Shared (App)';
const APPICON = `${SAFARI_APP}/Assets.xcassets/AppIcon.appiconset`;

// path → how many pixels to render, and how many POINTS the result is displayed at. Those
// come apart on every retina asset: Xcode's filenames carry the point size, so mac-icon-16@2x
// is 32 pixels of an icon the user sees at 16 points. `logo.mjs` picks its drawing from the
// point size, so the pair has to be carried here rather than inferred from the pixel count.
const mac = (pt, scale) => [`${APPICON}/mac-icon-${pt}@${scale}x.png`, pt * scale, pt];

const ICONS = [
  ...[16, 48, 128].map((px) => [`public/icons/icon-${px}.png`, px, px]),
  mac(16, 1),
  mac(16, 2),
  mac(32, 1),
  mac(32, 2),
  mac(128, 1),
  mac(128, 2),
  mac(256, 1),
  mac(256, 2),
  mac(512, 1),
  mac(512, 2),
  // iOS forbids an alpha channel in an app icon and masks the result to its own shape, so
  // this one alone gets an opaque ground and sits inset. Every other icon is transparent.
  [`${APPICON}/universal-icon-1024@1x.png`, 1024, 1024, {opaque: true}],
  [`${SAFARI_APP}/Resources/Icon.png`, 128, 128],
  [`${SAFARI_APP}/Assets.xcassets/LargeIcon.imageset/icon-128.png`, 128, 128],
];

// One lockup, not a light and a dark variant — the name is set in the wrapper's red, which
// reads on either ground. See `wordmarkSvg` for why that is a correctness property.
const WORDMARK = 'docs/brand/wordmark.png';

const shell = (body, w, h) =>
  `<!doctype html><meta charset="utf8"><style>*{margin:0;padding:0}
   body{width:${w}px;height:${h}px}svg{display:block}</style>${body}`;

const browser = await puppeteer.launch({executablePath: CHROME, headless: 'new', args: ['--no-sandbox']});
const page = await browser.newPage();

/** Screenshot one SVG document at its own size, on a transparent ground. */
const shoot = async (svg, w, h = w, scale = 1) => {
  await page.setViewport({width: w, height: h, deviceScaleFactor: scale});
  await page.setContent(shell(svg, w, h), {waitUntil: 'load'});
  return page.screenshot({omitBackground: true});
};

const write = async (path, png) => {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, png);
};

try {
  if (process.argv.includes('--proof')) {
    await proof();
  } else {
    for (const [path, px, pt, opts] of ICONS) {
      await write(path, await shoot(markSvg(px, {pt, ...opts}), px));
      console.log(`${String(px).padStart(4)}px @ ${String(pt).padStart(4)}pt  ${OPTICAL(pt).padEnd(7)}  ${path}`);
    }
    await write(WORDMARK, await shoot(wordmarkSvg(), 420, 128, 3));
    console.log(`  lockup  ${WORDMARK}`);
  }
} finally {
  await browser.close();
}

/** A sheet to judge by eye: the three drawings, the glyphs up close, and every shipped size. */
async function proof() {
  const swatch = (inner, bg) =>
    `<div style="background:${bg};padding:16px;border-radius:12px;display:flex;gap:16px;align-items:center">${inner}</div>`;
  const textGlyph = (glyphs, size, dy) =>
    `<g transform="rotate(-16 64 64)">
       <rect x="20" y="30" width="88" height="68" rx="22" fill="${PALETTE.cheek}"/>
       <rect x="30" y="40" width="68" height="48" rx="14" fill="${PALETTE.ink}"/>
       <text x="64" y="${dy}" font-family="${LOCKUP_FONT}" font-weight="700" font-size="${size}"
             fill="${PALETTE.pika}" text-anchor="middle">${glyphs}</text></g>`;
  const box = (label, inner) =>
    `<div style="display:flex;flex-direction:column;gap:6px;align-items:center">
       <div style="background:${PALETTE.ink};border-radius:12px;padding:14px">
         <svg viewBox="0 0 128 128" width="120" height="120">${inner}</svg></div>
       <b style="font:600 10px ui-monospace,monospace;color:#666">${label}</b></div>`;

  const body = `<div style="font:13px/1.4 system-ui;background:#f0f0f2;padding:24px;
      display:flex;flex-direction:column;gap:20px;width:1000px">
    <b>Three drawings — bolt / percent / unknown</b>
    ${['#e8e8ec', '#20232b']
      .map((bg) =>
        swatch(
          Object.values(ALL_DRAWINGS)
            .map((d) => `<svg viewBox="0 0 128 128" width="110" height="110">${d.svg}</svg>`)
            .join(''),
          bg,
        ),
      )
      .join('')}
    <b>The one opaque case — iOS, which forbids alpha and masks the corners itself</b>
    ${swatch(markSvg(128, {opaque: true}), '#e8e8ec')}
    <b>Glyphs up close — drawn as geometry, against the same thing set as text</b>
    <div style="display:flex;gap:14px">
      ${box('drawn ?%', ALL_DRAWINGS.unknown.svg)}
      ${box('text ?%', textGlyph('?%', 36, 77))}
      ${box('drawn %', ALL_DRAWINGS.percent.svg)}
      ${box('text %', textGlyph('%', 46, 81))}
    </div>
    <b>Every shipped size, actual pixels</b>
    ${['#e8e8ec', '#20232b'].map((bg) => swatch([16, 32, 48, 64, 128, 256].map((px) => markSvg(px)).join(''), bg)).join('')}
    <b>Toolbar, actual pixels</b>
    ${swatch([16, 16, 16].map((px) => markSvg(px)).join(''), '#20232b')}
    <b>Lockup — the SAME file on both grounds, which is the point</b>
    ${swatch(wordmarkSvg(), '#ffffff')}
    ${swatch(wordmarkSvg(), '#0d1117')}
  </div>`;

  await page.setViewport({width: 1000, height: 900, deviceScaleFactor: 2});
  await page.setContent(
    `<!doctype html><meta charset="utf8"><style>*{margin:0;padding:0;box-sizing:border-box}</style>${body}`,
    {waitUntil: 'load'},
  );
  await write('.icon-proof/proof.png', await page.screenshot({fullPage: true}));
  console.log('wrote .icon-proof/proof.png');
}
