import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';

/**
 * The store listing's one-line summary is written in three files, and the one that
 * actually reaches the Chrome Web Store is the least obvious: `public/manifest.json`'s
 * `description` is what the uploaded zip carries, and the listing shows whatever the
 * last upload said — so a summary fixed in the dashboard alone survives only until the
 * next release overwrites it. `docs/chrome-web-store-listing.md` holds the copy a human
 * edits, `package.json`'s `description` the npm-facing third copy.
 *
 * Nothing held them together, so the shipped summary sat a rewrite behind the doc's for
 * several releases with every check green. This is that predicate: the doc's Summary
 * block is the source, and the other two repeat it exactly.
 */
const LISTING = 'docs/chrome-web-store-listing.md';
const MANIFEST = 'public/manifest.json';
const PKG = 'package.json';

/** Chrome's own ceiling on a manifest `description`, enforced at upload — after a tag exists. */
const MANIFEST_DESCRIPTION_LIMIT = 132;

const SUMMARY_HEADING = '**Summary**';

/** The single line inside the first fenced block under the listing's Summary heading. */
function summaryOfRecord(listing: string): string {
  const heading = listing.indexOf(SUMMARY_HEADING);
  if (heading < 0) throw new Error(`${LISTING} has no ${SUMMARY_HEADING} heading`);
  const block = /```\n(.+)\n```/.exec(listing.slice(heading));
  if (!block?.[1]) throw new Error(`${LISTING} has no fenced summary block under ${SUMMARY_HEADING}`);
  return block[1];
}

function description(path: string): string | undefined {
  return (JSON.parse(readFileSync(path, 'utf8')) as {description?: string}).description;
}

describe('the store summary is one sentence, written once', () => {
  const summary = summaryOfRecord(readFileSync(LISTING, 'utf8'));

  it('is what the packaged manifest ships, since that is what the store reads', () => {
    expect(description(MANIFEST)).toBe(summary);
  });

  it('is what package.json repeats', () => {
    expect(description(PKG)).toBe(summary);
  });

  it('fits the manifest description limit', () => {
    expect(summary.length).toBeLessThanOrEqual(MANIFEST_DESCRIPTION_LIMIT);
  });
});
