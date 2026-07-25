#!/usr/bin/env node
// Answers one question the release pipeline could never answer for itself: is there
// work on main that nobody has released?
//
// Everything downstream of a version bump is already automatic (auto-tag.yml -> tag ->
// release.yml -> GitHub Release -> Chrome Web Store). The bump itself is manual, and
// that is the whole failure mode: forgetting it produces NO signal at all. This repo sat
// 16 commits past v0.19.3 — the Safari port, the CLAUDE.md restructure, itemreveal,
// drain/recoil — with nothing anywhere saying so. That is an unchecked want; this is the
// predicate that fails.
//
// Read-only, and offline by default (git + the two version files). It changes no version
// scheme and adds no Chrome Web Store traffic — it only makes the silence stop.
//
// A TAG IS NOT A SHIPMENT, which cost this repo a second time: v0.20.1 tagged, published its
// GitHub Release, then failed the Chrome Web Store upload because Google still had v0.20.0 in
// review. Tags were all this script read, so it cheerfully reported `in-sync` while the store
// sat a version behind — the same class of silence it was written to end. `--check-publish`
// closes that hole (see `publishOutcome`); it is the one flag that needs `gh` and the network.
//
//   node scripts/release-status.mjs                  report, always exit 0
//   node scripts/release-status.mjs --check-publish  also verify the last tag actually shipped
//   node scripts/release-status.mjs --fail-after=14  exit 1 once drift is 14+ days stale
//   node scripts/release-status.mjs --json           machine-readable, for CI summaries

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

/** The highest released version tag, by semver order — NOT by date, so an out-of-order
 *  hotfix tag can't be mistaken for the latest release. */
function latestReleaseTag() {
  const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean);
  return tags[0] ?? null;
}

const pkg = read('package.json').version;
const manifest = read('public/manifest.json').version;
const tag = latestReleaseTag();
const released = tag ? tag.replace(/^v/, '') : null;

// Commits on this branch since the last release tag. Squash-merges keep main linear, so
// this count doubles as a stable index into history (commit N is `rev-list --reverse`'s
// Nth entry) — which is why the count alone identifies a build.
const range = tag ? `${tag}..HEAD` : 'HEAD';
const commits = git('log', '--oneline', '--no-merges', range).split('\n').filter(Boolean);
const totalCommits = Number(git('rev-list', '--count', 'HEAD'));
const lastReleaseISO = tag ? git('log', '-1', '--format=%cI', tag) : null;
const daysStale = lastReleaseISO
  ? Math.floor((Date.now() - Date.parse(lastReleaseISO)) / 86_400_000)
  : null;

// Three distinct states, and they want different actions:
//   in-sync    — nothing to do.
//   pending    — the bump already landed but the tag hasn't appeared. auto-tag.yml is
//                mid-flight, or its verify job failed and needs a re-run. NOT a forgotten
//                release, so it never counts as drift.
//   unreleased — commits exist past the last tag and the version still matches it. This
//                is the failure this script exists for.
const versionsAgree = pkg === manifest;
const state = !versionsAgree ? 'mismatch'
  : pkg !== released && commits.length > 0 ? 'pending'
  : commits.length > 0 ? 'unreleased'
  : 'in-sync';

/**
 * Did the release that produced the newest tag actually FINISH?
 *
 * A tag is not a shipment. v0.20.1 tagged, attached its zip to a GitHub Release, and then
 * failed the last step — the Chrome Web Store upload — because Google still had v0.20.0 in
 * review. Everything this script looks at said `in-sync` while the store sat a version
 * behind: the exact failure it exists to prevent, in the one place it could not see.
 *
 * `auto-tag.yml` runs against the merge commit the tag points at, so the run is matched by
 * SHA rather than by time — a re-run or an unrelated push can't be mistaken for it.
 *
 * Opt-in (`--check-publish`) because everything else here is offline and instant; this needs
 * `gh` and the network. `release-drift.yml` always passes it. Any failure to ask (no `gh`, no
 * auth, no network) reports "unknown" rather than a false all-clear.
 */
