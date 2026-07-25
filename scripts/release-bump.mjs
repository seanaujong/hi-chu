#!/usr/bin/env node
// One command for the version bump, because it was never really one edit.
//
// CLAUDE.md's release recipe is "`npm version --no-git-tag-version X.Y.Z` updates
// package.json/package-lock.json; public/manifest.json's version field needs the same bump
// BY HAND." That by-hand half is exactly the kind of step that gets forgotten, which is why
// auto-tag.yml opens with a guard that refuses to release when the two disagree. A guard
// against a manual step is a sign the manual step shouldn't exist.
//
// npm's own `version` command still does the package.json/lock work — defaults first, no
// reimplementation of semver — and this only adds the manifest write and the verification
// that the two now agree.
//
//   npm run release-bump patch     0.19.3 -> 0.19.4
//   npm run release-bump minor     0.19.3 -> 0.20.0
//   npm run release-bump 1.0.0     explicit
//
// It deliberately does NOT commit, tag, or push. The bump lands through the normal branch
// + PR flow like any other change, because merging that PR is the one conscious human
// checkpoint in the pipeline — the thing release-visual-check gates. Automating past it
// would be automating past the only place a human still looks.

import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const MANIFEST = new URL('../public/manifest.json', import.meta.url);
const PKG = new URL('../package.json', import.meta.url);

const arg = process.argv[2];
if (!arg) {
  console.error('usage: npm run release-bump <major|minor|patch|X.Y.Z>');
  process.exit(2);
}

const before = JSON.parse(readFileSync(PKG, 'utf8')).version;

// npm rewrites package.json AND package-lock.json, and validates the argument for us.
execFileSync('npm', ['version', '--no-git-tag-version', arg], {stdio: 'pipe'});
const after = JSON.parse(readFileSync(PKG, 'utf8')).version;

// The manifest is a hand-maintained sibling: rewrite only the version field so the file's
// key order and formatting survive untouched (a JSON round-trip would reorder it).
const raw = readFileSync(MANIFEST, 'utf8');
const patched = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${after}"`);
if (patched === raw) {
  console.error(`✗ could not find a "version" field in public/manifest.json — bump it by hand.`);
  process.exit(1);
}
writeFileSync(MANIFEST, patched);

// The guard auto-tag.yml applies, applied here instead — so a mismatch is caught before
// the PR is even opened rather than after it merges.
const manifestVersion = JSON.parse(readFileSync(MANIFEST, 'utf8')).version;
if (manifestVersion !== after) {
  console.error(`✗ manifest is ${manifestVersion} but package.json is ${after}`);
  process.exit(1);
}

// Chrome Web Store accepts only dot-separated integers, each at most 65535. A semver
// pre-release or build tag ("1.0.0-rc.1", "1.0.0+g1a2b3c") parses fine for npm and is
// rejected at upload — catch it here, not in the store dashboard after a tag exists.
const cwsSafe = after.split('.').every((p) => /^\d+$/.test(p) && Number(p) <= 65535);
if (!cwsSafe) {
  console.error(`✗ "${after}" is not a valid Chrome Web Store version (integers only, each <= 65535).`);
  process.exit(1);
}

console.log(`${before} → ${after}  (package.json, package-lock.json, public/manifest.json)`);
console.log('\nNothing committed. Next:');
console.log(`  git checkout -b release/v${after} && git commit -am "Release v${after}"`);
console.log('  run the release-visual-check skill, then open the PR — merging it releases.');
