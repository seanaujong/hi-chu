// The pure half of release-range.mjs: which ref a release is measured on, and why a ref
// might be unusable. Both take their git reads as arguments, so every case below — a missing
// remote, a detached checkout, a commit off on its own line of history — is stated as data
// rather than staged as a repository.

import {describe, it, expect} from 'vitest';
import {RELEASE_REFS, defaultSince, pickReleaseRef, releaseRefProblem, tagBefore} from './release-range.mjs';

/** A `resolves` probe that knows about exactly these refs. */
const knows = (...refs) => (ref) => refs.includes(ref);

describe('pickReleaseRef', () => {
  it('prefers origin/main — what the remote will actually tag', () => {
    expect(pickReleaseRef(knows('origin/main', 'main'))).toBe('origin/main');
  });

  it('falls back to local main when there is no remote', () => {
    // A local `main` lags the remote until someone pulls, which HIDES unreleased work — so
    // it is second choice, never first.
    expect(pickReleaseRef(knows('main'))).toBe('main');
  });

  it('falls back to HEAD when neither exists, so a detached CI checkout still answers', () => {
    expect(pickReleaseRef(knows())).toBe('HEAD');
  });

  it('lets an explicit request win over every candidate', () => {
    expect(pickReleaseRef(knows('origin/main', 'main'), {requested: 'v0.21.0'})).toBe('v0.21.0');
    expect(pickReleaseRef(knows('origin/main'), {requested: 'abc1234'})).toBe('abc1234');
  });

  it('checks candidates in the documented order', () => {
    const asked = [];
    pickReleaseRef((ref) => {
      asked.push(ref);
      return false;
    });
    expect(asked).toEqual([...RELEASE_REFS]);
  });
});

describe('releaseRefProblem', () => {
  const ok = {ref: 'origin/main', exists: true, tag: 'v0.21.0', containsTag: true};

  it('passes a ref that exists and descends from the last release', () => {
    expect(releaseRefProblem(ok)).toBeNull();
  });

  it('passes when there are no release tags at all yet', () => {
    expect(releaseRefProblem({ref: 'main', exists: true, tag: null, containsTag: true})).toBeNull();
  });

  it('refuses a ref that does not exist, and says what to pass instead', () => {
    const msg = releaseRefProblem({...ok, exists: false, requested: true, ref: 'nope'});
    expect(msg).toContain('--ref=nope');
    expect(msg).toContain('does not name a commit');
    expect(msg).toMatch(/branch, tag or SHA/);
  });

  // The substantive rule. A commit that doesn't contain the last tag sits on a line of
  // history where that release never happened, so `tag..ref` silently omits whatever the two
  // lines don't share — you would ship believing the last release was included.
  it('refuses a commit that is not ahead of the last release, naming the tag', () => {
    const msg = releaseRefProblem({...ok, requested: true, ref: 'old-branch', containsTag: false});
    expect(msg).toContain('--ref=old-branch');
    expect(msg).toContain('not ahead of the last release v0.21.0');
    expect(msg).toContain('descended from v0.21.0');
  });

  it('phrases the same refusal without --ref when the ref was chosen for you', () => {
    const msg = releaseRefProblem({...ok, containsTag: false});
    expect(msg).toContain('origin/main is not ahead');
    expect(msg).not.toContain('--ref');
  });

  it('reports a missing ref before an ancestry verdict it could not have computed', () => {
    const msg = releaseRefProblem({...ok, exists: false, containsTag: false});
    expect(msg).toContain('does not name a commit');
    expect(msg).not.toContain('not ahead');
  });
});

describe('the tag label', () => {
  // `release-notes --since=X` validates against X, which is a range start rather than the
  // last release — calling it "the last release" there would name it wrongly.
  it('names what the tag IS in this call, so a range start is not called a release', () => {
    const args = {ref: 'old', requested: true, exists: true, tag: 'v0.20.0', containsTag: false};
    expect(releaseRefProblem({...args, tagLabel: 'the range start'})).toContain('not ahead of the range start v0.20.0');
    expect(releaseRefProblem(args)).toContain('not ahead of the last release v0.20.0');
  });
});

describe('tagBefore', () => {
  const tags = ['v0.22.0', 'v0.21.0', 'v0.20.1', 'v0.20.0'];

  it('is the release immediately below the one named', () => {
    expect(tagBefore(tags, 'v0.22.0')).toBe('v0.21.0');
    expect(tagBefore(tags, 'v0.20.1')).toBe('v0.20.0');
  });

  it('is null at the very first release — nothing came before it', () => {
    expect(tagBefore(tags, 'v0.20.0')).toBeNull();
    expect(tagBefore([], 'v0.1.0')).toBeNull();
  });

  it('falls back to the highest tag for something that is not a release tag', () => {
    expect(tagBefore(tags, 'abc1234')).toBe('v0.22.0');
  });
});

describe('defaultSince', () => {
  const tags = ['v0.22.0', 'v0.21.0', 'v0.20.1'];

  // The trap this exists for. `release.yml` runs AFTER auto-tag has created v0.22.0, so the
  // highest tag is the release being described — defaulting to it would ask for the range
  // v0.22.0..v0.22.0 and publish empty notes for a release full of changes, with nothing
  // anywhere looking broken.
  it('starts at the PREVIOUS tag when the range ends at a release tag', () => {
    expect(defaultSince('v0.22.0', tags)).toBe('v0.21.0');
  });

  it('starts at the latest tag when the range ends somewhere that is not a release', () => {
    expect(defaultSince('origin/main', tags)).toBe('v0.22.0');
    expect(defaultSince('abc1234', tags)).toBe('v0.22.0');
  });

  it('starts at the latest tag when no end was named at all', () => {
    expect(defaultSince(undefined, tags)).toBe('v0.22.0');
  });

  it('is null before the first release, so the range runs from the first commit', () => {
    expect(defaultSince(undefined, [])).toBeNull();
  });
});
