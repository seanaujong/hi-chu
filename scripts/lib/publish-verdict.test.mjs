// Every route a release can finish by, and every way the evidence can be missing, as data.

import {describe, it, expect} from 'vitest';
import {publishVerdict} from './publish-verdict.mjs';

const TAG = 'v0.22.0';
const TAG_SHA = '19bb7264';
const MAIN_SHA = 'e3b81af6';

const run = (over) => ({
  headSha: MAIN_SHA,
  conclusion: 'success',
  databaseId: 1,
  displayTitle: 'Release',
  createdAt: '2026-08-02T03:00:00Z',
  ...over,
});
const verdict = (over) => publishVerdict({tag: TAG, tagSha: TAG_SHA, ...over});

describe('the ordinary route — auto-tag calls release as a workflow_call', () => {
  // A reusable workflow is a job inside the caller's run, so it never shows up in
  // release.yml's own run list. The auto-tag run, at the tag's commit, is the only evidence.
  it('is ok when the auto-tag run at the tag succeeded', () => {
    expect(verdict({autoTagRuns: [run({headSha: TAG_SHA})]})).toEqual({state: 'ok'});
  });

  it('is failed when it did not, naming the run to look at', () => {
    expect(verdict({autoTagRuns: [run({headSha: TAG_SHA, conclusion: 'failure', databaseId: 77})]}))
      .toEqual({state: 'failed', id: 77});
  });

  it('ignores an auto-tag run for a DIFFERENT commit', () => {
    expect(verdict({autoTagRuns: [run({headSha: 'deadbeef', conclusion: 'failure'})]})).toEqual({state: 'unknown'});
  });

  it('is unknown while that run is still going', () => {
    expect(verdict({autoTagRuns: [run({headSha: TAG_SHA, conclusion: null})]})).toEqual({state: 'unknown'});
  });
});

describe('a pushed tag — release.yml runs on the tag commit itself', () => {
  it('is ok when that run succeeded', () => {
    expect(verdict({releaseRuns: [run({headSha: TAG_SHA})]})).toEqual({state: 'ok'});
  });
});

describe('the dispatch recovery — the case with no commit-shaped evidence', () => {
  // A dispatch runs against the DEFAULT BRANCH with the tag as an input, so its head commit is
  // main's and says nothing about which tag it released. `run-name: Release <tag>` is the join
  // key that makes it decidable at all.
  it('is ok when a run TITLED for this tag succeeded, though its head is main', () => {
    expect(verdict({
      autoTagRuns: [run({headSha: TAG_SHA, conclusion: 'failure', databaseId: 77})],
      releaseRuns: [run({displayTitle: `Release ${TAG}`, databaseId: 88, createdAt: '2026-08-02T03:30:00Z'})],
    })).toEqual({state: 'ok'});
  });

  it('is failed when the titled run itself failed', () => {
    expect(verdict({releaseRuns: [run({displayTitle: `Release ${TAG}`, conclusion: 'failure', databaseId: 88})]}))
      .toEqual({state: 'failed', id: 88});
  });

  it('does not credit a titled run for a DIFFERENT tag', () => {
    expect(verdict({releaseRuns: [run({displayTitle: 'Release v0.21.0'})]})).toEqual({state: 'unknown'});
  });

  it('prefers a titled success over an untitled failure, whatever the order', () => {
    expect(verdict({
      releaseRuns: [
        run({displayTitle: `Release ${TAG}`, conclusion: 'failure', databaseId: 88, createdAt: '2026-08-02T03:10:00Z'}),
        run({displayTitle: `Release ${TAG}`, conclusion: 'success', databaseId: 99, createdAt: '2026-08-02T03:30:00Z'}),
      ],
    })).toEqual({state: 'ok'});
  });
});

describe('a recovery that predates run naming', () => {
  // v0.22.0 exactly: auto-tag failed, a later dispatch fixed it, and that dispatch has no title
  // naming the tag because the naming did not exist yet. Reporting "failed" would leave main
  // permanently red for a release that shipped; claiming "ok" would invent evidence.
  const autoTag = run({headSha: TAG_SHA, conclusion: 'failure', databaseId: 77, createdAt: '2026-08-02T02:59:00Z'});

  it('reports retried, not failed, when a later release run succeeded', () => {
    expect(verdict({
      autoTagRuns: [autoTag],
      releaseRuns: [run({databaseId: 88, createdAt: '2026-08-02T03:30:00Z'})],
    })).toEqual({state: 'retried', id: 88});
  });

  it('stays failed when the only later run failed too', () => {
    expect(verdict({
      autoTagRuns: [autoTag],
      releaseRuns: [run({conclusion: 'failure', databaseId: 88, createdAt: '2026-08-02T03:30:00Z'})],
    })).toEqual({state: 'failed', id: 77});
  });

  it('stays failed when the successful run came BEFORE the failure', () => {
    expect(verdict({
      autoTagRuns: [autoTag],
      releaseRuns: [run({databaseId: 88, createdAt: '2026-08-02T02:00:00Z'})],
    })).toEqual({state: 'failed', id: 77});
  });
});

describe('no evidence at all', () => {
  it('is unknown rather than either verdict', () => {
    expect(verdict({})).toEqual({state: 'unknown'});
  });
});
