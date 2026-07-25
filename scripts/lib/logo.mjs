// The hi-chu mark, as pure SVG strings. No I/O and no browser — `make-icons.mjs` is the
// only thing that turns these into files, so the drawing can be unit-eyeballed on its own.
//
// The mark is a wrapped sweet (hi-chew) whose window is a damage readout (the calculator),
// in Pikachu's own colours. "?%" is the product in two characters: a damage percent that
// isn't known yet, which is exactly what the set-inference layer trades in.
//
// It is drawn at THREE levels of detail, not scaled from one. A 16px toolbar slot cannot
// hold a readout and a 128px store tile shouldn't waste the room, so `markSvg` picks the
// drawing that the requested pixel size can actually deliver — the same reason a typeface
// has optical sizes. `OPTICAL` below is that rule.
//
// The "%" and "?" are built from geometry rather than set as text on purpose: a shipped
// icon must not depend on a font being installed on whoever's machine renders it, and
// hand-drawing lets the stroke weight be tuned for icon sizes instead of text sizes.

export const PALETTE = {
  pika: '#FFCB05', // Pikachu yellow — the readout, the charge
  fold: '#EFA80B', // the same yellow a step down, for wrapper ends and creases
  cheek: '#EE4B3C', // Pikachu's cheek — the wrapper itself
  deepCheek: '#C4392B', // twist ends, in shadow
  paper: '#FFF3D6', // wrapper paper — the tile ground
  ink: '#2A2118', // Pikachu's ear tips — the readout window. Never pure black.
};

const P = PALETTE;

// Everything below is drawn in a 128x128 box.
const BOLT = 'M74 18 L38 70 H58 L52 110 L92 56 H70 Z';
const boltAt = (cx, cy, scale) => `translate(${cx} ${cy}) scale(${scale}) translate(-65 -64)`;

/** One pinched, fanned wrapper end, opening away from the body. */
const twistEnd = (x, y, reach, fill) =>
  `<path d="M${x} ${y} L${x + reach} ${y - 26} L${x + reach * 0.65} ${y} L${x + reach} ${y + 26} Z" fill="${fill}"/>`;

/** The sweet, tilted off-axis so it reads as an object rather than a button. */
const sweet = (contents) => `<g transform="rotate(-16 64 64)">
    ${twistEnd(24, 64, -22, P.deepCheek)}
    ${twistEnd(104, 64, 22, P.deepCheek)}
    <rect x="20" y="30" width="88" height="68" rx="22" fill="${P.cheek}"/>
    ${contents}
  </g>`;

const window_ = (glyphs) => `<rect x="28" y="40" width="72" height="48" rx="14" fill="${P.ink}"/>${glyphs}`;

/**
 * A percent sign as two rings and a bar, sized by cap height `h` and centred on (cx, cy).
 * Proportions follow a bold grotesque: rings 0.44h across, bar corner to corner. Both its
 * width and its height come out at 1.0h — the rings reach 0.5h from the centre either way.
 */
const percent = (cx, cy, h, fill) => {
  const ring = (dx, dy) =>
    `<circle cx="${(cx + dx * h).toFixed(2)}" cy="${(cy + dy * h).toFixed(2)}" r="${(0.15 * h).toFixed(2)}"
             fill="none" stroke="${fill}" stroke-width="${(0.14 * h).toFixed(2)}"/>`;
  return `${ring(-0.28, -0.28)}${ring(0.28, 0.28)}
    <path d="M${(cx - 0.24 * h).toFixed(2)} ${(cy + 0.43 * h).toFixed(2)}
             L${(cx + 0.24 * h).toFixed(2)} ${(cy - 0.43 * h).toFixed(2)}"
          stroke="${fill}" stroke-width="${(0.13 * h).toFixed(2)}" stroke-linecap="round" fill="none"/>`;
};

/**
 * A question mark as a stroked bowl turning into a stem, plus its dot. `h` is the full
 * height from the top of the bowl to the bottom of the dot.
 */
