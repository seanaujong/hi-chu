// Did the release for a given tag actually FINISH — all the way to the store?
//
// `release-status --check-publish` exists because a tag is not a shipment: v0.20.1 and v0.22.0
// both tagged, both published a GitHub Release, and both failed the Chrome Web Store upload.
// Everything else read `in-sync` while the store sat a version behind.
//
// The hard part is that a release can finish through more than one route, and the routes leave
// different evidence:
//
//   auto-tag → release (workflow_call)  a reusable workflow is a JOB inside the caller's run,
//                                       so it never appears in release.yml's own run list.
//                                       The evidence is the auto-tag run, at the tag's commit.
//   push of a v* tag                    a release.yml run whose head IS the tag's commit.
//   workflow_dispatch (the recovery)    a release.yml run against the DEFAULT BRANCH, with the
//                                       tag passed as an input. Its head commit is main's, so
//                                       nothing about the commit ties it to the tag — which is
//                                       why release.yml sets `run-name: Release <tag>`, making
//                                       the run's own title the join key.
//
// Pure: every reading comes in as an argument. The point is that "a recovery ran and worked"
// is decidable from data, because getting it wrong is expensive in both directions — a false
// failure trains everyone to ignore the one check that has caught real problems, and a false
// success is the silence the check was written to end.

const succeeded = (run) => run.conclusion === 'success';
const finished = (run) => Boolean(run.conclusion);

/**
 * `{state, id?}` where state is:
 *   ok       — proven to have finished
 *   failed   — proven to have failed, with nothing later that fixed it (`id` names the run)
 *   retried  — the original failed, but a LATER release run succeeded that cannot be tied to
 *              this tag. Honest uncertainty, not an alarm: it predates run naming, so no join
 *              key exists. Deliberately does NOT fail a build.
 *   unknown  — no evidence either way
 */
export function publishVerdict({tag, tagSha, autoTagRuns = [], releaseRuns = []}) {
  // A run that NAMES the tag is authoritative for every trigger, and is the only evidence a
  // dispatch leaves at all.
  const named = releaseRuns.filter((r) => r.displayTitle === `Release ${tag}`);
  if (named.some(succeeded)) return {state: 'ok'};

  // A release.yml run standing on the tag's own commit — the `push: tags` route.
  if (releaseRuns.some((r) => r.headSha === tagSha && succeeded(r))) return {state: 'ok'};

  // The ordinary route: auto-tag ran on the commit it then tagged.
  const autoTag = autoTagRuns.find((r) => r.headSha === tagSha);
  if (autoTag && succeeded(autoTag)) return {state: 'ok'};

  const namedFailure = named.find((r) => finished(r) && !succeeded(r));
  if (namedFailure) return {state: 'failed', id: namedFailure.databaseId};

  if (autoTag && finished(autoTag) && !succeeded(autoTag)) {
    // Before run naming there is no way to prove a later success was for THIS tag. Saying
    // "failed" anyway is what turns a fixed release into a permanently red main.
    const later = releaseRuns.find((r) => succeeded(r) && r.createdAt > autoTag.createdAt);
    return later ? {state: 'retried', id: later.databaseId} : {state: 'failed', id: autoTag.databaseId};
  }

  return {state: 'unknown'};
}
