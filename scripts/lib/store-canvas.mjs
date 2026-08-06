// The Chrome Web Store's screenshot frame: 1280×800, exactly, or the upload is rejected.
//
// That constraint is the whole reason this module exists. A tooltip is a tall narrow
// rectangle and a battle room is roughly square, so neither IS 1280×800 and neither ever
// will be — a screenshot sized to the thing it photographs cannot also be sized to the
// frame the store demands. So the shot is composed ONTO a canvas rather than cropped to
// one: brand background, a one-line caption saying what the reader is looking at, and the
// shot itself centred and scaled to fit.
//
// It stays pure — an HTML string in, no I/O — because the composing is done by rendering
// this page in a browser we already have open and photographing it, and a string is the
// only part of that worth testing or reading. `pngSize` reads the result back so the
// caller can fail loudly rather than discover the wrong dimensions at upload time.

/** The store's required frame. Not a preference — 1280×800 or 640×400 are the only sizes it takes. */
export const STORE_CANVAS = {width: 1280, height: 800};

/**
 * The mark's palette (`scripts/lib/logo.mjs`), so the four shots read as one set and as
 * hi-chu's. The caption is the DEEP cheek rather than the wrapper's own red: on this cream
 * it clears the large-text contrast bar (4.9:1) where the brighter red only just does.
 */
const PAPER = '#FFF3D6';
const DEEP_CHEEK = '#C4392B';

/**
 * A store-frame page holding one shot.
 *
 * `png` is the raw screenshot bytes and `css` the size of what was photographed in CSS
 * pixels — the two are NOT the same number, because every shot is taken at a device scale
 * factor above 1 so it survives being scaled down here. Carrying the CSS size is what lets
 * `maxZoom` mean something a reader would recognise ("at most three times life size")
 * rather than a ratio of one screenshot's pixels to another's.
 *
 * The fitting itself is left to CSS: `width` asks for the largest size we would ever want,
 * and the two `max-*: 100%` rules shrink it — proportionally, since the height is auto —
 * until it fits the stage. No arithmetic here means no arithmetic to get wrong.
 */
export function canvasHtml({png, css, caption, maxZoom = 3}) {
  const {width, height} = STORE_CANVAS;
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${width}px; height: ${height}px; background: ${PAPER};
    display: flex; flex-direction: column; align-items: center;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .caption {
    flex: none; box-sizing: border-box; width: 100%;
    padding: 26px 40px 20px; text-align: center;
    font-size: 34px; font-weight: 600; letter-spacing: -0.2px;
    color: ${DEEP_CHEEK};
  }
  /* The stage is what the shot is fitted INTO; it takes whatever the caption left. */
  .stage {
    flex: 1; min-height: 0; box-sizing: border-box;
    width: 100%; padding: 0 40px 34px;
    display: flex; align-items: center; justify-content: center;
  }
  .shot {
    display: block; width: ${Math.round(css.width * maxZoom)}px; height: auto;
    max-width: 100%; max-height: 100%;
    border-radius: 6px; border: 1px solid rgba(42, 33, 24, 0.18);
    box-shadow: 0 10px 30px rgba(42, 33, 24, 0.22);
  }
</style>
<div class="caption">${escapeHtml(caption)}</div>
<div class="stage"><img class="shot" src="data:image/png;base64,${png.toString('base64')}"></div>`;
}

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);

/**
 * A PNG's dimensions, straight from its header — the store's one hard requirement, checked
 * without taking on an image library for it. Every PNG opens with an 8-byte signature and
 * then an IHDR chunk whose first two fields are width and height as big-endian uint32s, so
 * they sit at a fixed offset in every file that is a PNG at all.
 */
export function pngSize(buffer) {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}
