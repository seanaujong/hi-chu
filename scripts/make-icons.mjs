// Render the extension icons (16/48/128 PNG) from one inline SVG, via the Chrome
// we already drive for drift-check (puppeteer-core) — no image toolchain needed.
// The icon: a Showdown-blue rounded square with a Pokémon-yellow damage bolt.
// Re-run after editing the SVG: `node scripts/make-icons.mjs`.
import {mkdir, writeFile} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SIZES = [16, 48, 128];
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4863b0"/>
      <stop offset="1" stop-color="#1b2547"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="124" height="124" rx="27" fill="url(#bg)"/>
  <path d="M74 18 L38 70 H58 L52 110 L92 56 H70 Z"
        fill="#ffcb05" stroke="#3b2a00" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

const browser = await puppeteer.launch({executablePath: CHROME, headless: 'new', args: ['--no-sandbox']});
try {
  const page = await browser.newPage();
  await mkdir('public/icons', {recursive: true});
  for (const size of SIZES) {
    await page.setViewport({width: size, height: size, deviceScaleFactor: 1});
    await page.setContent(
      `<!doctype html><meta charset=utf8><style>*{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      {waitUntil: 'load'},
    );
    const png = await page.screenshot({omitBackground: true, clip: {x: 0, y: 0, width: size, height: size}});
    await writeFile(`public/icons/icon-${size}.png`, png);
    console.log(`wrote public/icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