const question = (cx, cy, h, fill) => {
  const w = (0.155 * h).toFixed(2);
  const r = 0.215 * h;
  const bowlY = cy - 0.26 * h;
  return `<path d="M${(cx - r).toFixed(2)} ${(bowlY - 0.02 * h).toFixed(2)}
             A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 ${(cx + 0.1 * h).toFixed(2)} ${(bowlY + r).toFixed(2)}
             L${cx.toFixed(2)} ${(cy + 0.14 * h).toFixed(2)}"
          fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${cx.toFixed(2)}" cy="${(cy + 0.42 * h).toFixed(2)}" r="${(0.085 * h).toFixed(2)}" fill="${fill}"/>`;
};

const tile = (bleed) =>
  bleed
    ? `<rect x="0" y="0" width="128" height="128" fill="${P.paper}"/>`
    : `<rect x="2" y="2" width="124" height="124" rx="27" fill="${P.paper}"/>`;

// Both glyphs share one cap height so they sit on a common baseline, sized so the pair
// clears the window's 72x48 opening with a little air: at h=35 the "?" is ~20 wide and the
// "%" ~35, which is 58 of the 62 usable width.
const GLYPH_H = 35;

/** The three drawings, least to most detailed. */
const DRAWINGS = {
  // Toolbar sizes: the silhouette and the bolt, nothing else. A window here is a smudge.
  bolt: sweet(`<path d="${BOLT}" fill="${P.pika}" transform="${boltAt(66, 64, 0.62)}"/>`),
  // Mid sizes: the readout appears, but one glyph only — two would not survive the shrink.
  percent: sweet(window_(percent(64, 64, 42, P.pika))),
  // Large: the full readout — a damage percent that is not known yet.
  unknown: sweet(
    window_(`${question(43.5, 65, GLYPH_H, P.pika)}${percent(74.5, 64, GLYPH_H, P.pika)}`),
  ),
};

/**
 * Which drawing a size gets, keyed on POINTS — how big the icon appears — not on pixels.
 * The distinction is load-bearing for Safari's catalogue, where mac-icon-16@2x is 32 pixels
 * of a 16-point icon: it is displayed as small as the 1x file and needs the same drawing,
 * just at twice the resolution. Keying on pixels would hand it a readout nobody can read.
 *
 * The thresholds are where each element stops being legible, found by rendering and
 * looking — `node scripts/make-icons.mjs --proof` is how to re-check them.
 */
export const OPTICAL = (pt) => (pt < 40 ? 'bolt' : pt < 96 ? 'percent' : 'unknown');

/**
 * The mark as a standalone SVG document: `px` pixels across, carrying the detail that `pt`
 * points can actually deliver. They differ only for retina assets, so `pt` defaults to `px`.
 */
export const markSvg = (px, {pt = px, bleed = false} = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${px}" height="${px}">` +
  `${tile(bleed)}${DRAWINGS[OPTICAL(pt)]}</svg>`;

/** Every drawing, for the proof sheet. */
export const ALL_DRAWINGS = DRAWINGS;

/**
 * The lockup: the mark beside the name. Unlike the icon this DOES set type, so it is only
 * ever rendered to a PNG on macOS (where Avenir Next ships) and committed as pixels — it is
 * never shipped as an SVG that would re-render differently elsewhere. Swapping in a properly
 * licensed face means changing this one declaration.
 */
export const LOCKUP_FONT = 'Avenir Next, Helvetica Neue, sans-serif';

export const wordmarkSvg = ({color = P.ink} = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 128" width="420" height="128">
    <g transform="translate(4 12) scale(0.8)">${tile(false)}${DRAWINGS.unknown}</g>
    <text x="130" y="88" font-family="${LOCKUP_FONT}" font-weight="800" font-size="76"
          letter-spacing="-2" fill="${color}">hi-chu</text>
  </svg>`;
