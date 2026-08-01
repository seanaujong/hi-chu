// The pure core of release-notes.mjs: subjects + assets → markdown. Everything here runs
// against plain data — the script's git and `gh` reads stay in `main()`, which is what makes
// this testable at all.

import {describe, it, expect} from 'vitest';
import {assetsByPr, composeNotes, parseSubject} from './release-notes.mjs';

/** A release asset as `gh release view --json assets` returns it. */
const asset = (name) => ({name, url: `https://example.test/${name}`});

describe('parseSubject', () => {
  it('splits the squash-merge PR number off a commit subject', () => {
    expect(parseSubject('Rule out a Choice item (#65)')).toEqual({number: 65, title: 'Rule out a Choice item'});
  });

  it('keeps a subject with no PR number rather than dropping the change', () => {
    expect(parseSubject('A local commit')).toEqual({number: null, title: 'A local commit'});
  });
});

describe('assetsByPr', () => {
  it('groups by the PR number in the filename', () => {
    const byPr = assetsByPr([asset('pr-66-air-balloon.png'), asset('pr-71-super-fang.png')]);
    expect([...byPr.keys()].sort()).toEqual([66, 71]);
  });

  it('ignores anything that is not a pr-<NN>- asset', () => {
    expect(assetsByPr([asset('Source code (zip)'), asset('demo.png'), asset('pr-abc-x.png')]).size).toBe(0);
  });

  // The rule this file exists for. A before shot depicts the state its PR REPLACED — in
  // #71's case a photograph of the bug being fixed — so it must never reach a changelog.
  it('drops the -before half of a before/after pair, keeping the shipped state', () => {
    const byPr = assetsByPr([asset('pr-71-super-fang-before.png'), asset('pr-71-super-fang-after.png')]);
    expect(byPr.get(71).map((a) => a.name)).toEqual(['pr-71-super-fang-after.png']);
  });

  it('counts a PR with ONLY a before shot as un-illustrated — no picture of what shipped', () => {
    expect(assetsByPr([asset('pr-71-super-fang-before.png')]).has(71)).toBe(false);
  });

  it('matches -before only at the end of the name, so a stray "before" is safe', () => {
    const byPr = assetsByPr([asset('pr-99-before-and-after.png'), asset('pr-99-beforehand.png')]);
    expect(byPr.get(99).map((a) => a.name)).toEqual(['pr-99-before-and-after.png', 'pr-99-beforehand.png']);
  });

  it('keeps two assets that show genuinely different surfaces', () => {
    // Not every pair is a before/after — one PR can touch the move tooltip AND the switch
    // menu, and both deserve to show.
    const byPr = assetsByPr([asset('pr-66-move-tooltip.png'), asset('pr-66-switch-menu.png')]);
    expect(byPr.get(66)).toHaveLength(2);
  });
});

describe('composeNotes', () => {
  const subjects = ['Compute damage for moves that have no base power (#71)', 'Bump a dependency (#70)'];

  it('leads with illustrated changes and lists the rest', () => {
    const byPr = assetsByPr([asset('pr-71-super-fang-after.png')]);
    const md = composeNotes(subjects, byPr);
    expect(md).toContain("## What's new");
    expect(md).toContain('### Compute damage for moves that have no base power (#71)');
    expect(md).toContain('![Compute damage for moves that have no base power](https://example.test/pr-71-super-fang-after.png)');
    expect(md).toContain('## Also in this release');
    expect(md).toContain('- Bump a dependency (#70)');
  });

  it('never renders a before shot, even when the PR uploaded one', () => {
    // The regression #71 actually shipped: both halves rendered, "after" first because the
    // asset list is alphabetical, so the notes showed the fixed tooltip and then the bug.
    const byPr = assetsByPr([asset('pr-71-super-fang-after.png'), asset('pr-71-super-fang-before.png')]);
    const md = composeNotes(subjects, byPr);
    expect(md).toContain('pr-71-super-fang-after.png');
    expect(md).not.toContain('before');
  });

  it('is all plain list when nothing is illustrated — no empty "What\'s new"', () => {
    const md = composeNotes(subjects, assetsByPr([]));
    expect(md).not.toContain("What's new");
    expect(md).toContain('- Compute damage for moves that have no base power (#71)');
  });
});
