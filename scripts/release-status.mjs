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
// Measured on main, never on your checkout — see lib/release-range.mjs — so it answers the
// same way from any branch, and `--ref=` names a different commit when main's tip is not the
// one you mean to ship.
//
//   node scripts/release-status.mjs                  report, always exit 0
//   node scripts/release-status.mjs --ref=<commitish> measure a specific commit instead of main
//   node scripts/release-status.mjs --check-publish  also verify the last tag actually shipped
//   node scripts/release-status.mjs --fail-after=14  exit 1 once drift is 14+ days stale
//   node scripts/release-status.mjs --json           machine-readable, for CI summaries

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {currentBranch, differsFromCheckout, latestReleaseTag, resolveReleaseRef, showAtRef} from './lib/release-range.mjs';
import {publishVerdict} from './lib/publish-verdict.mjs';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const tag = latestReleaseTag();
const released = tag ? tag.replace(/^v/, '') : null;

// Commits on the RELEASE ref since the last release tag — main by default, not this
// checkout, because a release only ever ships what main has; `--ref=` overrides it when the
// commit you mean to ship is not main's current tip (see lib/release-range.mjs). Squash-
// merges keep main linear, so this count doubles as a stable index into history (commit N is
// `rev-list --reverse`'s Nth entry) — which is why the count alone identifies a build.
const {ref, sha, requested, problem} = resolveReleaseRef(flag('ref'), tag);
if (problem) {
  console.error(`✗ ${problem}`);
  process.exit(1);
}

// The declared version is read at the SAME commit the commits are counted on. Reading it off
// disk instead described two states at once: a bump sitting uncommitted in a working tree
// made this announce "Release PENDING — auto-tag.yml is either mid-flight or its verify job
// failed", advice for a release that had not started, because the version came from the disk
// while the commits came from main. To inspect your own bump, point the whole report at it
// with `--ref=HEAD`. The working-tree fallback covers a ref that carries no such file at all,
// and says so rather than quietly mixing sources again.
const fellBack = [];
const versionAt = (path) => {
  const blob = showAtRef(ref, path);
  if (blob !== null) return JSON.parse(blob).version;
  fellBack.push(path);
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).version;
};
const pkg = versionAt('package.json');
const manifest = versionAt('public/manifest.json');
const range = tag ? `${tag}..${ref}` : ref;
const commits = git('log', '--oneline', '--no-merges', range).split('\n').filter(Boolean);
const totalCommits = Number(git('rev-list', '--count', ref));
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
 * A release can finish by more than one route and each leaves different evidence, so deciding
 * this is its own law — `lib/publish-verdict.mjs`, which takes all of it as data. This
 * function only gathers: the tag's commit, and both workflows' recent runs.
 *
 * Opt-in (`--check-publish`) because everything else here is offline and instant; this needs
 * `gh` and the network. `release-drift.yml` always passes it. Any failure to ask (no `gh`, no
 * auth, no network) reports "unknown" rather than a false all-clear.
 */
function publishOutcome(tag) {
  if (!tag) return {state: 'unknown'};
  const runs = (workflow, fields) => {
    const out = execFileSync(
      'gh',
      ['run', 'list', `--workflow=${workflow}`, '--limit', '30', '--json', fields],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
    );
    return JSON.parse(out);
  };
  try {
    return publishVerdict({
      tag,
      tagSha: execFileSync('git', ['rev-list', '-n1', tag], {encoding: 'utf8'}).trim(),
      autoTagRuns: runs('auto-tag.yml', 'headSha,conclusion,databaseId,createdAt'),
      releaseRuns: runs('release.yml', 'headSha,conclusion,databaseId,createdAt,displayTitle'),
    });
  } catch {
    return {state: 'unknown'}; // no gh, no auth, no network — say so rather than imply success
  }
}

const failAfter = Number(process.argv.find((a) => a.startsWith('--fail-after='))?.split('=')[1] ?? NaN);
const publish = process.argv.includes('--check-publish') ? publishOutcome(tag) : null;
const stale = state === 'unreleased' && Number.isFinite(failAfter) && (daysStale ?? 0) >= failAfter;
// Only a PROVEN failure breaks the build. 'retried' and 'unknown' are honest uncertainty, and
// failing on those is how a check that has caught real problems earns a reputation for noise.
const publishBroken = publish?.state === 'failed';

const report = {
  state,
  declaredVersion: pkg,
  manifestVersion: manifest,
  lastReleaseTag: tag,
  measuredOn: ref,
  measuredSha: sha,
  measuredByRequest: requested,
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
    console.log(`⚠ ${commits.length} commit(s) on ${ref} are NOT released.`);
    console.log(`  last release ${tag}${daysStale !== null ? ` — ${daysStale} day(s) ago` : ''}`);
    console.log(`  declared version is still ${pkg}, so nothing will publish.`);
  }
  // Which commit these numbers describe, always — on a busy repository the release ref moves
  // between runs, and a bare branch name doesn't say which tip you got. The second line only
  // appears when the checkout is elsewhere: standing on the release ref is the normal case
  // and needs no announcement, but standing somewhere else means none of this is about the
  // code under your cursor, and silence there is how a branch's own commits get read as
  // pending release work.
  console.log(`  measured on ${ref} @ ${sha}${requested ? ' (--ref)' : ''}`);
  if (differsFromCheckout(ref)) {
    console.log(`  your checkout ${currentBranch()} is a different commit and was NOT read`);
  }
  if (fellBack.length) {
    console.log(`  (${fellBack.join(', ')} absent at ${ref}; read from the working tree instead)`);
  }
  if (publish && publish.state !== 'ok') {
    console.log(bar);
    if (publish.state === 'unknown') {
      console.log(`? could not check whether ${tag} finished publishing (no gh / auth / network).`);
    } else if (publish.state === 'retried') {
      console.log(`? ${tag}'s first release run failed and a later one succeeded — run ${publish.id}.`);
      console.log('  That run predates release run naming, so it cannot be tied to this tag.');
      console.log('  Confirm the store shows this version; releases from here on say so outright.');
    } else {
      console.log(`✗ ${tag} is TAGGED but its release run FAILED — it may not have reached the store.`);
      console.log(`  gh run view ${publish.id} --log-failed`);
      console.log('  Re-running auto-tag.yml does NOT help: the tag exists, so detect no-ops.');
      console.log(`  Recover with: gh workflow run release.yml -f tag=${tag}`);
    }
  } else if (publish?.state === 'ok') {
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
