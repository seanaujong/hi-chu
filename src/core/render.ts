// Turn damage reports into the HTML we splice into Showdown's tooltip.
//
// Pure: a model in, a string out. That is deliberate — rendering is the part most
// tempting to "just eyeball in the browser", so we make the frame a value and
// snapshot it. No DOM, no @smogon/calc here.

import type {DamageReport} from './damage.js';

export interface RenderModel {
  readonly defenderName: string;
  /** Defender current HP as a fraction in [0,1]. */
  readonly defenderHpPercent: number;
  /** Active Tera type of the attacker (the hovered Pokémon), if terastallized. */
  readonly attackerTera?: string;
  /** Active Tera type of the defender, if terastallized. */
  readonly defenderTera?: string;
  readonly reports: readonly DamageReport[];
  /** Caveats to surface (field effects omitted, role uncertainty, …). */
  readonly extraNotes: readonly string[];
}

/** Escape the few characters that matter when injecting into innerHTML. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
}

/** A 0..1 fraction as a tidy percentage string ("100%", "62.5%"). */
function pct1(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/** A raw HP amount as a percentage of the defender's max HP. */
function asPercent(raw: number, maxHP: number): number {
  return Math.round((raw / maxHP) * 1000) / 10;
}

/** Human-readable single-use KO chance. */
export function koText(chance: number): string {
  if (chance >= 0.9995) return 'guaranteed KO';
  if (chance <= 0) return '';
  if (chance < 0.005) return '<1% to KO';
  return `${Math.round(chance * 100)}% to KO`;
}

/** The "≈3.1 hits" / per-hit detail line for a multi-hit move. */
function multiHitDetail(r: DamageReport): string {
  if (!r.multiHit) return '';
  if (r.approximate || !r.hits || !r.perHit) return ' · multi-hit (approx.)';
  const hits = `≈${Math.round(r.hits.expected * 10) / 10} hits`;
  const perHit = `${asPercent(r.perHit.min, r.defenderMaxHP)}–${asPercent(r.perHit.max, r.defenderMaxHP)}% per hit`;
  return ` · ${hits} · ${perHit}`;
}

function damageRow(r: DamageReport): string {
  const dmg = `${r.percent.min}–${r.percent.max}% (${r.percent.mean}%)`;
  const ko = koText(r.koChance);
  const koSpan = ko ? ` <span class="rbtb-ko">${ko}</span>` : '';
  const sub = multiHitDetail(r);
  const subDiv = sub ? `<div class="rbtb-sub">${esc(sub.replace(/^ · /, ''))}</div>` : '';
  return (
    `<div class="rbtb-row"><span class="rbtb-mv">${esc(r.move)}</span> ` +
    `<span class="rbtb-dmg">${dmg}</span>${koSpan}${subDiv}</div>`
  );
}

const STYLE_ID = 'rbtb-style';

/** A one-time <style> block; the content script injects it once into the page. */
export const TOOLTIP_STYLE = `
<style id="${STYLE_ID}">
.rbtb { margin-top: 5px; padding-top: 4px; border-top: 1px solid rgba(128,128,128,.4); font-size: 10px; }
.rbtb-h { margin: 0 0 2px; font-size: 10px; font-weight: bold; opacity: .85; }
.rbtb-row { line-height: 1.35; }
.rbtb-mv { font-weight: bold; }
.rbtb-dmg { opacity: .95; }
.rbtb-ko { color: #c0392b; font-weight: bold; }
.rbtb-sub { opacity: .7; padding-left: 6px; }
.rbtb-status, .rbtb-note { opacity: .65; margin-top: 2px; }
.rbtb-note { color: #b9770e; }
.rbtb-tera { color: #8e44ad; font-weight: bold; }
</style>`;

/**
 * The tooltip section HTML for one matchup. Damaging moves are ranked by mean
 * damage; status moves are summarised on one line; caveats follow.
 */
export function renderDamageSection(model: RenderModel): string {
  const damaging = model.reports
    .filter((r) => r.category !== 'Status')
    .slice()
    .sort((a, b) => b.percent.mean - a.percent.mean);
  const statusMoves = model.reports.filter((r) => r.category === 'Status').map((r) => r.move);

  const teraBits: string[] = [];
  if (model.attackerTera) teraBits.push(`Tera ${esc(model.attackerTera)}`);
  if (model.defenderTera) teraBits.push(`vs Tera ${esc(model.defenderTera)}`);
  const teraLine = teraBits.length ? ` <span class="rbtb-tera">[${teraBits.join(' ')}]</span>` : '';

  const header =
    `<h4 class="rbtb-h">⚔ vs ${esc(model.defenderName)} (${pct1(model.defenderHpPercent)})${teraLine}</h4>`;

  const rows = damaging.length
    ? damaging.map(damageRow).join('')
    : `<div class="rbtb-row" style="opacity:.6">no damaging moves</div>`;

  const status = statusMoves.length
    ? `<div class="rbtb-status">Status: ${esc(statusMoves.join(', '))}</div>`
    : '';

  const notes = model.extraNotes.map((n) => `<div class="rbtb-note">⚠ ${esc(n)}</div>`).join('');

  return `<div class="rbtb">${header}${rows}${status}${notes}</div>`;
}