function publishOutcome(tag) {
  if (!tag) return 'unknown';
  try {
    const sha = execFileSync('git', ['rev-list', '-n1', tag], {encoding: 'utf8'}).trim();
    const runs = JSON.parse(
      execFileSync('gh', ['run', 'list', '--workflow=auto-tag.yml', '--limit', '30', '--json', 'headSha,conclusion,databaseId'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
    const run = runs.find((r) => r.headSha === sha);
    if (!run) return 'unknown';
    return run.conclusion === 'success' ? 'ok' : {state: 'failed', id: run.databaseId};
  } catch {
    return 'unknown'; // no gh, no auth, no network — say so rather than imply success
  }
}

const failAfter = Number(process.argv.find((a) => a.startsWith('--fail-after='))?.split('=')[1] ?? NaN);
const publish = process.argv.includes('--check-publish') ? publishOutcome(tag) : null;
const stale = state === 'unreleased' && Number.isFinite(failAfter) && (daysStale ?? 0) >= failAfter;
const publishBroken = publish !== null && publish !== 'ok' && publish !== 'unknown';

const report = {
  state,
  declaredVersion: pkg,
  manifestVersion: manifest,
  lastReleaseTag: tag,
  unreleasedCommits: commits.length,
  daysSinceLastRelease: daysStale,
  totalCommits,
  suggestedPatch: bump(pkg, 'patch'),
  suggestedMinor: bump(pkg, 'minor'),
  commits,
  stale,
  ...(publish ? {publish} : {}),
};

function bump(version, kind) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const bar = '─'.repeat(64);
  console.log(bar);
  if (state === 'mismatch') {
    console.log(`✗ package.json (${pkg}) and public/manifest.json (${manifest}) disagree.`);
    console.log('  auto-tag.yml refuses to release on this — run: npm run release-bump <version>');
  } else if (state === 'in-sync') {
    console.log(`✓ Released and up to date — ${tag ?? '(no tags yet)'}, nothing unreleased.`);
  } else if (state === 'pending') {
    console.log(`… Release PENDING: version is ${pkg} but ${'v' + pkg} is not tagged yet.`);
    console.log('  auto-tag.yml is either mid-flight or its verify job failed — re-run that job.');
  } else {
    console.log(`⚠ ${commits.length} commit(s) on main are NOT released.`);
    console.log(`  last release ${tag}${daysStale !== null ? ` — ${daysStale} day(s) ago` : ''}`);
    console.log(`  declared version is still ${pkg}, so nothing will publish.`);
  }
  if (publish && publish !== 'ok') {
    console.log(bar);
    if (publish === 'unknown') {
      console.log(`? could not check whether ${tag} finished publishing (no gh / auth / network).`);
    } else {
      console.log(`✗ ${tag} is TAGGED but its release run FAILED — it may not have reached the store.`);
      console.log(`  gh run view ${publish.id} --log-failed`);
      console.log('  Re-running auto-tag.yml does NOT help: the tag exists, so detect no-ops.');
    }
  } else if (publish === 'ok') {
    console.log(`✓ ${tag}'s release run completed, store publish included.`);
  }
  if (commits.length) {
    console.log(bar);
    for (const c of commits.slice(0, 20)) console.log(`  ${c}`);
    if (commits.length > 20) console.log(`  … and ${commits.length - 20} more`);
    console.log(bar);
    console.log(`  npm run release-bump patch   → ${report.suggestedPatch}`);
    console.log(`  npm run release-bump minor   → ${report.suggestedMinor}`);
  }
  console.log(bar);
}

if (publishBroken) {
  console.error(`\n::error::${tag} is tagged but its release run failed — check the Chrome Web Store publish.`);
  process.exit(1);
}
if (stale) {
  console.error(`\n::error::${commits.length} commits have been unreleased for ${daysStale} days (threshold ${failAfter}).`);
  process.exit(1);
}
