#!/usr/bin/env node
// Composes the human half of a release body: what changed since the last release, with
// each user-visible change shown as the before/after image its own PR already produced.
//
// Nothing here gathers anything new. Three things that already exist happen to join:
//   1. PRs are SQUASH-merged, so every commit subject on main ends with `(#NN)` — the PR
//      number is never missing (see CLAUDE.md → Contributing).
//   2. PR screenshots are release assets on the `pr-assets` tag, named `pr-<NN>-<what>.png`
//      (same section). The number in the filename is the join key.
//   3. `release-status.mjs` already defines which commits are unreleased.
// So the changelog is DERIVED, not maintained. There is no list to keep up to date and no
// step anyone can forget; a PR that shipped a screenshot is automatically illustrated here.
//
// WHY THIS IS A CHANGELOG AND NOT A PRODUCT TOUR. Each image shows the UI as of ITS OWN PR.
// When two PRs in one release touch the same surface, the earlier image depicts a state that
// never shipped — so presenting the set as "what the release looks like" would show users a
// product that does not exist. Every image therefore stays under its own `#NN` heading,
// which is an honest claim (this is what that change did) rather than a false one. Framing
// is the whole fix; deduping by surface would need per-image tagging that nothing has earned.
//
// Read-only. Writes nothing, tags nothing, publishes nothing — it prints markdown to stdout,
// so the human who reads it decides whether it becomes a release body:
//
//   node scripts/release-notes.mjs                    the unreleased range (default)
//   node scripts/release-notes.mjs --since=v0.20.0    an explicit starting tag
//   node scripts/release-notes.mjs --no-assets        offline; text only, no `gh` call
//   node scripts/release-notes.mjs | gh release edit v0.22.0 --notes-file -
//
// The last line is the point: `release.yml` writes only the provenance boilerplate, so a
// release body has no human summary at all unless someone adds one.

import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const ASSET_RELEASE = 'pr-assets'; // the storage-bucket pre-release, not a version

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();

/** The highest released version tag, by semver order — NOT by date, so an out-of-order
 *  hotfix tag can't be mistaken for the latest release. Deliberately identical to
 *  `release-status.mjs`: if these two disagreed about where the range starts, the notes
 *  would describe a different release than the status report claims is pending. */
function latestReleaseTag() {
  const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean);
  return tags[0] ?? null;
}

/** `Rule out a Choice item … (#65)` → `{number: 65, title: 'Rule out a Choice item …'}`.
 *  A subject with no trailing PR number is kept, untitled-by-number — squash-merge means
 *  that should not happen on main, but a local commit or a manual merge is not a reason to
 *  drop a change silently from the notes. */
export function parseSubject(subject) {
  const match = /^(.*?)\s*\(#(\d+)\)$/.exec(subject);
  if (!match) return {number: null, title: subject};
  return {number: Number(match[2]), title: match[1]};
}

/** Assets named `pr-<NN>-<anything>` grouped by PR number. Anything else in the release
 *  (a stray upload, GitHub's own source tarballs) simply doesn't match and is ignored. */
export function assetsByPr(assets) {
  const byPr = new Map();
  for (const asset of assets) {
    const match = /^pr-(\d+)-/.exec(asset.name);
    if (!match) continue;
    const pr = Number(match[1]);
    byPr.set(pr, [...(byPr.get(pr) ?? []), asset]);
  }
  return byPr;
}

/**
 * The pure core: subjects + assets → markdown. No git, no network, no clock.
 *
 * Illustrated changes lead because they are the ones a user notices, and each keeps its own
 * heading (see the framing note above). Everything else follows as a plain list rather than
 * being interleaved, which otherwise reads as a heading, one bullet, another heading.
 */
export function composeNotes(subjects, byPr) {
  const parsed = subjects.map(parseSubject);
  const illustrated = (c) => c.number !== null && byPr.has(c.number);
  const shown = parsed.filter(illustrated);
  const rest = parsed.filter((c) => !illustrated(c));

  const out = [];
  if (shown.length) {
    out.push("## What's new");
    for (const {number, title} of shown) {
      out.push('', `### ${title} (#${number})`, '');
      for (const asset of byPr.get(number)) out.push(`![${title}](${asset.url})`);
    }
    if (rest.length) out.push('', '## Also in this release', '');
  }
  for (const {number, title} of rest) {
    out.push(number === null ? `- ${title}` : `- ${title} (#${number})`);
  }
  return out.join('\n').trim() + '\n';
}

/** Assets on the screenshot release. Any failure to ask — no `gh`, no auth, no network, no
 *  such release yet — degrades to "no images" rather than aborting: text-only notes are
 *  still worth having, and a hard failure here would make the script useless offline. */
function fetchAssets(release) {
  try {
    const json = execFileSync('gh', ['release', 'view', release, '--json', 'assets'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(json).assets ?? [];
  } catch {
    return null; // null = could not ask, distinct from [] = asked, none there
  }
}

function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const since = arg('since') ?? latestReleaseTag();
  const range = since ? `${since}..HEAD` : 'HEAD';

  const subjects = git('log', '--format=%s', '--no-merges', range).split('\n').filter(Boolean);
  if (!subjects.length) {
    console.error(`Nothing to describe — no commits in ${range}.`);
    return;
  }

  const assetRelease = arg('assets') ?? ASSET_RELEASE;
  const assets = process.argv.includes('--no-assets') ? [] : fetchAssets(assetRelease);
  const byPr = assetsByPr(assets ?? []);

  process.stdout.write(composeNotes(subjects, byPr));

  // Progress goes to stderr so stdout stays a clean pipe into `gh release edit --notes-file -`.
  const illustrated = subjects.map(parseSubject).filter((c) => c.number !== null && byPr.has(c.number)).length;
  console.error(`\n${illustrated}/${subjects.length} change(s) illustrated, from ${since ?? 'the first commit'}.`);
  if (assets === null) {
    console.error(`Could not read the ${assetRelease} release (no gh / auth / network) — text only.`);
  }
}

// Run only when invoked directly, so the pure exports above stay importable side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
