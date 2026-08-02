#!/usr/bin/env node
// Composes the human half of a release body: what changed since the last release, with
// each user-visible change shown as the screenshot its own PR already produced — the SHIPPED
// half of it, where that PR posted a before/after pair (see `assetsByPr`).
//
// Nothing here gathers anything new. Three things that already exist happen to join:
//   1. PRs are SQUASH-merged, so every commit subject on main ends with `(#NN)` — the PR
//      number is never missing (see CLAUDE.md → Contributing).
//   2. PR screenshots are release assets on the `pr-assets` tag, named `pr-<NN>-<what>.png`
//      (same section). The number in the filename is the join key, and a `-before` suffix
//      is the one other part of the name this reads — as "old state, not for the changelog".
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
//   node scripts/release-notes.mjs --ref=<commitish>  end the range somewhere other than main
//   node scripts/release-notes.mjs --no-assets        offline; text only, no `gh` call
//   node scripts/release-notes.mjs | gh release edit v0.22.0 --notes-file -
//
// The last line is the point: `release.yml` writes only the provenance boilerplate, so a
// release body has no human summary at all unless someone adds one.

import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {defaultSince, resolveReleaseRef} from './lib/release-range.mjs';

const ASSET_RELEASE = 'pr-assets'; // the storage-bucket pre-release, not a version

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();

/** `Rule out a Choice item … (#65)` → `{number: 65, title: 'Rule out a Choice item …'}`.
 *  A subject with no trailing PR number is kept, untitled-by-number — squash-merge means
 *  that should not happen on main, but a local commit or a manual merge is not a reason to
 *  drop a change silently from the notes. */
export function parseSubject(subject) {
  const match = /^(.*?)\s*\(#(\d+)\)$/.exec(subject);
  if (!match) return {number: null, title: subject};
  return {number: Number(match[2]), title: match[1]};
}

/** The `-before` half of a PR's before/after pair, matched on the basename so that a shot
 *  legitimately called `pr-99-before-and-after.png` is not caught by accident. */
function isBeforeShot(name) {
  return /-before$/.test(name.replace(/\.[^./]+$/, ''));
}

/**
 * Assets named `pr-<NN>-<anything>` grouped by PR number. Anything else in the release
 * (a stray upload, GitHub's own source tarballs) simply doesn't match and is ignored.
 *
 * A `-before` shot is dropped, and that is a rule about what a changelog may CLAIM rather
 * than a formatting preference. A before shot exists to prove a PR changed something, so it
 * depicts the state that PR replaced. Carried into release notes it becomes a picture of a
 * product we do not ship — exactly what the framing note above exists to prevent — and,
 * unlabelled beside its after shot, it reads as a second feature rather than as the old one.
 * It is worse than a stale image: it is usually a photograph of the bug being fixed.
 *
 * A PR that uploaded ONLY a before shot therefore counts as un-illustrated and falls to the
 * plain list. That is the honest outcome — we have no picture of what actually shipped.
 */
export function assetsByPr(assets) {
  const byPr = new Map();
  for (const asset of assets) {
    const match = /^pr-(\d+)-/.exec(asset.name);
    if (!match || isBeforeShot(asset.name)) continue;
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
  // `--since` picks where the range STARTS, `--ref` where it ends; together they describe
  // any release, not only "everything on main right now". Naming a release TAG as the end
  // starts the range at the tag before it, which is what makes `--ref=v0.22.0` describe
  // v0.22.0 rather than collapsing to the empty `v0.22.0..v0.22.0` (see `defaultSince`).
  const since = arg('since') ?? defaultSince(arg('ref'));
  const {ref, sha, requested, problem} = resolveReleaseRef(
    arg('ref'),
    since,
    arg('since') ? 'the range start' : 'the last release',
  );
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exitCode = 1;
    return;
  }
  const range = since ? `${since}..${ref}` : ref;

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
  console.error(
    `\n${illustrated}/${subjects.length} change(s) illustrated, ` +
      `${since ?? 'the first commit'}..${ref} @ ${sha}${requested ? ' (--ref)' : ''}.`,
  );
  if (assets === null) {
    console.error(`Could not read the ${assetRelease} release (no gh / auth / network) — text only.`);
  }
}

// Run only when invoked directly, so the pure exports above stay importable side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
