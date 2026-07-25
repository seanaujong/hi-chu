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
// Read-only and offline (git + the two version files, no network, no gh). It changes no
// version scheme and adds no Chrome Web Store traffic — it only makes the silence stop.
//
//   node scripts/release-status.mjs                 report, always exit 0
//   node scripts/release-status.mjs --fail-after=14 exit 1 once drift is 14+ days stale
//   node scripts/release-status.mjs --json          machine-readable, for CI summaries

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

const failAfter = Number(process.argv.find((a) => a.startsWith('--fail-after='))?.split('=')[1] ?? NaN);
const stale = state === 'unreleased' && Number.isFinite(failAfter) && (daysStale ?? 0) >= failAfter;

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

if (stale) {
  console.error(`\n::error::${commits.length} commits have been unreleased for ${daysStale} days (threshold ${failAfter}).`);
  process.exit(1);
}
