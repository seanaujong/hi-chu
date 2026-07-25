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

// Everything below is drawn in a 128x128 box, centred on (64, 64).
const BOLT = 'M74 18 L38 70 H58 L52 110 L92 56 H70 Z';
const boltAt = (cx, cy, scale) => `translate(${cx} ${cy}) scale(${scale}) translate(-65 -64)`;

const BODY_W = 88;
const BODY_H = 68;
const ROT = -16; // enough tilt to read as an object, not so much that the readout slides off
const END_INSET = 4; // the twist ends start just inside the body so they never show a seam
const FAN = 1.18; // how far an end fans open, relative to how far it reaches out

/** One pinched, fanned wrapper end, opening away from the body. */
const twistEnd = (x, y, reach, fill) => {
  const s = Math.abs(reach) * FAN;
  return `<path d="M${x} ${y} L${x + reach} ${y - s} L${x + reach * 0.65} ${y} L${x + reach} ${y + s} Z"
                fill="${fill}"/>`;
};

/** The sweet, tilted off-axis so it reads as an object rather than a button. */
const sweet = (contents, reach) => {
  const x0 = 64 - BODY_W / 2;
  return `<g transform="rotate(${ROT} 64 64)">
    ${twistEnd(x0 + END_INSET, 64, -reach, P.deepCheek)}
    ${twistEnd(x0 + BODY_W - END_INSET, 64, reach, P.deepCheek)}
    <rect x="${x0}" y="${64 - BODY_H / 2}" width="${BODY_W}" height="${BODY_H}" rx="22" fill="${P.cheek}"/>
    ${contents}
  </g>`;
};

/**
 * How far the drawing reaches from centre once tilted, measured from its own corner points
 * rather than stored as a constant — so changing the geometry above cannot leave a stale
 * scale behind, which is exactly how the ends came to overhang in the first place.
 */
const halfExtent = (reach) => {
  const r = (ROT * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  const corners = [
    [BODY_W / 2, BODY_H / 2], // the body (its rounded corners sit inside this, so this is safe)
    [BODY_W / 2 - END_INSET + reach, reach * FAN], // a twist tip
  ];
  return Math.max(
    ...corners.flatMap(([x, y]) =>
      [[x, y], [x, -y], [-x, y], [-x, -y]].flatMap(([dx, dy]) => [
        Math.abs(dx * cos - dy * sin),
        Math.abs(dx * sin + dy * cos),
      ]),
    ),
  );
};

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

// The sweet is the whole icon — there is no rounded-square tile behind it. A frame would
// have to be bigger than the widest thing in the drawing, and the twist ends are wider than
// a 128 box once the sweet is tilted, so a tile could only ever crop them or shrink them.
// Without one the silhouette itself is the mark, which is also the more distinctive answer:
// every other extension icon is a rounded square with something inside it.
//
// How far from centre the mark is allowed to reach. A bare toolbar slot can take the full
// box; a platform that applies its own mask needs room inside it.
const REACH_FREE = 63;
const REACH_MASKED = 52;

const placed = (drawing, room) => {
  const scale = (room / halfExtent(drawing.reach)).toFixed(3);
  return `<g transform="translate(64 64) scale(${scale}) translate(-64 -64)">${drawing.svg}</g>`;
};

// Both glyphs share one cap height so they sit on a common baseline, sized so the pair
// clears the window's 72x48 opening with a little air: at h=35 the "?" is ~20 wide and the
// "%" ~35, which is 58 of the 62 usable width.
const GLYPH_H = 35;

// How far the twist ends reach. The small drawing pulls them in: with no tile behind it, a
// stubbier sweet scales up bigger in the same slot, and at 16px a long thin end is a sliver
// nobody can see anyway. The readout sizes keep the full, generous ends.
const REACH_SMALL = 14;
const REACH_FULL = 22;

/** The three drawings, least to most detailed. */
const DRAWINGS = {
  // Toolbar sizes: the silhouette and the bolt, nothing else. A window here is a smudge.
  bolt: {
    reach: REACH_SMALL,
    svg: sweet(`<path d="${BOLT}" fill="${P.pika}" transform="${boltAt(64, 64, 0.62)}"/>`, REACH_SMALL),
  },
  // Mid sizes: the readout appears, but one glyph only — two would not survive the shrink.
  percent: {reach: REACH_FULL, svg: sweet(window_(percent(64, 64, 42, P.pika)), REACH_FULL)},
  // Large: the full readout — a damage percent that is not known yet.
  unknown: {
    reach: REACH_FULL,
    svg: sweet(
      window_(`${question(43.5, 65, GLYPH_H, P.pika)}${percent(74.5, 64, GLYPH_H, P.pika)}`),
      REACH_FULL,
    ),
  },
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
 *
 * `opaque` lays the wrapper paper down as a full-bleed ground and insets the sweet. It is
 * for iOS alone, which forbids an alpha channel in an app icon (transparency is composited
 * onto black) and applies its own corner mask. Everywhere else the icon is transparent.
 */
export const markSvg = (px, {pt = px, opaque = false} = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${px}" height="${px}">` +
  (opaque ? `<rect x="0" y="0" width="128" height="128" fill="${P.paper}"/>` : '') +
  `${placed(DRAWINGS[OPTICAL(pt)], opaque ? REACH_MASKED : REACH_FREE)}</svg>`;

/** Every drawing, for the proof sheet. */
export const ALL_DRAWINGS = DRAWINGS;

/**
 * The lockup: the mark beside the name. Unlike the icon this DOES set type, so it is only
 * ever rendered to a PNG on macOS (where Avenir Next ships) and committed as pixels — it is
 * never shipped as an SVG that would re-render differently elsewhere. Swapping in a properly
 * licensed face means changing this one declaration.
 */
export const LOCKUP_FONT = 'Avenir Next, Helvetica Neue, sans-serif';

/**
 * The name is set in the wrapper's own red, and the colour is fixed rather than an option.
 * That is the whole point: at 3.7:1 on white and 5.1:1 on a near-black page it clears the
 * large-text contrast bar on BOTH, so ONE file serves every ground. The lockup used to ship
 * as a light and a dark variant, which meant any reference to the wrong one — a PR body, a
 * doc, a slide — rendered the name at 1.2:1 and effectively invisible. One file cannot be
 * paired with the wrong background, so it is a stronger guarantee than remembering to.
 */
export const wordmarkSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 128" width="420" height="128">
    <g transform="translate(2 14) scale(0.78)">${placed(DRAWINGS.unknown, REACH_FREE)}</g>
    <text x="118" y="88" font-family="${LOCKUP_FONT}" font-weight="800" font-size="76"
          letter-spacing="-2" fill="${P.cheek}">hi-chu</text>
  </svg>`;
