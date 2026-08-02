// Which commit a release is measured on, shared by release-status.mjs and release-notes.mjs.
//
// Both answer questions about a release — what is unreleased, and what changed — and a
// release only ever ships what is on main: `auto-tag.yml` triggers on a push to main and
// tags that exact commit. So the range is a fact about MAIN, not about whichever branch
// happens to be checked out. Reading `HEAD` instead let `release-status` count an unmerged
// feature branch's own commits while still printing "commit(s) on main are NOT released" —
// a run from a branch reported 13 when main had 11, and the sentence was wrong rather than
// merely imprecise.
//
// DEFAULTING to main is not the same as REQUIRING its tip, and on a busy repository those
// come apart: main moves while you bump, open the PR, run visual-check and merge, so the tip
// at the end is not the commit you decided to ship. Hence `--ref=<commitish>` — name any
// commit and it is measured instead, provided it is a descendant of the last release tag
// (`releaseRefProblem`). Every report prints the resolved SHA alongside the ref name, so a
// moving branch can never leave you unsure which commit the numbers describe.
//
// The two scripts have to agree about this range or they describe different releases: the
// notes would illustrate a set of commits the status report never counted. That agreement
// was a comment asking the next reader to keep two copies of `latestReleaseTag` identical.
// A comment is a wish; this module is the thing that cannot drift.

import {execFileSync} from 'node:child_process';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();

/**
 * Candidate refs for the branch a release ships from, best first.
 *
 * `origin/main` leads because it is what the remote will actually tag. A local `main` is
 * stale in exactly the direction that UNDER-reports — it lags the remote until someone
 * pulls, hiding unreleased work, which is the one failure this tooling exists to prevent.
 * Local `main` still earns second place for a checkout with no remote, and `HEAD` is the
 * last resort so a detached CI checkout answers instead of throwing.
 */
export const RELEASE_REFS = ['origin/main', 'main'];

/**
 * The ref to measure on: an explicit request always wins, else the first candidate that
 * exists, else `HEAD`.
 *
 * Pure — `resolves` is the only I/O and it is injected, so the order of preference, the
 * override and the fallback are all testable without a repository to stage.
 */
export function pickReleaseRef(resolves, {requested, candidates = RELEASE_REFS} = {}) {
  if (requested) return requested;
  return candidates.find((ref) => resolves(ref)) ?? 'HEAD';
}

/**
 * Why `ref` cannot be measured, phrased so the reader knows what to do about it — or null
 * when it is fine. Pure: the caller supplies what git said.
 *
 * The ancestry rule is the substantive one. A commit that does not CONTAIN the last release
 * tag sits on a line of history where that release never happened, so the range `tag..ref`
 * silently omits everything the two lines don't share — you would ship a build believing it
 * included the last release when it does not. Refusing is the only honest answer; a warning
 * would be read past.
 */
export function releaseRefProblem({ref, requested = false, exists, tag, containsTag, tagLabel = 'the last release'}) {
  const how = requested ? `--ref=${ref}` : ref;
  if (!exists) {
    return requested
      ? `${how} does not name a commit in this repository. Pass a branch, tag or SHA that exists here.`
      : `${how} does not name a commit in this repository.`;
  }
  if (tag && !containsTag) {
    return (
      `${how} is not ahead of ${tagLabel} ${tag} — it does not contain that tag, ` +
      `so its history is missing commits ${tag} already shipped. ` +
      `Pick a commit descended from ${tag}.`
    );
  }
  return null;
}

/** Whether `ref` names a commit in this repository. */
export function refExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

/** Whether `ancestor` is reachable from `descendant` — git's own answer, exit code and all. */
export function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

/** The highest released version tag, by semver order — NOT by date, so an out-of-order
 *  hotfix tag can't be mistaken for the latest release. */
export function latestReleaseTag() {
  const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean);
  return tags[0] ?? null;
}

/**
 * The commit a release is measured on: `{ref, sha, requested, problem}`. `problem` is a
 * ready-to-print sentence when the ref is unusable, and null otherwise — returned rather
 * than thrown, because both callers are reporting tools that want to print and exit rather
 * than unwind a stack.
 */
export function resolveReleaseRef(requested, tag = latestReleaseTag(), tagLabel = 'the last release') {
  const ref = pickReleaseRef(refExists, {requested});
  const exists = refExists(ref);
  const containsTag = exists && tag ? isAncestor(tag, ref) : true;
  const problem = releaseRefProblem({ref, requested: Boolean(requested), exists, tag, containsTag, tagLabel});
  return {
    ref,
    sha: exists ? git('rev-parse', '--short', ref) : null,
    requested: Boolean(requested),
    problem,
  };
}

/** True when `ref` is a different commit than the working checkout — the case where a report
 *  about main would otherwise be read as a report about the branch you are standing on. */
export function differsFromCheckout(ref) {
  try {
    return git('rev-parse', ref) !== git('rev-parse', 'HEAD');
  } catch {
    return false;
  }
}

/** The checkout's own branch name, for saying which branch is NOT being measured.
 *  `HEAD` for a detached checkout, which is what CI gives you. */
export function currentBranch() {
  try {
    return git('rev-parse', '--abbrev-ref', 'HEAD');
  } catch {
    return 'HEAD';
  }
}
