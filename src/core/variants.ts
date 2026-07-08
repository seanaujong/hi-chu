// Collapse the damage of many still-possible sets into the few DISTINCT outcomes a
// player actually needs to see. Under item/ability uncertainty a single move can deal
// several different amounts — Assault Vest halving a special hit is the loud case —
// but most surviving sets land on the SAME number (a defensively-inert item, a shared
// spread). So we group the per-variant calc results by identical outcome: identical
// rolls merge into one bucket, and the tooltip only ever splits when the number truly
// changes. Each surviving bucket is then named by the one dimension that differs.
//
// Pure: variants + their already-computed reports in, labelled buckets out. No calc,
// no DOM — the calc runs in the shell, this only groups and names.

import type {DamageReport} from './damage.js';
import type {SetVariant} from './types.js';

export interface DamageBucket {
  /** '' when there's a single outcome; else what tells it apart ("Assault Vest"). */
  readonly label: string;
  readonly report: DamageReport;
}

/** Two variants share a bucket iff their damage % range and KO chance read identically. */
function resultKey(r: DamageReport): string {
  return `${r.percent.min}|${r.percent.max}|${Math.round(r.koChance * 1000)}`;
}

/** Dedupe strings, preserving first-seen order. */
function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const NO_ITEM = 'no item';

const speciesOf = (bucket: readonly SetVariant[]): string[] => uniqueStrings(bucket.map((v) => v.mon.speciesForme));
const itemsOf = (bucket: readonly SetVariant[]): string[] => uniqueStrings(bucket.map((v) => v.mon.item ?? NO_ITEM));
const abilitiesOf = (bucket: readonly SetVariant[]): string[] => uniqueStrings(bucket.map((v) => v.mon.ability ?? ''));

/**
 * Label each bucket by the values UNIQUE to it on one axis (item, then ability). A
 * bucket with a small distinctive set names itself ("Assault Vest"); a large
 * "everything-else" bucket is named by exclusion of the small ones ("no Assault
 * Vest"). Returns null when the axis can't separate every bucket (e.g. two buckets
 * differ only by spread, both holding the same item) so the caller can try the next.
 */
function labelByAxis(valueSets: readonly (readonly string[])[]): string[] | null {
  const distinctive = valueSets.map((set, i) => set.filter((v) => !valueSets.some((other, j) => j !== i && other.includes(v))));
  if (distinctive.some((d) => d.length === 0)) return null; // this axis doesn't separate every bucket
  const small = distinctive.filter((d) => d.length <= 2).flat();
  return distinctive.map((d) => {
    if (d.length <= 2) return d.join(' / ');
    const others = uniqueStrings(small.filter((v) => !d.includes(v)));
    return others.length ? `no ${others.join(' / ')}` : d.join(' / ');
  });
}

/** Short labels distinguishing the buckets: species axis (a disguised Zoroark is a
 *  DIFFERENT Pokémon — the loudest distinction), else item, else ability, else role name.
 *  Species is null for the usual same-species case, so behaviour is unchanged there. */
export function labelBuckets(buckets: readonly (readonly SetVariant[])[]): string[] {
  if (buckets.length <= 1) return buckets.map(() => '');
  return (
    labelByAxis(buckets.map(speciesOf)) ??
    labelByAxis(buckets.map(itemsOf)) ??
    labelByAxis(buckets.map(abilitiesOf)) ??
    buckets.map((b, i) => b[0]?.role || `set ${i + 1}`)
  );
}

/**
 * Group per-variant calc results into the distinct outcomes, most-damaging first-seen
 * order preserved, each labelled by what sets it apart. One bucket → an empty label
 * and the tooltip renders exactly as it does when the item is known.
 */
export function bucketByDamage(scored: ReadonlyArray<{variant: SetVariant; report: DamageReport}>): DamageBucket[] {
  const groups = new Map<string, {report: DamageReport; variants: SetVariant[]}>();
  for (const {variant, report} of scored) {
    const key = resultKey(report);
    const group = groups.get(key);
    if (group) group.variants.push(variant);
    else groups.set(key, {report, variants: [variant]});
  }
  const buckets = [...groups.values()];
  const labels = labelBuckets(buckets.map((b) => b.variants));
  return buckets.map((b, i) => ({label: labels[i] ?? '', report: b.report}));
}
